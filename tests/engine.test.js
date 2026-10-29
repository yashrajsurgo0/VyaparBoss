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
  assert.strictEqual(C.normalizeLead({ business_name: "Two Mails", email: "Sales@rb.in; info@rb.in" }).lead.email, "sales@rb.in");
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
  assert.strictEqual(C.outreachVars({ business: "Mh Exports", city: "Moradabad", product: "Moradabad (brassware/metal decor): metal", segment: "exporter" }, {}).product, "brassware");
  assert.strictEqual(C.outreachVars({ business: "X", city: "Rudrapur", product: "3/5/7 ply corrugated boxes, printed", segment: "supplier" }, {}).product, "3/5/7 ply corrugated boxes");
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
  const after = C.renderCallScript({ ...lead, segment: "supplier", lastEmailed: Date.now() }, { senderName: "Yashraj" });
  assert.match(after[1], /email bheja tha/);
  assert.match(C.renderWhatsAppPitch({ ...lead, lastEmailed: Date.now() }, { senderName: "Yashraj" }), /email bhi bheja tha/);
});

test("global region: international buyer numbers, English-only AI replies, ports", () => {
  const base = { role: "buyer", business: "Lyon Home Decor", name: "Claire", city: "Lyon", what: "export cartons", consent: true };
  const g = C.normalizeJoin({ ...base, region: "global", phone: "+33 6 12 34 56 78" });
  assert.ok(g.ok, g.errors.join()); assert.deepStrictEqual([g.a.phone, g.a.region], ["+33612345678", "global"]);
  assert.ok(C.normalizeJoin({ ...base, region: "global", phone: "98765 43210" }).ok, "Indian mobile still fine in Global");
  assert.ok(!C.normalizeJoin({ ...base, phone: "+33 6 12 34 56 78" }).ok, "India region expects an Indian mobile");
  assert.match(C.buildParsePrompt("hi", null, "en"), /plain English with no Hindi words/);
  assert.match(C.buildParsePrompt("hi", null), /same language style/);
  assert.strictEqual(C.ruleParse("50 pallets to JNPT in 10 days").city, "Nhava Sheva");
});

test("order actions follow the roles and fill in the history", () => {
  const t0 = Date.UTC(2026, 9, 1), o = { po: "P1", date: t0, eta: 4, stage: 0, history: [t0], sid: "x" };
  assert.match(C.applyOrderAction(o, { action: "dispatch", shipment: { transporter: "VRL", lr: "123" } }, "buyer").error, /supplier/);
  const r = C.applyOrderAction(o, { action: "dispatch", shipment: { transporter: "VRL", lr: "ab-123", vehicle: "mh12  ab 1" } }, "supplier", t0 + 864e5);
  assert.deepStrictEqual([r.ev, o.stage, o.history.length, o.history[1], o.shipment.lr, o.shipment.vehicle], ["dispatch", 2, 3, t0 + 864e5, "AB-123", "MH12 AB 1"]);
  C.applyOrderAction(o, { action: "deliver", condition: "damaged", note: "3 cartons wet" }, "buyer", t0 + 3 * 864e5);
  assert.deepStrictEqual([o.stage, o.dispute.status, o.issue], [4, "open", "Damaged goods"]);
  assert.match(C.applyOrderAction(o, { action: "resolve", resolution: "credit" }, "supplier").error, /team/);
  C.applyOrderAction(o, { action: "resolve", resolution: "credit" }, "team");
  assert.strictEqual(o.issue, null);
  assert.match(C.applyOrderAction(o, { action: "review", stars: 9 }, "buyer").error, /1 to 5/);
});
test("track record: on time against the promised date, ratings averaged, samples ignored", () => {
  const d = 864e5, mk = (late, stars, extra = {}) => ({ sid: "x", date: 0, eta: 3, promisedBy: 3 * d, stage: 4, history: [0, 1, 2, 3, late ? 5 * d : 2 * d], review: stars ? { stars } : null, ...extra });
  const t = plain(C.trackRecord([mk(false, 5), mk(true, 3), mk(false, 0), mk(false, 5, { sample: true }), mk(false, 5, { sid: "y" })], "x"));
  assert.deepStrictEqual([t.delivered, t.onTime, t.pct, t.rated, t.avg], [3, 2, 67, 2, 4]);
  const s = C.applyTrack({}, t);
  assert.strictEqual(+C.onTimeOf(s).toFixed(1), +((85 * 2 + 200) / 5).toFixed(1), "blended with two neutral orders");
  assert.strictEqual(C.onTimeOf({ onTime: null }), 85, "new suppliers get the neutral default");
});

