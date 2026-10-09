# Sign-in: email, Google, Apple, Facebook

Email + password works out of the box (passwords are stored as scrypt hashes; sessions are HttpOnly cookies, 30 days).
The other three buttons show "being set up" until their keys are on the server. Each needs an account that only the
business owner can create. Add the keys in Render → vyaparboss → Environment, then redeploy.

**Before any of this: upgrade Render to Starter + disk.** On the free plan every redeploy wipes `data/`, which now
includes everyone's accounts.

## Google (free, ~15 minutes)
1. console.cloud.google.com → create a project "VyaparBoss" (the same Google account as the Gemini key is fine).
2. APIs & Services → OAuth consent screen → External → app name VyaparBoss, support email, logo optional → add your
   domain(s) under Authorized domains (`onrender.com` for now, your own domain later). Publish the app.
3. Credentials → Create credentials → OAuth client ID → Web application.
   Authorized JavaScript origins: `https://vyaparboss.onrender.com` (and your own domain later). No redirect URI needed.
4. Copy the Client ID into `GOOGLE_CLIENT_ID`. (No secret is needed: the server checks Google's signed ID token.)

## Apple (needs the Apple Developer Program, US$99/year)
1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → add an App ID with "Sign in with Apple".
2. Add a **Services ID** (e.g. `com.houseof24.vyaparboss.web`), enable Sign in with Apple, configure:
   Domains `vyaparboss.onrender.com`, Return URL `https://vyaparboss.onrender.com/`.
3. Set `APPLE_CLIENT_ID` to the Services ID. `APPLE_REDIRECT_URI` defaults to `PUBLIC_URL/`; set it if different.
   Apple shares the person's name only on their first sign-in; the app saves it then.

## Facebook (free; needs a Facebook account in good standing)
Yashraj's personal account is disabled, so a trusted team member must do this (same as WhatsApp).
1. developers.facebook.com → Create app → "Authenticate and request data from users with Facebook Login".
2. Facebook Login → Settings: Valid OAuth redirect URIs `https://vyaparboss.onrender.com/`; Allowed domains for the
   JavaScript SDK: `vyaparboss.onrender.com`.
3. App settings → Basic: copy App ID → `FACEBOOK_APP_ID`, App secret → `FACEBOOK_APP_SECRET`. Add a privacy policy URL,
   then switch the app to Live.

## How it fits together
- Buyer and supplier accounts are separate: one email belongs to one side. Logging in on the wrong side says which to use.
- A guest who explores without an account gets a light session; signing up keeps their requests and orders.
- Buyers see only their own requests and orders. Suppliers see only requests they qualified for, with their own quote
  and rank (never rivals' prices), and orders placed with them. The team (admin key) sees everything.
- Supplier phone numbers are not shown to buyers.
- Not built yet: password reset by email and email verification (both need the outreach email setup first).
