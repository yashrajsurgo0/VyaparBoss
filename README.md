# VyaparBoss
VyaparBoss | AI-powered B2B procurement and supply chain platform connecting Indian businesses with verified suppliers through intelligent sourcing, price comparison, automated negotiation, and seamless fulfillment.

**Vyapar bada, jhanjhat chhota!**

Meet **Bhai**, the built-in buying assistant: *Tu business badha, jugaad mera!*

AI-powered B2B procurement for Indian MSMEs: a buyer describes what they need in English, Hindi or Hinglish, and VyaparBoss turns it into a structured RFQ, finds qualified verified suppliers, compares total landed cost, negotiates within the buyer's target, and raises a purchase order only after the buyer approves.

An initiative of House of 24 Pvt. Ltd. Current stage: pre-MVP prototype.

## Run it

```bash
cp .env.example .env     # optional: add GEMINI_API_KEY (or ANTHROPIC_API_KEY) to switch on AI parsing
npm start                # app + API at http://localhost:5173
npm test                 # engine, parser and API tests (Node 18+, no dependencies)
npm run deploy:pages     # publish src/ to GitHub Pages (gh-pages branch)
npm run build:single     # dist/vyaparboss.html: whole app in one file, for sharing
```

**Live server:** https://vyaparboss.onrender.com (shared data, Gemini AI; Render free plan, so it sleeps when idle and data resets on redeploy).
**Static demo:** https://yashrajsurgo0.github.io/VyaparBoss/ (data stays in your browser). Redeploy with `npm run deploy:pages`.

Two ways the same app runs:

| | Data lives in | Request parsing | Used for |
|---|---|---|---|
| **With the server** (`npm start`) | `data/db.json` on the server, shared by everyone | Gemini or Claude via your API key (rule parser if no key) | Pilot operations, WhatsApp |
| **Static page** (GitHub Pages, claude.ai, opening `src/index.html`) | The viewer's browser | Claude inside claude.ai, otherwise the rule parser | Demos |

The app checks for `api/health` on load and picks the mode by itself.

## API

| Method | Path | Does |
|---|---|---|
| GET | `/api/health` | App, AI and WhatsApp status |
| GET | `/api/state` | Orders, RFQs, onboarded suppliers, settings |
| POST | `/api/parse` | `{text, partial}` → structured requirement (Claude or rules) |
| POST | `/api/quotes` | `{productId, qty, city, deadline}` → ranked landed-cost quotes |
| POST / PATCH | `/api/rfqs`, `/api/rfqs/:id` | Create / update RFQs (server assigns `RFQ-2627-0001` ids) |
| POST / PATCH | `/api/orders`, `/api/orders/:po` | Raise POs (`VB/PO/2026-27/0001`), move stages, flag issues |
| PUT / DELETE | `/api/suppliers/:id` | Onboard, edit or remove a supplier (validated, GSTIN checksum) |
| PUT | `/api/settings` | `{useSamples}`: show or hide the 15 sample suppliers |
| POST | `/api/draft` | AI-drafted supplier reply for an RFQ |
| GET / POST | `/webhooks/whatsapp` | Meta webhook verification and incoming messages (HMAC-checked when `WHATSAPP_APP_SECRET` is set) |
| POST | `/api/whatsapp/simulate` | `{from, text}` → the reply a buyer would get (no message sent) |
| GET | `/api/whatsapp/log` | Recent conversations, phone numbers masked |
| DELETE | `/api/samples` | Remove sample orders |

## What's in the prototype

**Bhai** is the built-in buying assistant. The Buy screen starts with one question ("Bolo kya chahiye?") and three category tiles. Each answer reveals the next question (product → quantity → city → date). Then comes Bhai's pick with the delivered price, with the breakdown, all quotes and negotiation one tap away, then confirm and approve.

| Tab | What it does |
|---|---|
| Buy | Talk to Bhai or tap through categories → quotes ranked by delivered cost → ask for a better price → approve → PO |
| Orders | POs (`VB/PO/2026-27/0001`) through PO sent → Confirmed → Dispatched → In transit → Delivered; issue reporting |
| Suppliers | Network: onboard real suppliers (GSTIN checksum, products, price tiers, MOQ, capacity, delivery radius, negotiation limit); 15 sample suppliers you can hide |
| Suppliers → Supplier view | What a supplier sees: requests they qualified for, auto-quote, rank, drafted WhatsApp reply |
| Insights | Value bought, buyer savings, request→order conversion, platform revenue, spend by category, WhatsApp practice chat |

