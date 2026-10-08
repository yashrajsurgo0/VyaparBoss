# CLAUDE.md — VyaparBoss

B2B procurement MVP for Indian MSMEs. Founder: Yashraj Surgoniwar (House of 24 Pvt. Ltd.). Full brief: `docs/PROJECT_BRIEF.md`.

## Commands
- `npm test` — parser and engine tests. Run after any change to `src/js/data.js`, `engine.js` or `parser.js`.
- `npm start` — static server on :5173. No build step, no framework.

## Architecture
- Plain browser scripts loaded in order: data → util → engine → parser → app. They share globals; keep that order.
- `engine.js` is pure logic (no DOM). Keep it that way so `tests/` can load it in Node.
- Agents map to code: Buyer Intelligence = `parser.js`; Supplier Discovery + RFQ + Optimization = `discover()` / `quoteFor()` in `engine.js`; Negotiation = `negotiate` action in `app.js`.
- State persists to `localStorage` key `vyaparboss.v1`.

## Rules
- Commercial outputs (prices, availability, suppliers) must come from structured data, never from the LLM. The LLM only extracts requirements and drafts messages.
- No purchase commitment without explicit buyer approval in the UI.
- Money formatted with `en-IN` grouping (lakh/crore). Financial year format `2026-27`.
- All supplier data is sample data until real onboarding; keep the footer disclaimer.
- Colors only through CSS tokens in `styles.css`; light and dark themes both supported.
