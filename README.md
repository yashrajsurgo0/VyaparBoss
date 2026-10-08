# VyaparBoss
VyaparBoss | AI-powered B2B procurement and supply chain platform connecting Indian businesses with verified suppliers through intelligent sourcing, price comparison, automated negotiation, and seamless fulfillment.

**Bolo kya chahiye. VyaparBoss sambhal lega.**

AI-powered B2B procurement for Indian MSMEs: a buyer describes what they need in English, Hindi or Hinglish, and VyaparBoss turns it into a structured RFQ, finds qualified verified suppliers, compares total landed cost, negotiates within the buyer's target, and raises a purchase order only after the buyer approves.

An initiative of House of 24 Pvt. Ltd. Current stage: pre-MVP prototype.

## Run it

```bash
cp .env.example .env     # optional: add ANTHROPIC_API_KEY to switch on Claude
npm start                # app + API at http://localhost:5173
npm test                 # engine, parser and API tests (Node 18+, no dependencies)
npm run deploy:pages     # publish src/ to GitHub Pages (gh-pages branch)
npm run build:single     # dist/vyaparboss.html: whole app in one file, for sharing
```

**Live demo:** https://yashrajsurgo0.github.io/VyaparBoss/ (static mode; data stays in your browser). Redeploy after changes with `npm run deploy:pages`.

Two ways the same app runs:

| | Data lives in | Request parsing | Used for |
|---|---|---|---|
| **With the server** (`npm start`) | `data/db.json` on the server, shared by everyone | Claude through the Anthropic API (rule parser if no key) | Pilot operations, WhatsApp |
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
| DELETE | `/api/samples` | Remove sample orders |

## What's in the prototype

| Tab | What it does |
|---|---|
| Procure | Procurement chat → editable RFQ → supplier discovery → landed-cost ranking → negotiation → approval → PO |
| Orders | POs (`VB/PO/2026-27/0001`) through PO sent → Confirmed → Dispatched → In transit → Delivered; issue reporting |
| Supplier network | Onboard real suppliers (GSTIN checksum, products, price tiers, MOQ, capacity, delivery radius, negotiation limit); 15 sample suppliers you can hide |
| Supplier desk | Supplier view of RFQs they qualified for, auto-quote, rank, drafted WhatsApp reply |
| Pilot metrics | GMV, AOV, buyer savings, RFQ→PO conversion, est. take-rate revenue, category mix |

Categories live: packaging, industrial consumables, agri inputs (14 products).

## Code map

```
server/
  index.js          HTTP server: static files + JSON API (no dependencies)
  core.js           loads src/js engine into Node so server and browser share one engine
  store.js          JSON-file database (data/db.json)
  anthropic.js      Anthropic Messages API client
src/
  index.html        markup for all tabs
  styles.css        design tokens (light + dark) and components
  js/data.js        products, cities, sample suppliers (rate-card tiers, MOQ, capacity, coverage)
  js/util.js        ₹ formatting (en-IN), distance, Indian FY
  js/engine.js      state + discovery, tier pricing, GST, freight, ranking
  js/parser.js      Buyer Intelligence Agent: Hinglish rule parser, Claude prompts, output sanitising
  js/repo.js        storage: server API when available, otherwise localStorage
  js/app.js         UI rendering and event wiring
tests/            engine.test.js, server.test.js
docs/               project brief and prototype notes
```

## Model assumptions (all illustrative — validate in the pilot)

- Landed cost = tier unit price × qty + GST (IGST inter-state, CGST+SGST intra-state) + freight.
- Freight: part load ₹2.50/kg + ₹0.006/kg/km (min ₹1,200); full truck ₹9,000 + ₹38/km per 9 t, whichever is cheaper.
- Road distance = straight-line × 1.3; transit 1 day per 450 km.
- Ranking: 60% landed cost, 25% on-time rate, 15% rating; suppliers missing the deadline are listed separately.
- Take rate 1.5% of goods value.
- Suppliers, GSTINs, prices and GST rates are sample data.

## AI

Claude reads buyer messages and drafts supplier replies. It never sets prices or picks suppliers: those come from supplier rate cards through `engine.js`, and model output is validated by `cleanParsed()` before use.

- With the server: set `ANTHROPIC_API_KEY` in `.env` (model defaults to `claude-haiku-5-5`, override with `ANTHROPIC_MODEL`).
- As a claude.ai artifact: uses the artifact runtime's Claude access.
- Anywhere else: the built-in Hinglish rule parser.

## Roadmap (next)

1. Real supplier onboarding and rate cards; replace sample data with a database.
2. Backend + auth for buyers and suppliers; WhatsApp intake.
3. Live freight quotes from a 3PL partner; GST rates by HSN from a maintained table.
4. Payments through a licensed gateway; e-invoice generation.
