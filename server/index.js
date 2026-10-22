// VyaparBoss server: serves the app from src/ and the JSON API the app uses when it finds /api/health.
// Zero dependencies. Run: npm start   (Node 18+)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadCore } = require("./core");
const { Store } = require("./store");
const { createClaude } = require("./anthropic");
const { createGemini } = require("./gemini");
const { createWhatsApp } = require("./whatsapp");
const { createMailer, unsubSig } = require("./email");
const { createAuth } = require("./auth");
const { createNotifier } = require("./notify");
const { createRazorpay } = require("./razorpay");
const crypto = require("crypto");
const zlib = require("zlib");
const { createRemote, pullSnapshot, attachRemote } = require("./remote");

const ROOT = path.join(__dirname, "..");
const STATIC_DIR = path.join(ROOT, "src");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8" };
// Content-Security-Policy: our own scripts, plus the Google / Apple / Facebook sign-in SDKs. Inline styles are allowed
// (the app sets a few style attributes); inline scripts are not.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com https://appleid.cdn-apple.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://accounts.google.com https://*.facebook.com https://graph.facebook.com",
  "frame-src https://accounts.google.com https://appleid.apple.com https://*.facebook.com",
  "form-action 'self' https://appleid.apple.com",
  "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'",
].join("; ");
const SECURITY_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "SAMEORIGIN",
  "permissions-policy": "camera=(), microphone=(self), geolocation=()", "cross-origin-opener-policy": "same-origin-allow-popups" };
const ZIP = /^(text\/|application\/(json|manifest|xml)|image\/svg)/;

