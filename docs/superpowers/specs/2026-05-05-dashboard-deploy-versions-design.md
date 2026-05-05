# Dashboard — Deploy Versions Design

## Goal

Permettre depuis le dashboard de voir les versions disponibles pour chaque app et de déclencher un déploiement sans manipulation manuelle sur le VPS.

## Architecture

### Source de vérité

Les apps sont découvertes en lisant `apps/*.yml` dans le repo `infra-as-code` via l'API GitHub Contents (remplace la recherche GitHub Code sur `build-deploy.yml`). Chaque fichier YAML fournit l'identifiant infra (`name`), le repo GitHub (`github_repo`) et l'image GHCR (`image`).

### Flux de données

```
Sync :
  GitHub Contents API (apps/*.yml)
    → parse YAML (base64 decode + js-yaml)
    → upsert apps (app_name, repo_name, image_name)

Get versions :
  GHCR API (/users/{owner}/packages/container/{imageName}/versions)
    → filtrer tags vX.Y.Z
    → trier desc

Get deployed version :
  Docker socket (/containers/{containerName}/json)
    → Config.Image → extraire tag après ":"

Deploy :
  GitHub Actions API (/repos/{owner}/{infraRepo}/actions/workflows/deploy-version.yml/dispatches)
    → inputs: { app_name, version }
```

## Backend

### DB — migration

Deux nouvelles colonnes sur `apps` :

| Colonne | Type | Nullable | Description |
|---------|------|----------|-------------|
| `app_name` | `varchar` | yes | Identifiant infra (ex: `chess`), clé pour `deploy-version.yml` |
| `image_name` | `varchar` | yes | Nom du package GHCR (ex: `my-chess-game`), clé pour l'API GHCR |

### Config

Nouveau paramètre : `GITHUB_INFRA_REPO` (env var, default `infra-as-code`).

### Modèle DB mis à jour

`AppModel` étendu :
```typescript
app_name: z.string().nullable()
image_name: z.string().nullable()
```

### Entités

`AppEntity` étendu :
```typescript
appName: z.string().nullable()
imageName: z.string().nullable()
```

`AppWithStatus` étendu :
```typescript
deployedVersion: z.string().nullable().default(null)
```

### Services

**`ghcr.service.ts`**
- `getImageVersions(imageName: string): Promise<string[]>`
- `GET https://api.github.com/users/{owner}/packages/container/{imageName}/versions`
- Headers: `Authorization: Bearer {token}`, `Accept: application/vnd.github+json`
- Filtre les versions ayant au moins un tag `vX.Y.Z`
- Retourne les tags triés desc (plus récent en premier)

**`container-status.service.ts` (mis à jour)**
- Le type de retour change : `{ status: ContainerStatus, version: string | null }`
- Un seul appel Docker (`/containers/{name}/json`) retourne à la fois l'état (`State.Running`) et la version (`Config.Image` → extrait tag après `:`)
- Retourne `{ status: 'unknown', version: null }` si le container n'existe pas

**`github-dispatch.service.ts`**
- `triggerDeploy(appName: string, version: string): Promise<void>`
- `POST https://api.github.com/repos/{owner}/{infraRepo}/actions/workflows/deploy-version.yml/dispatches`
- Body: `{ ref: "main", inputs: { app_name: appName, version } }`
- Lève `AppError('internal-server-error', ...)` si la réponse n'est pas 204

### Use-cases

**`SyncApps` (remplacé)**
1. `GET /repos/{owner}/{infraRepo}/contents/apps` → liste des fichiers `.yml`
2. Pour chaque fichier : `GET /repos/{owner}/{infraRepo}/contents/apps/{file}` → contenu base64
3. Décoder + parser YAML (via `js-yaml`)
4. Extraire : `name` → `appName`, `github_repo` → `repoName` (partie après `/`), `image` → `imageName` (partie après le dernier `/`)
5. Upsert dans `apps` avec les 3 champs
6. Retourner toutes les apps

**`GetApps` (mis à jour)**
- Pour chaque app configurée avec `containerName` : appeler `getContainerStatus` (qui retourne maintenant `{ status, version }`)
- Inclure `deployedVersion` dans `AppWithStatus` à partir de `version`

