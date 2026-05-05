# CI Release + Deploy Version — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer deux workflows GitHub Actions dans le repo infra — un workflow réutilisable de release (build + push GHCR + tag git + GitHub Release) et un workflow de déploiement d'une version précise sur le VPS via Vault.

**Architecture:** `ci-release.yml` est un workflow `workflow_call` qui lit le dernier tag git, calcule le nouveau selon le bump choisi (patch/minor/major), build l'image Docker, la push sur GHCR et crée la release GitHub. `deploy-version.yml` est un `workflow_dispatch` qui prend `app_name` + `version`, s'authentifie à Vault, génère `.env` et déploie via SSH. Chaque app repo a un wrapper minimaliste qui expose le `workflow_dispatch` à l'utilisateur.

**Tech Stack:** GitHub Actions, Bash, Docker Buildx, GHCR, gh CLI, Vault CLI (apt HashiCorp), appleboy/scp-action, appleboy/ssh-action, yq (mikefarah/yq@v4)

---

## File Map

| Fichier | Action | Responsabilité |
|---------|--------|----------------|
| `.github/workflows/ci-release.yml` | Créer | Workflow réutilisable : bump version, build, push GHCR, release |
| `.github/workflows/deploy-version.yml` | Créer | Déploiement d'une version précise sur le VPS |
| `C:\Lab\chess\.github\workflows\release.yml` | Créer | Wrapper workflow_dispatch pour chess |
| `D:\Lab\Web\slay_the_slime\.github\workflows\release.yml` | Créer | Wrapper workflow_dispatch pour slay-the-slime |

---

## Task 1 — Workflow `ci-release.yml`

**Files:**
- Create: `.github/workflows/ci-release.yml`

- [ ] **Créer `.github/workflows/ci-release.yml`**

```yaml
name: CI Release (Reusable)

on:
  workflow_call:
    inputs:
      app_name:
        description: "Nom de l'image Docker sur GHCR (ex: my-chess-game)"
        required: true
        type: string
      bump_type:
        description: "Type de bump sémantique"
        required: true
        type: string

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Calculer le nouveau tag
        id: version
        run: |
          LATEST=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
          MAJOR=$(echo "$LATEST" | cut -d. -f1 | tr -d 'v')
          MINOR=$(echo "$LATEST" | cut -d. -f2)
          PATCH=$(echo "$LATEST" | cut -d. -f3)

          case "${{ inputs.bump_type }}" in
            major) NEW="v$((MAJOR+1)).0.0" ;;
            minor) NEW="v${MAJOR}.$((MINOR+1)).0" ;;
            patch) NEW="v${MAJOR}.${MINOR}.$((PATCH+1))" ;;
            *) echo "ERROR: bump_type invalide" >&2; exit 1 ;;
          esac

          echo "tag=$NEW" >> $GITHUB_OUTPUT
          echo "Nouveau tag : $NEW (depuis $LATEST)"

      - name: Login GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build et push image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/${{ github.repository_owner }}/${{ inputs.app_name }}:${{ steps.version.outputs.tag }}
            ghcr.io/${{ github.repository_owner }}/${{ inputs.app_name }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Créer le tag git et la release GitHub
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NEW_TAG: ${{ steps.version.outputs.tag }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git tag "$NEW_TAG"
          git push origin "$NEW_TAG"
          gh release create "$NEW_TAG" \
            --title "$NEW_TAG" \
            --generate-notes
```

- [ ] **Valider la syntaxe YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci-release.yml')); print('OK')"
```

Expected: `OK`

- [ ] **Commit**

```bash
git add .github/workflows/ci-release.yml
git commit -m "feat: add reusable ci-release workflow"
```

---

## Task 2 — Workflow `deploy-version.yml`

**Files:**
- Create: `.github/workflows/deploy-version.yml`

- [ ] **Créer `.github/workflows/deploy-version.yml`**

```yaml
name: Deploy Version

