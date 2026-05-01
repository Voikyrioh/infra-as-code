# Provision New App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer un workflow GitHub Actions `provision-app.yml` qui automatise la pose des secrets SSH sur un repo cible et la création des fichiers de déploiement sur le VPS.

**Architecture:** Un seul job `provision` déclenché manuellement via `workflow_dispatch`. Il enchaîne 6 étapes séquentielles : calcul du fingerprint SSH → set des 5 secrets GitHub sur le repo cible → génération du `docker-compose.yml` par heredoc → setup SSH sur le runner → 3 opérations SSH/SCP sur le VPS → cleanup SSH. Aucun `GITHUB_TOKEN` requis sur le job (permissions: {}), seul le PAT `GH_PAT` est utilisé pour les secrets GitHub.

**Tech Stack:** GitHub Actions YAML, `gh` CLI (pré-installé sur `ubuntu-latest`), OpenSSH (`ssh`, `ssh-keyscan`, `scp`), `actionlint` pour validation locale.

---

## File Structure

| Fichier | Action | Rôle |
|---|---|---|
| `examples/app-docker-compose.yml` | Créer | Template de référence documentaire pour un développeur qui fait le provisioning manuellement |
| `.github/workflows/provision-app.yml` | Créer | Workflow principal `workflow_dispatch` |
| `CLAUDE.md` | Modifier | Ajouter `GH_PAT` dans la liste des secrets GitHub requis |

---

### Task 1: Template de référence `examples/app-docker-compose.yml`

**Files:**
- Create: `examples/app-docker-compose.yml`

Ce fichier documente la structure attendue d'un `docker-compose.yml` d'app. Il utilise des placeholders `<app_name>` etc. pour que le développeur sache quoi remplacer. Il n'est **pas** utilisé directement par le workflow (le workflow génère son propre fichier par heredoc) — c'est une référence pour les provisioning manuels.

- [ ] **Step 1: Créer le fichier template**

Créer `examples/app-docker-compose.yml` avec ce contenu exact :

```yaml
# Template docker-compose.yml pour une nouvelle app
# Remplacer <app_name>, <subdomain>, <port> avant usage manuel.
# Le workflow provision-app.yml génère ce fichier automatiquement.

services:
  app:
    image: ghcr.io/voikyrioh/<app_name>:${IMAGE_TAG:-latest}
    container_name: <app_name>
    restart: unless-stopped
    environment:
      - NODE_ENV=production
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.<app_name>.rule=Host(`<subdomain>.voikyrioh.fr`)"
      - "traefik.http.routers.<app_name>.entrypoints=websecure"
      - "traefik.http.routers.<app_name>.tls.certresolver=cloudflare"
      - "traefik.http.services.<app_name>.loadbalancer.server.port=<port>"
      - "traefik.http.routers.<app_name>.middlewares=secure-headers@file"
networks:
  proxy:
    external: true
```

- [ ] **Step 2: Valider la syntaxe YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('examples/app-docker-compose.yml').read()); print('OK')"
```

Résultat attendu : `OK`

- [ ] **Step 3: Commit**

```bash
git add examples/app-docker-compose.yml
git commit -m "feat: add app docker-compose template"
```

---

### Task 2: Workflow `.github/workflows/provision-app.yml`

**Files:**
- Create: `.github/workflows/provision-app.yml`

C'est le cœur de la feature. Le workflow enchaîne 6 étapes. Toutes les valeurs sensibles (`VPS_SSH_KEY`, `VPS_HOST`, `VPS_SSH_PORT`, `GH_PAT`) sont lues depuis les secrets GitHub et passées via des variables d'environnement au shell — jamais interpolées directement dans du code bash (prévention d'injection).

Les inputs utilisateur (`app_name`, `subdomain`, `port`) ne sont jamais passés à une commande SSH distante : ils servent uniquement à construire des chemins locaux et du contenu YAML.

- [ ] **Step 1: Créer le fichier workflow**

Créer `.github/workflows/provision-app.yml` avec ce contenu exact :

```yaml
name: Provision New App