**`GetAppVersions` (nouveau)**
- Input : `id: string`
- Chercher l'app en DB → vérifier `imageName` non null
- Appeler `getImageVersions(imageName)`
- Retourner `string[]`

**`DeployVersion` (nouveau)**
- Input : `id: string, version: string`
- Valider `version` avec regex `^v\d+\.\d+\.\d+$`
- Chercher l'app en DB → vérifier `appName` non null
- Appeler `triggerDeploy(appName, version)`
- Retourner `void`

### Routes

```
GET  /apps/:id/versions   → GetAppVersions.Execute(id)      → string[]
POST /apps/:id/deploy     → DeployVersion.Execute(id, body.version)  → 204
```

Schema de validation pour `POST /apps/:id/deploy` :
```typescript
z.object({ version: z.string().regex(/^v\d+\.\d+\.\d+$/) })
```

## Frontend

### Interfaces mises à jour

```typescript
// apps.service.ts
interface App {
  // ... existant ...
  appName: string | null        // nouveau
  imageName: string | null      // nouveau
  deployedVersion: string | null  // nouveau
}
```

### Nouveaux appels API

```typescript
// apps.service.ts
fetchAppVersions(id: string): Promise<string[]>
deployApp(id: string, version: string): Promise<void>
```

### Store mis à jour

```typescript
// apps.store.ts
async function deploy(id: string, version: string): Promise<void>
// Appelle deployApp(), puis recharge l'app concernée via loadApps()
```

### Nouveau composant atom : `VersionSelect`

**Fichier :** `src/components/atoms/VersionSelect/VersionSelect.vue`

**Props :**
```typescript
versions: string[]         // liste des versions dispo (vX.Y.Z, triées desc)
deployedVersion: string | null  // version actuellement déployée
disabled: boolean          // true si pas de versions ou app non configurée
```

**Emits :** `deploy(version: string)`

**Comportement :**
- À l'initialisation : `selected = deployedVersion ?? versions[0] ?? ''`
- Input cliquable → ouvre le dropdown, rend l'input éditable pour filtrer
- Filtrage en temps réel sur la valeur tapée (correspondance partielle)
- Sélection d'une version dans le dropdown → ferme le dropdown, met à jour `selected`
- Clic hors composant → ferme le dropdown
- Couleur du composant :
  - Vert (`#166534` / `#4ade80`) si `selected === deployedVersion`
  - Orange (`#92400e` / `#fb923c`) si `selected !== deployedVersion`
- Label du bouton : `↑ Déployer` si vert, `↓ Rollback` si orange
- État désactivé : input placeholder "aucune version", bouton grisé, cursor not-allowed

### `AppRow` mis à jour

**Grid :** `2fr 1fr 2fr 100px auto` (5 colonnes — la colonne "Deploy Status" disparaît)

**Nouvelles props :** `versions: string[]`, `deployedVersion: string | null`

**Nouveau comportement :**
- Émet `deploy(appId, version)` → le parent appelle `store.deploy()`
- Pendant le déploiement : composant VersionSelect désactivé + spinner sur le bouton
- Après succès : `loadApps()` pour rafraîchir `deployedVersion`

### `ApplicationsPage` mis à jour

- Charge les versions de chaque app configurée au montage (`fetchAppVersions` par app)
- Stocke les versions dans un `Map<appId, string[]>` local (réf dans la page)
- Gère l'état de déploiement en cours (`deploying: Set<appId>`)
- Passe `versions` et `deployedVersion` à chaque `AppRow`

## Comportement end-to-end

1. Page chargée → `loadApps()` + `fetchAppVersions()` pour chaque app configurée en parallèle
2. Chaque ligne affiche la version déployée pré-sélectionnée dans le VersionSelect
3. Utilisateur change la version → couleur orange + label "Rollback"
4. Utilisateur clique "Déployer" → `POST /apps/:id/deploy` → GitHub déclenche `deploy-version.yml`
5. Le workflow tourne en asynchrone sur GitHub (~1-2 min)
6. L'utilisateur rafraîchit manuellement pour voir la nouvelle version déployée

## Dépendances nouvelles

- Backend : `js-yaml` (parser YAML pour lire `apps/*.yml`)
- Frontend : aucune nouvelle dépendance
