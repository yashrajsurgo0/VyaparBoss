// Engine + parser tests. Run with: npm test  (Node 18+, no dependencies)
const assert = require("assert");
const { loadCore } = require("../server/core");
const C = loadCore();
const plain = v => JSON.parse(JSON.stringify(v)); // sandbox values have their own prototypes

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const parse = t => plain(C.applyParsed(C.ruleParse(t), null).r);

test("English request with kg, city and days", () => {
  const r = parse("Need 2000 kg food-grade packaging material delivered to Pune within 5 days");
  assert.deepStrictEqual([r.productId, r.qty, r.city, r.deadline], ["ldpe", 2000, "Pune", 5]);
});
test("Hinglish with ply spec and 'ek hafte'", () => {
  const r = parse("Bhai 5000 3-ply boxes chahiye Ahmedabad mein, ek hafte mein");
  assert.deepStrictEqual([r.productId, r.qty, r.city, r.deadline], ["box3", 5000, "Ahmedabad", 7]);
});
test("tonne converts to kg; NPK grade is not read as quantity", () => {
  const r = parse("2 tonne NPK 19:19:19 Indore");
  assert.deepStrictEqual([r.productId, r.qty, r.city], ["npk", 2000, "Indore"]);
});
test("bags of NPK convert at 25 kg", () => assert.strictEqual(parse("50 bags khad nashik 3 din").qty, 1250));
test("'2k' shorthand and city alias", () => {
  const r = parse("2k 3 ply boxes bangalore");
  assert.deepStrictEqual([r.qty, r.city], [2000, "Bengaluru"]);
});
test("Hindi number words", () => {
  assert.strictEqual(parse("do hazaar 5 ply export box dilli 10 din").qty, 2000);
  assert.strictEqual(parse("dedh lakh labels wale 3 ply boxes pune").qty, 150000);
  assert.strictEqual(parse("paanch sau kg mulch film nashik").qty, 500);
  const r = parse("do hazaar 5 ply export box dilli 10 din");
  assert.deepStrictEqual([r.productId, r.city, r.deadline], ["box5", "Delhi", 10]);
});
test("missing fields are reported", () => assert.deepStrictEqual(plain(C.missing(parse("need gloves"))), ["quantity", "city"]));
test("parse prompt forbids the AI from promising availability", () => {
  assert.match(C.buildParsePrompt("x", null), /Never promise availability/);
});
test("model output is sanitised before use", () => {
  const p = plain(C.cleanParsed({ product_id: "made-up", quantity: "-5", city: "Atlantis", deadline_days: 3, reply: 42 }));
  assert.deepStrictEqual([p.product_id, p.quantity, p.city, p.deadline_days, p.reply], [null, null, null, 3, null]);
});

test("tier pricing picks the highest tier reached", () => {
  const o = { tiers: [[500, 17.9], [2000, 16.2], [10000, 14.8]] };
  assert.strictEqual(C.tierPrice(o, 499), null);
  assert.strictEqual(C.tierPrice(o, 2000), 16.2);
  assert.strictEqual(C.tierPrice(o, 50000), 14.8);
});
test("freight: part-load minimum and full-truck switch", () => {
  assert.strictEqual(C.freightCost(10, 50).cost, 1200);
  const f = C.freightCost(18000, 1000);
  assert.deepStrictEqual([f.mode, f.cost], ["2 × 9 t truck", 2 * (9000 + 38 * 1000)]);
  assert.strictEqual(C.km("Pune", "Pune"), 25);
});
test("freight and landed cost add up", () => {
  const res = C.discover({ productId: "ldpe", qty: 2000, city: "Pune", deadline: 5 });
  assert.ok(res.eligible.length >= 2);
  assert.ok(res.excluded.every(x => x.why));
  for (const q of res.eligible) assert.ok(Math.abs(q.landed - (q.subtotal + q.gst + q.freight)) < 1e-6);
  const firstLate = res.eligible.findIndex(q => !q.meets);
  if (firstLate !== -1) assert.ok(res.eligible.slice(firstLate).every(q => !q.meets), "on-time quotes rank first");
});
test("negotiation never goes below a supplier's floor", () => {
  const res = C.discover({ productId: "box3", qty: 5000, city: "Pune" });
  const { neg, out } = C.negotiate(res, 1);
  for (const q of res.eligible) assert.ok(neg[q.s.id].price >= +(q.list * (1 - q.s.maxDisc)).toFixed(2));
  assert.ok(out.every(x => !x.ok));
});
test("every sample supplier has ascending tiers", () => {
  for (const s of C.SAMPLE_SUPPLIERS) for (const o of s.offers)
    o.tiers.forEach((t, i) => i && assert.ok(t[0] > o.tiers[i - 1][0] && t[1] <= o.tiers[i - 1][1], `${s.id}/${o.p}`));
});

