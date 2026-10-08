# VyaparBoss
VyaparBoss | AI-powered B2B procurement and supply chain platform connecting Indian businesses with verified suppliers through intelligent sourcing, price comparison, automated negotiation, and seamless fulfillment.

**Bolo kya chahiye. VyaparBoss sambhal lega.**

AI-powered B2B procurement for Indian MSMEs: a buyer describes what they need in English, Hindi or Hinglish, and VyaparBoss turns it into a structured RFQ, finds qualified verified suppliers, compares total landed cost, negotiates within the buyer's target, and raises a purchase order only after the buyer approves.

An initiative of House of 24 Pvt. Ltd. Current stage: pre-MVP prototype.

## Run it

```bash
npm start        # serves src/ at http://localhost:5173
npm test         # parser + landed-cost engine tests (Node 18+, no dependencies)
```

Or open `src/index.html` directly in a browser. No build step.

## What's in the prototype

| Tab | What it does |
|---|---|
| Procure | Procurement chat → editable RFQ → supplier discovery → landed-cost ranking → negotiation → approval → PO |
| Orders | POs (`VB/PO/2026-27/0001`) through PO sent → Confirmed → Dispatched → In transit → Delivered; issue reporting |
| Supplier network | 15 sample verified suppliers with GSTIN, audits, certifications, on-time rate, rate cards |
| Supplier desk | Supplier view of RFQs they qualified for, auto-quote, rank, drafted WhatsApp reply |
| Pilot metrics | GMV, AOV, buyer savings, RFQ→PO conversion, est. take-rate revenue, category mix |

Categories live: packaging, industrial consumables, agri inputs (14 products).

## Code map

```
src/
  index.html        markup for all tabs
  styles.css        design tokens (light + dark) and components
  js/data.js        products, cities, sample suppliers (rate-card tiers, MOQ, capacity, coverage)
  js/util.js        ₹ formatting (en-IN), distance, Indian FY
  js/engine.js      state + discovery, tier pricing, GST, freight, ranking
  js/parser.js      Buyer Intelligence Agent: Hinglish rule parser + Claude JSON parser
  js/app.js         UI rendering and event wiring
tests/engine.test.js
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

`parser.js` calls Claude through the artifact runtime (`window.claude.use("sample")`) when the page is opened as a claude.ai artifact. Anywhere else it falls back to the rule parser. Prices and suppliers always come from structured records, never from the model.

Next step for production: swap that call for a backend endpoint using the Anthropic API.

## Roadmap (next)

1. Real supplier onboarding and rate cards; replace sample data with a database.
2. Backend + auth for buyers and suppliers; WhatsApp intake.
3. Live freight quotes from a 3PL partner; GST rates by HSN from a maintained table.
4. Payments through a licensed gateway; e-invoice generation.
