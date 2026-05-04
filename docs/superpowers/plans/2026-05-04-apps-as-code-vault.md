# Apps as Code + HashiCorp Vault — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduire une config déclarative par app (`apps/<app>.yml`) + ressources partagées (`resources/<type>.yml`) avec HashiCorp Vault comme coffre-fort, et mettre à jour les workflows CI/CD pour provisionner automatiquement les ressources et injecter les secrets au déploiement.

**Architecture:** Les apps sont définies as-code dans `apps/`. Le workflow `provision-app.yml` lit ce fichier, crée les zones isolées sur les ressources partagées (postgres DB, redis index), génère les credentials et les pousse dans Vault sous `secret/apps/<app>`. Les vars non-sensibles sont baked dans le `docker-compose.yml` généré. Au déploiement, `deploy-app.yml` s'authentifie à Vault, lit `secret/apps/<app>`, génère le `.env` (IMAGE_TAG + secrets) et l'envoie sur le VPS avant de lancer les containers.

**Tech Stack:** HashiCorp Vault 1.17, GitHub Actions (hashicorp/setup-vault@v3, mikefarah/yq@v4, appleboy/scp-action, appleboy/ssh-action), Docker Compose, Bash, yq (YAML parser), openssl (génération mot de passe), vault CLI (AppRole auth, KV v2)

---

## File Map

| Fichier | Action | Responsabilité |
|---------|--------|----------------|
| `vault/docker-compose.yml` | Créer | Service Vault avec labels Traefik |
| `vault/.env.example` | Créer | Documentation VAULT_ADDR |
| `.github/workflows/deploy-vault.yml` | Créer | Déploie Vault comme les autres stacks |
| `resources/postgres.yml` | Créer | Définition instance PostgreSQL partagée |
| `resources/redis.yml` | Créer | Définition instance Redis partagée |
| `apps/example.yml` | Créer | Template documenté pour nouvelles apps |
| `apps/dashboard.yml` | Créer | Config du dashboard (migration) |
| `docs/runbooks/vault-init.md` | Créer | Procédure d'initialisation manuelle Vault |
| `.github/workflows/provision-app.yml` | Modifier | Réécriture complète — lit app.yml, provisionne |
| `.github/workflows/deploy-app.yml` | Modifier | Ajoute Vault auth + génération .env |

---

## Task 1 — Vault Docker service

**Files:**
- Create: `vault/docker-compose.yml`
- Create: `vault/.env.example`

- [ ] **Créer `vault/docker-compose.yml`**

```yaml
services:
  vault:
    image: hashicorp/vault:1.17
    container_name: vault
    restart: unless-stopped
    cap_add:
      - IPC_LOCK
    environment:
      VAULT_LOCAL_CONFIG: |
        ui = false
        storage "file" { path = "/vault/data" }
        listener "tcp" {
          address = "0.0.0.0:8200"
          tls_disable = true
        }
    volumes:
      - vault-data:/vault/data
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.vault.rule=Host(`vault.voikyrioh.fr`)"
      - "traefik.http.routers.vault.entrypoints=websecure"
      - "traefik.http.routers.vault.tls=true"
      - "traefik.http.routers.vault.tls.certresolver=cloudflare"
      - "traefik.http.services.vault.loadbalancer.server.port=8200"
      - "traefik.http.routers.vault.middlewares=secure-headers@file"

volumes:
  vault-data:

networks:
  proxy:
    external: true
```

- [ ] **Créer `vault/.env.example`**

```
# Adresse Vault pour les workflows CI/CD
VAULT_ADDR=https://vault.voikyrioh.fr
```

- [ ] **Valider la syntaxe Docker Compose**

```bash
docker compose -f vault/docker-compose.yml config
```

Expected: configuration YAML valide sans erreur

- [ ] **Commit**

```bash
git add vault/
git commit -m "feat: add Vault Docker service"
```

---

## Task 2 — Vault deploy workflow

**Files:**
- Create: `.github/workflows/deploy-vault.yml`

- [ ] **Créer `.github/workflows/deploy-vault.yml`**

```yaml
name: Deploy Vault

on:
  push:
    branches: [main]
    paths:
      - 'vault/**'
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Copy Vault config to VPS
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_SSH_PORT }}
          source: "vault/docker-compose.yml"
          target: /opt/infra/vault/
          strip_components: 1

      - name: Deploy Vault
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_SSH_PORT }}
          script: |
            mkdir -p /opt/infra/vault
            cd /opt/infra/vault
            docker compose pull
            docker compose up -d
            docker compose ps
```

