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

  const routes = [
    ["GET", /^\/api\/health$/, () => ({ ok: true, app: "vyaparboss", ai: !!claude, provider: claude?.provider || null, model: claude?.model || null, whatsapp: whatsapp.configured })],
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
      const { text, partial } = await jsonBody(req);
      if (!text || typeof text !== "string") throw bad("text is required");
      return ctx.services.parse(text, partial || null);
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
  return { server, store, ctx };
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
    async parse(text, partial) {
      if (claude) {
        try {
          const p = core.cleanParsed(await claude.json(core.buildParsePrompt(text, partial)));
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