function loadEnv(file = path.join(ROOT, ".env")) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function createApp(opts = {}) {
  const env = { ...process.env, ...opts.env };
  const core = loadCore();
  const store = new Store(opts.dataFile || env.DATA_FILE || path.join(ROOT, "data", "db.json"), () => ({ ...core.buildSampleData(), suppliers: [], useSamples: true }));
  const syncSuppliers = () => core.setSuppliers(store.data.suppliers, store.data.useSamples);
  syncSuppliers();
  // AI provider: Gemini if a Google key is set, else Claude if an Anthropic key is set, else the rule parser.
  const claude = opts.claude !== undefined ? opts.claude : pickLLM(env);
  const ctx = { core, store, claude, syncSuppliers, env };
  // Off-server copy of the data (survives redeploys). See server/remote.js and docs/DEPLOY.md.
  const remote = opts.remote !== undefined ? opts.remote : createRemote(env, opts.fetch);
  const sync = remote ? attachRemote(store, remote) : null;
  ctx.services = makeServices(ctx);
  const mailer = createMailer(env, opts.fetch);
  const PUBLIC_URL = String(env.PUBLIC_URL || "https://vyaparboss.onrender.com").replace(/\/+$/, "");
  const ORIGINS = String(env.ALLOWED_ORIGINS || "https://yashrajsurgo0.github.io").split(",").map(s => s.trim()).filter(Boolean);
  const DAILY_CAP = Number(env.OUTREACH_DAILY_CAP) || 30;
  const secret = env.OUTREACH_SECRET || env.ADMIN_KEY || "";
  const unsubUrl = email => `${PUBLIC_URL}/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubSig(secret, email)}`;
  const joinHits = new Map();
  // Simple per-IP limits for public endpoints and wrong admin keys.
  const hits = new Map();
  const clientIp = req => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const limit = (req, key, max, windowMs, msg) => {
    const k = key + "|" + clientIp(req), since = Date.now() - windowMs, list = (hits.get(k) || []).filter(t => t > since);
    if (list.length >= max) throw Object.assign(new Error(msg || "Too many tries. Please wait a little and try again."), { status: 429 });
    list.push(Date.now()); hits.set(k, list);
    if (hits.size > 5000) for (const [kk, v] of hits) if (!v.some(t => t > since)) hits.delete(kk);
  };
  const auth = createAuth({ store, env, fetchImpl: opts.fetch || globalThis.fetch });
  const notify = createNotifier({ store, mailer, core, publicUrl: PUBLIC_URL });
  const razorpay = opts.razorpay !== undefined ? opts.razorpay : createRazorpay(env, opts.fetch);
  store.data.fees ||= { rate: 0.015 };
  store.data.rzEvents ||= [];
  // Sends the confirm-your-email link (only when email sending is set up). Never blocks the request.
  const sendVerify = u => { if (!notify.on) return; const tok = auth.startVerify(u); if (tok) notify.verifyEmail(u, `${PUBLIC_URL}/#verify/${tok}`).catch(() => {}); };
  store.data.messages ||= [];
  const whatsapp = createWhatsApp(ctx, { verifyToken: env.WHATSAPP_VERIFY_TOKEN, accessToken: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, appSecret: env.WHATSAPP_APP_SECRET, apiVersion: env.WHATSAPP_API_VERSION, send: opts.waSend });

  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = (req, max = 1e6) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > max) { reject(Object.assign(new Error("Request too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
  const jsonBody = async req => { const raw = await readBody(req); if (!raw.length) return {}; try { return JSON.parse(raw); } catch { throw Object.assign(new Error("Body must be JSON"), { status: 400 }); } };

  // Ops-only routes need the ADMIN_KEY (sent as x-admin-key). Without one set, they stay closed.
  const admin = req => {
    if (!env.ADMIN_KEY) throw Object.assign(new Error("Set ADMIN_KEY on the server to use ops tools"), { status: 503 });
    const got = Buffer.from(String(req.headers["x-admin-key"] || "")), want = Buffer.from(String(env.ADMIN_KEY));
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
      limit(req, "adminfail", 10, 15 * 6e4, "Too many wrong admin keys. Wait 15 minutes.");
      throw Object.assign(new Error("Admin key needed"), { status: 401 });
    }
  };
  /** True when the request carries the right admin key (no throw, no rate-limit side effects). */
  const isAdmin = req => {
    if (!env.ADMIN_KEY || !req.headers["x-admin-key"]) return false;
    const got = Buffer.from(String(req.headers["x-admin-key"])), want = Buffer.from(String(env.ADMIN_KEY));
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  };
  const needUser = (req, role) => {
    const u = auth.userOf(req);
    if (!u || u.guest) throw Object.assign(new Error("Please log in first"), { status: 401 });
    if (role && u.role !== role) throw Object.assign(new Error(`This needs a ${role} account`), { status: 403 });
    return u;
  };
  const plainJ = v => JSON.parse(JSON.stringify(v));
  /** What one person may see. Team (admin key): everything. Buyers: their own requests and orders, plus examples.
      Suppliers: requests they qualified for (only their own quote, plus their rank) and orders placed with them. */
  function stateFor(req) {
    const base = store.publicState();
    const u = auth.userOf(req), me = auth.publicUser(u);
    if (isAdmin(req)) return { ...base, me, team: true, schedules: store.data.schedules };
    const strip = s => { const { contact, ownerId, ...rest } = s; return u && ownerId === u.id ? { ...rest, contact, mine: true } : rest; };
    const suppliers = base.suppliers.map(strip);
    if (u && u.role === "supplier") {
      const sid = u.supplierId;
      const rfqs = base.rfqs.filter(r => sid && r.quotes.some(q => q.sid === sid)).map(r => {
        const ranked = r.quotes.filter(q => q.meets).sort((a, b) => a.landed - b.landed);
        const { invites, ownerId, ...rest } = r;
        return { ...rest, quotes: r.quotes.filter(q => q.sid === sid), rank: ranked.findIndex(q => q.sid === sid) + 1, of: ranked.length,
          myQuote: (invites || []).find(i => i.sid === sid)?.quote || null };
      });
      return { orders: base.orders.filter(o => sid && o.sid === sid && !hiddenFromSupplier(o)).map(({ ownerId, orgId, approval, ...o }) => o), rfqs, seq: base.seq, suppliers, useSamples: base.useSamples, me };
    }
    const org = auth.orgOf(u);
    const mine = r => r.sample || (u && (r.ownerId === u.id || (r.orgId && r.orgId === org)));
    const schedules = u ? store.data.schedules.filter(x => x.orgId === org) : [];
    return { orders: base.orders.filter(mine).map(({ fee, ...o }) => o), rfqs: base.rfqs.filter(mine), seq: base.seq, suppliers, useSamples: base.useSamples, me, schedules,
      payOnline: !!razorpay };
  }
  const sameOrg = (u, rec) => !!(u && u.role === "buyer" && (rec.ownerId === u.id || (rec.orgId && rec.orgId === auth.orgOf(u))));
  const hiddenFromSupplier = o => ["pending", "rejected"].includes(o.approval?.status);
  const canTouchOrder = (req, o) => isAdmin(req) || (() => { const u = auth.userOf(req); return u && (sameOrg(u, o) || (u.role === "supplier" && u.supplierId && o.sid === u.supplierId && !hiddenFromSupplier(o))); })();
  /** Why a team member's order needs the owner's approval, or "" if it doesn't. */
  function approvalNeeded(u, order) {
    if (!u?.orgOwner) return "";
    const owner = store.data.users.find(x => x.id === u.orgOwner); if (!owner) return "";
    if (u.memberLimit != null && order.landed > u.memberLimit) return `Above ${u.name || "this member"}'s limit of ${core.inr(u.memberLimit)} per order`;
    if (owner.budgetMonthly) {
      const spent = core.monthSpend(store.data.orders.filter(o => o.orgId === owner.id));
      if (spent + order.landed > owner.budgetMonthly) return `Takes this month's spend past the ${core.inr(owner.budgetMonthly)} budget`;
    }
    return "";
  }
  /** Repeat orders: when one is due, make a fresh request with today's prices and tell the buyer. Never orders by itself. */
  let lastScheduleRun = 0;
  function runSchedules(now = Date.now()) {
    lastScheduleRun = now;
    let changed = false;
    for (const sc of store.data.schedules) {
      if (!sc.active || sc.nextAt > now) continue;
      changed = true;
      const prev = sc.lastRfq && store.data.rfqs.find(r => r.id === sc.lastRfq);
      const owner = store.data.users.find(x => x.id === sc.ownerId);
      while (sc.nextAt <= now) sc.nextAt = core.nextRun(sc.nextAt, sc.every);
      if (!owner) { sc.active = false; continue; }
      if (prev && prev.status === "open") { sc.skipped = (sc.skipped || 0) + 1; notify.scheduleReminder(owner, prev, sc); continue; } // last one still waiting: remind, don't pile up
      const r = { productId: sc.productId, qty: sc.qty, city: sc.city, deadline: sc.deadline || null };
      const res = core.discover(r);
      const rec = ctx.services.createRfq(plainJ(core.rfqRecord(r, res, { ownerId: sc.ownerId, orgId: sc.orgId, source: "schedule", scheduleId: sc.id })));
      sc.lastRunAt = now; sc.lastRfq = rec.id; sc.runs = (sc.runs || 0) + 1;
      notify.newRequest(rec);
      notify.scheduleReady(owner, rec, sc, res.eligible.filter(q => q.meets)[0] || res.eligible[0] || null);
    }
    if (changed) store.save();
  }
  if (!opts.noTimers) setInterval(() => { try { runSchedules(); } catch (e) { console.error("schedules:", e); } }, 15 * 6e4).unref();
  function opsReport(now = Date.now()) {
    const H = 36e5, D = 864e5, med = xs => { const v = xs.filter(x => x >= 0).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
    const orders = store.data.orders.filter(o => !o.sample), live = orders.filter(o => !o.cancelled && o.approval?.status !== "pending" && o.approval?.status !== "rejected");
    const rfqs = store.data.rfqs.filter(r => !r.sample);
    const delivered = live.filter(o => o.stage === 4 && o.history?.[4]);
    const onTime = delivered.filter(o => o.history[4] <= core.promisedBy(o) + 12 * H).length;
    const gmv = live.reduce((a, o) => a + o.landed, 0);
    const weekStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
    const w0 = weekStart(now), weeks = Array.from({ length: 8 }, (_, i) => ({ start: w0 - (7 - i) * 7 * D, gmv: 0, orders: 0 }));
    for (const o of live) { const w = weeks.find(x => o.date >= x.start && o.date < x.start + 7 * D); if (w) { w.gmv += o.landed; w.orders++; } }
    const firstQuote = r => Math.min(...(r.invites || []).filter(i => i.quote?.at).map(i => i.quote.at));
    const quoted = rfqs.filter(r => isFinite(firstQuote(r)));
    const orgsWith = n => { const c = {}; for (const o of live) { const k = o.orgId || o.ownerId; if (k) c[k] = (c[k] || 0) + 1; } return Object.values(c).filter(x => x >= n).length; };
    const recent = t => t > now - 30 * D;
    const fees = live.filter(o => o.fee); // only orders that actually went to the supplier
    const toSettle = orders.flatMap(o => (o.payments || []).filter(p => p.method === "razorpay" && !p.settled).map(p => ({ po: o.po, supplier: o.sname, amount: p.amount, id: p.id, at: p.at, test: !!p.test })));
    const alerts = [];
    const add = (level, kind, title, detail, ref) => alerts.push({ level, kind, title, detail, ref });
    const ago = t => { const h = (now - t) / H; return h < 1 ? "under an hour" : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`; };
    for (const r of rfqs) if (r.status === "open" && Array.isArray(r.quotes) && !r.quotes.length && r.date > now - 14 * D) add("critical", "sourcing", `No supplier for ${core.qfmt(r.qty)} ${core.PMAP[r.productId]?.unit} ${core.PMAP[r.productId]?.name} to ${r.city}`, `${r.id}, ${ago(r.date)} ago. Find a supplier who makes this and serves ${r.city}.`, r.id);
    for (const o of live) {
      if (o.stage === 0 && now - (o.approval?.decidedAt || o.date) > 24 * H) add("serious", "confirm", `${o.sname} hasn't confirmed ${o.po}`, `Placed ${ago(o.approval?.decidedAt || o.date)} ago. Call the supplier.`, o.po);
      if (o.stage < 4 && now > core.promisedBy(o) + 12 * H) add("serious", "late", `${o.po} is late`, `${o.sname} promised ${new Date(core.promisedBy(o)).toDateString()}; it's at "${core.STAGES[o.stage]}".`, o.po);
      if (o.dispute?.status === "open") add(now - o.dispute.opened > 48 * H ? "critical" : "warning", "dispute", `Problem on ${o.po}: ${o.issue}`, `Open ${ago(o.dispute.opened)}. ${o.dispute.msgs?.length || 0} message${o.dispute.msgs?.length === 1 ? "" : "s"}.`, o.po);
      for (const p of o.payments || []) if (p.status === "claimed" && now - p.at > 3 * D) add("warning", "payment", `${o.sname} hasn't confirmed a payment on ${o.po}`, `Buyer paid ${core.inr(p.amount)} ${Math.round((now - p.at) / D)} days ago${p.ref ? ` (ref ${p.ref})` : ""}.`, o.po);
    }
    if (toSettle.length) add("warning", "settle", `${core.inr(toSettle.reduce((a, p) => a + p.amount, 0))} paid online waits to be settled to suppliers`, `${toSettle.length} payment${toSettle.length > 1 ? "s" : ""}. Pay the supplier, then mark it settled below.`, null);
    const rank = { critical: 0, serious: 1, warning: 2 };
    alerts.sort((a, b) => rank[a.level] - rank[b.level]);
    return {
      kpi: {
        gmv, gmv30: live.filter(o => recent(o.date)).reduce((a, o) => a + o.landed, 0), orders: live.length, aov: live.length ? Math.round(gmv / live.length) : 0,
        requests: rfqs.length, quoteRate: rfqs.length ? quoted.length / rfqs.length : null, orderRate: rfqs.length ? rfqs.filter(r => r.status === "ordered").length / rfqs.length : null,
        responseHours: med(quoted.map(r => (firstQuote(r) - r.date) / H)), confirmHours: med(live.filter(o => o.history?.[1]).map(o => (o.history[1] - (o.approval?.decidedAt || o.date)) / H)),
        onTimeRate: delivered.length ? onTime / delivered.length : null, delivered: delivered.length,
        disputeRate: live.length ? live.filter(o => o.dispute).length / live.length : null, openDisputes: live.filter(o => o.dispute?.status === "open").length,
        cancelRate: orders.length ? orders.filter(o => o.cancelled && o.approval?.status !== "rejected").length / orders.length : null,
        repeatRate: orgsWith(1) ? orgsWith(2) / orgsWith(1) : null, activeBuyers: new Set(rfqs.filter(r => recent(r.date)).map(r => r.orgId || r.ownerId).filter(Boolean)).size,
        activeSuppliers: new Set([...live.filter(o => recent(o.date)).map(o => o.sid), ...rfqs.filter(r => recent(r.date)).flatMap(r => (r.invites || []).filter(i => i.quote).map(i => i.sid))]).size,
        feesDue: fees.filter(o => ["due", "invoiced"].includes(o.fee.status)).reduce((a, o) => a + o.fee.amount, 0), feesCollected: fees.filter(o => o.fee.status === "collected").reduce((a, o) => a + o.fee.amount, 0),
      },
      weeks, alerts,
      disputes: live.filter(o => o.dispute?.status === "open").map(o => ({ po: o.po, supplier: o.sname, issue: o.issue, detail: o.dispute.detail, msgs: o.dispute.msgs || [], opened: o.dispute.opened, landed: o.landed })),
      fees: fees.map(o => ({ po: o.po, supplier: o.sname, amount: o.fee.amount, rate: o.fee.rate, status: o.fee.status, date: o.date })).slice(0, 200),
      toSettle, feeRate: store.data.fees.rate,
      suppliers: store.data.suppliers.filter(x => x.selfListed || x.feeAgreed).map(x => ({ id: x.id, name: x.name, city: x.city, feeAgreed: !!x.feeAgreed, feeRate: x.feeRate ?? null, verified: !!x.verified, onTime: x.onTime, rating: x.rating, delivered: x.track?.delivered || 0 })),
    };
  }
  /** Recomputes a real supplier's on-time rate and rating from their delivered orders. */
  function refreshTrack(sid) {
    const s = store.data.suppliers.find(x => x.id === sid); if (!s) return;
    core.applyTrack(s, core.trackRecord(store.data.orders, sid)); syncSuppliers();
  }
  /** After an order action: cancelled orders reopen the request; records and emails follow. */
  function afterOrderChange(o, ev, actorId, who) {
    if (ev === "cancel" || ev === "cancel_quiet") {
      const rec = store.data.rfqs.find(r => r.id === o.rfqId);
      if (rec && rec.wonBy === o.sid) { rec.status = "open"; rec.wonBy = null; }
    }
    store.save();
    if (o.sample || ev === "cancel_quiet") return;
    if (["invoice", "pay_claimed", "pay_recorded", "payconfirm", "paynotreceived"].includes(ev)) { notify.moneyEvent(o, ev, actorId); return; }
    if (["deliver", "deliver_issue", "review", "cancel", "dispute", "resolve", "withdraw"].includes(ev)) refreshTrack(o.sid);
    if (["confirm", "dispatch", "transit", "deliver", "deliver_issue"].includes(ev)) whatsapp.notifyOrder(o);
    notify.orderEvent(o, ev, actorId, who, env.CONTACT_TO);
  }
  const findInvite = token => { for (const r of store.data.rfqs) { const i = (r.invites || []).find(x => x.token === token); if (i) return { r, i }; } return {}; };
  const unsubscribed = email => store.data.outreach.unsub.includes(String(email).toLowerCase());

  const routes = [
    ["GET", /^\/api\/health$/, () => ({ ok: true, app: "vyaparboss", ai: !!claude, provider: claude?.provider || null, model: claude?.model || null, whatsapp: whatsapp.configured, email: mailer.configured, ops: !!env.ADMIN_KEY, storage: sync ? sync.status.kind : "disk", saved: sync ? sync.status.lastSaved : null, storageError: sync ? sync.status.lastError : null })],
    ["GET", /^\/sitemap\.xml$/, (req, m, url, res) => {
      const pages = ["/", "/#join/s", "/#join/b", "/privacy.html", "/terms.html", "/contact.html"];
      res.writeHead(200, { "content-type": TYPES[".xml"], "cache-control": "public, max-age=3600" });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.filter(p => !p.includes("#")).map(p => `  <url><loc>${PUBLIC_URL}${p}</loc></url>`).join("\n")}\n</urlset>\n`);
    }],

    // ---------- Accounts ----------
    ["GET", /^\/api\/auth\/config$/, () => ({ ...auth.config(), emailOn: notify.on })],
    ["GET", /^\/api\/auth\/me$/, req => ({ user: auth.publicUser(auth.userOf(req)) })],
    ["POST", /^\/api\/auth\/signup$/, async (req, m, url, res) => {
      limit(req, "signup", 10, 36e5, "Too many sign-ups from here. Try again in an hour.");
      const b = await jsonBody(req);
      const { ok, a, errors } = core.normalizeAccount(b);
      if (!ok) throw bad(errors.join(". "));
      const nu = auth.signup(req, res, a, b.password);
      sendVerify(nu);
      return { user: auth.publicUser(nu) };
    }],
    ["POST", /^\/api\/auth\/login$/, async (req, m, url, res) => {
      limit(req, "login", 12, 15 * 6e4, "Too many tries. Wait 15 minutes, then try again.");
      const b = await jsonBody(req);
      return { user: auth.publicUser(auth.login(req, res, b.role === "supplier" ? "supplier" : "buyer", String(b.email || "").trim(), b.password)) };
    }],
    ["POST", /^\/api\/auth\/oauth$/, async (req, m, url, res) => {
      limit(req, "oauth", 20, 15 * 6e4);
      const b = await jsonBody(req);
      if (!["google", "apple", "facebook"].includes(b.provider)) throw bad("Unknown sign-in method");
      const { user, created } = await auth.oauth(req, res, b.provider, b.role === "supplier" ? "supplier" : "buyer", b);
      return { user: auth.publicUser(user), created };
    }],
    ["POST", /^\/api\/auth\/forgot$/, async req => {
      limit(req, "forgot", 5, 36e5, "Too many reset emails from here. Try again in an hour.");
      const { email } = await jsonBody(req);
      if (!core.isEmail(String(email || "").trim())) throw bad("Enter the email you signed up with");
      if (!notify.on) throw Object.assign(new Error("Password reset by email isn't switched on yet. Use the contact page and we'll help."), { status: 503 });
      const r = auth.startReset(email);
      if (r) await notify.passwordReset(r.user, `${PUBLIC_URL}/#reset/${r.token}`);
      return { ok: true }; // same answer whether or not the email has an account
    }],
    ["POST", /^\/api\/auth\/verify$/, async req => {
      limit(req, "verify", 20, 36e5);
      const u = auth.finishVerify((await jsonBody(req)).token);
      const me = auth.userOf(req);
      return { ok: true, user: me && me.id === u.id ? auth.publicUser(u) : null };
    }],
    ["POST", /^\/api\/auth\/verify\/resend$/, req => {
      limit(req, "verifyresend", 3, 36e5, "We've sent a few already. Check spam, or try again in an hour.");
      const u = needUser(req);
      if (u.emailVerified) return { ok: true, already: true };
      if (!notify.on) throw Object.assign(new Error("Email sending isn't switched on yet."), { status: 503 });
      if (!u.email) throw bad("Add an email to your account first");
      sendVerify(u); return { ok: true };
    }],
    ["POST", /^\/api\/auth\/reset$/, async (req, m, url, res) => {
      limit(req, "reset", 10, 36e5);
      const b = await jsonBody(req);
      return { user: auth.publicUser(auth.finishReset(req, res, b.token, b.password)) };
    }],
    ["POST", /^\/api\/auth\/password$/, async req => {
      limit(req, "password", 10, 15 * 6e4);
      const u = needUser(req); const b = await jsonBody(req);
      auth.changePassword(u, b.current, b.password); return { user: auth.publicUser(u) };
    }],
    ["DELETE", /^\/api\/auth\/me$/, async (req, m, url, res) => {
      const u = needUser(req); const b = await jsonBody(req);
      if (b.confirm !== "DELETE") throw bad("Type DELETE to confirm");
      auth.deleteUser(req, res, u); syncSuppliers(); return { ok: true };
    }],
    // Contact form (also used by the static pages on GitHub Pages). Stored for the team; never shown publicly.
    ["POST", /^\/api\/contact$/, async req => {
      limit(req, "contact", 5, 36e5, "Too many messages from here. Try again in an hour.");
      const b = await jsonBody(req);
      const msg = { id: "M" + Date.now().toString(36), at: Date.now(), name: String(b.name || "").trim().slice(0, 80), email: String(b.email || "").trim().toLowerCase().slice(0, 120),
        topic: ["general", "privacy", "delete", "supplier", "buyer"].includes(b.topic) ? b.topic : "general", text: String(b.text || "").trim().slice(0, 2000) };
      if (!core.isEmail(msg.email)) throw bad("Enter an email so we can reply");
      if (msg.text.length < 5) throw bad("Write a short message");
      if (b.website) return { ok: true }; // honeypot: bots fill every field
      store.data.messages = store.data.messages.concat(msg).slice(-500); store.save();
      if (mailer.configured && env.CONTACT_TO) mailer.send({ to: env.CONTACT_TO, subject: `[VyaparBoss ${msg.topic}] ${msg.name || msg.email}`, text: `${msg.text}\n\nFrom: ${msg.name} <${msg.email}>` }).catch(e => console.warn("contact mail:", e.message));
      return { ok: true };
    }],
    // What's switched on, for the Team → Setup checklist. Says whether keys are set, never their values.
    ["GET", /^\/api\/admin\/setup$/, req => {
      admin(req);
      const users = (store.data.users || []).filter(u => !u.guest);
      const real = store.data.orders.filter(o => !o.sample);
      return {
        publicUrl: PUBLIC_URL,
        storage: { kind: sync ? sync.status.kind : "disk", lastSaved: sync ? sync.status.lastSaved : null, error: sync ? sync.status.lastError : null, dataFile: !!env.DATA_FILE && env.DATA_FILE !== "./data/db.json" },
        admin: true,
        email: { on: mailer.configured, provider: mailer.provider, from: mailer.from, contactTo: !!env.CONTACT_TO },
        signIn: { email: true, google: !!auth.providers.google, apple: !!auth.providers.apple, facebook: !!auth.providers.facebook },
        ai: claude ? `${claude.provider} (${claude.model})` : null,
        whatsapp: whatsapp.configured,
        payments: razorpay ? { on: true, test: razorpay.test, webhook: razorpay.webhookOn } : { on: false },
        fees: store.data.fees,
        counts: { buyers: users.filter(u => u.role === "buyer").length, suppliers: users.filter(u => u.role === "supplier").length,
          verifiedEmails: users.filter(u => u.emailVerified).length, listings: store.data.suppliers.filter(x => x.selfListed).length,
          verifiedListings: store.data.suppliers.filter(x => x.verified).length, requests: store.data.rfqs.filter(r => !r.sample).length, orders: real.length,
          samplesShown: !!store.data.useSamples, messages: (store.data.messages || []).length, signups: store.data.applications.length },
      };
    }],
    // Team → Ops: the numbers that say whether the marketplace works, and what needs a person today.
    ["GET", /^\/api\/admin\/ops$/, req => { admin(req); return opsReport(); }],
    ["GET", /^\/api\/admin\/messages$/, req => (admin(req), { messages: store.data.messages.slice().reverse() })],
    ["POST", /^\/api\/auth\/logout$/, (req, m, url, res) => { auth.endSession(req, res); store.save(); return { ok: true }; }],
    ["PATCH", /^\/api\/auth\/me$/, async req => {
      const u = needUser(req); const b = await jsonBody(req);
      const { ok, a, errors } = core.normalizeAccount({ ...auth.publicUser(u), ...b, role: u.role, email: u.email || b.email });
      if (!ok) throw bad(errors.join(". "));
      Object.assign(u, { name: a.name, business: a.business, phone: a.phone, city: a.city });
      if (typeof b.notify === "boolean") u.notify = b.notify;
      if ("budgetMonthly" in b && u.role === "buyer" && !u.orgOwner) { const v = Math.round(Number(b.budgetMonthly)); u.budgetMonthly = v > 0 ? v : null; }
      if ("gstin" in b) { const g = String(b.gstin || "").trim().toUpperCase(); if (g && !core.checkGstin(g).ok) throw bad(core.checkGstin(g).why); u.gstin = g; }
      if ("address" in b) u.address = String(b.address || "").trim().slice(0, 300);
      if (!u.email && a.email) u.email = a.email;
      store.save(); return { user: auth.publicUser(u) };
    }],

    // ---------- Supplier accounts: own listing and quotes ----------
    ["PUT", /^\/api\/my\/listing$/, async req => {
      const u = needUser(req, "supplier"); const input = await jsonBody(req);
      const prev = u.supplierId && store.data.suppliers.find(s => s.id === u.supplierId);
      const { ok, s, errors } = core.normalizeSupplier({ ...input, id: prev ? prev.id : null, createdAt: prev?.createdAt, onTime: prev?.onTime, rating: prev?.rating });
      if (!ok) throw bad(errors.join(". "));
      s.id ||= "c" + Date.now().toString(36);
      Object.assign(s, { orders: prev?.orders || 0, ownerId: u.id, selfListed: true, verified: !!prev?.verified });
      if (prev?.track) Object.assign(s, { track: prev.track, onTime: prev.onTime, rating: prev.rating }); // earned, not editable
      if (prev) Object.assign(s, { feeAgreed: !!prev.feeAgreed, feeRate: prev.feeRate ?? null });
      store.data.suppliers = store.data.suppliers.filter(x => x.id !== s.id).concat(plainJ(s));
      u.supplierId = s.id; store.save(); syncSuppliers();
      const { ownerId, ...pub } = s; return { ...plainJ(pub), mine: true };
    }],
    ["POST", /^\/api\/my\/quotes$/, async req => {
      const u = needUser(req, "supplier"); const b = await jsonBody(req);
      const r = store.data.rfqs.find(x => x.id === b.rfqId);
      if (!r || !u.supplierId || !r.quotes.some(q => q.sid === u.supplierId)) throw notFound("Request");
      if (r.status === "ordered") throw Object.assign(new Error("This request is already closed."), { status: 409 });
      const sup = core.getSMAP()[u.supplierId], o = sup?.offers.find(x => x.p === r.productId);
      const { ok, q, errors } = core.normalizeLiveQuote(b, o ? core.tierPrice(o, r.qty) : null);
      if (!ok) throw bad(errors.join(". "));
      r.invites ||= [];
      let i = r.invites.find(x => x.sid === u.supplierId);
      if (!i) { i = { sid: u.supplierId, sname: sup?.name || "", token: crypto.randomBytes(12).toString("base64url"), at: Date.now(), via: "app" }; r.invites.push(i); }
      i.quote = q; store.save(); notify.quoteReceived(r, u.supplierId); return { ok: true, quote: q };
    }],

    // ---------- Public: sign-up and supplier quote links ----------
    ["POST", /^\/api\/join$/, async req => {
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      const hour = Date.now() - 36e5, hits = (joinHits.get(ip) || []).filter(t => t > hour);
      if (hits.length >= 8) throw Object.assign(new Error("Too many sign-ups from here. Try again in an hour."), { status: 429 });
      joinHits.set(ip, hits.concat(Date.now()));
      const body = await jsonBody(req);
      if (body.company_site) return { ok: true }; // honeypot: bots fill every field
      const { ok, a, errors } = core.normalizeJoin(body);
      if (!ok) throw bad(errors.join(". "));
      const app = { ...a, id: "A" + String(++store.data.seq.app).padStart(4, "0"), at: Date.now(), status: "new" };
      store.data.applications.unshift(app);
      const lead = a.ref && store.data.leads.find(l => l.id === a.ref);
      if (lead) lead.status = "joined";
      store.save();
      console.log(`New ${a.role} sign-up ${app.id} from ${a.city}`);
      return { ok: true, id: app.id };
    }],
    ["GET", /^\/api\/quote\/([\w-]{16,})$/, (req, m) => {
      const { r, i } = findInvite(m[1]); if (!r) throw notFound("Quote request");
      const s = core.getSMAP()[i.sid], p = core.PMAP[r.productId];
      const o = s?.offers.find(x => x.p === r.productId);
      return { rfq: { id: r.id, product: p.name, spec: p.spec, unit: p.unit, gst: p.gst, qty: r.qty, city: r.city, deadline: r.deadline, date: r.date, open: r.status !== "ordered" },
        supplier: { name: s?.name || i.sname, city: s?.city || "" }, rateCard: o ? core.tierPrice(o, r.qty) : null, quote: i.quote || null };
    }],
    ["POST", /^\/api\/quote\/([\w-]{16,})$/, async (req, m) => {
      limit(req, "quote", 30, 36e5);
      const { r, i } = findInvite(m[1]); if (!r) throw notFound("Quote request");
      if (r.status === "ordered") throw Object.assign(new Error("This request is already closed. Thank you!"), { status: 409 });
      const s = core.getSMAP()[i.sid], o = s?.offers.find(x => x.p === r.productId);
      const { ok, q, errors } = core.normalizeLiveQuote(await jsonBody(req), o ? core.tierPrice(o, r.qty) : null);
      if (!ok) throw bad(errors.join(". "));
      i.quote = q; store.save(); notify.quoteReceived(r, i.sid); return { ok: true, quote: q };
    }],
    // Someone opened their personal sign-up link from an outreach email or WhatsApp. Counts only; no personal data.
    ["POST", /^\/api\/track$/, async req => {
      limit(req, "track", 60, 36e5);
      const { ev, ref } = await jsonBody(req);
      if (ev !== "join_view") throw bad("Unknown event");
      const lead = ref && store.data.leads.find(l => l.id === String(ref));
      if (lead) { lead.views = (lead.views || 0) + 1; lead.lastViewed = Date.now(); store.save(); }
      return { ok: true };
    }],
    ["GET", /^\/unsubscribe$/, (req, m, url, res) => unsubscribePage(url, res)],
    ["POST", /^\/unsubscribe$/, (req, m, url, res) => unsubscribePage(url, res)],

    // ---------- Ops (admin key) ----------
    ["GET", /^\/api\/admin\/check$/, req => { admin(req); return { ok: true, email: mailer.configured, from: mailer.from, cap: DAILY_CAP, publicUrl: PUBLIC_URL }; }],
    // Backups: the free Render plan wipes data on every redeploy. Download before, restore after.
    ["GET", /^\/api\/admin\/backup$/, (req, m, url, res) => {
      admin(req);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
        "content-disposition": `attachment; filename="vyaparboss-backup-${new Date().toISOString().slice(0, 10)}.json"` });
      res.end(JSON.stringify({ app: "vyaparboss", version: 1, at: Date.now(), data: store.data }));
    }],
    ["POST", /^\/api\/admin\/restore$/, async req => {
      admin(req);
      const raw = await readBody(req, 2e7);
      let b; try { b = JSON.parse(raw); } catch { throw bad("That isn't a VyaparBoss backup file"); }
      const d = b && b.app === "vyaparboss" && b.data;
      const lists = ["orders", "rfqs", "suppliers", "applications", "leads"];
      if (!d || !d.seq || lists.some(k => k in d && !Array.isArray(d[k]))) throw bad("That isn't a VyaparBoss backup file");
      store.data = d;
      store.data.suppliers ||= []; store.data.applications ||= []; store.data.leads ||= [];
      store.data.outreach ||= { settings: {}, log: [], unsub: [] }; store.data.whatsapp ||= { sessions: {}, log: [] };
      store.data.seq.lead ??= store.data.leads.length; store.data.seq.app ??= store.data.applications.length;
      store.save(); syncSuppliers();
      return { ok: true, orders: d.orders?.length || 0, suppliers: d.suppliers.length, applications: d.applications.length, leads: d.leads.length };
    }],
    ["GET", /^\/api\/admin\/applications$/, req => { admin(req); return { applications: store.data.applications }; }],
    ["PATCH", /^\/api\/admin\/applications\/(.+)$/, async (req, m) => {
      admin(req); const a = store.data.applications.find(x => x.id === m[1]); if (!a) throw notFound("Sign-up");
      const p = await jsonBody(req);
      if (["new", "contacted", "onboarded", "rejected"].includes(p.status)) a.status = p.status;
      if ("note" in p) a.note = String(p.note || "").slice(0, 300);
      if (p.supplierId) a.supplierId = String(p.supplierId).slice(0, 40);
      store.save(); return a;
    }],
    ["POST", /^\/api\/admin\/rfqs\/(.+)\/invites$/, async (req, m) => {
      admin(req); const r = store.data.rfqs.find(x => x.id === m[1]); if (!r) throw notFound("RFQ");
      const { sids } = await jsonBody(req); const smap = core.getSMAP();
      r.invites ||= [];
      for (const sid of Array.isArray(sids) ? sids.slice(0, 20) : []) {
        const s = smap[sid]; if (!s || s.sample || r.invites.some(i => i.sid === sid)) continue;
        r.invites.push({ sid, sname: s.name, token: crypto.randomBytes(12).toString("base64url"), at: Date.now(), quote: null });
      }
      store.save();
      return { invites: r.invites.map(i => ({ ...i, url: `${PUBLIC_URL}/#quote/${i.token}`, contact: smap[i.sid]?.contact || "" })) };
    }],
    ["GET", /^\/api\/admin\/rfqs\/(.+)\/invites$/, (req, m) => {
      admin(req); const r = store.data.rfqs.find(x => x.id === m[1]); if (!r) throw notFound("RFQ");
      const smap = core.getSMAP();
      return { invites: (r.invites || []).map(i => ({ ...i, url: `${PUBLIC_URL}/#quote/${i.token}`, contact: smap[i.sid]?.contact || "" })) };
    }],
    ["GET", /^\/api\/admin\/leads$/, req => { admin(req); return { leads: store.data.leads, outreach: { settings: store.data.outreach.settings, sentToday: sentSince(864e5), cap: DAILY_CAP, email: mailer.configured, from: mailer.from, publicUrl: PUBLIC_URL } }; }],
    ["POST", /^\/api\/admin\/leads$/, async req => {
      admin(req); const { leads } = await jsonBody(req);
      if (!Array.isArray(leads)) throw bad("leads must be a list");
      const { added, skipped } = core.mergeLeads(store.data.leads, leads.slice(0, 2000));
      for (const l of added) { l.id = "L" + String(++store.data.seq.lead).padStart(4, "0"); if (l.email && unsubscribed(l.email)) l.status = "unsubscribed"; }
      store.data.leads.push(...JSON.parse(JSON.stringify(added))); store.save();
      return { added: added.length, skipped: skipped.length, total: store.data.leads.length };
    }],
    ["PATCH", /^\/api\/admin\/leads\/(.+)$/, async (req, m) => {
      admin(req); const l = store.data.leads.find(x => x.id === m[1]); if (!l) throw notFound("Lead");
      const p = await jsonBody(req);
      if (core.LEAD_STATUSES.includes(p.status)) l.status = p.status;
      if (p.contacted) { l.lastContacted = Date.now(); if (l.status === "new") l.status = "contacted"; }
      // Sent outside the app (mail merge): record it so the follow-up call comes up on time.
      if (p.emailed) { l.lastEmailed = Date.now(); if (["new", "contacted"].includes(l.status)) l.status = "emailed"; l.sends = (l.sends || []).concat({ t: String(p.template || "manual").slice(0, 40), at: Date.now() }).slice(-10); }
      if ("notes" in p) l.notes = String(p.notes || "").slice(0, 1000);
      if ("email" in p) { const e = String(p.email || "").trim().toLowerCase(); if (e && !core.isEmail(e)) throw bad("Invalid email"); l.email = e; }
      store.save(); return l;
    }],
    ["DELETE", /^\/api\/admin\/leads\/(.+)$/, (req, m) => { admin(req); store.data.leads = store.data.leads.filter(l => l.id !== m[1]); store.save(); return { ok: true }; }],
    ["PUT", /^\/api\/admin\/outreach\/settings$/, async req => {
      admin(req); const p = await jsonBody(req), st = store.data.outreach.settings;
      for (const k of ["senderName", "senderAddress"]) if (k in p) st[k] = String(p[k] || "").trim().slice(0, 200);
      store.save(); return st;
    }],
    ["POST", /^\/api\/admin\/outreach$/, async req => {
      admin(req); const { leadIds, templateId, send } = await jsonBody(req);
      if (!core.OUTREACH_TEMPLATES.some(t => t.id === templateId)) throw bad("Unknown template");
      const st = store.data.outreach.settings;
      if (send && (!st.senderName || !st.senderAddress)) throw bad("Add your name and business address first; every outreach email must show who sent it");
      const ids = new Set(Array.isArray(leadIds) ? leadIds : []);
      const leads = store.data.leads.filter(l => ids.has(l.id));
      const ctx = { senderName: st.senderName, senderAddress: st.senderAddress, joinBase: PUBLIC_URL + "/", unsubLink: l => l.email ? unsubUrl(l.email) : "" };
      let room = DAILY_CAP - sentSince(864e5);
      const out = []; let sent = 0;
      for (const l of leads) {
        const mail = core.renderOutreach(templateId, l, ctx);
        const skip = !l.email ? "No email" : unsubscribed(l.email) || l.status === "unsubscribed" ? "Unsubscribed"
          : ["bounced", "not_interested", "joined"].includes(l.status) ? `Marked ${l.status.replace("_", " ")}`
          : (l.sends || []).some(s => s.t === templateId) ? "Already got this email"
          : l.lastEmailed && Date.now() - l.lastEmailed < 3 * 864e5 ? "Emailed in the last 3 days" : null;
        const row = { id: l.id, business: l.business, to: l.email, subject: mail.subject, text: mail.text, skip };
        if (send && !skip) {
          if (room <= 0) row.skip = `Daily limit of ${DAILY_CAP} reached`;
          else {
            try {
              await mailer.send({ to: l.email, subject: mail.subject, text: mail.text, unsubUrl: unsubUrl(l.email) });
              room--; sent++; row.sent = true;
              l.status = l.status === "new" ? "emailed" : l.status; l.lastEmailed = Date.now();
              l.sends = (l.sends || []).concat({ t: templateId, at: Date.now() }).slice(-10);
              store.data.outreach.log.push({ at: Date.now(), lead: l.id, t: templateId });
            } catch (e) { row.skip = e.message; if (e.status === 503) { store.save(); throw e; } }
          }
        }
        out.push(row);
      }
      store.data.outreach.log = store.data.outreach.log.slice(-5000);
      store.save();
      return { previews: out, sent, remaining: Math.max(0, room), cap: DAILY_CAP };
    }],
    ["GET", /^\/api\/state$/, req => { if (Date.now() - lastScheduleRun > 6e4) runSchedules(); return stateFor(req); }],

    // ---------- Repeat orders ----------
    ["POST", /^\/api\/schedules$/, async req => {
      const u = needUser(req, "buyer");
      if (store.data.schedules.filter(x => x.orgId === auth.orgOf(u)).length >= 30) throw bad("You have 30 repeat orders already. Remove one first.");
      const { ok, s, errors } = core.normalizeSchedule(await jsonBody(req)); if (!ok) throw bad(errors.join(". "));
      const sc = { ...plainJ(s), id: "REP-" + String(++store.data.seq.sched).padStart(4, "0"), ownerId: u.id, orgId: auth.orgOf(u), active: true, createdAt: Date.now(), runs: 0 };
      store.data.schedules.push(sc); store.save(); return sc;
    }],
    ["PATCH", /^\/api\/schedules\/(.+)$/, async (req, m) => {
      const u = needUser(req, "buyer"); const sc = store.data.schedules.find(x => x.id === m[1] && x.orgId === auth.orgOf(u)); if (!sc) throw notFound("Repeat order");
      const p = await jsonBody(req);
      if ("active" in p) { sc.active = !!p.active; if (sc.active && sc.nextAt < Date.now()) sc.nextAt = core.nextRun(Date.now(), sc.every); }
      if (["qty", "every", "deadline", "city", "note", "start"].some(k => k in p)) {
        const { ok, s, errors } = core.normalizeSchedule({ ...sc, ...p, start: p.start || new Date(sc.nextAt).toISOString().slice(0, 10) }); if (!ok) throw bad(errors.join(". "));
        Object.assign(sc, plainJ(s));
      }
      store.save(); return sc;
    }],
    ["DELETE", /^\/api\/schedules\/(.+)$/, (req, m) => {
      const u = needUser(req, "buyer"); const n = store.data.schedules.length;
      store.data.schedules = store.data.schedules.filter(x => !(x.id === m[1] && x.orgId === auth.orgOf(u)));
      if (n === store.data.schedules.length) throw notFound("Repeat order");
      store.save(); return { ok: true };
    }],

    // ---------- Buyer teams: members, approval limits, invites ----------
    ["GET", /^\/api\/org$/, req => {
      const u = needUser(req, "buyer");
      if (u.orgOwner) return { member: true };
      return { member: false, budget: u.budgetMonthly || null, spent: core.monthSpend(store.data.orders.filter(o => o.orgId === u.id || (!o.orgId && o.ownerId === u.id))),
        members: store.data.users.filter(x => x.orgOwner === u.id).map(x => ({ id: x.id, name: x.name, email: x.email, limit: x.memberLimit ?? null })),
        invites: store.data.orgInvites.filter(i => i.orgId === u.id && i.exp > Date.now()).map(({ h, ...i }) => i),
        pending: store.data.orders.filter(o => o.orgId === u.id && o.approval?.status === "pending").length };
    }],
    ["POST", /^\/api\/org\/invites$/, async req => {
      const u = needUser(req, "buyer"); if (u.orgOwner) throw Object.assign(new Error("Only the account owner invites people"), { status: 403 });
      limit(req, "orginvite", 20, 36e5);
      const b = await jsonBody(req); const email = String(b.email || "").trim().toLowerCase();
      if (!core.isEmail(email)) throw bad("Enter their email");
      if (email === u.email) throw bad("That's your own email");
      const lim = b.limit === "" || b.limit == null ? null : Math.round(Number(b.limit));
      if (lim != null && !(lim >= 0)) throw bad("Approval limit must be a positive amount, or empty for no limit");
      if (store.data.orgInvites.filter(i => i.orgId === u.id && i.exp > Date.now()).length >= 20) throw bad("Too many open invites. Remove some first.");
      const token = crypto.randomBytes(18).toString("base64url");
      const inv = { id: "INV" + Date.now().toString(36), h: crypto.createHash("sha256").update(token).digest("hex"), orgId: u.id, email, limit: lim, exp: Date.now() + 14 * 864e5, createdAt: Date.now() };
      store.data.orgInvites.push(inv); store.save();
      const link = `${PUBLIC_URL}/#team-invite/${token}`;
      notify.teamInvite(email, u, link, lim);
      return { ok: true, link, emailed: notify.on, invite: { ...inv, h: undefined } };
    }],
    ["DELETE", /^\/api\/org\/invites\/(.+)$/, (req, m) => {
      const u = needUser(req, "buyer"); store.data.orgInvites = store.data.orgInvites.filter(i => !(i.id === m[1] && i.orgId === u.id)); store.save(); return { ok: true };
    }],
    ["POST", /^\/api\/org\/join$/, async req => {
      const u = needUser(req); limit(req, "orgjoin", 20, 36e5);
      const h = crypto.createHash("sha256").update(String((await jsonBody(req)).token || "")).digest("hex");
      const inv = store.data.orgInvites.find(i => i.h === h && i.exp > Date.now());
      if (!inv) throw bad("This invite has expired or was already used. Ask for a new one.");
      if (u.role !== "buyer") throw Object.assign(new Error("Team invites are for buyer accounts. Log in or sign up as a buyer."), { status: 403 });
      if (inv.orgId === u.id) throw bad("That's your own team");
      if (store.data.users.some(x => x.orgOwner === u.id)) throw bad("You already have your own team. Remove its members first.");
      Object.assign(u, { orgOwner: inv.orgId, memberLimit: inv.limit });
      store.data.orgInvites = store.data.orgInvites.filter(i => i !== inv); store.save();
      return { user: auth.publicUser(u) };
    }],
    ["PATCH", /^\/api\/org\/members\/(.+)$/, async (req, m) => {
      const u = needUser(req, "buyer"); const mem = store.data.users.find(x => x.id === m[1] && x.orgOwner === u.id); if (!mem) throw notFound("Member");
      const b = await jsonBody(req); const lim = b.limit === "" || b.limit == null ? null : Math.round(Number(b.limit));
      if (lim != null && !(lim >= 0)) throw bad("Approval limit must be a positive amount, or empty for no limit");
      mem.memberLimit = lim; store.save(); return { ok: true };
    }],
    ["DELETE", /^\/api\/org\/members\/(.+)$/, (req, m) => {
      const u = needUser(req, "buyer"), id = m[1];
      const mem = store.data.users.find(x => x.id === id && (x.orgOwner === u.id || (x.id === u.id && u.orgOwner))); if (!mem) throw notFound("Member");
      delete mem.orgOwner; delete mem.memberLimit; store.save(); return { ok: true };
    }],

    ["POST", /^\/api\/rfqs$/, async (req, m, url, res) => {
      const body = await jsonBody(req);
      const u = auth.ensureUser(req, res);
      if (u.role === "supplier") throw Object.assign(new Error("Supplier accounts can't place buy requests. Log in as a buyer."), { status: 403 });
      const { scheduleId, orgId, ...clean } = body;
      const rec = ctx.services.createRfq({ ...clean, ownerId: u.id, orgId: auth.orgOf(u) });
      notify.newRequest(rec); return rec;
    }],
    ["PATCH", /^\/api\/rfqs\/(.+)$/, async (req, m) => {
      const rec = store.data.rfqs.find(r => r.id === m[1]); if (!rec) throw notFound("RFQ");
      const u = auth.userOf(req);
      if (!isAdmin(req) && !sameOrg(u, rec)) throw notFound("RFQ");
      const p = await jsonBody(req);
      for (const k of ["productId", "qty", "city", "deadline", "quotes", "status", "wonBy"]) if (k in p) rec[k] = p[k];
      notify.newRequest(rec); store.save(); return rec;
    }],

    ["POST", /^\/api\/orders$/, async (req, m, url, res) => {
      const { order, rfqPatch } = await jsonBody(req);
      if (!order?.productId || !order?.sid) throw bad("Order needs productId and sid");
      const u = auth.ensureUser(req, res);
      if (u.role === "supplier") throw Object.assign(new Error("Supplier accounts can't place orders. Log in as a buyer."), { status: 403 });
      const rec = order.rfqId && store.data.rfqs.find(r => r.id === order.rfqId);
      if (isAdmin(req)) { const o = ctx.services.createOrder({ ...order, ownerId: order.ownerId || u.id }, rfqPatch); if (!o.sample) notify.orderPlaced(o); return o; }
      // Buyers can't set prices: rebuild the order from their own request and the supplier's rates or own quote.
      if (!rec || !sameOrg(u, rec)) throw bad("Place orders from one of your own requests");
      if (rec.status === "ordered") throw Object.assign(new Error("This request already has an order"), { status: 409 });
      const r = { productId: rec.productId, qty: rec.qty, city: rec.city, deadline: rec.deadline || null, id: rec.id };
      const live = core.liveMap(rec), base = core.discover(r, {}, live), q0 = base.eligible.find(x => x.s.id === order.sid);
      if (!q0) throw bad("That supplier can't take this order");
      // A negotiated price is kept only if it's within the supplier's own discount limit.
      const floor = +(q0.list * (1 - (q0.s.maxDisc ?? 0.03))).toFixed(2);
      const asked = Number(order.unit);
      const neg = asked > 0 && asked < q0.list ? { [order.sid]: { price: Math.max(floor, asked) } } : {};
      const qres = core.discover(r, neg, live), q = qres.eligible.find(x => x.s.id === order.sid);
      const clean = plainJ(core.orderRecord(r, qres, q, { ownerId: u.id, orgId: rec.orgId || auth.orgOf(u), source: rec.source === "schedule" ? "schedule" : "web" }));
      // Team members: orders above their limit, or past the monthly budget, wait for the account owner.
      // Bill-to details for the supplier's tax invoice: the team's business (owner's details for members). No email or phone.
      const biz = (u.orgOwner && store.data.users.find(x => x.id === u.orgOwner)) || u;
      clean.billTo = { business: biz.business || "", gstin: biz.gstin || "", address: biz.address || "", city: rec.city };
      const supRec = store.data.suppliers.find(x => x.id === clean.sid);
      if (supRec?.feeAgreed) { const rate = supRec.feeRate ?? store.data.fees.rate; clean.fee = { rate, amount: Math.round(clean.subtotal * rate), status: "due" }; }
      const why = approvalNeeded(u, clean);
      if (why) clean.approval = { status: "pending", by: u.id, name: u.name || "", why, at: Date.now() };
      const placed = ctx.services.createOrder(clean, { status: "ordered", wonBy: q.s.id, quotes: plainJ(core.quoteSummary(qres)) });
      if (why) notify.approvalNeeded(placed, store.data.users.find(x => x.id === u.orgOwner), u);
      else notify.orderPlaced(placed);
      const { fee, ...forBuyer } = placed; return forBuyer;
    }],
    // Orders move by named actions; applyOrderAction (engine.js) decides who may do what.
    // The older {stage, history, issue} patch is kept for the team and the example orders.
    ["PATCH", /^\/api\/orders\/(.+)$/, async (req, m) => {
      const o = store.data.orders.find(x => x.po === m[1]); if (!o) throw notFound("Order");
      if (!o.sample && !canTouchOrder(req, o)) throw notFound("Order");
      const p = await jsonBody(req), u = auth.userOf(req), team = isAdmin(req);
      if (p.action === "approve" || p.action === "reject") {
        if (o.approval?.status !== "pending") throw Object.assign(new Error("This order isn't waiting for approval"), { status: 409 });
        if (!team && !(u && !u.orgOwner && auth.orgOf(u) === o.orgId)) throw Object.assign(new Error("Only the account owner approves team orders"), { status: 403 });
        const now = Date.now();
        Object.assign(o.approval, { status: p.action === "approve" ? "approved" : "rejected", decidedBy: u?.id || "team", decidedAt: now, note: String(p.note || "").slice(0, 200) });
        if (p.action === "approve") { o.promisedBy = now + o.eta * 864e5; o.history = [now]; store.save(); notify.orderPlaced(o); }
        else { o.cancelled = { by: "buyer", reason: "Not approved" + (o.approval.note ? `: ${o.approval.note}` : ""), at: now }; afterOrderChange(o, "cancel_quiet", u?.id, "buyer"); }
        notify.approvalDecided(o, store.data.users.find(x => x.id === o.approval.by));
        store.save(); return o;
      }
      if (p.action) {
        const who = team ? "team" : o.sample ? (u?.role === "supplier" ? "supplier" : String(p.as) === "supplier" ? "supplier" : "buyer")
          : sameOrg(u, o) ? "buyer" : "supplier";
        const r = core.applyOrderAction(o, p, who);
        if (r.error) throw Object.assign(new Error(r.error), { status: 409 });
        afterOrderChange(o, r.ev, u?.id, who);
        if (who === "supplier") { const { ownerId, ...rest } = o; return rest; } // suppliers never learn who the buyer is
        return o;
      }
      if (!team && !o.sample) throw bad("Use an action to update this order");
      const before = [o.stage, o.issue];
      if ("stage" in p) { const s = Math.round(p.stage); if (s < 0 || s > 4) throw bad("stage must be 0–4"); o.stage = s; }
      if (Array.isArray(p.history)) o.history = p.history.slice(0, 5);
      if ("issue" in p) o.issue = p.issue ? String(p.issue).slice(0, 200) : null;
      store.save();
      if (o.stage !== before[0] || (o.issue && o.issue !== before[1])) { whatsapp.notifyOrder(o); if (!o.sample) { refreshTrack(o.sid); notify.orderStage(o, u?.id); } }
      return o;
    }],
    // Online payment: a Razorpay link for what's still due on one order (buyer side).
    ["POST", /^\/api\/orders\/(.+)\/paylink$/, async (req, m) => {
      if (!razorpay) throw Object.assign(new Error("Online payment isn't switched on yet. Pay the supplier directly and record it here."), { status: 503 });
      const o = store.data.orders.find(x => x.po === m[1]); const u = auth.userOf(req);
      if (!o || !(isAdmin(req) || sameOrg(u, o))) throw notFound("Order");
      if (o.cancelled || o.approval?.status === "pending") throw Object.assign(new Error("This order can't be paid right now"), { status: 409 });
      limit(req, "paylink", 20, 36e5);
      // What's due, minus payments the buyer already recorded that the supplier hasn't confirmed yet: no paying twice.
      const due = Math.round(core.dueOf(o) - core.claimedOf(o)); if (due < 1) throw Object.assign(new Error("Nothing is due on this order (payments waiting for the supplier's confirmation count)"), { status: 409 });
      if (o.payLink && o.payLink.amount === due && o.payLink.at > Date.now() - 6 * 864e5) return o.payLink;
      const p = core.PMAP[o.productId];
      const link = await razorpay.createLink({ amount: due, po: o.po, description: `${o.po}: ${core.qfmt(o.qty)} ${p.unit} ${p.name} from ${o.sname}`, callbackUrl: `${PUBLIC_URL}/#orders` });
      o.payLink = { ...link, at: Date.now(), test: razorpay.test }; store.save(); return o.payLink;
    }],
    ["POST", /^\/webhooks\/razorpay$/, async (req, m, url, res) => {
      const raw = await readBody(req);
      if (!razorpay || !razorpay.verify(raw, req.headers["x-razorpay-signature"])) { send(res, 401, { error: "Bad signature" }); return; }
      const evId = String(req.headers["x-razorpay-event-id"] || "");
      if (evId && store.data.rzEvents.includes(evId)) return { ok: true, duplicate: true };
      let j; try { j = JSON.parse(raw); } catch { throw bad("Body must be JSON"); }
      if (j.event === "payment_link.paid") {
        const link = j.payload?.payment_link?.entity || {}, pay = j.payload?.payment?.entity || {};
        const o = store.data.orders.find(x => x.po === link.notes?.po);
        if (o && pay.id && !(o.payments || []).some(x => x.ref === pay.id)) {
          o.payments = (o.payments || []).concat({ id: "RZP" + pay.id, amount: (pay.amount || link.amount_paid || 0) / 100, method: "razorpay", ref: pay.id, at: Date.now(), by: "razorpay", status: "confirmed", settled: false, test: razorpay.test });
          if (o.payLink) o.payLink.paid = true;
          notify.moneyEvent(o, "pay_online", null);
        }
      }
      if (evId) store.data.rzEvents = store.data.rzEvents.concat(evId).slice(-500);
      store.save(); return { ok: true };
    }],
    // Team: VyaparBoss's fee per order, settling online payments to suppliers, fee terms per supplier.
    ["PATCH", /^\/api\/admin\/orders\/(.+)$/, async (req, m) => {
      admin(req); const o = store.data.orders.find(x => x.po === m[1]); if (!o) throw notFound("Order");
      const b = await jsonBody(req);
      if (b.fee && o.fee && ["due", "invoiced", "collected", "waived"].includes(b.fee.status)) o.fee.status = b.fee.status;
      if (b.settle) { const p = (o.payments || []).find(x => x.id === b.settle && x.method === "razorpay"); if (!p) throw notFound("Payment"); p.settled = Date.now(); }
      store.save(); return o;
    }],
    ["PUT", /^\/api\/admin\/fees$/, async req => {
      admin(req); const r = Number((await jsonBody(req)).ratePct);
      if (!(r >= 0 && r <= 10)) throw bad("Fee must be 0–10%");
      store.data.fees.rate = Math.round(r * 100) / 10000; store.save(); return store.data.fees;
    }],
    ["DELETE", /^\/api\/samples$/, req => {
      admin(req);
      store.data.orders = store.data.orders.filter(o => !o.sample);
      store.data.rfqs = store.data.rfqs.filter(r => !r.sample);
      store.save(); return { ok: true };
    }],

    // Team: manage the supplier network.
    ["PUT", /^\/api\/(?:admin\/)?suppliers\/(.+)$/, async (req, m) => {
      admin(req);
      const input = await jsonBody(req);
      const prev = store.data.suppliers.find(s => s.id === m[1]);
      const { ok, s, errors } = core.normalizeSupplier({ ...input, id: prev ? prev.id : null, createdAt: prev?.createdAt });
      if (!ok) throw bad(errors.join(". "));
      s.id ||= "c" + Date.now().toString(36);
      Object.assign(s, { orders: prev?.orders || 0, verified: "verified" in input ? !!input.verified : prev ? !!prev.verified : true });
      if (prev?.ownerId) Object.assign(s, { ownerId: prev.ownerId, selfListed: true });
      if (prev?.track) Object.assign(s, { track: prev.track, onTime: prev.onTime, rating: prev.rating });
      if (prev) Object.assign(s, { feeAgreed: !!prev.feeAgreed, feeRate: prev.feeRate ?? null });
      store.data.suppliers = store.data.suppliers.filter(x => x.id !== s.id).concat(plainJ(s));
      store.save(); syncSuppliers(); return s;
    }],
    ["PATCH", /^\/api\/admin\/suppliers\/(.+)$/, async (req, m) => {
      admin(req); const s = store.data.suppliers.find(x => x.id === m[1]); if (!s) throw notFound("Supplier");
      const p = await jsonBody(req); if ("verified" in p) s.verified = !!p.verified;
      if ("feeAgreed" in p) s.feeAgreed = !!p.feeAgreed;
      if ("feeRatePct" in p) { const r = p.feeRatePct === "" || p.feeRatePct == null ? null : Number(p.feeRatePct); if (r != null && !(r >= 0 && r <= 10)) throw bad("Fee must be 0–10%"); s.feeRate = r == null ? null : Math.round(r * 100) / 10000; }
      store.save(); syncSuppliers(); return s;
    }],
    ["DELETE", /^\/api\/(?:admin\/)?suppliers\/(.+)$/, (req, m) => {
      admin(req);
      store.data.suppliers = store.data.suppliers.filter(s => s.id !== m[1]);
      for (const u of store.data.users || []) if (u.supplierId === m[1]) u.supplierId = null;
      store.save(); syncSuppliers(); return { ok: true };
    }],
    ["PUT", /^\/api\/(?:admin\/)?settings$/, async req => {
      admin(req);
      const p = await jsonBody(req);
      if ("useSamples" in p) store.data.useSamples = !!p.useSamples;
      store.save(); syncSuppliers(); return { useSamples: store.data.useSamples };
    }],

    ["POST", /^\/api\/quotes$/, async req => {
      const r = await jsonBody(req);
      if (!core.PMAP[r.productId] || !core.CITIES[r.city] || !(r.qty > 0)) throw bad("Need productId, city and qty");
      const res = core.discover({ productId: r.productId, qty: Math.round(r.qty), city: r.city, deadline: r.deadline || null });
      return { quotes: res.eligible.map(q => ({ sid: q.s.id, supplier: q.s.name, city: q.s.city, unit: q.unit, subtotal: Math.round(q.subtotal), gst: Math.round(q.gst), freight: Math.round(q.freight), landed: Math.round(q.landed), eta: q.eta, meets: q.meets })),
        excluded: res.excluded.map(x => ({ sid: x.s.id, supplier: x.s.name, why: x.why })) };
    }],
    ["POST", /^\/api\/parse$/, async req => {
      const { text, partial, lang } = await jsonBody(req);
      if (!text || typeof text !== "string") throw bad("text is required");
      return ctx.services.parse(text, partial || null, lang === "en" ? "en" : "hi");
    }],
    ["POST", /^\/api\/draft$/, async req => {
      const { rfqId, sid } = await jsonBody(req);
      const r = store.data.rfqs.find(x => x.id === rfqId), s = core.getSMAP()[sid];
      const mine = r?.quotes.find(q => q.sid === sid);
      if (!r || !s || !mine) throw notFound("RFQ or supplier");
      const du = auth.userOf(req);
      if (!isAdmin(req) && !(du && du.role === "supplier" && du.supplierId === sid)) throw notFound("RFQ or supplier");
      if (!claude) throw Object.assign(new Error("AI drafting needs GEMINI_API_KEY or ANTHROPIC_API_KEY on the server"), { status: 503 });
      return { text: await claude.complete(core.buildReplyPrompt(r, s, mine), { maxTokens: 400 }) };
    }],

    ["GET", /^\/webhooks\/whatsapp$/, (req, m, url, res) => whatsapp.verify(url, res)],
    ["POST", /^\/webhooks\/whatsapp$/, async (req, m, url, res) => whatsapp.receive(await readBody(req), req.headers, res)],
    ["POST", /^\/api\/whatsapp\/simulate$/, async req => {
      admin(req);
      const { from, text } = await jsonBody(req);
      if (!text) throw bad("text is required");
      return { reply: await whatsapp.handleText(String(from || "919800000000"), String(text), { simulated: true }) };
    }],
    ["GET", /^\/api\/whatsapp\/log$/, req => (admin(req), { configured: whatsapp.configured, log: store.data.whatsapp.log.slice(-100) })],
  ];

  function sentSince(ms) { const t = Date.now() - ms; return store.data.outreach.log.filter(x => x.at > t).length; }
  function unsubscribePage(url, res) {
    const e = String(url.searchParams.get("e") || "").toLowerCase(), t = url.searchParams.get("t") || "";
    const ok = e && t === unsubSig(secret, e);
    if (ok && !unsubscribed(e)) {
      store.data.outreach.unsub.push(e);
      for (const l of store.data.leads) if (l.email === e) l.status = "unsubscribed";
      store.save();
    }
    res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VyaparBoss</title><body style="font:17px/1.5 system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#1E1F25;background:#FBF7EF"><h1 style="font-size:24px">${ok ? "You're unsubscribed" : "This link didn't work"}</h1><p>${ok ? "VyaparBoss won't email this address again. Sorry for the trouble." : "Reply to the email with \"unsubscribe\" and we'll remove you by hand."}</p><p style="color:#6b6b6b;font-size:14px">VyaparBoss, House of 24 Pvt. Ltd.</p></body>`);
  }

  // Static files: ETag + revalidation (no build hashes, so browsers always check), gzip for text, branded 404.
  const fileCache = new Map();
  function loadFile(file, cb) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return cb(err || new Error("not a file"));
      const hit = fileCache.get(file);
      if (hit && hit.mtime === st.mtimeMs) return cb(null, hit);
      fs.readFile(file, (err2, buf) => {
        if (err2) return cb(err2);
        const type = TYPES[path.extname(file)] || "application/octet-stream";
        const entry = { mtime: st.mtimeMs, buf, type, etag: `"${crypto.createHash("sha1").update(buf).digest("base64url").slice(0, 20)}"`, gz: ZIP.test(type) && buf.length > 1024 ? zlib.gzipSync(buf, { level: 9 }) : null };
        if (fileCache.size > 200) fileCache.clear();
        fileCache.set(file, entry); cb(null, entry);
      });
    });
  }
  function serveStatic(req, url, res) {
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(STATIC_DIR, rel));
    if (!file.startsWith(STATIC_DIR + path.sep)) { res.writeHead(403).end(); return; }
    loadFile(file, (err, f) => {
      if (err) return loadFile(path.join(STATIC_DIR, "404.html"), (e2, nf) => {
        if (e2) { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
        res.writeHead(404, { "content-type": nf.type, "cache-control": "no-cache" }); res.end(req.method === "HEAD" ? undefined : nf.buf);
      });
      const isImg = /^image\/(png|x-icon)/.test(f.type);
      const headers = { "content-type": f.type, etag: f.etag, "cache-control": isImg ? "public, max-age=86400" : "no-cache", vary: "accept-encoding" };
      if (req.headers["if-none-match"] === f.etag) { res.writeHead(304, headers).end(); return; }
      const gz = f.gz && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
      if (gz) headers["content-encoding"] = "gzip";
      const body = gz ? f.gz : f.buf;
      headers["content-length"] = body.length;
      res.writeHead(200, headers); res.end(req.method === "HEAD" ? undefined : body);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    res.setHeader("content-security-policy", CSP);
    if (String(req.headers["x-forwarded-proto"] || "").includes("https")) res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    // The static copy on GitHub Pages posts sign-ups and supplier quotes here.
    const origin = req.headers.origin;
    if (origin && ORIGINS.includes(origin) && /^\/api\/(join|quote\/|health|track|contact)/.test(url.pathname)) {
      res.setHeader("access-control-allow-origin", origin); res.setHeader("vary", "origin");
      if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" }).end(); return; }
    }
    const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
    if (!route) {
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/webhooks/")) return send(res, 404, { error: "No such endpoint" });
      if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, url, res);
      return send(res, 405, { error: "Method not allowed" });
    }
    try {
      const m = url.pathname.match(route[1]).map((x, i) => (i ? decodeURIComponent(x) : x));
      const out = await route[2](req, m, url, res);
      if (!res.headersSent && out !== undefined) send(res, 200, out);
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : "Server error" });
    }
  });
  return { server, store, ctx, mailer, sync, runSchedules };
}

function pickLLM(env) {
  const gKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (gKey) return createGemini({ apiKey: gKey, model: env.GEMINI_MODEL || "gemini-3.8-flash", fallbackModel: env.GEMINI_FALLBACK_MODEL ?? "gemini-3.7-flash" });
  if (env.ANTHROPIC_API_KEY) return createClaude({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || "claude-haiku-5-5" });
  return null;
}

function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }
function notFound(what) { return Object.assign(new Error(`${what} not found`), { status: 404 }); }

// Shared business actions (used by the REST API and by WhatsApp).
function makeServices({ core, store, claude }) {
  const plain = v => JSON.parse(JSON.stringify(v));
  return {
    async parse(text, partial, lang) {
      if (claude) {
        try {
          const p = core.cleanParsed(await claude.json(core.buildParsePrompt(text, partial, lang)));
          if (p) return { parsed: p, via: claude.provider || "AI" };
        } catch (e) { console.warn(`${claude.provider || "AI"} parse failed, using rules:`, e.message); }
      }
      return { parsed: plain(core.ruleParse(text)), via: "Rules" };
    },
    createRfq(input) {
      const rec = { ...input, id: core.rfqIdFor(++store.data.seq.rfq), date: input.date || Date.now(), status: "open", wonBy: null, invites: [] };
      if (!core.PMAP[rec.productId] || !core.CITIES[rec.city] || !(rec.qty > 0)) { store.data.seq.rfq--; throw bad("RFQ needs a known productId, city and qty"); }
      store.data.rfqs.unshift(rec); store.save(); return rec;
    },
    createOrder(order, rfqPatch) {
      const o = { ...order, po: core.poIdFor(++store.data.seq.po) };
      store.data.orders.unshift(o);
      const rec = store.data.rfqs.find(r => r.id === o.rfqId);
      if (rec && rfqPatch) for (const k of ["status", "wonBy", "quotes"]) if (k in rfqPatch) rec[k] = rfqPatch[k];
      const sup = store.data.suppliers.find(s => s.id === o.sid); if (sup) sup.orders = (sup.orders || 0) + 1;
      store.save(); return o;
    },
  };
}

if (require.main === module) {
  loadEnv();
  const port = Number(process.env.PORT) || 5173;
  (async () => {
    // With UPSTASH_* set, bring the saved database onto this (possibly fresh) disk before anything reads it.
    const remote = createRemote(process.env);
    const dataFile = process.env.DATA_FILE || path.join(ROOT, "data", "db.json");
    let pulled = null;
    if (remote) pulled = await pullSnapshot(remote, dataFile);
    const { ctx, server, store, sync } = createApp({ remote, dataFile });
    if (pulled === "empty") store.save(); // first run with remote storage: push what we have
    server.listen(port, () => {
      console.log(`VyaparBoss running at http://localhost:${port}`);
      console.log(`  AI parsing: ${ctx.claude ? `${ctx.claude.provider} (${ctx.claude.model})` : "rule parser (set GEMINI_API_KEY or ANTHROPIC_API_KEY in .env)"}`);
      console.log(`  WhatsApp:   ${process.env.WHATSAPP_TOKEN ? "configured" : "not configured (see docs/WHATSAPP_SETUP.md)"}`);
      console.log(`  Storage:    ${remote ? `disk + Upstash copy (${pulled})` : "disk only (data/db.json; set UPSTASH_REDIS_REST_URL to keep data across redeploys)"}`);
    });
    // Render sends SIGTERM before a redeploy: push the last changes, then exit.
    const stop = async () => { try { if (sync) await sync.flush(); } finally { process.exit(0); } };
    process.on("SIGTERM", stop); process.on("SIGINT", stop);
  })().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { createApp, loadEnv };