on:
  workflow_dispatch:
    inputs:
      target_repo:
        description: "Nom du repo GitHub à provisionner (ex: chess)"
        required: true
        type: string
      app_name:
        description: "Nom du dossier sur le VPS et du container"
        required: true
        type: string
      subdomain:
        description: "Sous-domaine Traefik (→ <subdomain>.voikyrioh.fr)"
        required: true
        type: string
      port:
        description: "Port interne exposé par le container"
        required: true
        type: string

jobs:
  provision:
    runs-on: ubuntu-latest
    permissions: {}

    steps:
      - name: Calcul du SSH fingerprint
        id: fingerprint
        env:
          VPS_HOST: ${{ secrets.VPS_HOST }}
          VPS_SSH_PORT: ${{ secrets.VPS_SSH_PORT }}
        run: |
          FINGERPRINT=$(ssh-keyscan -p "$VPS_SSH_PORT" "$VPS_HOST" 2>/dev/null)
          echo "fingerprint=$FINGERPRINT" >> "$GITHUB_OUTPUT"

      - name: Set secrets GitHub sur le repo cible
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
          VPS_SSH_KEY: ${{ secrets.VPS_SSH_KEY }}
          VPS_HOST: ${{ secrets.VPS_HOST }}
          VPS_SSH_PORT: ${{ secrets.VPS_SSH_PORT }}
          SSH_FINGERPRINT: ${{ steps.fingerprint.outputs.fingerprint }}
          TARGET_REPO: ${{ inputs.target_repo }}
        run: |
          gh secret set SSH_PRIVATE_KEY --repo "voikyrioh/$TARGET_REPO" --body "$VPS_SSH_KEY"
          gh secret set SSH_HOST        --repo "voikyrioh/$TARGET_REPO" --body "$VPS_HOST"
          gh secret set SSH_PORT        --repo "voikyrioh/$TARGET_REPO" --body "$VPS_SSH_PORT"
          gh secret set SSH_USER        --repo "voikyrioh/$TARGET_REPO" --body "deploy"
          gh secret set SSH_HOST_FINGERPRINT --repo "voikyrioh/$TARGET_REPO" --body "$SSH_FINGERPRINT"

      - name: Génération du docker-compose.yml
        env:
          APP_NAME: ${{ inputs.app_name }}
          SUBDOMAIN: ${{ inputs.subdomain }}
          APP_PORT: ${{ inputs.port }}
        run: |
          cat > /tmp/docker-compose.yml << EOF
          services:
            app:
              image: ghcr.io/voikyrioh/${APP_NAME}:\${IMAGE_TAG:-latest}
              container_name: ${APP_NAME}
              restart: unless-stopped
              environment:
                - NODE_ENV=production
              networks:
                - proxy
              labels:
                - "traefik.enable=true"
                - "traefik.http.routers.${APP_NAME}.rule=Host(\`${SUBDOMAIN}.voikyrioh.fr\`)"
                - "traefik.http.routers.${APP_NAME}.entrypoints=websecure"
                - "traefik.http.routers.${APP_NAME}.tls.certresolver=cloudflare"
                - "traefik.http.services.${APP_NAME}.loadbalancer.server.port=${APP_PORT}"
                - "traefik.http.routers.${APP_NAME}.middlewares=secure-headers@file"
          networks:
            proxy:
              external: true
          EOF

      - name: Setup SSH sur le runner
        env:
          VPS_SSH_KEY: ${{ secrets.VPS_SSH_KEY }}
          VPS_HOST: ${{ secrets.VPS_HOST }}
          VPS_SSH_PORT: ${{ secrets.VPS_SSH_PORT }}
        run: |
          mkdir -p ~/.ssh
          echo "$VPS_SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan -p "$VPS_SSH_PORT" "$VPS_HOST" >> ~/.ssh/known_hosts

      - name: Provisioning VPS
        env:
          VPS_HOST: ${{ secrets.VPS_HOST }}
          VPS_SSH_PORT: ${{ secrets.VPS_SSH_PORT }}
          APP_NAME: ${{ inputs.app_name }}
        run: |
          ssh -p "$VPS_SSH_PORT" "deploy@$VPS_HOST" "mkdir -p /opt/infra/apps/$APP_NAME"
          scp -P "$VPS_SSH_PORT" /tmp/docker-compose.yml "deploy@$VPS_HOST:/opt/infra/apps/$APP_NAME/docker-compose.yml"
          ssh -p "$VPS_SSH_PORT" "deploy@$VPS_HOST" \
            "[ ! -f /opt/infra/apps/$APP_NAME/.env ] && echo 'IMAGE_TAG=latest' > /opt/infra/apps/$APP_NAME/.env || true"

      - name: Cleanup SSH
        if: always()
        run: rm -rf ~/.ssh
