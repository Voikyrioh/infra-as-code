# Provision App — CLAUDE.md

Infrastructure repo pour automatiser le provisioning d'apps Docker sur VPS via GitHub Actions.

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
