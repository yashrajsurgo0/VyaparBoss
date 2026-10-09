// Outreach email sending through a transactional email API (Brevo or Resend). No SMTP, no dependencies.
// Nothing is sent unless EMAIL_PROVIDER, EMAIL_API_KEY and OUTREACH_FROM_EMAIL are set AND an admin presses Send.
const crypto = require("crypto");

function createMailer(env, fetchImpl = globalThis.fetch) {
  const provider = String(env.EMAIL_PROVIDER || "").toLowerCase();
  const apiKey = env.EMAIL_API_KEY;
  const from = env.OUTREACH_FROM_EMAIL;
  const fromName = env.OUTREACH_FROM_NAME || "VyaparBoss";
  const replyTo = env.OUTREACH_REPLY_TO || from;
  const configured = !!(apiKey && from && ["brevo", "resend"].includes(provider));

  async function send({ to, subject, text, unsubUrl }) {
    if (!configured) throw Object.assign(new Error("Email sending isn't set up. Add EMAIL_PROVIDER, EMAIL_API_KEY and OUTREACH_FROM_EMAIL on the server."), { status: 503 });
    const headers = unsubUrl ? { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {};
    let url, init;
    if (provider === "brevo") {
      url = "https://api.brevo.com/v3/smtp/email";
      init = { method: "POST", headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender: { name: fromName, email: from }, to: [{ email: to }], replyTo: { email: replyTo }, subject, textContent: text, headers }) };
    } else {
      url = "https://api.resend.com/emails";
      init = { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], reply_to: replyTo, subject, text, headers }) };
    }
    const r = await fetchImpl(url, init);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw Object.assign(new Error(`${provider} refused the email (${r.status}): ${body.slice(0, 160)}`), { status: 502 });
    }
    return true;
  }
  return { configured, provider: configured ? provider : null, from: configured ? from : null, send };
}

// Signed unsubscribe links, so nobody can unsubscribe someone else by guessing.
const unsubSig = (secret, email) => crypto.createHmac("sha256", String(secret || "vb-unsub")).update(String(email).toLowerCase()).digest("hex").slice(0, 24);

module.exports = { createMailer, unsubSig };