test("plans: limits by plan, paid plans lapse to Free, ranking ignores plans", () => {
  const P = C.PRICING, now = Date.now();
  assert.strictEqual(C.planOf({ plan: "pro", planUntil: now + 1e6 }, now), "pro");
  assert.strictEqual(C.planOf({ plan: "pro", planUntil: now - 1 }, now), "free", "expired plan is Free");
  assert.strictEqual(C.planOf({ plan: "gold" }, now), "free");
  const six = { offers: ["box3", "box5", "ldpe", "tape", "stretch", "pallet"].map(p => ({ p })) };
  assert.match(plain(C.planLimitErrors(six, P, now))[0], /up to 5 products/);
  assert.deepStrictEqual(plain(C.planLimitErrors({ ...six, plan: "growth", planUntil: now + 1e6 }, P, now)), []);
  assert.match(plain(C.planLimitErrors({ offers: [{ p: "box3" }, { p: "gloves" }] }, P, now))[0], /1 category/);
  const r = { productId: "box3", qty: 6000, city: "Pune" }, a = plain(C.discover(r).eligible.map(q => q.s.id));
  C.getSuppliers().forEach(s => { s.plan = "pro"; s.planUntil = now + 1e6; });
  assert.deepStrictEqual(plain(C.discover(r).eligible.map(q => q.s.id)), a, "a paid plan never changes the ranking");
  C.getSuppliers().forEach(s => { delete s.plan; delete s.planUntil; });
});
test("commission: by category, big-order and plan discounts, min and cap, only when agreed", () => {
  const P = C.PRICING, now = Date.now();
  assert.strictEqual(C.commissionFor({ productId: "box3", subtotal: 100000 }, {}), null, "no fee without agreement");
  assert.deepStrictEqual(plain(C.commissionFor({ productId: "box3", subtotal: 100000 }, { feeAgreed: true }, P, now)), { rate: 0.02, amount: 2000, plan: "free", status: "due" });
  assert.strictEqual(C.commissionFor({ productId: "cement", subtotal: 100000 }, { feeAgreed: true }, P, now).rate, 0.01, "building is 1%");
  assert.strictEqual(C.commissionFor({ productId: "box3", subtotal: 600000 }, { feeAgreed: true }, P, now).rate, 0.015, "big orders 0.5 points off");
  assert.strictEqual(C.commissionFor({ productId: "box3", subtotal: 100000 }, { feeAgreed: true, plan: "pro", planUntil: now + 1e6 }, P, now).rate, 0.015, "Pro 0.5 points off");
  assert.strictEqual(C.commissionFor({ productId: "box3", subtotal: 1000 }, { feeAgreed: true }, P, now).amount, 99, "minimum fee");
  assert.strictEqual(C.commissionFor({ productId: "box3", subtotal: 5e6 }, { feeAgreed: true }, P, now).amount, 25000, "capped");
  assert.strictEqual(C.commissionFor({ productId: "box3", subtotal: 100000 }, { feeAgreed: true, feeRate: 0.03 }, P, now).rate, 0.03, "a negotiated rate wins");
});
test("buyer services: freight replaces the supplier's, GST on our invoice, revenue net of partner costs", () => {
  const r = { productId: "box3", qty: 6000, city: "Pune" }, res = C.discover(r), q = res.eligible[0];
  const o = plain(C.orderRecord(r, res, q)), before = o.landed, freight = o.freight;
  C.applyServices(o, q, { freight: true, assured: true });
  assert.strictEqual(o.freight, 0); assert.strictEqual(o.landed, before - freight, "supplier invoice is goods + GST");
  const f = o.services.lines.find(l => l.k === "freight"), a = o.services.lines.find(l => l.k === "assured");
  assert.ok(f.amount < freight, "KaantaMandi Freight is below the usual freight");
  assert.strictEqual(f.gst, Math.round(f.amount * 0.05), "freight at 5% GST"); assert.strictEqual(a.gst, Math.round(a.amount * 0.18));
  assert.strictEqual(C.orderTotal(o), o.landed + o.services.total);
  const rev = plain(C.orderRevenue(o));
  assert.deepStrictEqual([rev.freight, rev.assured], [f.amount - f.cost, a.amount]);
  o.stage = 4; o.history = [0, 1, 2, 3, o.promisedBy + 3 * 864e5];
  assert.strictEqual(C.orderRevenue(o).assured, 0, "Assured is refunded on a late delivery");
  assert.strictEqual(C.orderRevenue({ ...o, cancelled: { by: "buyer" } }).freight, 0, "cancelled orders earn nothing");
  const o2 = plain(C.orderRecord(r, res, q)); C.applyServices(o2, q, {}); assert.strictEqual(o2.services, undefined, "nothing ticked, nothing added");
  const o3 = plain(C.orderRecord(r, res, q)); C.applyServices(o3, q, { insurance: true }); assert.strictEqual(o3.services, undefined, "insurance stays off until a licensed partner is switched on");
  C.applyServices(o3, q, { insurance: true }, C.pricingWith({ insurance: { enabled: true } })); assert.strictEqual(o3.services.lines[0].k, "insurance");
});
test("economics report: GMV, streams, take rate, cohorts; pricing edits are checked", () => {
  const d = 864e5, now = Date.UTC(2026, 9, 20), mk = (owner, daysAgo, extra = {}) => ({ ownerId: owner, date: now - daysAgo * d, productId: "box3", subtotal: 100000, landed: 110000, stage: 0, fee: { amount: 2000, status: "due" }, ...extra });
  const orders = [mk("a", 5), mk("a", 40), mk("b", 3, { services: { lines: [{ k: "assured", amount: 1000, gst: 180, cost: 0 }], total: 1180, status: "due" } }), mk("c", 2, { sample: true }), mk("d", 1, { cancelled: { by: "buyer" } })];
  const e = plain(C.economicsReport({ orders, rfqs: [{ date: now - d }, { date: now - 2 * d }], suppliers: [{ plan: "growth", planUntil: now + 9e9 }], planPayments: [{ at: now - d, amount: 1499, status: "paid" }], now }));
  assert.deepStrictEqual([e.orders, e.gmv, e.streams.commission, e.streams.assured, e.streams.plans, e.revenue], [2, 221180, 4000, 1000, 1499, 6499]);
  assert.strictEqual(+e.takeRate.toFixed(4), +(6499 / 221180).toFixed(4));
  assert.deepStrictEqual([e.newBuyers, e.activeBuyers, e.mrr, e.payingSuppliers], [1, 2, 1499, 1]);
  assert.strictEqual(e.contribution, 6499 - 2 * 150 - 2 * 2, "revenue minus ops and AI costs");
  assert.ok(e.cohorts.length >= 1);
  assert.ok(!C.normalizePricing({ take: { byCat: { pack: 0.5 } } }).ok, "50% commission is refused");
  assert.ok(C.normalizePricing({ plans: { growth: { monthly: 999 } } }).ok);
  const m = plain(C.projectMonth({ orders: 100, aov: 100000, takeRate: 0.02, feeShare: 1 }));
  assert.ok(m.revenue > 0 && m.gmv === 1e7);
});

console.log(`\n${passed} engine tests passed`);
