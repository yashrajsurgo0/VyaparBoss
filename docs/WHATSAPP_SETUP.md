# WhatsApp setup

Buyers message your WhatsApp Business number → VyaparBoss replies with the top 3 landed-cost quotes → buyer replies **APPROVE 1** → a purchase order is raised → dispatch updates go back to the buyer on WhatsApp.

**You can try all of this today without Meta:** open the app on the server, go to **Pilot metrics → WhatsApp intake**, and type as a buyer. Or from a terminal: `npm run wa -- "5000 3-ply boxes Pune 7 din"`.

To connect a real number you need two things: the server online at a public `https://` address (see [DEPLOY.md](DEPLOY.md)), and a Meta developer app. Allow about 30 minutes.

## What buyers can send

| Message | What happens |
|---|---|
| `5000 3-ply boxes Pune 7 din` | Parses the requirement, replies with the 3 best quotes |
| `need nitrile gloves` | Asks for what's missing (quantity, city), remembers the rest for 24 h |
| `APPROVE 1` (or 2, 3) | Raises the PO with that supplier. This reply is the buyer's approval |
| `STATUS` | Their last 3 orders and current stage |
| `RESET` | Starts a new request |
| `hi` / `help` | How-to message |

## 1. Create the Meta app (about 10 min)

1. Go to **developers.facebook.com** and log in with the Facebook account that manages your business. Click **My Apps → Create App**.
2. Choose the use case **"Connect with customers through WhatsApp"** (or app type **Business**), give it a name such as *VyaparBoss*, and link your Meta Business portfolio (House of 24). Create one if asked.
3. In the app dashboard, open **WhatsApp → API Setup**. Meta gives you a free **test phone number**. On this page note down:
   - **Phone number ID** → this is `WHATSAPP_PHONE_NUMBER_ID`
   - **Temporary access token** → this is `WHATSAPP_TOKEN`. It expires after 24 hours; step 4 replaces it.
4. Under **"To"**, add your own mobile number and confirm the code WhatsApp sends you. While testing, only numbers added here (up to 5) can message the test number.
5. Open **App settings → Basic**, click **Show** next to **App secret**. That's `WHATSAPP_APP_SECRET`. It lets the server reject fake webhook calls.

## 2. Put the keys on the server

In the server's environment, either in your `.env` file or in your host's dashboard (see DEPLOY.md), set:

```
WHATSAPP_TOKEN=EAAG...            # from API Setup
WHATSAPP_PHONE_NUMBER_ID=1234...  # from API Setup
WHATSAPP_VERIFY_TOKEN=any-long-random-text-you-make-up
WHATSAPP_APP_SECRET=abc123...     # from App settings → Basic
```

Restart the server. The startup log should say `WhatsApp: configured`, and **Pilot metrics** shows "Connected to WhatsApp Cloud API".

## 3. Point WhatsApp at your server (about 5 min)

1. In the Meta app, open **WhatsApp → Configuration → Webhook → Edit**.
2. **Callback URL:** `https://YOUR-SERVER-ADDRESS/webhooks/whatsapp`
3. **Verify token:** exactly the `WHATSAPP_VERIFY_TOKEN` you made up.
4. Click **Verify and save**. If it fails, check that the server is online and that the token matches exactly.
5. Under **Webhook fields**, click **Manage** and subscribe to **messages**.

Now send `hi` from your phone to the test number. You should get the help message back within a few seconds.

## 4. Before real buyers use it

- **Permanent token.** The temporary token dies every 24 hours. In **business.facebook.com → Settings → Users → System users**, add a system user (Admin), click **Generate token**, pick your app, and tick `whatsapp_business_messaging` and `whatsapp_business_management`. Use that token as `WHATSAPP_TOKEN`.
- **Your own number.** In **WhatsApp → API Setup → Add phone number**, register the VyaparBoss business number. It must not be active on the normal WhatsApp or WhatsApp Business app. Meta also needs business verification to lift the test limits.
- **The 24-hour rule.** WhatsApp only allows free-form replies within 24 hours of the buyer's last message. Quote replies are always inside that window. Dispatch updates sent days later need a Meta-approved **message template**. Until templates are added, late updates may not be delivered, so check **Orders** in the app.
- **Costs.** Meta charges per conversation for business-initiated messages. Replies to buyers within 24 hours are currently free or cheap in India; check Meta's current pricing page.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Verify and save" fails | Server not reachable at that URL, or verify token differs. Open `https://YOUR-SERVER/api/health` in a browser: it should show `"app":"vyaparboss"` |
| Message sent, no reply | Check the server log. `WhatsApp send failed: 401` means the token expired (see step 4). `Bad signature` means `WHATSAPP_APP_SECRET` is wrong |
| Reply never arrives on a new phone | During testing that phone must be in the **To** list (step 1.4) |
| Replies are understood poorly | Add `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`) so AI reads messages instead of the rule parser |
