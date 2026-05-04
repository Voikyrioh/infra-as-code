# Spec — Apps as Code + HashiCorp Vault

## Context

Aujourd'hui, provisionner une nouvelle app sur le VPS requiert un déclenchement manuel du
workflow `provision-app.yml` avec 4 inputs saisis à la main. Il n'existe pas de source de
vérité centralisée des apps déployées, ni de gestion automatisée des credentials (DB, Redis…).
Les secrets vivent dans des fichiers `.env` sur le serveur, créés une fois et jamais rotés.

Objectif : introduire une config déclarative par app (`apps/<app>.yml`) et par ressource
partagée (`resources/<type>.yml`), avec HashiCorp Vault comme coffre-fort. Le workflow de
provision lit ces fichiers, crée les zones isolées sur les ressources partagées, génère les
credentials, les pousse dans Vault, et configure le VPS. Le déploiement pull ensuite Vault
pour construire le `.env`.

---

## Architecture cible

```
infra/
├── apps/
│   ├── dashboard.yml          ← config déclarative par app
│   └── example.yml            ← template documenté
├── resources/
│   ├── postgres.yml           ← définition instance PG partagée
│   └── redis.yml              ← définition instance Redis partagée
├── vault/
│   ├── docker-compose.yml     ← service Vault
│   └── .env.example
├── .github/workflows/
│   ├── provision-app.yml      ← lit app.yml + provisionne ressources + Vault
│   ├── deploy-app.yml         ← pull Vault → génère .env → deploy
│   └── deploy-vault.yml       ← déploie Vault (comme les autres stacks)
└── ... (inchangé : traefik/, monitoring/, postgres/, ansible/)
```

---

## Format des fichiers de config

### `apps/<app>.yml`

```yaml
name: dashboard
github_repo: voikyrioh/dashboard
subdomain: dashboard
port: 8080
image: ghcr.io/voikyrioh/dashboard-api

# Variables d'environnement non-sensibles
env:
  NODE_ENV: production
  LOG_LEVEL: info
  GITHUB_OWNER: voikyrioh

# Ressources partagées dont l'app a besoin
# Le workflow crée une zone isolée (DB propre, namespace Redis) et stocke les credentials dans Vault
resources:
  - type: postgres
  - type: redis        # optionnel

# Paths Vault à lire lors du déploiement
# Le premier path (secret/apps/<name>) est auto-alimenté par provision-app.yml
vault:
  paths:
    - secret/apps/dashboard
    # - secret/shared/stripe  # secrets partagés ajoutés manuellement si besoin
```

### `resources/postgres.yml`

```yaml
type: postgres
container: shared_postgres
port: 5432
# Path Vault contenant les credentials admin pour créer les DBs
vault_admin_path: secret/resources/postgres
# Clés attendues : PG_ADMIN_USER, PG_ADMIN_PASSWORD
```

### `resources/redis.yml`

```yaml
type: redis
container: shared_redis
port: 6379
# Path Vault contenant les credentials admin + le compteur d'index DB
vault_admin_path: secret/resources/redis
# Clés attendues : REDIS_PASSWORD (optionnel), REDIS_NEXT_DB_INDEX (compteur 0-15)
```

---

## Vault — Structure des secrets

```
secret/
├── apps/
│   └── <app-name>/
│       # Credentials DB (si type: postgres déclaré)
│       ├── PG_HOST=shared_postgres
│       ├── PG_PORT=5432
│       ├── PG_DATABASE=<app-name>
│       ├── PG_USER=<app-name>_user
│       ├── PG_PASSWORD=<généré>
│       # Credentials Redis (si type: redis déclaré)
│       ├── REDIS_HOST=shared_redis
│       ├── REDIS_PORT=6379
│       └── REDIS_DB=<alloué>
├── resources/
│   ├── postgres/
│   │   ├── PG_ADMIN_USER=postgres
│   │   ├── PG_ADMIN_PASSWORD=<secret>
│   └── redis/
│       ├── REDIS_PASSWORD=<secret ou vide>
│       └── REDIS_NEXT_DB_INDEX=<compteur>
└── shared/
    └── <service>/        # secrets partagés ajoutés manuellement
        └── ...
```

---

## Vault — Déploiement

- **Image :** `hashicorp/vault:1.17`
- **Stockage :** filesystem chiffré sur volume Docker (`vault-data`)
- **Authentification CI/CD :** méthode AppRole — chaque app et le workflow infra ont un
  AppRole dédié avec une policy restreinte à `secret/apps/<app>/`
- **UI :** désactivée (`ui = false`) — l'API reste accessible pour les workflows CI/CD
- **Exposition :** Vault exposé via Traefik sur `vault.voikyrioh.fr` (HTTPS) pour que
  GitHub Actions puisse s'authentifier via AppRole depuis l'extérieur
- **Auto-unseal :** non — Vault démarre sealed après redémarrage du VPS, nécessite
  `vault operator unseal` manuellement

### `vault/docker-compose.yml`

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
      - infra
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.vault.rule=Host(`vault.voikyrioh.fr`)"
      - "traefik.http.routers.vault.entrypoints=websecure"
      - "traefik.http.routers.vault.tls.certresolver=cloudflare"
      - "traefik.http.services.vault.loadbalancer.server.port=8200"
      - "traefik.http.routers.vault.middlewares=secure-headers@file"

