# CLAUDE.md — Infrastructure VPS OVH

## Contexte du projet

Infrastructure as-code complète pour un VPS OVH (2 vCores, 2 Go RAM, 40 Go disque).
Remplace un setup manuel (Docker à la main + PM2 + Nginx) par une stack automatisée.
Cloudflare est utilisé comme proxy SSL public en amont.
Ce repo est privé sur GitHub.

## Stack retenue

| Rôle | Outil |
|------|-------|
| Orchestration containers | Docker Compose |
| Reverse proxy | Traefik (remplace Nginx, auto-découverte via labels) |
| Métriques | Victoria Metrics (compatible Prometheus, plus léger) |
| Logs (stockage) | Loki |
| Logs (collecte) | Fluent Bit |
| Visualisation | Grafana |
| Config serveur | Ansible (bootstrap initial uniquement) |
| CI/CD | GitHub Actions |
| Registry images | GHCR (GitHub Container Registry) |
| Dashboard custom | Backend Hono (TypeScript) + Frontend Vue 3 |
| Auth dashboard | WebAuthn / Passkeys via Dashlane (biométrie) |

## Architecture

```
Internet → Cloudflare (HTTPS) → Traefik (reverse proxy)
                                      ├── Apps Docker (via labels)
                                      ├── Grafana (monitoring.domaine.fr)
                                      └── Dashboard (dashboard.domaine.fr)

Stack monitoring (réseau interne Docker) :
  Fluent Bit → Loki (logs)
  Victoria Metrics ← scrape métriques containers
  Grafana ← Victoria Metrics + Loki
```

## Décisions architecturales clés

- **Docker Compose plutôt que Kubernetes** : k3s utiliserait ~500-700 Mo RAM, laissant trop peu pour les apps. Docker Compose couvre les besoins réels (scaling vertical + multi-instances sur même nœud).
- **Traefik plutôt que Nginx** : auto-découverte des containers via labels Docker — plus de fichier de config à créer par site.
- **Victoria Metrics plutôt que Prometheus** : même API, ~2x plus léger en RAM.
- **Ansible pour le bootstrap uniquement** : configure le serveur une fois (Docker, UFW, Fail2ban, SSH). Après ça, tout passe par Docker Compose + GitHub Actions.
- **WebAuthn (passkeys) pour le dashboard** : authentification biométrique via Dashlane, pas de mot de passe.
- **GHCR** : gratuit pour les repos privés, intégré à GitHub Actions.

## Structure du repo

```
infra/
├── ansible/                    # Bootstrap serveur (exécuté une fois)
│   ├── inventory.yml
│   └── playbooks/
│       ├── setup.yml           # Docker, users, répertoires
│       └── security.yml        # UFW, Fail2ban, SSH keys
├── traefik/                    # Config reverse proxy
│   ├── traefik.yml
│   └── dynamic/middlewares.yml
├── monitoring/                 # Stack observabilité
│   ├── docker-compose.yml
│   ├── victoria-metrics.yml
│   ├── loki.yml
│   └── fluent-bit.conf
├── dashboard/                  # Dashboard custom
│   ├── backend/                # Hono + TypeScript
│   └── frontend/               # Vue 3
└── .github/workflows/          # CI/CD GitHub Actions
```

## Phases d'implémentation

1. Bootstrap serveur (Ansible)
2. Traefik (reverse proxy + TLS)
3. Stack monitoring (Grafana fonctionnel)
4. CI/CD template (workflow réutilisable)
5. Dashboard backend (Hono + Docker socket + WebAuthn)
6. Dashboard frontend (Vue 3 + biométrie)
7. Migration des apps existantes

## Sécurité

- SSH par clé uniquement (pas de mot de passe)
- Clé SSH dédiée pour GitHub Actions (stockée en GitHub Secret)
- UFW : ports 80, 443, SSH uniquement
- Fail2ban : protection brute-force SSH
- Tous les secrets dans GitHub Secrets, jamais dans le code
- Interfaces internes (Grafana, Dashboard) derrière Traefik HTTPS

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

## Comment interagir avec ce projet

### Profil utilisateur
- Débutant en Ops/DevOps, développeur capable côté code
- Veut apprendre et comprendre, pas juste copier-coller
- Objectif : pouvoir maintenir et faire évoluer l'infra seul

### Approche pédagogique à suivre
- **Toujours expliquer le pourquoi** avant le comment pour chaque décision
- **Donner des pistes de recherche** plutôt que tout donner d'emblée
- Proposer une **première implémentation** uniquement si explicitement demandé
- Résumer les **décisions et leurs raisons** après chaque étape significative
- Signaler quand une notion mérite d'être apprise plus en profondeur

### Style de collaboration
- Poser les questions **une par une** (pas de liste de 5 questions d'un coup)
- **Proposer 2-3 options** avec trade-offs quand plusieurs choix s'offrent
- Mettre à jour ce CLAUDE.md après chaque décision architecturale importante
- Préférer les explications courtes avec des schémas ASCII plutôt que de longs paragraphes
