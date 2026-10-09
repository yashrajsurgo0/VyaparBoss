# CLAUDE.md — VyaparBoss

B2B procurement MVP for Indian MSMEs. Founder: Yashraj Surgoniwar (House of 24 Pvt. Ltd.). Full brief: `docs/PROJECT_BRIEF.md`.

## Commands
- `npm test` — engine, parser and API tests. Run after any change in `src/js/` or `server/`.
- `npm start` — app + API on :5173 (reads `.env`). No build step, no framework, no npm dependencies.
- `npm run deploy:pages` — publish `src/` to GitHub Pages (live demo: https://yashrajsurgo0.github.io/VyaparBoss/). Run after UI changes are pushed to main.
- Live server: https://vyaparboss.onrender.com (Render, free plan, connected by public repo URL, so redeploy via Render → Manual Deploy → Deploy latest commit). On the free plan a redeploy wipes `data/`: once real sign-ups exist, download a backup first (Insights → Outreach → Back up, or `GET /api/admin/backup`) and restore it after.
- `npm run build:single` — single-file build in `dist/` (gitignored).

## Architecture
- Plain browser scripts loaded in order: data → util → engine → parser → repo → i18n → app → grow. They share globals; keep that order. `grow.js` holds the public pages (`#join`, `#quote/<token>`) and ops tools (Sign-ups, Outreach, quote links).
- `data.js`, `util.js`, `engine.js`, `parser.js` must stay DOM-free: `server/core.js` loads them into Node so server and browser share one engine. Add new shared functions to the `EXPORTS` list in `server/core.js`.
- `repo.js` is the only place that persists data: server API when `/api/health` answers, else localStorage.
- Server: `server/index.js` routes; business actions in `makeServices()` so REST and WhatsApp share them. WhatsApp logic lives in `server/whatsapp.js` (try it with `npm run wa -- "message"`).
- Don't log full buyer phone numbers; use `mask()` from `server/whatsapp.js`.
- Agents map to code: Buyer Intelligence = `parser.js`; Supplier Discovery + RFQ + Optimization = `discover()` / `quoteFor()` in `engine.js`; Negotiation = `negotiate()` in `engine.js`.
- Server data: `data/db.json` (gitignored). Browser data: localStorage key `vyaparboss.v1`.
- Never commit `.env`, `data/` or `leads/` (researched business contacts; the repo is public).

## Rules
- AI provider is pluggable (`server/gemini.js`, `server/anthropic.js`, chosen in `pickLLM()`); both expose `{provider, model, complete, json}`.
- Commercial outputs (prices, availability, suppliers) must come from structured data, never from the LLM. The LLM only extracts requirements and drafts messages.
- No purchase commitment without explicit buyer approval: the UI approval checkbox, or the buyer's own "APPROVE n" WhatsApp reply. Never auto-approve.
- Money formatted with `en-IN` grouping (lakh/crore). Financial year format `2026-27`.
- Sample suppliers (`SAMPLE_SUPPLIERS`, flagged `sample:true`) are illustrative; onboarded suppliers go through `normalizeSupplier()` on both client and server. Keep the footer disclaimer.
- New suppliers have no track record: `onTime`/`rating` stay `null` and ranking uses `NEW_SUPPLIER` defaults. Never invent history.
- Colors only through CSS tokens in `styles.css`; light and dark themes both supported. Drawings live as `<symbol>`s in `index.html` and take color from `.f-*`/`.s-*` classes.
- Logo: `#logo` (two-gold folded up-right arrow) and `#logo-tile` (on #16171B, app icon/favicon) in `index.html`. Wordmark is "Vyapar" + "Boss" in gold. Before registering the brand, get a trademark search done: the established "Vyapar" billing app serves the same MSME market.
- Regions/languages (`i18n.js`): India · Hinglish (`in_hi`, original voice), India · English (`in_en`), Global · English (`gl_en`, buyers anywhere sourcing from Indian suppliers). Every user-facing line that differs goes through `t(key)` with entries in `STR.hi`, `STR.en` and, if Global needs different framing, `STR.gl`. No Hindi words in English modes. Logo, the name VyaparBoss and Bhai never change. Switcher in the header; `?region=global` / `?lang=en` in links; default guessed from time zone (India time → Hinglish, else Global).
- Taglines: company "Vyapar bada, jhanjhat chhota!" (English: "Bigger business. Smaller hassle."); Bhai "Tu business badha, jugaad mera!" (English: "You grow the business. I'll handle the buying."). Bhai is an original character: don't base him on film characters or real people.
- The assistant is called **Bhai** everywhere (UI, AI prompts, WhatsApp). Voice: warm, short, Hinglish-friendly; never promises price or availability.
- Buy flow is progressive: show one question at a time (`nextField()`), keep details behind `<details>` expanders. Don't put everything on screen at once.
- After UI changes: `npm test` (includes `tests/ui.smoke.js`), push, `npm run deploy:pages`, and redeploy Render.
- Ops routes (`/api/admin/*`) need `ADMIN_KEY` (header `x-admin-key`); without it set they stay closed. Sign-ups and leads never go in `/api/state`; quote-link tokens are stripped from it.
- Supplier quotes come only from the supplier's own quote link (`normalizeLiveQuote`) or their rate card. Bhai never invents a price.
- Outreach: every email carries sender name, business address and a signed unsubscribe link; daily cap; no repeat of the same template; never auto-send (an admin presses Send, twice). Lead lists only hold contact details the business published itself, with a source URL. See `docs/OUTREACH.md`.
