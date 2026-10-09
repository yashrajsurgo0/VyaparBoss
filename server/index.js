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
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const STATIC_DIR = path.join(ROOT, "src");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

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
  ctx.services = makeServices(ctx);
  const mailer = createMailer(env, opts.fetch);
  const PUBLIC_URL = String(env.PUBLIC_URL || "https://vyaparboss.onrender.com").replace(/\/+$/, "");
  const ORIGINS = String(env.ALLOWED_ORIGINS || "https://yashrajsurgo0.github.io").split(",").map(s => s.trim()).filter(Boolean);
  const DAILY_CAP = Number(env.OUTREACH_DAILY_CAP) || 30;
  const secret = env.OUTREACH_SECRET || env.ADMIN_KEY || "";
  const unsubUrl = email => `${PUBLIC_URL}/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubSig(secret, email)}`;
  const joinHits = new Map();
  const whatsapp = createWhatsApp(ctx, { verifyToken: env.WHATSAPP_VERIFY_TOKEN, accessToken: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, appSecret: env.WHATSAPP_APP_SECRET, apiVersion: env.WHATSAPP_API_VERSION, send: opts.waSend });

  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = req => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > 1e6) { reject(Object.assign(new Error("Request too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
  const jsonBody = async req => { const raw = await readBody(req); if (!raw.length) return {}; try { return JSON.parse(raw); } catch { throw Object.assign(new Error("Body must be JSON"), { status: 400 }); } };

  // Ops-only routes need the ADMIN_KEY (sent as x-admin-key). Without one set, they stay closed.
  const admin = req => {
    if (!env.ADMIN_KEY) throw Object.assign(new Error("Set ADMIN_KEY on the server to use ops tools"), { status: 503 });
    const got = Buffer.from(String(req.headers["x-admin-key"] || "")), want = Buffer.from(String(env.ADMIN_KEY));
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw Object.assign(new Error("Admin key needed"), { status: 401 });
  };
  const findInvite = token => { for (const r of store.data.rfqs) { const i = (r.invites || []).find(x => x.token === token); if (i) return { r, i }; } return {}; };
  const unsubscribed = email => store.data.outreach.unsub.includes(String(email).toLowerCase());

  const routes = [
    ["GET", /^\/api\/health$/, () => ({ ok: true, app: "vyaparboss", ai: !!claude, provider: claude?.provider || null, model: claude?.model || null, whatsapp: whatsapp.configured, email: mailer.configured, ops: !!env.ADMIN_KEY })],

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
      const { r, i } = findInvite(m[1]); if (!r) throw notFound("Quote request");
      if (r.status === "ordered") throw Object.assign(new Error("This request is already closed. Thank you!"), { status: 409 });
      const s = core.getSMAP()[i.sid], o = s?.offers.find(x => x.p === r.productId);
      const { ok, q, errors } = core.normalizeLiveQuote(await jsonBody(req), o ? core.tierPrice(o, r.qty) : null);
      if (!ok) throw bad(errors.join(". "));
      i.quote = q; store.save(); return { ok: true, quote: q };
    }],
    ["GET", /^\/unsubscribe$/, (req, m, url, res) => unsubscribePage(url, res)],
    ["POST", /^\/unsubscribe$/, (req, m, url, res) => unsubscribePage(url, res)],

    // ---------- Ops (admin key) ----------
    ["GET", /^\/api\/admin\/check$/, req => { admin(req); return { ok: true, email: mailer.configured, from: mailer.from, cap: DAILY_CAP, publicUrl: PUBLIC_URL }; }],
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
    ["GET", /^\/api\/state$/, () => store.publicState()],

    ["POST", /^\/api\/rfqs$/, async req => ctx.services.createRfq(await jsonBody(req))],
    ["PATCH", /^\/api\/rfqs\/(.+)$/, async (req, m) => {
      const rec = store.data.rfqs.find(r => r.id === m[1]); if (!rec) throw notFound("RFQ");
      const p = await jsonBody(req);
      for (const k of ["productId", "qty", "city", "deadline", "quotes", "status", "wonBy"]) if (k in p) rec[k] = p[k];
      store.save(); return rec;
    }],

    ["POST", /^\/api\/orders$/, async req => {
      const { order, rfqPatch } = await jsonBody(req);
      if (!order?.productId || !order?.sid) throw bad("Order needs productId and sid");
      return ctx.services.createOrder(order, rfqPatch);
    }],
    ["PATCH", /^\/api\/orders\/(.+)$/, async (req, m) => {
      const o = store.data.orders.find(x => x.po === m[1]); if (!o) throw notFound("Order");
      const p = await jsonBody(req);
      const before = [o.stage, o.issue];
      if ("stage" in p) { const s = Math.round(p.stage); if (s < 0 || s > 4) throw bad("stage must be 0–4"); o.stage = s; }
      if (Array.isArray(p.history)) o.history = p.history.slice(0, 5);
      if ("issue" in p) o.issue = p.issue ? String(p.issue).slice(0, 200) : null;
      store.save();
      if (o.stage !== before[0] || (o.issue && o.issue !== before[1])) whatsapp.notifyOrder(o);
      return o;
    }],
    ["DELETE", /^\/api\/samples$/, () => {
      store.data.orders = store.data.orders.filter(o => !o.sample);
      store.data.rfqs = store.data.rfqs.filter(r => !r.sample);
      store.save(); return { ok: true };
    }],

    ["PUT", /^\/api\/suppliers\/(.+)$/, async (req, m) => {
      const input = await jsonBody(req);
      const prev = store.data.suppliers.find(s => s.id === m[1]);
      const { ok, s, errors } = core.normalizeSupplier({ ...input, id: prev ? prev.id : null, createdAt: prev?.createdAt });
      if (!ok) throw bad(errors.join(". "));
      s.id ||= "c" + Date.now().toString(36);
      s.orders = prev?.orders || 0;
      store.data.suppliers = store.data.suppliers.filter(x => x.id !== s.id).concat(JSON.parse(JSON.stringify(s)));
      store.save(); syncSuppliers(); return s;
    }],
    ["DELETE", /^\/api\/suppliers\/(.+)$/, (req, m) => {
      store.data.suppliers = store.data.suppliers.filter(s => s.id !== m[1]);
      store.save(); syncSuppliers(); return { ok: true };
    }],
    ["PUT", /^\/api\/settings$/, async req => {
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
      if (!claude) throw Object.assign(new Error("AI drafting needs GEMINI_API_KEY or ANTHROPIC_API_KEY on the server"), { status: 503 });
      return { text: await claude.complete(core.buildReplyPrompt(r, s, mine), { maxTokens: 400 }) };
    }],

    ["GET", /^\/webhooks\/whatsapp$/, (req, m, url, res) => whatsapp.verify(url, res)],
    ["POST", /^\/webhooks\/whatsapp$/, async (req, m, url, res) => whatsapp.receive(await readBody(req), req.headers, res)],
    ["POST", /^\/api\/whatsapp\/simulate$/, async req => {
      const { from, text } = await jsonBody(req);
      if (!text) throw bad("text is required");
      return { reply: await whatsapp.handleText(String(from || "919800000000"), String(text), { simulated: true }) };
    }],
    ["GET", /^\/api\/whatsapp\/log$/, () => ({ configured: whatsapp.configured, log: store.data.whatsapp.log.slice(-100) })],
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

  function serveStatic(url, res) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(STATIC_DIR, rel));
    if (!file.startsWith(STATIC_DIR)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
      res.end(buf);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    // The static copy on GitHub Pages posts sign-ups and supplier quotes here.
    const origin = req.headers.origin;
    if (origin && ORIGINS.includes(origin) && /^\/api\/(join|quote\/|health)/.test(url.pathname)) {
      res.setHeader("access-control-allow-origin", origin); res.setHeader("vary", "origin");
      if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" }).end(); return; }
    }
    const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
    if (!route) {
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/webhooks/")) return send(res, 404, { error: "No such endpoint" });
      if (req.method === "GET" || req.method === "HEAD") return serveStatic(url, res);
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
  return { server, store, ctx, mailer };
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
      const rec = { ...input, id: core.rfqIdFor(++store.data.seq.rfq), date: input.date || Date.now(), status: "open", wonBy: null };
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
  const { ctx, server } = createApp();
  server.listen(port, () => {
    console.log(`VyaparBoss running at http://localhost:${port}`);
    console.log(`  AI parsing: ${ctx.claude ? `${ctx.claude.provider} (${ctx.claude.model})` : "rule parser (set GEMINI_API_KEY or ANTHROPIC_API_KEY in .env)"}`);
    console.log(`  WhatsApp:   ${process.env.WHATSAPP_TOKEN ? "configured" : "not configured (see docs/WHATSAPP_SETUP.md)"}`);
  });
}

module.exports = { createApp, loadEnv };