- [ ] **Valider la syntaxe YAML du workflow**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/deploy-vault.yml'))" && echo OK
```

Expected: `OK`

- [ ] **Commit**

```bash
git add .github/workflows/deploy-vault.yml
git commit -m "feat: add deploy-vault workflow"
```

---

## Task 3 — Resource definition files

**Files:**
- Create: `resources/postgres.yml`
- Create: `resources/redis.yml`

- [ ] **Créer `resources/postgres.yml`**

```yaml
type: postgres
container: shared_postgres
port: 5432
# Path Vault contenant les credentials admin utilisés pour créer les DBs des apps
# Clés attendues dans Vault : PG_ADMIN_USER, PG_ADMIN_PASSWORD
vault_admin_path: secret/resources/postgres
```

- [ ] **Créer `resources/redis.yml`**

```yaml
type: redis
container: shared_redis
port: 6379
# Path Vault contenant le compteur d'index DB et optionnellement le password
# Clés attendues dans Vault : REDIS_NEXT_DB_INDEX (entier, commence à 0)
# REDIS_PASSWORD est optionnel (si Redis tourne sans auth, ne pas le définir)
vault_admin_path: secret/resources/redis
```

- [ ] **Valider la syntaxe des deux fichiers**

```bash
python3 -c "import yaml, sys; [yaml.safe_load(open(f)) for f in ['resources/postgres.yml','resources/redis.yml']]; print('OK')"
```

Expected: `OK`

- [ ] **Commit**

```bash
git add resources/
git commit -m "feat: add resource definition files (postgres, redis)"
```

---

## Task 4 — App config files

**Files:**
- Create: `apps/example.yml`
- Create: `apps/dashboard.yml`

- [ ] **Créer `apps/example.yml`** (template documenté)

```yaml
# Template de configuration pour une nouvelle app
# Copier ce fichier, le renommer en <app_name>.yml, et adapter les valeurs.
# Déclencher provision-app.yml (workflow_dispatch, input: app_name) après modification.

name: example                              # Identifiant unique, utilisé comme nom de container et dossier sur le VPS
github_repo: voikyrioh/example             # Repo GitHub cible (owner/repo)
subdomain: example                         # → example.voikyrioh.fr via Traefik
port: 3000                                 # Port interne du container
image: ghcr.io/voikyrioh/example           # Image GHCR (sans le tag — géré par IMAGE_TAG dans .env)

# Variables d'environnement NON SENSIBLES
# Baked dans le docker-compose.yml généré par provision-app.yml
# Pour les modifier : mettre à jour ce fichier et re-déclencher provision-app.yml
env:
  NODE_ENV: production
  LOG_LEVEL: info

# Ressources partagées dont l'app a besoin
# Le workflow provision-app.yml crée une zone isolée (DB propre, index Redis)
# et stocke les credentials dans Vault automatiquement
resources: []
  # - type: postgres    # Crée une DB <name> + user <name>_user sur shared_postgres
  # - type: redis       # Alloue un index DB sur shared_redis (0-15)

# Paths Vault lus lors de chaque déploiement pour construire le .env
# Le premier path est auto-créé par provision-app.yml
vault:
  paths:
    - secret/apps/example
    # - secret/shared/stripe    # Pour des secrets partagés entre apps (ajoutés manuellement)
```

- [ ] **Créer `apps/dashboard.yml`** (migration de la config existante)

```yaml
name: dashboard
github_repo: voikyrioh/dashboard
subdomain: dashboard
port: 8080
image: ghcr.io/voikyrioh/dashboard-api

env:
  NODE_ENV: production
  HOSTNAME: "0.0.0.0"
  RP_ID: dashboard.voikyrioh.fr
  ORIGIN: https://dashboard.voikyrioh.fr
  CLIENT_URLS: https://dashboard.voikyrioh.fr
  GITHUB_OWNER: voikyrioh
  GITHUB_REPO: dashboard
  LOG_FILE: /data/logs/app.log
  PRIVATE_KEY: /data/ssl/id_rsa
  PUBLIC_KEY: /data/ssl/id_rsa.pub
  JWT_EXPIRATION_TIME_MS: "3600000"

resources:
  - type: postgres

