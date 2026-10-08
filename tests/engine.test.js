// Run with: npm test  (Node 18+, no dependencies)
// Loads the browser scripts into a sandbox and checks parsing + landed-cost logic.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const files = ["data", "util", "engine", "parser"].map(f =>
  fs.readFileSync(path.join(__dirname, "..", "src", "js", f + ".js"), "utf8"));
const ctx = vm.createContext({ console, localStorage: { getItem: () => null, setItem() {} } });
vm.runInContext(files.join("\n") + "\nthis.api={ruleParse,applyParsed,missing,discover,freightCost,tierPrice,km,PMAP,SUPPLIERS};", ctx);
const { ruleParse, applyParsed, missing, discover, freightCost, tierPrice, km, SUPPLIERS } = ctx.api;

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const parse = t => applyParsed(ruleParse(t), null).r;
const plain = v => JSON.parse(JSON.stringify(v)); // sandbox arrays have a different prototype

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
test("missing fields are reported", () => assert.deepStrictEqual(plain(missing(parse("need gloves"))), ["quantity", "city"]));

test("tier pricing picks the highest tier reached", () => {
  const o = { tiers: [[500, 17.9], [2000, 16.2], [10000, 14.8]] };
  assert.strictEqual(tierPrice(o, 499), null);
  assert.strictEqual(tierPrice(o, 2000), 16.2);
  assert.strictEqual(tierPrice(o, 50000), 14.8);
});
test("freight: part load minimum and full-truck switch", () => {
  assert.strictEqual(freightCost(10, 50).cost, 1200);
  const f = freightCost(18000, 1000);
  assert.strictEqual(f.mode, "2 × 9 t truck");
  assert.strictEqual(f.cost, 2 * (9000 + 38 * 1000));
});
test("same-city distance has a 25 km floor", () => assert.strictEqual(km("Pune", "Pune"), 25));

test("discovery excludes on MOQ, capacity and coverage; ranks on-time first", () => {
  const res = discover({ productId: "ldpe", qty: 2000, city: "Pune", deadline: 5 });
  assert.ok(res.eligible.length >= 2);
  assert.ok(res.excluded.every(x => x.why));
  const firstLate = res.eligible.findIndex(q => !q.meets);
  if (firstLate !== -1) assert.ok(res.eligible.slice(firstLate).every(q => !q.meets));
  for (const q of res.eligible)
    assert.ok(Math.abs(q.landed - (q.subtotal + q.gst + q.freight)) < 1e-6, "landed = goods + GST + freight");
});
test("every supplier offer has ascending tiers", () => {
  for (const s of SUPPLIERS) for (const o of s.offers)
    o.tiers.forEach((t, i) => i && assert.ok(t[0] > o.tiers[i - 1][0] && t[1] <= o.tiers[i - 1][1], `${s.id}/${o.p}`));
});

console.log(`\n${passed} tests passed`);
