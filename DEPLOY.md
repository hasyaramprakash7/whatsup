# Deploying to a server

The whole system runs on **one Linux server** with Docker:

```
Internet ──HTTPS──▶ Caddy ──▶ app (dashboard + API + /webhook)
                              worker (sends broadcasts)
                              MongoDB, Redis (private, not reachable from outside)
```

Caddy gets a free HTTPS certificate automatically. You need about **30 minutes**.

---

## 1. Rent a server

Any provider works. You need **Ubuntu 24.04, 2 GB RAM, 1 vCPU, 25+ GB disk**.

| Provider | Plan | Approx. cost |
|---|---|---|
| DigitalOcean (Bangalore region) | Basic Droplet, 2 GB | ~$12 / month |
| AWS Lightsail (Mumbai region) | 2 GB instance | ~$12 / month |
| Hetzner (Singapore region) | CX22 / CPX11 | ~€5 / month |

When creating it, add your **SSH key** (or note the root password). Copy the server's **public IP address**.

## 2. Point a domain at it

In your DNS (Cloudflare for `bluxurytech.com`), add:

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `wa` | *server IP* | **DNS only** (grey cloud) |

That gives you `wa.bluxurytech.com`. Keep it **DNS only** so Caddy can get the certificate.

## 3. Install Docker on the server

```bash
ssh root@YOUR_SERVER_IP
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 4. Get the code

```bash
git clone https://github.com/hasyaramprakash7/whatsup.git /opt/whatsup
cd /opt/whatsup
```

(If the repository is private, GitHub will ask you to sign in — use a
[personal access token](https://github.com/settings/tokens) as the password.)

## 5. Create the `.env` on the server

```bash
cp .env.example .env
nano .env
```

Fill in (copy the Meta/R2 values from your PC's `.env`):

| Setting | Value |
|---|---|
| `APP_DOMAIN` | `wa.bluxurytech.com` |
| `REDIS_PASSWORD` | output of `openssl rand -hex 24` |
| `ADMIN_API_KEY` | output of `openssl rand -hex 32` (a **new** key for production) |
| `WHATSAPP_VERIFY_TOKEN` | same as on your PC, or a new one (then update Meta, step 8) |
| `META_APP_SECRET` | from Meta → App settings → Basic |
| `R2_*` | same as on your PC |
| `CORS_ORIGINS` | `https://wa.bluxurytech.com` |

You can leave `MONGO_URI`, `REDIS_HOST`, `REDIS_PORT`, `NODE_ENV`, `TRUST_PROXY` as they are —
docker-compose sets them. Save with `Ctrl+O`, `Enter`, `Ctrl+X`, then lock the file:

```bash
chmod 600 .env
```

## 6. Start everything

```bash
docker compose up -d --build
docker compose ps          # all services should be "Up" (app/mongo/redis "healthy")
```

Open `https://wa.bluxurytech.com` — the sign-in page should load with a padlock.
Sign in with the new `ADMIN_API_KEY`.

## 7. Clients and data

**Fresh start (simplest):** create the client again in the dashboard (Phone Number ID, WABA ID,
access token…). A new client key (`wre_…`) is shown once — save it.

**Or copy your test data from the PC** (keeps the client, its key and leads):

```powershell
# On your PC (PowerShell, in the project folder)
docker exec mongo mongodump --db whatsapp_realestate --archive=/tmp/wa.archive
docker cp mongo:/tmp/wa.archive .\wa.archive
scp .\wa.archive root@YOUR_SERVER_IP:/opt/whatsup/
```

```bash
# On the server
cd /opt/whatsup
docker compose cp wa.archive mongo:/tmp/wa.archive
docker compose exec mongo mongorestore --archive=/tmp/wa.archive
rm wa.archive
```

## 8. Point Meta at the server

Meta app → **Connect on WhatsApp → Configuration → Webhook → Edit**:

- **Callback URL:** `https://wa.bluxurytech.com/webhook`
- **Verify token:** the `WHATSAPP_VERIFY_TOKEN` from the server's `.env`

Click **Verify and save**, and check **messages** is still **Subscribed**.
Then send "Hi" from your phone and watch the logs (next section).

You can now stop ngrok and the server on your PC.

---

## Everyday commands (on the server, in `/opt/whatsup`)

| Task | Command |
|---|---|
| See live logs | `docker compose logs -f app worker` |
| Status | `docker compose ps` |
| Restart after editing `.env` | `docker compose up -d` |
| Deploy new code from GitHub | `git pull && docker compose up -d --build` |
| Stop everything | `docker compose down` (data is kept) |

## Backups

MongoDB data lives in a Docker volume on the server. Make a daily backup:

```bash
mkdir -p /opt/backups
crontab -e
# add this line (runs 03:00 daily, keeps 14 days):
0 3 * * * cd /opt/whatsup && docker compose exec -T mongo mongodump --db whatsapp_realestate --archive > /opt/backups/wa-$(date +\%F).archive && find /opt/backups -name 'wa-*.archive' -mtime +14 -delete
```

Copy backups off the server from time to time (e.g. to R2 or your PC).

## Troubleshooting

- **No padlock / certificate error:** DNS must point at the server and be *DNS only*; ports 80/443 open.
  Check `docker compose logs caddy`.
- **`Set REDIS_PASSWORD` / `Set APP_DOMAIN` error on start:** that value is missing in `.env`.
- **Meta "Verify and save" fails:** verify token in Meta ≠ `WHATSAPP_VERIFY_TOKEN` in `.env`,
  or the site isn't reachable over HTTPS yet.
- **Webhook arrives but "Invalid signature":** `META_APP_SECRET` is wrong.