Categories live: packaging, industrial consumables, agri inputs (14 products).

## Code map

```
server/
  index.js          HTTP server: static files + JSON API (no dependencies)
  core.js           loads src/js engine into Node so server and browser share one engine
  store.js          JSON-file database (data/db.json)
  gemini.js         Google Gemini API client
  anthropic.js      Anthropic Messages API client
  whatsapp.js       WhatsApp Cloud API: webhook, conversation state, APPROVE flow, order updates
scripts/            build-single.js, wa-simulate.js
render.yaml         one-click Render deploy with a persistent disk
src/
  index.html        page shell + all drawings (logo, Bhai, illustrations, icons) as inline SVG symbols
  styles.css        design tokens (peacock teal, marigold, kraft; light + dark), Baloo 2 + Mukta type
  js/data.js        products, cities, sample suppliers (rate-card tiers, MOQ, capacity, coverage)
  js/util.js        ₹ formatting (en-IN), distance, Indian FY
  js/engine.js      state + discovery, tier pricing, GST, freight, ranking
  js/parser.js      Buyer Intelligence Agent: Hinglish rule parser, Claude prompts, output sanitising
  js/repo.js        storage: server API when available, otherwise localStorage
  js/app.js         UI rendering and event wiring
tests/            engine.test.js, server.test.js, ui.smoke.js (drives the Buy flow in a fake DOM)
docs/               PROJECT_BRIEF.md, DEPLOY.md, WHATSAPP_SETUP.md
```

## Model assumptions (all illustrative — validate in the pilot)

- Landed cost = tier unit price × qty + GST (IGST inter-state, CGST+SGST intra-state) + freight.
- Freight: part load ₹2.50/kg + ₹0.006/kg/km (min ₹1,200); full truck ₹9,000 + ₹38/km per 9 t, whichever is cheaper.
- Road distance = straight-line × 1.3; transit 1 day per 450 km.
- Ranking: 60% landed cost, 25% on-time rate, 15% rating; suppliers missing the deadline are listed separately.
- Take rate 1.5% of goods value.
- Suppliers, GSTINs, prices and GST rates are sample data.

## WhatsApp

Buyers text the business number in English, Hindi or Hinglish. The server parses the message, asks for anything missing, and replies with the top 3 landed-cost quotes. When the buyer replies **APPROVE 1**, it raises the PO, and stage changes go back to the buyer.

- Try it without Meta: **Insights → Bhai on WhatsApp** (server mode), or `npm run wa -- "5000 3-ply boxes Pune 7 din"`.
- Connect a real number: [docs/WHATSAPP_SETUP.md](docs/WHATSAPP_SETUP.md). Put the server online first: [docs/DEPLOY.md](docs/DEPLOY.md) (Render blueprint included).

## AI

AI reads buyer messages and drafts supplier replies. It never sets prices or picks suppliers: those come from supplier rate cards through `engine.js`, and model output is validated by `cleanParsed()` before use.

- With the server: set `GEMINI_API_KEY` (Google, model `gemini-3.8-flash` by default, override with `GEMINI_MODEL`) or `ANTHROPIC_API_KEY` (Claude, `claude-haiku-5-5`). If both are set, Gemini is used.
- As a claude.ai artifact: uses the artifact runtime's Claude access.
- Anywhere else: the built-in Hinglish rule parser.

## Roadmap (next)

1. Onboard the first 10–15 real suppliers and hide the samples.
2. Connect the WhatsApp number (code ready; needs a Meta business admin) and upgrade Render to Starter + disk before real orders.
3. WhatsApp message templates for dispatch updates after 24 hours.
4. Buyer and supplier logins; move from `db.json` to Postgres.
5. Live freight quotes from a 3PL partner; GST rates by HSN from a maintained table.
6. Payments through a licensed gateway; e-invoice generation.
