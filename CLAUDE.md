# CLAUDE.md — VyaparBoss

B2B procurement MVP for Indian MSMEs. Founder: Yashraj Surgoniwar (House of 24 Pvt. Ltd.). Full brief: `docs/PROJECT_BRIEF.md`.

## Commands
- `npm test` — engine, parser and API tests. Run after any change in `src/js/` or `server/`.
- `npm start` — app + API on :5173 (reads `.env`). No build step, no framework, no npm dependencies.
- `npm run deploy:pages` — publish `src/` to GitHub Pages (live demo: https://yashrajsurgo0.github.io/VyaparBoss/). Run after UI changes are pushed to main.
- Live server: https://vyaparboss.onrender.com (Render, free plan, connected by public repo URL, so redeploy via Render → Manual Deploy → Deploy latest commit).
- `npm run build:single` — single-file build in `dist/` (gitignored).

## Architecture
- Plain browser scripts loaded in order: data → util → engine → parser → repo → app. They share globals; keep that order.
- `data.js`, `util.js`, `engine.js`, `parser.js` must stay DOM-free: `server/core.js` loads them into Node so server and browser share one engine. Add new shared functions to the `EXPORTS` list in `server/core.js`.
- `repo.js` is the only place that persists data: server API when `/api/health` answers, else localStorage.
- Server: `server/index.js` routes; business actions in `makeServices()` so REST and WhatsApp share them. WhatsApp logic lives in `server/whatsapp.js` (try it with `npm run wa -- "message"`).
- Don't log full buyer phone numbers; use `mask()` from `server/whatsapp.js`.
- Agents map to code: Buyer Intelligence = `parser.js`; Supplier Discovery + RFQ + Optimization = `discover()` / `quoteFor()` in `engine.js`; Negotiation = `negotiate()` in `engine.js`.
- Server data: `data/db.json` (gitignored). Browser data: localStorage key `vyaparboss.v1`.
- Never commit `.env` or `data/`.

## Rules
- AI provider is pluggable (`server/gemini.js`, `server/anthropic.js`, chosen in `pickLLM()`); both expose `{provider, model, complete, json}`.
- Commercial outputs (prices, availability, suppliers) must come from structured data, never from the LLM. The LLM only extracts requirements and drafts messages.
- No purchase commitment without explicit buyer approval: the UI approval checkbox, or the buyer's own "APPROVE n" WhatsApp reply. Never auto-approve.
- Money formatted with `en-IN` grouping (lakh/crore). Financial year format `2026-27`.
- Sample suppliers (`SAMPLE_SUPPLIERS`, flagged `sample:true`) are illustrative; onboarded suppliers go through `normalizeSupplier()` on both client and server. Keep the footer disclaimer.
- New suppliers have no track record: `onTime`/`rating` stay `null` and ranking uses `NEW_SUPPLIER` defaults. Never invent history.
- Colors only through CSS tokens in `styles.css`; light and dark themes both supported.