on:
  workflow_dispatch:
    inputs:
      app_name:
        description: "Nom de l'app (= fichier dans apps/, ex: chess)"
        required: true
        type: string
      version:
        description: "Version à déployer (ex: v1.2.3)"
        required: true
        type: string

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Validation
        env:
          APP_NAME: ${{ inputs.app_name }}
          VERSION: ${{ inputs.version }}
        run: |
          if [[ ! "$APP_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
            echo "ERROR: app_name invalide" >&2; exit 1
          fi
          if [ ! -f "apps/$APP_NAME.yml" ]; then
            echo "ERROR: apps/$APP_NAME.yml introuvable" >&2; exit 1
          fi
          if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "ERROR: version doit correspondre à vX.Y.Z" >&2; exit 1
          fi

      - name: Calcul du SSH fingerprint
        id: fingerprint
        env:
          VPS_HOST: ${{ secrets.VPS_HOST }}
          VPS_SSH_PORT: ${{ secrets.VPS_SSH_PORT }}
        run: |
          FINGERPRINT=$(ssh-keyscan -p "$VPS_SSH_PORT" "$VPS_HOST" 2>/dev/null)
          if [ -z "$FINGERPRINT" ]; then
            echo "ERROR: ssh-keyscan vide" >&2; exit 1
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

      - name: Install Vault CLI
        run: |
          sudo apt-get update -qq && sudo apt-get install -y -qq gpg
          wget -qO- https://apt.releases.hashicorp.com/gpg | gpg --dearmor | sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg > /dev/null
          echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
          sudo apt-get update -qq && sudo apt-get install -y -qq vault

      - name: Générer .env depuis Vault
        env:
          VAULT_ADDR: ${{ secrets.VAULT_ADDR }}
          VAULT_ROLE_ID: ${{ secrets.VAULT_ROLE_ID }}
          VAULT_SECRET_ID: ${{ secrets.VAULT_SECRET_ID }}
          APP_NAME: ${{ inputs.app_name }}
          VERSION: ${{ inputs.version }}
        run: |
          TOKEN=$(vault write -field=token auth/approle/login \
            role_id="$VAULT_ROLE_ID" \
            secret_id="$VAULT_SECRET_ID")
          echo "::add-mask::$TOKEN"
          export VAULT_TOKEN="$TOKEN"

          echo "IMAGE_TAG=$VERSION" > .env

          if vault kv get -format=json "secret/apps/$APP_NAME" > /tmp/vault-secrets.json 2>/dev/null; then
            jq -r '.data.data | to_entries[] | "\(.key)=\(.value)"' /tmp/vault-secrets.json >> .env
          fi

          echo "=== .env généré (clés uniquement) ==="
          cut -d= -f1 .env

      - name: Copier .env sur le VPS
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_SSH_PORT }}
          source: ".env"
          target: /opt/infra/apps/${{ inputs.app_name }}/

      - name: Déployer sur le VPS
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

      - name: Cleanup SSH
        if: always()
        run: rm -rf ~/.ssh
```

- [ ] **Valider la syntaxe YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-version.yml')); print('OK')"
```

Expected: `OK`

- [ ] **Commit**

```bash
git add .github/workflows/deploy-version.yml
git commit -m "feat: add deploy-version workflow"
```

- [ ] **Push**

```bash
git push origin main
```

---

## Task 3 — Wrapper `release.yml` pour chess

**Files:**
- Create: `C:\Lab\chess\.github\workflows\release.yml`

- [ ] **Créer `C:\Lab\chess\.github\workflows\release.yml`**

```yaml
name: Release

on:
  workflow_dispatch:
    inputs:
      bump_type:
        description: "Type de release"
        type: choice
        options:
          - patch
          - minor
          - major
        default: patch

jobs:
  release:
    uses: voikyrioh/infra-as-code/.github/workflows/ci-release.yml@main
    with:
      app_name: my-chess-game
      bump_type: ${{ inputs.bump_type }}
    secrets: inherit
    permissions:
      contents: write
      packages: write
```

- [ ] **Valider la syntaxe YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('C:/Lab/chess/.github/workflows/release.yml')); print('OK')"
```

Expected: `OK`

- [ ] **Commit dans le repo chess**

```bash
git -C "C:/Lab/chess" add .github/workflows/release.yml
git -C "C:/Lab/chess" commit -m "feat: add release workflow (uses infra ci-release)"
git -C "C:/Lab/chess" push origin main
```

---

## Task 4 — Wrapper `release.yml` pour slay-the-slime

**Files:**
- Create: `D:\Lab\Web\slay_the_slime\.github\workflows\release.yml`

- [ ] **Créer `D:\Lab\Web\slay_the_slime\.github\workflows\release.yml`**

```yaml
name: Release

on:
  workflow_dispatch:
    inputs:
      bump_type:
        description: "Type de release"
        type: choice
        options:
          - patch
          - minor
          - major
        default: patch

jobs:
  release:
    uses: voikyrioh/infra-as-code/.github/workflows/ci-release.yml@main
    with:
      app_name: slay_the_slime
      bump_type: ${{ inputs.bump_type }}
    secrets: inherit
    permissions:
      contents: write
      packages: write
```

- [ ] **Valider la syntaxe YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('D:/Lab/Web/slay_the_slime/.github/workflows/release.yml')); print('OK')"
```

Expected: `OK`

- [ ] **Commit dans le repo slay-the-slime**

```bash
git -C "D:/Lab/Web/slay_the_slime" add .github/workflows/release.yml
git -C "D:/Lab/Web/slay_the_slime" commit -m "feat: add release workflow (uses infra ci-release)"
git -C "D:/Lab/Web/slay_the_slime" push origin main
```

---

## Vérification end-to-end

### Test du workflow ci-release (via chess)

1. Aller sur GitHub → repo `voikyrioh/my-chess-game` → Actions → "Release"
2. Cliquer "Run workflow" → choisir `patch`
3. Vérifier :
   - Le workflow passe au vert
   - Un tag `v0.0.1` existe dans le repo chess
   - Une release `v0.0.1` est créée avec notes auto-générées
   - L'image `ghcr.io/voikyrioh/my-chess-game:v0.0.1` existe sur GHCR
   - L'image `ghcr.io/voikyrioh/my-chess-game:latest` est mise à jour

### Test du workflow deploy-version

1. Aller sur GitHub → repo `voikyrioh/infra-as-code` → Actions → "Deploy Version"
2. Cliquer "Run workflow" → `app_name: chess`, `version: v0.0.1`
3. Vérifier :
   - Le workflow passe au vert
   - Sur le VPS : `cat /opt/infra/apps/chess/.env` contient `IMAGE_TAG=v0.0.1`
   - `docker ps | grep chess` → container `Up`
   - `https://chess.voikyrioh.fr` répond