test("GSTIN checksum", () => {
  assert.strictEqual(C.checkGstin("27AAPFU0939F1ZV").ok, true);
  assert.strictEqual(C.checkGstin("27AAPFU0939F1ZX").ok, false);
  assert.strictEqual(C.checkGstin("27AAPFU0939").ok, false);
  assert.ok(C.checkGstin("27AAPFU0939F1ZV", "Ahmedabad").warn, "state mismatch is flagged");
});
test("price tiers parse and validate", () => {
  assert.deepStrictEqual(plain(C.parseTiers("2000:16.2, 500:17.9")), [[500, 17.9], [2000, 16.2]]);
  assert.strictEqual(C.parseTiers("500:10, 2000:12"), null, "price can't rise with quantity");
  assert.strictEqual(C.parseTiers("abc"), null);
});
test("onboarded supplier joins discovery", () => {
  const { ok, s, errors } = C.normalizeSupplier({ name: "Test Corrugators", city: "Pune", gstin: "27AAPFU0939F1ZV", lead: 2, coverage: 300, maxDiscPct: 4,
    offers: [{ p: "box3", tiersText: "500:15, 5000:13", cap: 20000 }] });
  assert.ok(ok, errors.join("; "));
  s.id = "ctest";
  C.setSuppliers([s], true);
  const res = C.discover({ productId: "box3", qty: 6000, city: "Pune" });
  assert.strictEqual(res.eligible[0].s.id, "ctest", "cheapest local supplier ranks first");
  C.setSuppliers([], true);
});
test("onboarding rejects bad input with readable reasons", () => {
  const { ok, errors } = C.normalizeSupplier({ name: "X", city: "Nowhere", gstin: "123", lead: 0, coverage: 10, offers: [] });
  assert.strictEqual(ok, false);
  assert.ok(errors.length >= 5, errors.join("; "));
});
test("WhatsApp quote explains when option 1 isn't the cheapest", () => {
  const r = { productId: "box3", qty: 5000, city: "Pune", deadline: 7 };
  const msg = C.quoteMessage(r, C.discover(r));
  assert.match(msg, /% on-time/);
  if (/mehenga/.test(msg)) assert.match(msg, /Sabse sasta: option \d/);
});
test("sample data builds three linked orders", () => {
  const d = plain(C.buildSampleData());
  assert.strictEqual(d.orders.length, 3);
  for (const o of d.orders) assert.ok(d.rfqs.find(r => r.id === o.rfqId && r.wonBy === o.sid));
});

