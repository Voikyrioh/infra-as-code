# Accès aux bases de données via SSH tunnel

Les bases de données (MySQL, PostgreSQL) tournent sur un réseau Docker interne (`mysql`, `postgres`) et ne sont pas exposées directement sur Internet. Pour y accéder depuis ta machine locale, utilise un tunnel SSH.

## MySQL (port local 3306)

```bash
ssh -L 3306:shared_mysql:3306 -N deploy@<VPS_HOST> -p <VPS_PORT>
```

Ou via le Makefile à la racine du repo :

```bash
make db-mysql VPS_HOST=<ip_du_vps> VPS_PORT=<port_ssh>
```

Une fois le tunnel actif, connecte-toi avec DBeaver, TablePlus ou tout client MySQL :
- **Host** : `localhost`
- **Port** : `3306`
- **User** / **Password** / **Database** : récupérés depuis Vault (`secret/apps/<app_name>`)

## PostgreSQL (port local 5432)

```bash
ssh -L 5432:shared_postgres:5432 -N deploy@<VPS_HOST> -p <VPS_PORT>
```

Ou via le Makefile :

```bash
make db-postgres VPS_HOST=<ip_du_vps> VPS_PORT=<port_ssh>
```

## Notes

- Le flag `-N` ouvre le tunnel sans lancer de shell (connexion silencieuse).
- Utilise `Ctrl+C` pour fermer le tunnel.
- Les credentials VPS (`VPS_HOST`, `VPS_PORT`) sont dans les GitHub Secrets du repo infra.
- La clé SSH est `VPS_SSH_KEY` — exporte-la dans `~/.ssh/` si besoin d'un accès direct.
