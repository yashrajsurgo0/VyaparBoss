# CLAUDE.md — VyaparBoss

B2B procurement MVP for Indian MSMEs. Founder: Yashraj Surgoniwar (House of 24 Pvt. Ltd.). Full brief: `docs/PROJECT_BRIEF.md`.

## Commands
- `npm test` — engine, parser and API tests. Run after any change in `src/js/` or `server/`.
- `npm start` — app + API on :5173 (reads `.env`). No build step, no framework, no npm dependencies.

## Architecture
- Plain browser scripts loaded in order: data → util → engine → parser → repo → app. They share globals; keep that order.
- `data.js`, `util.js`, `engine.js`, `parser.js` must stay DOM-free: `server/core.js` loads them into Node so server and browser share one engine. Add new shared functions to the `EXPORTS` list in `server/core.js`.
- `repo.js` is the only place that persists data: server API when `/api/health` answers, else localStorage.
- Server: `server/index.js` routes; business actions in `makeServices()` so REST and WhatsApp share them.
- Agents map to code: Buyer Intelligence = `parser.js`; Supplier Discovery + RFQ + Optimization = `discover()` / `quoteFor()` in `engine.js`; Negotiation = `negotiate()` in `engine.js`.
- Server data: `data/db.json` (gitignored). Browser data: localStorage key `vyaparboss.v1`.
- Never commit `.env` or `data/`.

## Rules
- Commercial outputs (prices, availability, suppliers) must come from structured data, never from the LLM. The LLM only extracts requirements and drafts messages.
- No purchase commitment without explicit buyer approval in the UI.
- Money formatted with `en-IN` grouping (lakh/crore). Financial year format `2026-27`.
- Sample suppliers (`SAMPLE_SUPPLIERS`, flagged `sample:true`) are illustrative; onboarded suppliers go through `normalizeSupplier()` on both client and server. Keep the footer disclaimer.
- New suppliers have no track record: `onTime`/`rating` stay `null` and ranking uses `NEW_SUPPLIER` defaults. Never invent history.
- Colors only through CSS tokens in `styles.css`; light and dark themes both supported.
