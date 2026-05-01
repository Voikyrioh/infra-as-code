# Provision New App — Design Spec

## Contexte

Quand une nouvelle app est ajoutée à l'infrastructure (ex: `chess`), deux opérations manuelles sont nécessaires avant le premier déploiement :

1. **Secrets GitHub** — configurer les 5 secrets SSH sur le repo de l'app (`SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_HOST_FINGERPRINT`) pour que le workflow réutilisable `voikyrioh/dashboard/.github/workflows/build-deploy.yml` puisse déployer.
2. **Provisioning VPS** — créer `/opt/infra/apps/<app_name>/` avec un `docker-compose.yml` (labels Traefik) et un `.env` initial.

Ce workflow automatise ces deux étapes en un seul déclenchement depuis GitHub.

---

## Workflow : `.github/workflows/provision-app.yml`

### Déclencheur

`workflow_dispatch` — déclenché manuellement depuis l'UI GitHub ou via `gh workflow run`.

### Inputs

| Input | Type | Required | Description | Exemple |
|---|---|---|---|---|
| `target_repo` | string | ✅ | Nom du repo GitHub à provisionner | `chess` |
| `app_name` | string | ✅ | Nom du dossier sur le VPS et du container | `chess` |
| `subdomain` | string | ✅ | Sous-domaine Traefik (→ `<subdomain>.voikyrioh.fr`) | `chess` |
| `port` | string | ✅ | Port interne exposé par le container | `3000` |

### Prérequis

**Nouveau secret à ajouter dans le repo `infra` (une seule fois) :**

| Secret | Description |
|---|---|
| `GH_PAT` | Personal Access Token avec `secrets:write` sur les repos cibles. Fine-grained PAT : permission "Secrets" → Read and write sur les repos voikyrioh/*. |

**Secrets existants déjà dans infra (réutilisés) :**
`VPS_SSH_KEY`, `VPS_HOST`, `VPS_SSH_PORT`

---

## Job : `provision`

### Étape 1 — Calcul du SSH fingerprint

```bash
FINGERPRINT=$(ssh-keyscan -p $VPS_SSH_PORT $VPS_HOST 2>/dev/null)
echo "fingerprint=$FINGERPRINT" >> $GITHUB_OUTPUT
```

Résultat stocké via `$GITHUB_OUTPUT` et référencé comme `steps.<id>.outputs.fingerprint` dans les étapes suivantes. Évite de stocker le fingerprint en dur.

### Étape 2 — Set secrets GitHub sur le repo cible

Via `gh secret set --repo voikyrioh/{target_repo}` avec `GH_TOKEN=${{ secrets.GH_PAT }}`.

Mapping des secrets infra → secrets dashboard workflow :

| Secret infra | Secret posé sur target repo | Valeur |
|---|---|---|
| `VPS_SSH_KEY` | `SSH_PRIVATE_KEY` | Clé privée SSH multi-ligne |
| `VPS_HOST` | `SSH_HOST` | IP ou hostname du VPS |
| `VPS_SSH_PORT` | `SSH_PORT` | Port SSH |
| *(hardcodé)* | `SSH_USER` | `deploy` |
| *(calculé)* | `SSH_HOST_FINGERPRINT` | Output ssh-keyscan |

Les valeurs sont passées via variables d'environnement au step (jamais injectées directement dans le shell).

### Étape 3 — Génération du `docker-compose.yml`

Généré localement sur le runner depuis le template `exemples/app-docker-compose.yml` avec substitution de `app_name`, `subdomain`, `port` via les env vars. Le fichier est écrit dans `/tmp/docker-compose.yml`.

**Template de sortie :**
```yaml
services:
  app:
    image: ghcr.io/voikyrioh/{app_name}:${IMAGE_TAG:-latest}
    container_name: {app_name}
    restart: unless-stopped
    environment:
      - NODE_ENV=production
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.{app_name}.rule=Host(`{subdomain}.voikyrioh.fr`)"
      - "traefik.http.routers.{app_name}.entrypoints=websecure"
      - "traefik.http.routers.{app_name}.tls.certresolver=cloudflare"
      - "traefik.http.services.{app_name}.loadbalancer.server.port={port}"
      - "traefik.http.routers.{app_name}.middlewares=secure-headers@file"
networks:
  proxy:
    external: true
```

### Étape 4 — Setup SSH sur le runner

```bash
mkdir -p ~/.ssh
echo "$VPS_SSH_KEY" > ~/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa
ssh-keyscan -p {VPS_SSH_PORT} {VPS_HOST} >> ~/.ssh/known_hosts
```

### Étape 5 — Provisioning VPS

Trois opérations SSH/SCP (séquentielles) :

1. **Créer le dossier** :
   ```bash
   ssh -p {port} deploy@{host} "mkdir -p /opt/infra/apps/{app_name}"
   ```

2. **Copier le docker-compose.yml** :
   ```bash
   scp -P {port} /tmp/docker-compose.yml deploy@{host}:/opt/infra/apps/{app_name}/docker-compose.yml
   ```

3. **Créer le `.env` (idempotent)** :
   ```bash
   ssh -p {port} deploy@{host} \
     "[ ! -f /opt/infra/apps/{app_name}/.env ] && echo 'IMAGE_TAG=latest' > /opt/infra/apps/{app_name}/.env || true"
   ```

L'opération `.env` est idempotente : si le fichier existe déjà (app re-provisionnée), il n'est pas écrasé.

### Étape 6 — Cleanup SSH

```bash
rm -rf ~/.ssh
```

Toujours exécuté via `if: always()`.

---

## Sécurité

- `VPS_SSH_KEY`, `VPS_HOST`, `VPS_SSH_PORT`, `GH_PAT` sont passés via env vars, jamais interpolés directement dans le shell
- `inputs.*` (app_name, subdomain, port) sont des strings simples — pas d'exécution distante avec ces valeurs, uniquement des chemins de fichiers et des labels YAML
- `permissions: {}` sur le job (pas de `GITHUB_TOKEN` nécessaire)
- Cleanup SSH en `if: always()`

---

## Flux complet après provisioning

```
1. provision-app.yml déclenché (target_repo=chess, app_name=chess, subdomain=chess, port=3000)
   ↓
2. Secrets SSH posés sur voikyrioh/chess
   ↓
3. /opt/infra/apps/chess/docker-compose.yml créé sur le VPS
4. /opt/infra/apps/chess/.env créé (IMAGE_TAG=latest)
   ↓
5. Développeur ajoute .github/workflows/build-deploy.yml dans chess
   (copie de voikyrioh/dashboard/examples/build-deploy.yml, app-name: chess)
   ↓
6. workflow_dispatch depuis chess → build image → deploy SSH → Traefik détecte les labels → HTTPS live
   ↓
7. Dashboard sync → chess apparaît dans la liste des apps
```
