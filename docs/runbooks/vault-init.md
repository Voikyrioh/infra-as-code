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
