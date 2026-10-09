// API tests: boots the server on a random port with a throwaway data file. No network, no API key needed.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp } = require("../server");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vb-"));
  const sent = [];
  const fakeClaude = { provider: "Claude", model: "fake", async json(prompt) { if (!prompt.includes("3000 dabbe pune\"\"\"")) throw new Error("fake Claude: no canned answer"); return { product_id: "box3", quantity: 3000, unit: "pcs", city: "Pune", deadline_days: 4, notes: "", reply: "Samajh gaya" }; }, async complete() { return "Namaste ji, rate confirmed."; } };
  const { server } = createApp({
    dataFile: path.join(dir, "db.json"), claude: fakeClaude,
    env: { WHATSAPP_VERIFY_TOKEN: "verify-me", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123" },
    waSend: async (to, text) => { sent.push({ to, text }); },
  });
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() };
  };
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log("ok -", name); };

  try {
    const health = (await call("GET", "/api/health")).body;
    await test("health reports app and AI", async () => {
      assert.deepStrictEqual([health.app, health.ai, health.model], ["vyaparboss", true, "fake"]);
    });
    await test("state starts with sample orders", async () => {
      const { body } = await call("GET", "/api/state");
      assert.strictEqual(body.orders.length, 3);
    });
    await test("Gemini key wins provider selection, Anthropic is the fallback", async () => {
      const mk = env => createApp({ dataFile: path.join(dir, "p.json"), env: { GEMINI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_API_KEY: "", ...env } }).ctx.claude;
      assert.deepStrictEqual([mk({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" }).provider, mk({ GOOGLE_API_KEY: "g" }).provider, mk({ ANTHROPIC_API_KEY: "a" }).provider, mk({})], ["Gemini", "Gemini", "Claude", null]);
      assert.strictEqual(mk({ GEMINI_API_KEY: "g" }).model, "gemini-3.8-flash");
    });
    await test("Gemini retries a busy model, then falls back", async () => {
      const { createGemini } = require("../server/gemini");
      const calls = []; const realFetch = global.fetch;
      global.fetch = async url => { const m = url.match(/models\/([^:]+)/)[1]; calls.push(m);
        if (m === "busy-model") return { ok: false, status: 503, json: async () => ({ error: { message: "high demand" } }) };
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "{\"ok\":1}" }] } }] }) }; };
      try {
        const g = createGemini({ apiKey: "k", model: "busy-model", fallbackModel: "spare-model", retryDelayMs: 1 });
        assert.deepStrictEqual(await g.json("x"), { ok: 1 });
        assert.deepStrictEqual(calls, ["busy-model", "busy-model", "spare-model"]);
        calls.length = 0;
        global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "API key not valid" } }) });
        await assert.rejects(g.json("x"), /API key not valid/);
      } finally { global.fetch = realFetch; }
    });
    await test("static app is served", async () => {
      const { status, body } = await call("GET", "/");
      assert.strictEqual(status, 200); assert.ok(body.includes("VyaparBoss"));
    });
    await test("path traversal is blocked", async () => {
      const { status } = await call("GET", "/../package.json");
      assert.ok(status === 403 || status === 404);
    });
    await test("parse goes through Claude when configured", async () => {
      const { body } = await call("POST", "/api/parse", { text: "3000 dabbe pune" });
      assert.deepStrictEqual([body.via, body.parsed.product_id, body.parsed.city], ["Claude", "box3", "Pune"]);
    });
    let rfqId;
    await test("create RFQ assigns an FY-based id", async () => {
      const { status, body } = await call("POST", "/api/rfqs", { productId: "box3", qty: 3000, city: "Pune", quotes: [] });
      assert.strictEqual(status, 200); assert.match(body.id, /^RFQ-\d{4}-0004$/); rfqId = body.id;
    });
    await test("RFQ validation rejects junk", async () => {
      const { status } = await call("POST", "/api/rfqs", { productId: "nope", qty: -1, city: "X" });
      assert.strictEqual(status, 400);
    });
    let po;
    await test("create order marks the RFQ ordered", async () => {
      const { body } = await call("POST", "/api/orders", { order: { productId: "box3", qty: 3000, city: "Pune", sid: "s1", landed: 1, subtotal: 1, gst: 0, freight: 0, avg: 1, eta: 3, stage: 0, history: [Date.now()], rfqId }, rfqPatch: { status: "ordered", wonBy: "s1" } });
      assert.match(body.po, /^VB\/PO\/\d{4}-\d{2}\/0004$/); po = body.po;
      const st = (await call("GET", "/api/state")).body;
      assert.strictEqual(st.rfqs.find(r => r.id === rfqId).status, "ordered");
    });
    await test("order stage updates and validates", async () => {
      assert.strictEqual((await call("PATCH", "/api/orders/" + encodeURIComponent(po), { stage: 2 })).body.stage, 2);
      assert.strictEqual((await call("PATCH", "/api/orders/" + encodeURIComponent(po), { stage: 9 })).status, 400);
    });
    let sid;
    await test("supplier onboarding validates and saves", async () => {
      const badRes = await call("PUT", "/api/suppliers/new", { name: "X", city: "Pune", gstin: "27AAPFU0939F1ZX", offers: [] });
      assert.strictEqual(badRes.status, 400); assert.match(badRes.body.error, /Check character/);
      const { status, body } = await call("PUT", "/api/suppliers/new", { name: "Hadapsar Cartons", city: "Pune", area: "Hadapsar", gstin: "27AAPFU0939F1ZV", lead: 2, coverage: 400, maxDiscPct: 3, offers: [{ p: "box3", tiersText: "300:15.5, 3000:13.9", cap: 30000 }] });
      assert.strictEqual(status, 200, JSON.stringify(body)); sid = body.id;
      assert.strictEqual((await call("GET", "/api/state")).body.suppliers.length, 1);
    });
    await test("onboarded supplier wins a local quote", async () => {
      const { body } = await call("POST", "/api/quotes", { productId: "box3", qty: 3000, city: "Pune", deadline: 4 });
      assert.strictEqual(body.quotes[0].sid, sid);
      assert.ok(Math.abs(body.quotes[0].landed - (body.quotes[0].subtotal + body.quotes[0].gst + body.quotes[0].freight)) <= 2);
    });
    await test("hiding sample suppliers leaves only onboarded ones", async () => {
      await call("PUT", "/api/settings", { useSamples: false });
      const { body } = await call("POST", "/api/quotes", { productId: "ldpe", qty: 500, city: "Pune" });
      assert.strictEqual(body.quotes.length, 0);
      await call("PUT", "/api/settings", { useSamples: true });
    });
    await test("supplier can be removed", async () => {
      await call("DELETE", "/api/suppliers/" + sid);
      assert.strictEqual((await call("GET", "/api/state")).body.suppliers.length, 0);
      const re = await call("PUT", "/api/suppliers/new", { name: "Hadapsar Cartons", city: "Pune", gstin: "27AAPFU0939F1ZV", lead: 2, coverage: 400, offers: [{ p: "box3", tiersText: "300:15.5, 3000:13.9", cap: 30000 }] });
      sid = re.body.id;
    });
    if (!health.whatsapp) console.log("(WhatsApp not built yet: skipping WhatsApp tests)");
    else await test("WhatsApp webhook verification", async () => {
      const ok = await call("GET", "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42");
      assert.deepStrictEqual([ok.status, ok.body], [200, "42"]);
      assert.strictEqual((await call("GET", "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1")).status, 403);
    });
    if (health.whatsapp) await test("WhatsApp: incomplete request asks a follow-up, then completes", async () => {
      const msg = text => ({ entry: [{ changes: [{ value: { messages: [{ from: "919833333333", id: "wamid." + Math.random(), type: "text", text: { body: text } }] } }] }] });
      sent.length = 0;
      await call("POST", "/webhooks/whatsapp", msg("need nitrile gloves"));
      await new Promise(r => setTimeout(r, 50));
      assert.match(sent.at(-1).text, /Kitna|quantity/i);
    });
    if (health.whatsapp) await test("WhatsApp: APPROVE raises a PO with the chosen supplier", async () => {
      const from = "919844444444";
      await call("POST", "/api/whatsapp/simulate", { from, text: "8000 3 ply boxes Pune 7 din" });
      const { body } = await call("POST", "/api/whatsapp/simulate", { from, text: "APPROVE 1" });
      assert.match(body.reply, /PO VB\/PO\//);
      const st = (await call("GET", "/api/state")).body;
      assert.strictEqual(st.orders[0].source, "whatsapp");
      sent.length = 0;
      await call("PATCH", "/api/orders/" + encodeURIComponent(st.orders[0].po), { stage: 2 });
      assert.match(sent.at(-1)?.text || "", /Dispatched/, "buyer gets a dispatch update on WhatsApp");
      assert.strictEqual(sent.at(-1).to, from);
    });
    if (health.whatsapp) await test("WhatsApp: STATUS lists the buyer's orders, APPROVE twice is refused", async () => {
      const from = "919844444444";
      assert.match((await call("POST", "/api/whatsapp/simulate", { from, text: "status" })).body.reply, /Dispatched/);
      assert.match((await call("POST", "/api/whatsapp/simulate", { from, text: "approve 1" })).body.reply, /pehle hi place/);
    });
    if (health.whatsapp) await test("WhatsApp: signed webhooks are enforced when an app secret is set", async () => {
      const crypto = require("crypto");
      const { server: s2 } = createApp({ dataFile: path.join(dir, "db2.json"), claude: null, env: { WHATSAPP_APP_SECRET: "sec", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1" }, waSend: async () => {} });
      await new Promise(r => s2.listen(0, r));
      const url = `http://127.0.0.1:${s2.address().port}/webhooks/whatsapp`;
      const raw = JSON.stringify({ entry: [] });
      const badSig = await fetch(url, { method: "POST", headers: { "x-hub-signature-256": "sha256=00" }, body: raw });
      const good = await fetch(url, { method: "POST", headers: { "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", "sec").update(raw).digest("hex") }, body: raw });
      s2.close();
      assert.deepStrictEqual([badSig.status, good.status], [401, 200]);
    });
    if (health.whatsapp) await test("WhatsApp: log masks phone numbers", async () => {
      const { body } = await call("GET", "/api/whatsapp/log");
      assert.ok(body.log.length > 3);
      assert.ok(body.log.every(l => !/\d{10}/.test(l.from)));
    });
    await test("draft reply uses Claude", async () => {
      const st = (await call("GET", "/api/state")).body;
      const r = st.rfqs.find(x => x.quotes.length);
      const { body } = await call("POST", "/api/draft", { rfqId: r.id, sid: r.quotes[0].sid });
      assert.match(body.text, /Namaste/);
    });
    await test("growth: sign-up, ops gate, quote links, leads, outreach, unsubscribe", async () => {
      const mails = [];
      const fakeFetch = async (url, init) => { mails.push({ url, body: JSON.parse(init.body) }); return { ok: true, text: async () => "" }; };
      const { server: s3 } = createApp({ dataFile: path.join(dir, "db3.json"), claude: null, fetch: fakeFetch,
        env: { ADMIN_KEY: "k3y-123", EMAIL_PROVIDER: "brevo", EMAIL_API_KEY: "x", OUTREACH_FROM_EMAIL: "hello@vb.test", PUBLIC_URL: "https://vb.test", OUTREACH_DAILY_CAP: "2" } });
      await new Promise(r => s3.listen(0, r));
      const b3 = `http://127.0.0.1:${s3.address().port}`;
      const c3 = async (method, p, body, key) => { const r = await fetch(b3 + p, { method, headers: { "content-type": "application/json", ...(key ? { "x-admin-key": key } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() }; };
      try {
        // ops tools are closed without the key
        assert.strictEqual((await c3("GET", "/api/admin/applications")).status, 401);
        assert.strictEqual((await c3("GET", "/api/admin/applications", null, "wrong-key")).status, 401);
        // leads import with dedupe
        const imp = (await c3("POST", "/api/admin/leads", { leads: [
          { business_name: "Rudrapur Cartons", city: "Rudrapur", email: "sales@rc.test", category: "Corrugated boxes" },
          { business_name: "Karur Weaves", city: "Karur", email: "hi@kw.test", segment: "exporter-buyer", cluster_product: "home textiles" },
          { business_name: "Agra Shoes", city: "Agra", email: "", segment: "exporter-buyer" },
          { business_name: "Dup", email: "SALES@rc.test" }] }, "k3y-123")).body;
        assert.deepStrictEqual([imp.added, imp.skipped], [3, 1]);
        const leads = (await c3("GET", "/api/admin/leads", null, "k3y-123")).body.leads;
        // calling or WhatsApp marks the lead contacted
        const agra = leads.find(l => l.business === "Agra Shoes");
        const contacted = (await c3("PATCH", "/api/admin/leads/" + agra.id, { contacted: true, notes: "Call back Monday" }, "k3y-123")).body;
        assert.deepStrictEqual([contacted.status, contacted.notes, !!contacted.lastContacted], ["contacted", "Call back Monday", true]);
        const mm = (await c3("PATCH", "/api/admin/leads/" + agra.id, { emailed: true, template: "exporter_buyer" }, "k3y-123")).body;
        assert.deepStrictEqual([mm.status, mm.sends.at(-1).t, !!mm.lastEmailed], ["emailed", "exporter_buyer", true], "mail-merge sends are recorded");
        // sending needs sender identity first
        assert.strictEqual((await c3("POST", "/api/admin/outreach", { leadIds: [leads[0].id], templateId: "supplier_free", send: true }, "k3y-123")).status, 400);
        await c3("PUT", "/api/admin/outreach/settings", { senderName: "Yashraj", senderAddress: "House of 24, Nagpur" }, "k3y-123");
        const prev = (await c3("POST", "/api/admin/outreach", { leadIds: leads.map(l => l.id), templateId: "supplier_free" }, "k3y-123")).body;
        assert.strictEqual(prev.sent, 0); assert.strictEqual(mails.length, 0, "preview never sends");
        assert.strictEqual(prev.previews.find(p => p.business === "Agra Shoes").skip, "No email");
        const sent = (await c3("POST", "/api/admin/outreach", { leadIds: leads.map(l => l.id), templateId: "supplier_free", send: true }, "k3y-123")).body;
        assert.strictEqual(sent.sent, 2); assert.strictEqual(mails.length, 2);
        assert.match(mails[0].body.textContent, /https:\/\/vb\.test\/unsubscribe\?e=/);
        assert.ok(mails[0].body.headers["List-Unsubscribe"]);
        const again = (await c3("POST", "/api/admin/outreach", { leadIds: leads.map(l => l.id), templateId: "supplier_free", send: true }, "k3y-123")).body;
        assert.strictEqual(again.sent, 0, "no repeat emails, daily cap respected");
        // unsubscribe: bad signature refused, good one recorded
        const unsubLink = mails[1].body.textContent.match(/https:\/\/vb\.test(\/unsubscribe\?\S+)/)[1];
        assert.strictEqual((await fetch(b3 + "/unsubscribe?e=hi@kw.test&t=forged")).status, 400);
        assert.strictEqual((await fetch(b3 + unsubLink)).status, 200);
        const after = (await c3("GET", "/api/admin/leads", null, "k3y-123")).body.leads;
        assert.ok(after.some(l => l.status === "unsubscribed"));
        // public sign-up, linked to the outreach lead
        const bad = await c3("POST", "/api/join", { role: "supplier", business: "X" });
        assert.strictEqual(bad.status, 400);
        const ok = await c3("POST", "/api/join", { role: "supplier", business: "Rudrapur Cartons", name: "Amit", phone: "9876543210", city: "Rudrapur", cats: ["pack"], consent: true, ref: leads[0].id });
        assert.match(ok.body.id, /^A\d{4}$/);
        assert.deepStrictEqual((await c3("POST", "/api/join", { company_site: "spam" })).body, { ok: true }, "honeypot quietly ignored");
        const apps = (await c3("GET", "/api/admin/applications", null, "k3y-123")).body.applications;
        assert.strictEqual(apps.length, 1);
        assert.strictEqual((await c3("GET", "/api/admin/leads", null, "k3y-123")).body.leads.find(l => l.id === leads[0].id).status, "joined");
        assert.ok(!JSON.stringify((await c3("GET", "/api/state")).body).includes("9876543210"), "sign-ups never in public state");
        // quote links: onboard a real supplier, invite, supplier answers, price shows up
        const sup = (await c3("PUT", "/api/suppliers/new", { name: "Rudrapur Cartons", city: "Rudrapur", gstin: "05AABCR1234A1Z8", lead: 2, coverage: 1500, offers: [{ p: "box5", tiersText: "200:44, 1000:40", cap: 20000 }] }));
        const sid = sup.body.id;
        assert.ok(sid, JSON.stringify(sup.body));
        const rfq = (await c3("POST", "/api/rfqs", { productId: "box5", qty: 2000, city: "Moradabad", deadline: 10, quotes: [] })).body;
        assert.strictEqual((await c3("POST", `/api/admin/rfqs/${rfq.id}/invites`, { sids: [sid] })).status, 401);
        const invs = (await c3("POST", `/api/admin/rfqs/${rfq.id}/invites`, { sids: [sid, "s1"] }, "k3y-123")).body.invites;
        assert.strictEqual(invs.length, 1, "sample suppliers can't be invited");
        const token = invs[0].url.split("#quote/")[1];
        const view = (await c3("GET", "/api/quote/" + token)).body;
        assert.deepStrictEqual([view.rfq.qty, view.rfq.city, view.rateCard], [2000, "Moradabad", 40]);
        assert.strictEqual((await c3("POST", "/api/quote/" + token, { unit: 4000, lead: 2 })).status, 400);
        assert.strictEqual((await c3("POST", "/api/quote/" + token, { unit: 37.5, lead: 3, note: "30% advance" })).body.quote.unit, 37.5);
        assert.strictEqual((await c3("GET", "/api/quote/not-a-real-token-123")).status, 404);
        const pubRfq = (await c3("GET", "/api/state")).body.rfqs.find(r => r.id === rfq.id);
        assert.strictEqual(pubRfq.invites[0].quote.unit, 37.5);
        assert.ok(!("token" in pubRfq.invites[0]), "tokens stay secret");
        // link clicks are counted on the lead, unknown events refused
        assert.strictEqual((await c3("POST", "/api/track", { ev: "join_view", ref: leads[1].id })).status, 200);
        assert.strictEqual((await c3("POST", "/api/track", { ev: "spy" })).status, 400);
        const clicked = (await c3("GET", "/api/admin/leads", null, "k3y-123")).body.leads.find(l => l.id === leads[1].id);
        assert.deepStrictEqual([clicked.views, !!clicked.lastViewed], [1, true]);
        // backup and restore round-trip
        const bk = await fetch(b3 + "/api/admin/backup", { headers: { "x-admin-key": "k3y-123" } });
        assert.match(bk.headers.get("content-disposition"), /vyaparboss-backup/);
        const backup = await bk.json();
        await c3("DELETE", "/api/admin/leads/" + leads[0].id, null, "k3y-123");
        assert.strictEqual((await c3("POST", "/api/admin/restore", { app: "other" }, "k3y-123")).status, 400);
        const rs = (await c3("POST", "/api/admin/restore", backup, "k3y-123")).body;
        assert.strictEqual(rs.leads, 3);
        assert.ok((await c3("GET", "/api/admin/leads", null, "k3y-123")).body.leads.some(l => l.id === leads[0].id), "deleted lead is back");
        // CORS for the GitHub Pages copy
        const pre = await fetch(b3 + "/api/join", { method: "OPTIONS", headers: { origin: "https://yashrajsurgo0.github.io" } });
        assert.strictEqual(pre.headers.get("access-control-allow-origin"), "https://yashrajsurgo0.github.io");
        // wrong admin keys get throttled
        let last; for (let i = 0; i < 12; i++) last = (await c3("GET", "/api/admin/leads", null, "guess-" + i)).status;
        assert.strictEqual(last, 429);
      } finally { s3.close(); }
    });
    await test("unknown API path is a JSON 404", async () => {
      const { status, body } = await call("GET", "/api/nope");
      assert.deepStrictEqual([status, body.error], [404, "No such endpoint"]);
    });
    console.log(`\n${passed} server tests passed`);
  } catch (e) {
    console.error("FAILED:", e.message); process.exitCode = 1;
  } finally {
    server.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
})();
