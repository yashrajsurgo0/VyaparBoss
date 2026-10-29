// Online payments through Razorpay Payment Links. Optional: on only when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set.
// Use test keys (rzp_test_…) until a lawyer and Razorpay have signed off on how money reaches suppliers
// (a marketplace normally needs Razorpay Route or similar, so funds don't sit with KaantaMandi).
const crypto = require("crypto");

function createRazorpay(env, fetchImpl = globalThis.fetch) {
  const id = env.RAZORPAY_KEY_ID, secret = env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) return null;
  const auth = "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
  return {
    test: String(id).startsWith("rzp_test_"),
    webhookOn: !!env.RAZORPAY_WEBHOOK_SECRET,
    /** Creates a hosted payment link for one order's amount due. Amount in rupees. */
    async createLink({ amount, po, description, callbackUrl, notes = {} }) {
      const body = {
        amount: Math.round(amount * 100), currency: "INR", accept_partial: false, upi_link: false,
        reference_id: (String(po).replace(/\W/g, "") + "-" + Date.now().toString(36)).slice(0, 40),
        description: String(description).slice(0, 2000), notify: { sms: false, email: false }, reminder_enable: false,
        notes: { po: String(po), ...notes }, callback_url: callbackUrl, callback_method: "get",
        expire_by: Math.floor(Date.now() / 1000) + 7 * 86400,
      };
      const r = await fetchImpl("https://api.razorpay.com/v1/payment_links", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(`Razorpay: ${j.error?.description || "HTTP " + r.status}`), { status: 502 });
      return { id: j.id, url: j.short_url, amount };
    },
    /** Webhook signature: HMAC-SHA256 of the raw body with the webhook secret, hex, in X-Razorpay-Signature. */
    verify(raw, sig) {
      if (!env.RAZORPAY_WEBHOOK_SECRET || !sig) return false;
      const want = Buffer.from(crypto.createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex"));
      const got = Buffer.from(String(sig));
      return got.length === want.length && crypto.timingSafeEqual(got, want);
    },
  };
}

module.exports = { createRazorpay };