```

- [ ] **Step 2: Valider la syntaxe YAML du workflow**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/provision-app.yml').read()); print('OK')"
```

Résultat attendu : `OK`

- [ ] **Step 3: Installer et lancer actionlint (linter GitHub Actions)**

```bash
# Téléchargement de l'archive pour Linux x86_64
curl -L https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_linux_amd64.tar.gz \
  -o /tmp/actionlint.tar.gz
tar -xzf /tmp/actionlint.tar.gz -C /tmp actionlint
chmod +x /tmp/actionlint

# Lancer le linter
/tmp/actionlint .github/workflows/provision-app.yml
```

Résultat attendu : aucune erreur (sortie vide, exit code 0).

Si actionlint signale une erreur sur l'expression `${{ steps.fingerprint.outputs.fingerprint }}` dans `SSH_FINGERPRINT` (faux positif courant sur les outputs dynamiques), c'est acceptable — continuer.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/provision-app.yml
git commit -m "feat: add provision-app workflow"
```

---

### Task 3: Mise à jour de `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (section "Secrets GitHub requis")

Ajouter `GH_PAT` à la liste des secrets pour que les futurs intervenants sachent qu'il faut le configurer.

- [ ] **Step 1: Mettre à jour la section secrets dans `CLAUDE.md`**

Remplacer le bloc existant :

```
## Secrets GitHub requis

```
VPS_HOST          → IP du VPS
VPS_SSH_KEY       → Clé privée SSH GitHub Actions
CF_API_TOKEN      → Token Cloudflare (DNS challenge Let's Encrypt)
GRAFANA_PASSWORD  → Mot de passe admin Grafana
GHCR_TOKEN        → Token lecture GHCR
```
```

Par :

```
## Secrets GitHub requis

```
VPS_HOST          → IP du VPS
VPS_SSH_KEY       → Clé privée SSH GitHub Actions
VPS_SSH_PORT      → Port SSH du VPS
CF_API_TOKEN      → Token Cloudflare (DNS challenge Let's Encrypt)
GRAFANA_PASSWORD  → Mot de passe admin Grafana
GHCR_TOKEN        → Token lecture GHCR
GH_PAT            → Fine-grained PAT avec permission "Secrets" (Read and write) sur voikyrioh/* — requis par provision-app.yml
```
```

Note : `VPS_SSH_PORT` était déjà utilisé dans les workflows existants mais absent de la liste — on en profite pour l'ajouter.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document GH_PAT and VPS_SSH_PORT secrets in CLAUDE.md"
```

---

## Étapes manuelles préalables (hors plan)

Avant de déclencher le workflow pour la première fois, l'utilisateur doit :

1. Créer un **Fine-grained Personal Access Token** sur GitHub :
   - Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - Repository access : `voikyrioh/*` (tous les repos)
   - Permission : **Secrets** → Read and write
2. Ajouter ce PAT comme secret `GH_PAT` dans le repo **infra** :
   - Settings → Secrets and variables → Actions → New repository secret

Ces étapes ne peuvent pas être automatisées (bootstrap problem : il faut le PAT pour poser des secrets).
