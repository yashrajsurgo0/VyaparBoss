# Putting the server online

The **GitHub Pages demo** (`yashrajsurgo0.github.io/VyaparBoss`) is static: data stays in each visitor's browser, and Claude and WhatsApp can't run there. For the pilot you need the **server** online at a public `https://` address. That's what gives you shared data, Claude through your API key, and WhatsApp.

The server has no dependencies, so any host that runs Node 18+ works. The one requirement is a **persistent disk**: data lives in `data/db.json`, and hosts that wipe the disk on every restart would lose your orders.

## Option A: Render (easiest, about 10 min)

The repo includes a `render.yaml` blueprint.

1. Sign up at **render.com** with your GitHub account.
2. **New → Blueprint**, pick the **VyaparBoss** repo, and click **Apply**. Render reads `render.yaml` and creates the web service on the **free** plan.
3. When asked for environment values, paste your `GEMINI_API_KEY` (from aistudio.google.com → Get API key). Add the WhatsApp ones later, following WHATSAPP_SETUP.md.
4. After the first deploy you get an address like `https://vyaparboss.onrender.com`. Open `/api/health` on it to check: it should show `"app":"vyaparboss"`.

**Free vs paid.** The free plan sleeps when idle (the first request takes about a minute) and **wipes its disk on every restart or redeploy**. Two ways to keep your data:

**Free: Upstash (about 3 minutes, recommended now).**
1. Sign up at **upstash.com** (Google or GitHub login), **Create database** → Redis, any name, region **ap-south-1 (Mumbai)** or the one nearest your Render region, free plan.
2. On the database page, open **REST API** and copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. In Render → your service → **Environment**, add both, save. Render redeploys.
4. Open `/api/health`: it should say `"storage":"upstash"`. From now on the server copies its data to Upstash a second after every change, plus one dated copy per day kept for 14 days, and loads it back after every redeploy. If Upstash can't be read at start-up, the server refuses to start rather than start empty and overwrite good data.

The whole database is one value, so this suits the pilot (thousands of records). Move to Postgres when you outgrow it.

**Paid: a Render disk.** Upgrade: in Render open the service → **Settings → Instance type → Starter**, then **Disks → Add disk** (mount path `/var/data`, 1 GB) and set `DATA_FILE=/var/data/db.json` under **Environment**. Or edit `render.yaml` as its comments describe. Check render.com/pricing for current prices.

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
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Keeps data across redeploys on the free plan | upstash.com → your database → REST API |
| `ADMIN_KEY` | Team tools (Sign-ups, Outreach, network edits) | Any long random string you make up |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `OUTREACH_FROM_EMAIL` | Password resets, order emails, outreach | docs/OUTREACH.md |
| `CONTACT_TO` | Where contact-page messages are forwarded | Your inbox |
| `WHATSAPP_*` | WhatsApp intake | docs/WHATSAPP_SETUP.md |

## Backups

`data/db.json` is the whole database. With Upstash on, there's a dated copy for each of the last 14 days (`vyaparboss:db:day:YYYY-MM-DD`). You can also download a copy any time from Team → Outreach → Back up (or `GET /api/admin/backup` with the admin key) and restore it there. Move to Postgres before you have many concurrent users.

## What the server does for you

- Security headers on every response (Content-Security-Policy, HSTS over https, no framing by other sites, no MIME sniffing).
- Compressed (gzip) static files with ETags, so repeat visits only re-check, not re-download.
- `robots.txt`, `sitemap.xml`, a branded 404 page, and Privacy, Terms and Contact pages (needed for Google and Facebook sign-in approval).
- A GitHub Actions workflow runs `npm test` on every push to `main`.
