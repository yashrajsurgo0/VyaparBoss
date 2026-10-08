# Putting the server online

The **GitHub Pages demo** (`yashrajsurgo0.github.io/VyaparBoss`) is static: data stays in each visitor's browser, and Claude and WhatsApp can't run there. For the pilot you need the **server** online at a public `https://` address. That's what gives you shared data, Claude through your API key, and WhatsApp.

The server has no dependencies, so any host that runs Node 18+ works. The one requirement is a **persistent disk**: data lives in `data/db.json`, and hosts that wipe the disk on every restart would lose your orders.

## Option A: Render (easiest, about 10 min)

The repo includes a `render.yaml` blueprint.

1. Sign up at **render.com** with your GitHub account.
2. **New → Blueprint**, pick the **VyaparBoss** repo, and click **Apply**. Render reads `render.yaml` and creates the web service on the **free** plan.
3. When asked for environment values, paste your `GEMINI_API_KEY` (from aistudio.google.com → Get API key). Add the WhatsApp ones later, following WHATSAPP_SETUP.md.
4. After the first deploy you get an address like `https://vyaparboss.onrender.com`. Open `/api/health` on it to check: it should show `"app":"vyaparboss"`.

**Free vs paid.** The free plan sleeps when idle (the first request takes about a minute) and **wipes data on every restart or redeploy**. Before real orders, upgrade: in Render open the service → **Settings → Instance type → Starter**, then **Disks → Add disk** (mount path `/var/data`, 1 GB) and set `DATA_FILE=/var/data/db.json` under **Environment**. Or edit `render.yaml` as its comments describe. Check render.com/pricing for current prices.

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
| `GEMINI_API_KEY` | AI reads buyer messages, drafts supplier replies | aistudio.google.com → Get API key |
| `GEMINI_MODEL` | Optional, default `gemini-3.8-flash` | — |
| `ANTHROPIC_API_KEY` | Alternative to Gemini (Claude) | console.anthropic.com → API Keys |
| `DATA_FILE` | Where data is saved (`/var/data/db.json` on Render) | — |
| `WHATSAPP_*` | WhatsApp intake | docs/WHATSAPP_SETUP.md |

## Backups

`data/db.json` is the whole database. Download a copy weekly from the Render shell (`cat /var/data/db.json`) or with a cron job on a VPS. Move to Postgres before you have many concurrent users.