vault:
  paths:
    - secret/apps/dashboard
```

- [ ] **Valider la syntaxe des deux fichiers**

```bash
python3 -c "import yaml, sys; [yaml.safe_load(open(f)) for f in ['apps/example.yml','apps/dashboard.yml']]; print('OK')"
```

Expected: `OK`

- [ ] **Commit**

```bash
git add apps/
git commit -m "feat: add app config files (example template + dashboard)"
```

---

## Task 5 — Vault initialization runbook

**Files:**
- Create: `docs/runbooks/vault-init.md`

- [ ] **Créer `docs/runbooks/vault-init.md`**

```markdown
# Runbook — Initialisation Vault

À exécuter une seule fois après le premier déploiement du container Vault.
Toutes les commandes s'exécutent sur le VPS via SSH.

## Prérequis

- Container `vault` déployé et en cours d'exécution (`docker ps | grep vault`)
- Vault CLI installé : `docker exec vault vault --version`

## 1. Initialisation (une seule fois)

```bash
docker exec vault vault operator init
```

**Sortie** : 5 Unseal Keys + 1 Initial Root Token. **Conserver ces valeurs en lieu sûr** (gestionnaire de mots de passe). Elles ne seront plus affichées.

## 2. Unseal (requis après chaque redémarrage du container)

Vault démarre toujours en état "sealed". Il faut fournir 3 des 5 Unseal Keys :

```bash
docker exec -it vault vault operator unseal  # Saisir Unseal Key 1
docker exec -it vault vault operator unseal  # Saisir Unseal Key 2
docker exec -it vault vault operator unseal  # Saisir Unseal Key 3
```

Vérifier le statut : `docker exec vault vault status` → `Sealed: false`

## 3. Login avec le Root Token

```bash
export VAULT_ADDR=http://localhost:8200
docker exec vault vault login  # Saisir le Root Token
```

Ou avec la variable d'env :
```bash
docker exec -e VAULT_TOKEN=<root-token> vault vault status
```

Pour les étapes suivantes, ajouter `-e VAULT_TOKEN=<root-token>` à chaque commande `docker exec vault vault`.

## 4. Activer le moteur de secrets KV v2

```bash
docker exec -e VAULT_TOKEN=<root-token> vault vault secrets enable -path=secret kv-v2
```

## 5. Activer AppRole

```bash
docker exec -e VAULT_TOKEN=<root-token> vault vault auth enable approle
```

## 6. Créer la policy pour le workflow infra

```bash
docker exec -e VAULT_TOKEN=<root-token> vault vault policy write infra-workflow - <<'EOF'
path "secret/data/apps/*" {
  capabilities = ["create", "update", "read", "patch"]
}
path "secret/data/resources/*" {
  capabilities = ["read", "update", "patch"]
}
path "secret/metadata/apps/*" {
  capabilities = ["read", "list", "delete"]
}
path "secret/metadata/resources/*" {
  capabilities = ["read"]
}
path "auth/approle/role/app-*" {
  capabilities = ["create", "update", "read"]
}
path "auth/approle/role/app-*/role-id" {
  capabilities = ["read"]
}
path "auth/approle/role/app-*/secret-id" {
  capabilities = ["create", "update"]
}
path "sys/policies/acl/app-*" {
  capabilities = ["create", "update", "read"]
}
EOF
```

## 7. Créer l'AppRole pour le workflow infra

```bash
docker exec -e VAULT_TOKEN=<root-token> vault vault write auth/approle/role/infra-workflow \
  token_policies="infra-workflow" \
  token_ttl=1h \
  token_max_ttl=4h
```

Récupérer les credentials :
```bash
ROLE_ID=$(docker exec -e VAULT_TOKEN=<root-token> vault vault read -field=role_id auth/approle/role/infra-workflow/role-id)
SECRET_ID=$(docker exec -e VAULT_TOKEN=<root-token> vault vault write -force -field=secret_id auth/approle/role/infra-workflow/secret-id)
echo "ROLE_ID: $ROLE_ID"
echo "SECRET_ID: $SECRET_ID"
```

**→ Stocker ROLE_ID et SECRET_ID dans les GitHub Secrets du repo infra** :
- `VAULT_ADDR` = `https://vault.voikyrioh.fr`
- `VAULT_ROLE_ID` = valeur de ROLE_ID
- `VAULT_SECRET_ID` = valeur de SECRET_ID