test("CSV parser handles quotes, commas and blank lines", () => {
  const rows = plain(C.parseCSV('business_name,city,email\n"Shree, Ganesh Pack",Rajkot,a@b.in\n\n"Say ""hi"" Ltd",Moradabad,\n'));
  assert.deepStrictEqual(rows.map(r => r.business_name), ["Shree, Ganesh Pack", 'Say "hi" Ltd']);
  assert.strictEqual(C.parseCSV(C.toCSV(rows, ["business_name", "city"]))[0].business_name, "Shree, Ganesh Pack");
});
test("leads: researched rows normalise, bad emails dropped, duplicates skipped", () => {
  const exp = C.normalizeLead({ business_name: "Karur Weaves", city: "Karur", segment: "exporter-buyer", cluster_product: "home textiles", email: "not-an-email" }).lead;
  assert.deepStrictEqual([exp.segment, exp.email, exp.product], ["exporter", "", "home textiles"]);
  assert.strictEqual(C.normalizeLead({ business_name: "Rudra Box", category: "Corrugated boxes" }).lead.segment, "supplier");
  const { added, skipped } = C.mergeLeads([{ business: "Alpha", email: "a@x.in" }], [{ business_name: "Beta", email: "A@x.in" }, { business_name: "Agra Kraft", city: "Agra" }, { business_name: "agra kraft", city: "agra" }]);
  assert.deepStrictEqual([added.length, skipped.length], [1, 2]);
});
test("outreach email: placeholders filled, opt-out and sender always present", () => {
  const lead = { id: "L0007", business: "Moradabad Brass Co", city: "Moradabad", segment: "exporter", product: "brassware; gifts", contact: "Mr. Ravi Kumar" };
  const m = C.renderOutreach("exporter_buyer", lead, { senderName: "Yashraj", senderAddress: "House of 24, Nagpur", joinBase: "https://x.test/", unsubLink: () => "https://x.test/unsub" });
  assert.match(m.text, /Namaste Ravi ji/);
  assert.match(m.text, /https:\/\/x\.test\/#join\/b\/L0007/);
  assert.match(m.text, /House of 24, Nagpur/);
  assert.match(m.text, /https:\/\/x\.test\/unsub/);
  assert.ok(!/\{\{/.test(m.subject + m.text));
  for (const t of C.OUTREACH_TEMPLATES) assert.match(t.body, /\{\{unsub_link\}\}/);
});
test("sign-up validation", () => {
  const ok = C.normalizeJoin({ role: "supplier", business: "Rudrapur Cartons", name: "Amit", phone: "+91 98765 43210", city: "Rudrapur", cats: ["pack"], consent: true });
  assert.ok(ok.ok, ok.errors.join("; "));
  assert.strictEqual(ok.a.phone, "9876543210");
  const withRates = C.normalizeJoin({ role: "supplier", business: "Rudrapur Cartons", name: "Amit", phone: "9876543210", city: "Rudrapur", cats: ["pack"], consent: true,
    offers: [{ p: "box5", tiersText: "200:44, 1000:40", cap: "20000" }, { p: "", tiersText: "" }], coverage: "800", lead: "3" });
  assert.deepStrictEqual(plain([withRates.a.offers, withRates.a.coverage, withRates.a.lead]), [[{ p: "box5", tiers: [[200, 44], [1000, 40]], cap: 20000 }], 800, 3]);
  assert.match(C.normalizeJoin({ ...withRates.a, consent: true, offers: [{ p: "box5", tiersText: "cheap" }] }).errors.join(), /write rates like/);
  const bad = C.normalizeJoin({ role: "buyer", business: "X", phone: "12345", consent: false });
  assert.ok(bad.errors.length >= 4);
});
test("a supplier's own quote replaces their rate card and is ranked", () => {
  const r = { productId: "box3", qty: 5000, city: "Pune", deadline: null };
  const base = C.discover(r, {}, {});
  const sid = base.eligible.at(-1).s.id;
  const live = { [sid]: { unit: 9, lead: 1 } };
  const res = C.discover(r, {}, live);
  const q = res.eligible.find(x => x.s.id === sid);
  assert.deepStrictEqual([q.live, q.unit, q.ready], [true, 9, 1]);
  assert.strictEqual(res.eligible[0].s.id, sid);
  assert.ok(C.normalizeLiveQuote({ unit: 900, lead: 2 }, 16).errors.length === 1, "absurd price is caught");
  assert.strictEqual(plain(C.liveMap({ invites: [{ sid: "s1", quote: { unit: 5, lead: 2 } }, { sid: "s2", quote: null }] })).s1.unit, 5);
});
test("export clusters are deliverable cities", () => {
  for (const c of ["Moradabad", "Karur", "Panipat", "Silvassa", "Kanpur"]) assert.ok(C.CITIES[c], c);
  assert.strictEqual(C.ruleParse("50 ISPM pallets Moradabad 10 din").product_id, "pallet");
  assert.ok(C.checkGstin("26AAACV1234A1Z5").why !== "GSTIN must be 15 characters: state code, PAN, entity code, Z, check character");
});

test("phone-first outreach: mobiles detected, WhatsApp pitch and call script are honest", () => {
  assert.deepStrictEqual([C.mobileOf("+91 98765 43210 / 0594-222"), C.mobileOf("0591-2412345"), C.mobileOf("98252 15936"), C.mobileOf("")], ["9876543210", null, "9825215936", null]);
  const lead = { id: "L0009", business: "Karur Weaves", city: "Karur", segment: "exporter", product: "home textiles" };
  const wa = C.renderWhatsAppPitch(lead, { senderName: "Yashraj", joinBase: "https://x.test/" });
  assert.match(wa, /#join\/b\/L0009/); assert.match(wa, /"no"/); assert.ok(!/\{\{/.test(wa));
  const script = C.renderCallScript({ ...lead, segment: "supplier" }, { senderName: "Yashraj" });
  assert.ok(script.length >= 5 && /Don't promise/.test(script.at(-1)));
});

console.log(`\n${passed} engine tests passed`);
