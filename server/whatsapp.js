// WhatsApp intake via Meta's WhatsApp Cloud API.
// Buyer texts the business number → we parse → ask for anything missing → reply with top quotes →
// buyer replies "APPROVE 1" → PO is raised (that reply is the buyer's explicit approval) → stage updates go back on WhatsApp.
// Setup steps: docs/WHATSAPP_SETUP.md
const crypto = require("crypto");

const SESSION_TTL = 24 * 3600e3;
const mask = n => String(n).replace(/^(\d{2})\d+(\d{4})$/, "$1••••••$2");

function createWhatsApp(ctx, cfg) {
  const { core, store, services } = ctx;
  const configured = !!(cfg.accessToken && cfg.phoneNumberId);
  const seen = new Set();
  const plain = v => JSON.parse(JSON.stringify(v));
  const wa = store.data.whatsapp;

  async function sendText(to, body) {
    if (cfg.send) return cfg.send(to, body); // tests
    if (!configured) return;
    const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion || "v21.0"}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: body.slice(0, 4000) } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.error("WhatsApp send failed:", res.status, await res.text().catch(() => ""));
  }

  function log(from, text, reply, simulated) {
    wa.log.push({ at: Date.now(), from: mask(from), in: text.slice(0, 500), out: reply.slice(0, 1500), simulated: !!simulated });
    if (wa.log.length > 300) wa.log.splice(0, wa.log.length - 300);
  }

  const HELP = `Namaste! VyaparBoss mein aapka swagat hai.\n\nBas likhiye kya chahiye, jaise:\n"5000 3-ply boxes Pune, 7 din mein"\n"2 tonne NPK 19:19:19 Indore"\n\nHum verified suppliers se landed-cost quotes bhejenge (rate + GST + freight). Commands: STATUS (aapke orders), RESET (naya request).`;

  async function handleText(from, text, { simulated } = {}) {
    const t = text.trim();
    const now = Date.now();
    let s = wa.sessions[from];
    if (!s || now - s.at > SESSION_TTL) s = wa.sessions[from] = { partial: null, lastRfqId: null, at: now };
    s.at = now;
    let reply;

    if (/^(hi|hello|hey|namaste|namaskar|help|menu|start)\W*$/i.test(t)) reply = HELP;
    else if (/^(reset|cancel|naya|new)\b/i.test(t)) { s.partial = null; reply = "Theek hai, naya request bhejiye: product, quantity aur delivery city."; }
    else if (/^status\b/i.test(t)) {
      const mine = store.data.orders.filter(o => o.buyer === from).slice(0, 3);
      reply = mine.length ? mine.map(o => `${o.po}: ${core.qfmt(o.qty)} ${core.PMAP[o.productId].unit} ${core.PMAP[o.productId].name} → ${core.STAGES[o.stage]}${o.issue ? ` (issue: ${o.issue})` : ""}`).join("\n") : "Abhi aapka koi order nahi hai. Requirement bhejiye, quotes turant milenge.";
    }
    else if (/^(approve|confirm|haan|ok)\b/i.test(t)) reply = approve(from, s, t);
    else reply = await requirement(from, s, t);

    log(from, t, reply, simulated);
    store.save();
    return reply;
  }

  async function requirement(from, s, text) {
    const base = s.partial && core.missing(s.partial).length ? s.partial : null;
    const { parsed, via } = await services.parse(text, base);
    const { r, notes } = core.applyParsed(parsed, base);
    const r0 = plain(r);
    const miss = plain(core.missing(r0));
    if (miss.length) {
      s.partial = r0;
      const ask = miss.includes("product") ? "Kaunsa product chahiye? Abhi live: corrugated boxes, LDPE film, BOPP tape, stretch film, gloves, helmets, cutting wheels, MIG wire, cotton waste, drip lateral, crates, mulch film, NPK."
        : miss.includes("quantity") ? `Kitna chahiye? Quantity ${core.PMAP[r0.productId].unit} mein batayiye.`
        : "Delivery kis city mein chahiye?";
      return (via === "Claude" && parsed.reply ? parsed.reply + "\n\n" : "") + ask;
    }
    s.partial = null;
    const res = core.discover(r0);
    const rec = services.createRfq(plain(core.rfqRecord(r0, res, { source: "whatsapp", buyer: from })));
    s.lastRfqId = rec.id;
    const msg = core.quoteMessage({ ...r0, id: rec.id }, res);
    return notes.length ? `${msg}\n\n(${plain(notes).join("; ")})` : msg;
  }

  function approve(from, s, text) {
    const rec = s.lastRfqId && store.data.rfqs.find(r => r.id === s.lastRfqId);
    if (!rec) return "Approve karne ke liye pehle requirement bhejiye. Quotes aane ke baad \"APPROVE 1\" likhiye.";
    if (rec.status === "ordered") return `${rec.id} ka order pehle hi place ho chuka hai. STATUS likh kar dekhiye.`;
    const n = Math.max(1, parseInt((text.match(/\d+/) || ["1"])[0], 10));
    const r = { productId: rec.productId, qty: rec.qty, city: rec.city, deadline: rec.deadline, id: rec.id };
    const res = core.discover(r);
    const ranked = res.eligible.filter(q => q.meets).length ? res.eligible.filter(q => q.meets) : res.eligible;
    const q = ranked[n - 1];
    if (!q) return `Option ${n} available nahi hai. ${ranked.length ? `1 se ${Math.min(3, ranked.length)} tak chuniye.` : "Is RFQ ke liye koi supplier nahi mila."}`;
    const order = plain(core.orderRecord(r, res, q, { source: "whatsapp", buyer: from }));
    const o = services.createOrder(order, { status: "ordered", wonBy: q.s.id, quotes: plain(core.quoteSummary(res)) });
    return `✅ PO ${o.po} raised\n${q.s.name} (${q.s.city})\n${core.qfmt(r.qty)} ${core.PMAP[r.productId].unit} ${core.PMAP[r.productId].name} → ${r.city}\nTotal landed: ${core.inr(o.landed)}\nExpected in ~${o.eta} din. Dispatch updates yahin milenge.`;
  }

  return {
    configured,
    handleText,
    verify(url, res) {
      const p = url.searchParams;
      if (p.get("hub.mode") === "subscribe" && cfg.verifyToken && p.get("hub.verify_token") === cfg.verifyToken) {
        res.writeHead(200, { "content-type": "text/plain" }).end(p.get("hub.challenge") || "");
      } else res.writeHead(403, { "content-type": "text/plain" }).end("Verification failed");
    },
    async receive(raw, headers, res) {
      if (cfg.appSecret) {
        const sig = String(headers["x-hub-signature-256"] || "");
        const want = "sha256=" + crypto.createHmac("sha256", cfg.appSecret).update(raw).digest("hex");
        if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) {
          res.writeHead(401, { "content-type": "text/plain" }).end("Bad signature"); return;
        }
      }
      let body; try { body = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
      res.writeHead(200, { "content-type": "text/plain" }).end("EVENT_RECEIVED"); // Meta retries unless we answer fast
      for (const entry of body.entry || []) for (const ch of entry.changes || []) for (const m of ch.value?.messages || []) {
        if (seen.has(m.id)) continue; seen.add(m.id); if (seen.size > 1000) seen.delete(seen.values().next().value);
        const text = m.type === "text" ? m.text?.body : m.type === "button" ? m.button?.text : m.interactive?.button_reply?.title || m.interactive?.list_reply?.title;
        try {
          const reply = text ? await handleText(m.from, text) : "Abhi sirf text messages samajh paate hain. Apni requirement likh kar bhejiye.";
          await sendText(m.from, reply);
        } catch (e) { console.error("WhatsApp handling failed:", e); }
      }
    },
    async notifyOrder(o) {
      if (o.source !== "whatsapp" || !o.buyer) return;
      const p = core.PMAP[o.productId];
      await sendText(o.buyer, `${o.po}: ${core.STAGES[o.stage]}${o.issue ? `\nIssue: ${o.issue}` : ""}\n${core.qfmt(o.qty)} ${p.unit} ${p.name} → ${o.city}`).catch(e => console.error(e));
    },
  };
}

module.exports = { createWhatsApp, mask };