## 8. Peupler les credentials admin PostgreSQL

```bash
docker exec -e VAULT_TOKEN=<root-token> vault vault kv put secret/resources/postgres \
  PG_ADMIN_USER=postgres \
  PG_ADMIN_PASSWORD=<mot-de-passe-admin-postgres>
```

## 9. Initialiser le compteur Redis

```bash
docker exec -e VAULT_TOKEN=<root-token> vault vault kv put secret/resources/redis \
  REDIS_NEXT_DB_INDEX=0
```

Si Redis est sécurisé par un mot de passe :
```bash
docker exec -e VAULT_TOKEN=<root-token> vault vault kv patch secret/resources/redis \
  REDIS_PASSWORD=<redis-password>
```

## Vérification finale

```bash
docker exec -e VAULT_TOKEN=<root-token> vault vault kv get secret/resources/postgres
docker exec -e VAULT_TOKEN=<root-token> vault vault kv get secret/resources/redis
```

## Note sur l'unseal au redémarrage

À chaque redémarrage du VPS ou du container Vault, répéter l'étape 2 (unseal).
Vault ne peut pas démarrer en état unsealed automatiquement sans un mécanisme d'auto-unseal
(ex: AWS KMS, Transit seal) — hors scope pour ce setup.
```

- [ ] **Commit**

```bash
git add docs/runbooks/vault-init.md
git commit -m "docs: add Vault initialization runbook"
```

---

## Task 6 — Réécriture de provision-app.yml

**Files:**
- Modify: `.github/workflows/provision-app.yml`

Ce workflow remplace entièrement l'actuel. Il prend `app_name` comme seul input, lit `apps/<app_name>.yml`, provisionne les ressources déclarées, et configure le VPS + le repo cible.

- [ ] **Remplacer le contenu de `.github/workflows/provision-app.yml`**

```yaml
name: Provision New App

on:
  workflow_dispatch:
    inputs:
      app_name:
        description: "Nom du fichier dans apps/ (ex: dashboard)"
        required: true
        type: string