volumes:
  vault-data:

networks:
  infra:
    external: true
  proxy:
    external: true
```

---

## Workflow `provision-app.yml` — Logique révisée

**Déclencheur :** `workflow_dispatch`, un seul input : `app_name`

**Étapes :**

1. Checkout du repo infra
2. Parser `apps/<app_name>.yml` avec `yq`
3. Pour chaque ressource déclarée dans `resources[]` :
   - **type: postgres**
     - Lire `resources/postgres.yml`
     - S'authentifier à Vault (AppRole infra) → lire `secret/resources/postgres/`
     - Générer un mot de passe fort (openssl rand)
     - SSH → `psql` : `CREATE USER <app>_user WITH PASSWORD '...'`
     - SSH → `psql` : `CREATE DATABASE <app> OWNER <app>_user`
     - Écrire dans Vault `secret/apps/<app>/` : `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`
   - **type: redis**
     - Lire `resources/redis.yml`
     - Lire et incrémenter `secret/resources/redis/REDIS_NEXT_DB_INDEX` dans Vault
     - Écrire dans Vault `secret/apps/<app>/` : `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`
4. Générer `docker-compose.yml` depuis template (`examples/app-docker-compose.yml`)
   avec substitution `app_name`, `subdomain`, `port`, `image`
5. SSH → créer `/opt/infra/apps/<app_name>/`
6. Copier `docker-compose.yml` vers le VPS
7. SSH → créer `.env` vide (sera rempli au premier déploiement)
8. `gh secret set` → setter les secrets SSH sur `voikyrioh/<github_repo>`
9. `gh secret set` → setter `VAULT_ADDR`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID` sur le repo cible
10. Créer l'AppRole Vault pour l'app avec policy restreinte à `secret/apps/<app>/`

**Nouveaux GitHub Secrets requis dans le repo infra :**
```
VAULT_ADDR          → adresse du Vault (ex: http://IP:8200)
VAULT_ROLE_ID       → AppRole role_id du workflow infra
VAULT_SECRET_ID     → AppRole secret_id du workflow infra
```

---

## Workflow `deploy-app.yml` — Étape Vault ajoutée

Appelé depuis chaque app repo via `workflow_call`. Après le build/push de l'image :

1. Checkout du repo infra (pour lire `apps/<app>.yml`)
2. S'authentifier à Vault (`VAULT_ROLE_ID` + `VAULT_SECRET_ID` depuis GitHub Secrets de l'app)
3. Lire tous les `vault.paths` déclarés dans `apps/<app>.yml`
4. Fusionner : `env` (app.yml, non-sensible) + secrets (Vault) → fichier `.env`
5. SSH → écrire `.env` sur le VPS dans `/opt/infra/apps/<app>/`
6. `docker compose pull && up -d --remove-orphans`

**Nouveaux GitHub Secrets requis dans chaque app repo (settés par provision-app.yml) :**
```
VAULT_ADDR
VAULT_ROLE_ID       → AppRole dédié, policy restreinte à secret/apps/<app>/
VAULT_SECRET_ID
```

---

## Fichiers à créer / modifier

| Fichier | Action |
|---------|--------|
| `vault/docker-compose.yml` | Créer |
| `vault/.env.example` | Créer |
| `resources/postgres.yml` | Créer |
| `resources/redis.yml` | Créer |
| `apps/dashboard.yml` | Créer (migration config dashboard) |
| `apps/example.yml` | Créer (template commenté) |
| `.github/workflows/deploy-vault.yml` | Créer |
| `.github/workflows/provision-app.yml` | Modifier |
| `.github/workflows/deploy-app.yml` | Modifier |

Fichiers non modifiés : `traefik/`, `monitoring/`, `postgres/`, `ansible/`, `examples/`

---

## Vérification end-to-end

**1. Vault opérationnel**
- Trigger `deploy-vault.yml` → container tourne sur le VPS
- `vault operator init` + `vault operator unseal` (manuel, une fois)
- `vault auth enable approle` + création des policies (manuel, une fois)
- Peupler manuellement `secret/resources/postgres/` et `secret/resources/redis/`

**2. Provision d'une app test**
- Créer `apps/test-app.yml` avec `resources: [{type: postgres}]`
- Trigger `provision-app.yml` (input: `test-app`)
- Vérifier Vault : `secret/apps/test-app/` contient les credentials PG
- Vérifier VPS : `/opt/infra/apps/test-app/docker-compose.yml` existe
- Vérifier repo cible : secrets SSH + Vault présents

**3. Déploiement**
- Push sur le repo de l'app → `deploy-app.yml` se déclenche
- Vérifier `.env` sur le VPS : vars non-sensibles + secrets Vault fusionnés
- Container accessible via `https://test-app.voikyrioh.fr`

---

## Points d'attention

- **Vault unseal au redémarrage :** comportement attendu, à documenter dans un runbook.
- **AppRole par app :** principe de moindre privilège — chaque app ne peut lire que `secret/apps/<app>/`.
- **Redis index allocation :** le compteur `REDIS_NEXT_DB_INDEX` n'est pas atomique si deux
  provisions tournent simultanément. Acceptable pour un usage solo sur ce VPS.
- **Migration dashboard :** les secrets actuels du dashboard (dans GitHub Secrets) devront être
  migrés vers Vault lors de la mise en place. Le `.env` existant sur le VPS sera remplacé.
