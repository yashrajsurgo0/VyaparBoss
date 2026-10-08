// API tests: boots the server on a random port with a throwaway data file. No network, no API key needed.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp } = require("../server");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vb-"));
  const sent = [];
  const fakeClaude = { model: "fake", async json() { return { product_id: "box3", quantity: 3000, unit: "pcs", city: "Pune", deadline_days: 4, notes: "", reply: "Samajh gaya" }; }, async complete() { return "Namaste ji, rate confirmed."; } };
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
    });
    await test("draft reply uses Claude", async () => {
      const st = (await call("GET", "/api/state")).body;
      const r = st.rfqs.find(x => x.quotes.length);
      const { body } = await call("POST", "/api/draft", { rfqId: r.id, sid: r.quotes[0].sid });
      assert.match(body.text, /Namaste/);
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
