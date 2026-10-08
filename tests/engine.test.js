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

console.log(`\n${passed} engine tests passed`);
