# Hackathon Deployment Guide

Each team gets a **forked repo + subdomain + AWS credentials** from the organizer.  
CI/CD runs in your fork via GitHub Actions — no local tooling required to deploy.

---

## What the organizer provides to each team

| Item | Example |
|------|---------|
| Subdomain | `team-alpha.hackathon.seta-international.com` |
| EC2 public IP | `x.x.x.x` (pre-bootstrapped, Docker ready) |
| EC2 SSH private key | `.pem` file |
| ECR registry | `YOUR_ACCOUNT_ID.dkr.ecr.YOUR_REGION.amazonaws.com` |
| ECR repository | `team-alpha` |
| AWS access key (ECR push) | `AKIA…` |
| AWS secret key (ECR push) | `…` |
| OpenAI API key | `sk-…` |

---

## One-time setup (after receiving credentials)

### 1. Fork the repo

Go to `https://github.com/Seta-International/agent-platform` → **Fork**.

### 2. Set GitHub Variables

**Settings → Secrets and variables → Actions → Variables tab → New repository variable**

| Variable | Value |
|----------|-------|
| `ECR_REGISTRY` | ECR registry hostname from organizer |
| `ECR_REPOSITORY` | ECR repository name from organizer |
| `APP_DOMAIN` | Your subdomain from organizer |
| `EC2_HOST` | EC2 public IP from organizer |

> `AWS_REGION` defaults to `ap-southeast-1` — only add it if your ECR is in a different region.

### 3. Set GitHub Secrets

**Settings → Secrets and variables → Actions → Secrets tab → New repository secret**

| Secret | Value |
|--------|-------|
| `AWS_ECR_ACCESS_KEY_ID` | AWS access key from organizer |
| `AWS_ECR_SECRET_ACCESS_KEY` | AWS secret key from organizer |
| `EC2_SSH_PRIVATE_KEY` | Full content of the `.pem` file (including `-----BEGIN...-----`) |
| `OPENAI_API_KEY` | OpenAI API key from organizer |

> Database password, auth secret, and encryption key are **auto-generated on the EC2 on first deploy** and persisted in `/opt/seta/secrets.env` — no need to generate or store them yourself.

### 4. Verify EC2 is ready

If the organizer provisioned the EC2 with the Terraform stack, everything is pre-configured — skip to [First deploy](#first-deploy).

If you are using a **plain Ubuntu 24.04 instance**, SSH in and run the one-time bootstrap:

```bash
ssh -i your-key.pem ubuntu@<EC2_HOST>

# 1. Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker

# 2. Install AWS CLI v2
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip awscliv2.zip && sudo ./aws/install && rm -rf aws awscliv2.zip

# 3. Stop host nginx — Traefik owns ports 80 and 443
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl disable nginx 2>/dev/null || true
sudo apt-get purge -y nginx nginx-common 2>/dev/null || true

# 4. Verify
docker --version && aws --version
```

---

## First deploy

1. Go to your fork on GitHub → **Actions** → **Hackathon — Release**
2. Click **Run workflow**
3. Optionally enter a custom image tag (default: short SHA of HEAD)
4. Click **Run workflow** — takes ~5–8 min for the first build (cached on subsequent runs)

The workflow:
- Builds `seta-server` and `seta-web` for `linux/amd64`
- Generates and persists app secrets on the EC2 (first run only)
- Pushes images to your ECR repository
- SSHs into your EC2, writes `/opt/seta/.env`, pulls images, runs migrations, starts the stack
- Smoke-tests `https://<APP_DOMAIN>/health/ready`

### Access your app

```
https://<APP_DOMAIN>
```

---

## First-time seed (demo data)

Run this **once after the first deploy** to bootstrap the hackathon tenant and load all demo data.

1. Go to **Actions** → **Hackathon — DB Reset & Seed**
2. Click **Run workflow** — all inputs have safe defaults
3. Log in after completion:

```
Email:    admin@hackathon.com
Password: ChangeMe@2026
```

> **Warning:** this **destroys all data** in the database. Only use it for a fresh start or a full demo reset.

---

## Redeploy after code changes

Run **Hackathon — Release** again — either manually or push to `main`.

---

## Full reset (wipe + re-seed)

Re-run **Hackathon — DB Reset & Seed** at any time to wipe all data and reload the demo dataset.

---

## Useful SSH commands

```bash
ssh -i your-key.pem ubuntu@<EC2_HOST>

# Live logs
cd /opt/platform && docker compose --env-file /opt/seta/.env logs -f --tail=50

# Restart stack manually
docker compose --env-file /opt/seta/.env up -d --no-deps server web worker

# Check .env
cat /opt/seta/.env

# Run migrations manually
docker compose --env-file /opt/seta/.env run --rm migrator
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Workflow fails at ECR login | Check `AWS_ECR_ACCESS_KEY_ID` and `AWS_ECR_SECRET_ACCESS_KEY` secrets |
| Workflow fails at SSH | Check `EC2_SSH_PRIVATE_KEY` and `EC2_HOST`; ensure port 22 is open in the EC2 security group |
| App not reachable after deploy | Check DNS — your subdomain must point to the EC2 IP |
| Port 80/443 already in use | Run `sudo systemctl stop nginx && sudo systemctl disable nginx` on EC2 |
| Database errors | Run migrations: `docker compose --env-file /opt/seta/.env run --rm migrator` on EC2 |
| EC2 replaced / secrets lost | Delete `/opt/seta/secrets.env` on the new EC2 before deploying — fresh secrets will be generated and postgres re-initialised |
| Seed fails mid-run | It's idempotent — re-run the workflow with **Seed demo data** checked |
| `proxy` container not starting | Check `docker logs seta-proxy-1` — often a bad Traefik config mount or port conflict |
