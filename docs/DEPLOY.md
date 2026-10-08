# Putting the server online

The **GitHub Pages demo** (`yashrajsurgo0.github.io/VyaparBoss`) is static: data stays in each visitor's browser, and Claude and WhatsApp can't run there. For the pilot you need the **server** online at a public `https://` address. That's what gives you shared data, Claude through your API key, and WhatsApp.

The server has no dependencies, so any host that runs Node 18+ works. The one requirement is a **persistent disk**: data lives in `data/db.json`, and hosts that wipe the disk on every restart would lose your orders.

## Option A: Render (easiest, about 10 min)

The repo includes a `render.yaml` blueprint.

1. Sign up at **render.com** with your GitHub account.
2. **New → Blueprint**, pick the **VyaparBoss** repo, and click **Apply**. Render reads `render.yaml` and creates the web service with a 1 GB disk mounted at `/var/data`.
3. When asked for environment values, paste your `ANTHROPIC_API_KEY`. Add the WhatsApp ones later, following WHATSAPP_SETUP.md.
4. After the first deploy you get an address like `https://vyaparboss.onrender.com`. Open `/api/health` on it to check: it should show `"app":"vyaparboss"`.

Cost: persistent disks need a paid instance (Render's Starter plan plus disk, a few dollars a month; check render.com/pricing). The free plan works for a quick look, but its disk is wiped on restart.

Every push to `main` redeploys automatically.

## Option B: any VPS (DigitalOcean, AWS Lightsail, Hetzner)

```bash
git clone https://github.com/yashrajsurgo0/VyaparBoss && cd VyaparBoss
cp .env.example .env && nano .env      # add keys
PORT=5173 node server/index.js         # use pm2 or systemd to keep it running
```

Put it behind Caddy or nginx for HTTPS, since WhatsApp requires `https://`.

## Keys you'll set

| Variable | Needed for | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude reads buyer messages, drafts supplier replies | console.anthropic.com → API Keys |
| `ANTHROPIC_MODEL` | Optional, default `claude-haiku-5-5` | — |
| `DATA_FILE` | Where data is saved (`/var/data/db.json` on Render) | — |
| `WHATSAPP_*` | WhatsApp intake | docs/WHATSAPP_SETUP.md |

## Backups

`data/db.json` is the whole database. Download a copy weekly from the Render shell (`cat /var/data/db.json`) or with a cron job on a VPS. Move to Postgres before you have many concurrent users.
