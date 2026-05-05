# Spec — CI Release + Deploy Version Workflows

## Contexte

Aujourd'hui, le déploiement des apps est couplé au build via `dashboard/build-deploy.yml`.
L'objectif est de découpler les deux responsabilités :

- **App repo** : CI uniquement — build + push image GHCR sur déclenchement manuel
- **Infra** : logique de déploiement — choisir une version et la pousser sur le VPS via Vault

---

## Architecture cible

```
App repo
  └── .github/workflows/release.yml   ← workflow_dispatch (patch/minor/major)
        └── appelle ci-release.yml@infra

Infra repo
  ├── .github/workflows/ci-release.yml      ← workflow_call réutilisable
  └── .github/workflows/deploy-version.yml  ← workflow_dispatch (app_name + version)
```

---

## Workflow 1 — `ci-release.yml` (réutilisable)

**Fichier :** `infra/.github/workflows/ci-release.yml`

**Déclencheur :** `workflow_call` uniquement

**Inputs :**

| Nom | Type | Description |
|-----|------|-------------|
| `app_name` | string | Nom de l'image Docker sur GHCR (ex: `my-chess-game`) |
| `bump_type` | choice (patch/minor/major) | Type de bump sémantique |

**Permissions requises (héritées du repo appelant) :**
- `contents: write` — créer le tag git + la release GitHub
- `packages: write` — push l'image sur GHCR

**Étapes :**

1. Checkout du repo appelant (avec `fetch-depth: 0` pour avoir tous les tags)
2. Lire le dernier tag git (`git describe --tags --abbrev=0`, fallback `v0.0.0`)
3. Calculer le nouveau tag selon `bump_type` :
   - `patch` : `v1.2.3` → `v1.2.4`
   - `minor` : `v1.2.3` → `v1.3.0`
   - `major` : `v1.2.3` → `v2.0.0`
4. Login GHCR
5. Build + push image :
   - `ghcr.io/voikyrioh/<app_name>:<new_version>`
   - `ghcr.io/voikyrioh/<app_name>:latest`
6. Créer le git tag `<new_version>` sur le commit courant
7. Créer la GitHub Release avec `--generate-notes`

**Wrapper dans chaque app repo :**

Fichier : `.github/workflows/release.yml`

```yaml
on:
  workflow_dispatch:
    inputs:
      bump_type:
        description: "Type de release"
        type: choice
        options: [patch, minor, major]
        default: patch

jobs:
  release:
    uses: voikyrioh/infra-as-code/.github/workflows/ci-release.yml@main
    with:
      app_name: <image-name>
      bump_type: ${{ inputs.bump_type }}
    secrets: inherit
    permissions:
      contents: write
      packages: write
```

---

## Workflow 2 — `deploy-version.yml`

**Fichier :** `infra/.github/workflows/deploy-version.yml`

**Déclencheur :** `workflow_dispatch` (manuel ou via API GitHub par le dashboard)

**Inputs :**

| Nom | Type | Description |
|-----|------|-------------|
| `app_name` | string | Nom du fichier dans `apps/` (ex: `chess`) |
| `version` | string | Tag de version à déployer (ex: `v1.2.3`) |

**Permissions :** `contents: read`

**Étapes :**

1. Checkout du repo infra
2. Valider que `apps/<app_name>.yml` existe
3. Installer le Vault CLI (via apt HashiCorp)
4. S'authentifier à Vault (AppRole infra : `VAULT_ROLE_ID` + `VAULT_SECRET_ID`)
5. Générer `.env` :
   - `IMAGE_TAG=<version>`
   - Secrets Vault depuis `secret/apps/<app_name>` (optionnel, tolère l'absence)
6. SCP `.env` → `/opt/infra/apps/<app_name>/` sur le VPS
7. SSH → `docker compose pull && docker compose up -d --remove-orphans`

**GitHub Secrets requis (repo infra) :**
```
VAULT_ADDR, VAULT_ROLE_ID, VAULT_SECRET_ID
VPS_HOST, VPS_SSH_KEY, VPS_SSH_PORT
```

---

## Fichiers à créer / modifier

| Fichier | Action |
|---------|--------|
| `infra/.github/workflows/ci-release.yml` | Créer |
| `infra/.github/workflows/deploy-version.yml` | Créer |
| `chess/.github/workflows/release.yml` | Créer (wrapper) |
| `slay-the-slime/.github/workflows/release.yml` | Créer (wrapper) |

Le workflow `deploy-app.yml` existant reste inchangé — il continue à gérer les éventuels déploiements continus si des app repos l'utilisent.

---

## Points d'attention

- **`fetch-depth: 0`** dans le checkout est indispensable pour que `git describe --tags` trouve les tags existants.
- **`secrets: inherit`** dans le wrapper permet de passer `GITHUB_TOKEN` du repo appelant au workflow réutilisable — nécessaire pour créer le tag et pusher sur GHCR.
- **Fallback `v0.0.0`** : si aucun tag n'existe dans le repo, le premier bump patch donnera `v0.0.1`.
- Le dashboard (phase suivante) déclenchera `deploy-version.yml` via `POST /repos/voikyrioh/infra-as-code/actions/workflows/deploy-version.yml/dispatches` avec `ref: main` et les inputs `app_name` + `version`.
