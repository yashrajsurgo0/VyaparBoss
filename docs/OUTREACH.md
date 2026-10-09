# Outreach: finding suppliers and buyers, and emailing them well

## What's built
- **Sign-up page** `#join` (also `#join/s` for suppliers, `#join/b` for buyers). Free, 2 minutes. Works from the live server and from the GitHub Pages copy (which posts to the server).
- **Suppliers → Sign-ups** (team only): every sign-up with a WhatsApp link. "Add as supplier" opens the onboarding form pre-filled; saving marks the sign-up onboarded.
- **Insights → Outreach** (team only): import lead CSVs, pick a template, preview, then send (or download a mail-merge CSV). Leads who sign up through their personal link are marked "joined" automatically.
- **Supplier quote links**: on a request's quotes, "Team: get real quotes from suppliers" makes one link per onboarded supplier, with a WhatsApp button. Their own price replaces the rate-card estimate.

- **Email first, then call**: email a batch (send from the app, or download for mail merge and press "I've sent them"). Leads emailed 4+ days ago with no reply show up under **Call next**, with a call script and WhatsApp opener that mention the earlier email.
- **Phone and WhatsApp**: in Outreach, each lead has WhatsApp (pre-written Hinglish opener with their personal sign-up link) and Call buttons. Tap a business name for a call script and notes. Opening WhatsApp or the dialer marks the lead "contacted"; you press Send in WhatsApp yourself. IndiaMART relay numbers get Call only.
- **Suppliers can add their own rates at sign-up** (optional). "Add as supplier" then pre-fills those rates; the team only adds the GSTIN and checks.

## Switch it on (Render → vyaparboss → Environment)
1. `ADMIN_KEY`: a long random password (e.g. from a password manager). Your team enters it once per browser session.
2. Upgrade to **Starter + disk** (see `render.yaml` notes) *before* sending outreach. On the free plan, sign-ups are wiped on every redeploy and the site sleeps (first visit can take ~50 s).
3. Email sending (optional; you can use the mail-merge download instead):
   - Get a domain for outreach (e.g. `vyaparboss.in`) and a mailbox on it. Don't send cold email from your main Gmail.
   - Create a free [Brevo](https://www.brevo.com) account (300 emails/day on the free plan), verify the domain (SPF, DKIM, DMARC records they give you), create an API key.
   - Set `EMAIL_PROVIDER=brevo`, `EMAIL_API_KEY`, `OUTREACH_FROM_EMAIL=you@yourdomain`, `OUTREACH_REPLY_TO` (where replies go).
   - Resend works too: `EMAIL_PROVIDER=resend`.
4. In Insights → Outreach, fill "Who's writing" (your name and business address).

## Sending well
- Start at 20–30 emails a day for the first two weeks (`OUTREACH_DAILY_CAP`), then raise slowly. Reply to every answer within a day.
- One follow-up after 5–7 days, then stop. The tool won't send the same template to a lead twice or email anyone twice within 3 days.
- Phone beats email for small Indian firms: use the lead's phone/WhatsApp for the top 20, and email for the rest.
- Keep it honest: the templates make no claims about numbers of buyers or savings. Don't add any until they're true.

## The rules that keep you safe
- Every email shows who you are, your business address and a working unsubscribe link (built in). Unsubscribes are permanent.
- Only email business addresses the business published itself (own website, trade directory, association list). Don't buy lists. Don't guess addresses.
- Respect directory terms: IndiaMART, for example, forbids copying its listings for commercial use, so contact those firms one by one or through IndiaMART.
- India's Digital Personal Data Protection Act applies to personal data such as a proprietor's own email or phone. Collect only what you need, say why, honour opt-outs, and delete on request. Get a lawyer's view before scaling up.