jobs:
  provision:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions: {}

    steps:
      - uses: actions/checkout@v4

      - name: Install yq
        uses: mikefarah/yq@v4

      - name: Install Vault CLI
        uses: hashicorp/setup-vault@v3
        with:
          version: '1.17.0'

      - name: Validation
        env:
          APP_NAME: ${{ inputs.app_name }}
        run: |
          if [[ ! "$APP_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
            echo "ERROR: app_name invalide (caracteres alphanumeriques et tirets uniquement)" >&2
            exit 1
          fi
          if [ ! -f "apps/$APP_NAME.yml" ]; then
            echo "ERROR: apps/$APP_NAME.yml introuvable dans le repo" >&2
            exit 1
          fi

      - name: Lire la config de l'app
        id: config
        env:
          APP_NAME: ${{ inputs.app_name }}
        run: |
          F="apps/$APP_NAME.yml"
          echo "github_repo=$(yq '.github_repo' $F)"   >> $GITHUB_OUTPUT
          echo "subdomain=$(yq '.subdomain' $F)"       >> $GITHUB_OUTPUT
          echo "port=$(yq '.port' $F)"                 >> $GITHUB_OUTPUT
          echo "image=$(yq '.image' $F)"               >> $GITHUB_OUTPUT
          echo "has_postgres=$(yq '.resources // [] | .[] | select(.type == "postgres") | "true"' $F | head -1)" >> $GITHUB_OUTPUT
          echo "has_redis=$(yq '.resources // [] | .[] | select(.type == "redis") | "true"' $F | head -1)"      >> $GITHUB_OUTPUT

      - name: Calcul du SSH fingerprint
        id: fingerprint
        env:
          VPS_HOST: ${{ secrets.VPS_HOST }}
          VPS_SSH_PORT: ${{ secrets.VPS_SSH_PORT }}
        run: |
          FINGERPRINT=$(ssh-keyscan -p "$VPS_SSH_PORT" "$VPS_HOST" 2>/dev/null)
          if [ -z "$FINGERPRINT" ]; then
            echo "ERROR: ssh-keyscan vide — VPS inaccessible ou port incorrect" >&2
            exit 1
          fi
          {
            echo "fingerprint<<FINGERPRINT_EOF"
            echo "$FINGERPRINT"
            echo "FINGERPRINT_EOF"
          } >> "$GITHUB_OUTPUT"

      - name: Setup SSH
        env:
          VPS_SSH_KEY: ${{ secrets.VPS_SSH_KEY }}
          SSH_FINGERPRINT: ${{ steps.fingerprint.outputs.fingerprint }}
        run: |
          mkdir -p ~/.ssh
          echo "$VPS_SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          echo "$SSH_FINGERPRINT" >> ~/.ssh/known_hosts

      - name: Authentification Vault (AppRole infra)
        env:
          VAULT_ADDR: ${{ secrets.VAULT_ADDR }}
          VAULT_ROLE_ID: ${{ secrets.VAULT_ROLE_ID }}
          VAULT_SECRET_ID: ${{ secrets.VAULT_SECRET_ID }}
        run: |
          TOKEN=$(vault write -field=token auth/approle/login \
            role_id="$VAULT_ROLE_ID" \
            secret_id="$VAULT_SECRET_ID")
          echo "VAULT_TOKEN=$TOKEN"     >> $GITHUB_ENV
          echo "VAULT_ADDR=$VAULT_ADDR" >> $GITHUB_ENV

      - name: Provision PostgreSQL
        if: steps.config.outputs.has_postgres == 'true'
        env:
          APP_NAME: ${{ inputs.app_name }}
          VPS_HOST: ${{ secrets.VPS_HOST }}
          VPS_SSH_PORT: ${{ secrets.VPS_SSH_PORT }}
        run: |
          PG_ADMIN_USER=$(vault kv get -field=PG_ADMIN_USER secret/resources/postgres)
          PG_ADMIN_PASSWORD=$(vault kv get -field=PG_ADMIN_PASSWORD secret/resources/postgres)
          PG_CONTAINER=$(yq '.container' resources/postgres.yml)

          PG_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')
          PG_USER="${APP_NAME}_user"
          PG_DATABASE="$APP_NAME"

          ssh -o StrictHostKeyChecking=yes -p "$VPS_SSH_PORT" "deploy@$VPS_HOST" \
            "docker exec $PG_CONTAINER psql -U $PG_ADMIN_USER \
              -c \"CREATE USER $PG_USER WITH PASSWORD '$PG_PASSWORD';\" 2>/dev/null || true
             docker exec $PG_CONTAINER psql -U $PG_ADMIN_USER \
              -c \"CREATE DATABASE $PG_DATABASE OWNER $PG_USER;\" 2>/dev/null || true"

          vault kv put "secret/apps/$APP_NAME" \
            PG_HOST="$PG_CONTAINER" \
            PG_PORT="5432" \
            PG_DATABASE="$PG_DATABASE" \
            PG_USER="$PG_USER" \
            PG_PASSWORD="$PG_PASSWORD"

      - name: Provision Redis
        if: steps.config.outputs.has_redis == 'true'
        env:
          APP_NAME: ${{ inputs.app_name }}
        run: |
          REDIS_CONTAINER=$(yq '.container' resources/redis.yml)
          REDIS_PORT=$(yq '.port' resources/redis.yml)

          NEXT_INDEX=$(vault kv get -field=REDIS_NEXT_DB_INDEX secret/resources/redis)
          NEW_INDEX=$((NEXT_INDEX + 1))
          vault kv patch secret/resources/redis REDIS_NEXT_DB_INDEX="$NEW_INDEX"

          # Si vault kv put secret/apps/<app> n'existe pas encore (pas de postgres), créer
          # Si postgres a déjà été exécuté, utiliser patch pour ajouter les clés Redis
          if vault kv get "secret/apps/$APP_NAME" > /dev/null 2>&1; then
            vault kv patch "secret/apps/$APP_NAME" \
              REDIS_HOST="$REDIS_CONTAINER" \
              REDIS_PORT="$REDIS_PORT" \
              REDIS_DB="$NEXT_INDEX"
          else
            vault kv put "secret/apps/$APP_NAME" \
              REDIS_HOST="$REDIS_CONTAINER" \
              REDIS_PORT="$REDIS_PORT" \
              REDIS_DB="$NEXT_INDEX"
          fi

      - name: Génération du docker-compose.yml
        env:
          APP_NAME: ${{ inputs.app_name }}
        run: |
          SUBDOMAIN="${{ steps.config.outputs.subdomain }}"
          APP_PORT="${{ steps.config.outputs.port }}"
          APP_IMAGE="${{ steps.config.outputs.image }}"

          # Construire la section environment depuis app.yml
          ENV_SECTION=$(yq '.env // {} | to_entries[] | "      " + .key + ": \"" + .value + "\""' "apps/$APP_NAME.yml")

          cat > /tmp/docker-compose.yml <<COMPOSE
          services:
            app:
              image: ${APP_IMAGE}:\${IMAGE_TAG:-latest}
              container_name: ${APP_NAME}
              restart: unless-stopped
              environment:
          ${ENV_SECTION}
              env_file:
                - .env
              networks:
                - proxy
              labels:
                - "traefik.enable=true"
                - "traefik.http.routers.${APP_NAME}.rule=Host(\`${SUBDOMAIN}.voikyrioh.fr\`)"
                - "traefik.http.routers.${APP_NAME}.entrypoints=websecure"
                - "traefik.http.routers.${APP_NAME}.tls=true"
                - "traefik.http.routers.${APP_NAME}.tls.certresolver=cloudflare"
                - "traefik.http.services.${APP_NAME}.loadbalancer.server.port=${APP_PORT}"
                - "traefik.http.routers.${APP_NAME}.middlewares=secure-headers@file"
          networks:
            proxy:
              external: true
          COMPOSE

      - name: Provisioning VPS
        env:
          VPS_HOST: ${{ secrets.VPS_HOST }}
          VPS_SSH_PORT: ${{ secrets.VPS_SSH_PORT }}
          APP_NAME: ${{ inputs.app_name }}
        run: |
          ssh -o StrictHostKeyChecking=yes -p "$VPS_SSH_PORT" "deploy@$VPS_HOST" \
            "mkdir -p /opt/infra/apps/$APP_NAME"
          scp -o StrictHostKeyChecking=yes -P "$VPS_SSH_PORT" \
            /tmp/docker-compose.yml "deploy@$VPS_HOST:/opt/infra/apps/$APP_NAME/docker-compose.yml"
          ssh -o StrictHostKeyChecking=yes -p "$VPS_SSH_PORT" "deploy@$VPS_HOST" \
            "touch /opt/infra/apps/$APP_NAME/.env"

      - name: Créer l'AppRole Vault pour l'app
        env:
          APP_NAME: ${{ inputs.app_name }}
        run: |
          vault policy write "app-$APP_NAME" - <<EOF
          path "secret/data/apps/$APP_NAME" {
            capabilities = ["read"]
          }
          path "secret/metadata/apps/$APP_NAME" {
            capabilities = ["read"]
          }
          EOF

          vault write "auth/approle/role/app-$APP_NAME" \
            token_policies="app-$APP_NAME" \
            token_ttl=1h \
            token_max_ttl=4h

          APP_ROLE_ID=$(vault read -field=role_id "auth/approle/role/app-$APP_NAME/role-id")
          APP_SECRET_ID=$(vault write -force -field=secret_id "auth/approle/role/app-$APP_NAME/secret-id")

          echo "APP_ROLE_ID=$APP_ROLE_ID"     >> $GITHUB_ENV
          echo "APP_SECRET_ID=$APP_SECRET_ID" >> $GITHUB_ENV

      - name: Set secrets GitHub sur le repo cible
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
          VPS_SSH_KEY: ${{ secrets.VPS_SSH_KEY }}
          VPS_HOST: ${{ secrets.VPS_HOST }}
          VPS_SSH_PORT: ${{ secrets.VPS_SSH_PORT }}
          SSH_FINGERPRINT: ${{ steps.fingerprint.outputs.fingerprint }}
          VAULT_ADDR_VALUE: ${{ secrets.VAULT_ADDR }}
          GITHUB_REPO: ${{ steps.config.outputs.github_repo }}
        run: |
          gh secret set SSH_PRIVATE_KEY      --repo "$GITHUB_REPO" --body "$VPS_SSH_KEY"
          gh secret set SSH_HOST             --repo "$GITHUB_REPO" --body "$VPS_HOST"
          gh secret set SSH_PORT             --repo "$GITHUB_REPO" --body "$VPS_SSH_PORT"
          gh secret set SSH_USER             --repo "$GITHUB_REPO" --body "deploy"
          gh secret set SSH_HOST_FINGERPRINT --repo "$GITHUB_REPO" --body "$SSH_FINGERPRINT"
          gh secret set VAULT_ADDR           --repo "$GITHUB_REPO" --body "$VAULT_ADDR_VALUE"
          gh secret set VAULT_ROLE_ID        --repo "$GITHUB_REPO" --body "$APP_ROLE_ID"
          gh secret set VAULT_SECRET_ID      --repo "$GITHUB_REPO" --body "$APP_SECRET_ID"

      - name: Cleanup SSH
        if: always()
        run: rm -rf ~/.ssh
```

- [ ] **Valider la syntaxe YAML du workflow**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/provision-app.yml')); print('OK')"
```

Expected: `OK`

- [ ] **Commit**

```bash
git add .github/workflows/provision-app.yml
git commit -m "feat: rewrite provision-app to use app config files and Vault"
```

---

## Task 7 — Mise à jour de deploy-app.yml

**Files:**
- Modify: `.github/workflows/deploy-app.yml`

Le workflow actuel génère le `.env` avec seulement `IMAGE_TAG`. La nouvelle version s'authentifie à Vault, lit `secret/apps/<app_name>`, et génère un `.env` complet (IMAGE_TAG + tous les secrets Vault). Les vars non-sensibles sont dans `docker-compose.yml` via `environment:` (baked au moment de la provision).

- [ ] **Remplacer le contenu de `.github/workflows/deploy-app.yml`**

```yaml
name: Deploy App (Reusable)

on:
  workflow_call:
    inputs:
      app_name:
        description: "Nom de l'app (= nom du dossier dans /opt/infra/apps/)"
        required: true
        type: string
      image_name:
        description: "Nom de l'image Docker sur GHCR"
        required: true
        type: string
    secrets:
      VPS_HOST:
        required: true
      VPS_SSH_KEY:
        required: true
      VPS_SSH_PORT:
        required: true
      VAULT_ADDR:
        required: true
      VAULT_ROLE_ID:
        required: true
      VAULT_SECRET_ID:
        required: true

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/${{ inputs.image_name }}
          tags: |
            type=sha,prefix=,format=short
            type=raw,value=latest

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}

      - name: Install Vault CLI
        uses: hashicorp/setup-vault@v3
        with:
          version: '1.17.0'

      - name: Générer .env depuis Vault
        env:
          VAULT_ADDR: ${{ secrets.VAULT_ADDR }}
          VAULT_ROLE_ID: ${{ secrets.VAULT_ROLE_ID }}
          VAULT_SECRET_ID: ${{ secrets.VAULT_SECRET_ID }}
          APP_NAME: ${{ inputs.app_name }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          TOKEN=$(vault write -field=token auth/approle/login \
            role_id="$VAULT_ROLE_ID" \
            secret_id="$VAULT_SECRET_ID")
          export VAULT_TOKEN="$TOKEN"

          # IMAGE_TAG = 7 premiers caractères du sha git (écrit dans le workspace)
          echo "IMAGE_TAG=${IMAGE_TAG:0:7}" > .env

          # Lire tous les secrets de l'app depuis Vault et les ajouter au .env
          vault kv get -format=json "secret/apps/$APP_NAME" \
            | jq -r '.data.data | to_entries[] | "\(.key)=\(.value)"' \
            >> .env

          echo "=== .env généré (clés uniquement) ==="
          cut -d= -f1 .env

      - name: Copy docker-compose.yml and .env to VPS
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_SSH_PORT }}
          source: "docker-compose.yml,.env"
          target: /opt/infra/apps/${{ inputs.app_name }}/

      - name: Deploy on VPS
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_SSH_PORT }}
          script: |
            cd /opt/infra/apps/${{ inputs.app_name }}
            docker compose pull
            docker compose up -d --remove-orphans
            docker compose ps
```

- [ ] **Valider la syntaxe YAML du workflow**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/deploy-app.yml')); print('OK')"
```

Expected: `OK`

- [ ] **Commit**

```bash
git add .github/workflows/deploy-app.yml
git commit -m "feat: update deploy-app to pull secrets from Vault"
```

---

## Task 8 — Mettre à jour CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Mettre à jour la section "Secrets GitHub requis"** dans `CLAUDE.md`

Remplacer la section existante par :

```markdown
## Secrets GitHub requis

### Repo infra (voikyrioh/infra)
```
VPS_HOST          → IP du VPS
VPS_SSH_KEY       → Clé privée SSH GitHub Actions
VPS_SSH_PORT      → Port SSH du VPS
CF_API_TOKEN      → Token Cloudflare (DNS challenge Let's Encrypt)
GRAFANA_PASSWORD  → Mot de passe admin Grafana
GHCR_TOKEN        → Token lecture GHCR
GH_PAT            → Fine-grained PAT avec permission "Secrets" (Read and write) sur voikyrioh/*
VAULT_ADDR        → Adresse Vault (ex: https://vault.voikyrioh.fr)
VAULT_ROLE_ID     → AppRole role_id du workflow infra (créé lors de vault-init)
VAULT_SECRET_ID   → AppRole secret_id du workflow infra (créé lors de vault-init)
```

### Repos app (settés automatiquement par provision-app.yml)
```
SSH_PRIVATE_KEY       → Clé privée SSH
SSH_HOST              → IP du VPS
SSH_PORT              → Port SSH
SSH_USER              → deploy
SSH_HOST_FINGERPRINT  → Fingerprint SSH du VPS
VAULT_ADDR            → Adresse Vault
VAULT_ROLE_ID         → AppRole role_id de l'app (accès restreint à secret/apps/<app>/)
VAULT_SECRET_ID       → AppRole secret_id de l'app
```
```

- [ ] **Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with new GitHub Secrets structure"
```

---

## Vérification end-to-end

### Étape 1 — Déployer et initialiser Vault

```bash
# Déclencher deploy-vault.yml depuis GitHub Actions (workflow_dispatch)
# Puis sur le VPS :
ssh deploy@<VPS_HOST> -p <VPS_SSH_PORT>
docker ps | grep vault   # → doit être "Up"
# Suivre docs/runbooks/vault-init.md
```

### Étape 2 — Ajouter les 3 secrets Vault dans le repo infra

Via GitHub UI ou CLI :
```bash
gh secret set VAULT_ADDR     --repo voikyrioh/infra --body "https://vault.voikyrioh.fr"
gh secret set VAULT_ROLE_ID  --repo voikyrioh/infra --body "<role_id>"
gh secret set VAULT_SECRET_ID --repo voikyrioh/infra --body "<secret_id>"
```

### Étape 3 — Provisionner une app test

Créer `apps/test-app.yml` :
```yaml
name: test-app
github_repo: voikyrioh/test-app
subdomain: test-app
port: 3000
image: ghcr.io/voikyrioh/test-app
env:
  NODE_ENV: production
resources:
  - type: postgres
vault:
  paths:
    - secret/apps/test-app
```

Déclencher `provision-app.yml` (workflow_dispatch, input: `test-app`).

**Résultats attendus :**
- Vault `secret/apps/test-app` contient `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`
- VPS : `/opt/infra/apps/test-app/docker-compose.yml` existe avec `NODE_ENV: production` dans `environment:`
- Repo `voikyrioh/test-app` : 8 secrets settés (SSH x5 + Vault x3)

### Étape 4 — Tester le déploiement

Dans le repo `voikyrioh/test-app`, déclencher le workflow de déploiement.

**Résultats attendus :**
- Log du step "Générer .env depuis Vault" : affiche les clés (IMAGE_TAG, PG_HOST, PG_PORT, etc.) sans les valeurs
- VPS : `/opt/infra/apps/test-app/.env` contient `IMAGE_TAG=<sha>` + les secrets PG
- Container tourne : `docker ps | grep test-app`

---

## Points d'attention

- **`vault kv patch` vs `vault kv put`** : `put` écrase tous les champs, `patch` ajoute/met à jour. La step Redis utilise `patch` si des secrets postgres existent déjà pour l'app. Si l'app n'a que Redis (pas postgres), `patch` d'un path inexistant échoue — le workflow gère ce cas avec une vérification préalable.

- **Indentation du heredoc docker-compose.yml** : le heredoc dans `provision-app.yml` est indenté par rapport au shell. Utiliser `yq` pour le lire ensuite ne pose pas de problème car Docker Compose accepte les fichiers avec indentation variable.

- **`appleboy/scp-action` avec chemin `/tmp/.env`** : le `strip_components: 2` retire `/tmp/` du chemin source pour que le fichier arrive directement en tant que `.env` dans le dossier cible. Vérifier ce comportement si la version de l'action change.

- **Vault unseal après redémarrage** : prévoir une alerte ou une vérification de santé sur le container Vault. Un container `restart: unless-stopped` redémarre sealed — les déploiements échoueront jusqu'à l'unseal manuel.
