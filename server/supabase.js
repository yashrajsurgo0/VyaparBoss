// Postgres storage on Supabase: one row per user, session, supplier, request, order and so on, so the data
// is a real database (queryable, backed up daily by Supabase, kept in India when the project is in Mumbai).
// Zero dependencies: talks to Supabase's REST API (PostgREST) with the server-only secret key.
//
// It plugs into the same hooks as server/remote.js: get() assembles the whole store from the tables on boot,
// set(json) writes only the rows that changed since the last save and deletes rows that are gone.
// Tables come from db/schema.sql (run once in Supabase → SQL editor). Row-level security is on with no
// policies, so the public anon key can read nothing; only this server, with the secret key, can.

// store.data key → table and the field that identifies a row.
const TABLES = {
  users: { table: "users", key: "id" },
  suppliers: { table: "suppliers", key: "id" },
  rfqs: { table: "rfqs", key: "id" },
  orders: { table: "orders", key: "po" },
  planPayments: { table: "plan_payments", key: "id" },
  applications: { table: "signups", key: "id" },
  leads: { table: "leads", key: "id" },
  schedules: { table: "schedules", key: "id" },
  orgInvites: { table: "org_invites", key: "id" },
  messages: { table: "messages", key: "id" },
};
const SESSIONS = "sessions"; // store.data.sessions is a map: hashed token → { uid, exp }
const KV = "app_state";      // everything else (counters, settings, outreach log…) as one row per key
const ORDER = "__order:";    // app_state rows that remember each table's array order
const ALL_TABLES = [...Object.values(TABLES).map(t => t.table), SESSIONS, KV];

function createSupabase(env, fetchImpl = globalThis.fetch) {
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, ""), key = env.SUPABASE_SECRET_KEY;
  if (!base || !key) return null;
  // New-style secret keys (sb_secret_…) go in apikey only; legacy service_role JWTs also as a bearer token.
  const headers = { apikey: key, "content-type": "application/json", ...(String(key).startsWith("sb_") ? {} : { authorization: `Bearer ${key}` }) };

  async function call(method, path, body, prefer) {
    const r = await fetchImpl(`${base}/rest/v1/${path}`, { method, headers: { ...headers, ...(prefer ? { prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(`Supabase: ${j.message || j.hint || "HTTP " + r.status}${j.code === "42P01" || j.code === "PGRST205" ? " (run db/schema.sql first)" : ""}`);
    }
    return method === "GET" ? r.json() : null;
  }
  async function readAll(table) {
    const rows = [];
    for (let off = 0; ; off += 1000) {
      const page = await call("GET", `${table}?select=id,doc&order=id&limit=1000&offset=${off}`);
      rows.push(...page); if (page.length < 1000) return rows;
    }
  }
  const inList = ids => "(" + ids.map(i => '"' + String(i).replace(/["\\]/g, m => "\\" + m) + '"').join(",") + ")";

  /** Splits store.data into { table: Map(id → serialized doc) }. */
  function toRows(data) {
    const out = Object.fromEntries(ALL_TABLES.map(t => [t, new Map()]));
    for (const [k, v] of Object.entries(data)) {
      const t = TABLES[k];
      if (t && Array.isArray(v) && v.every(x => x && x[t.key] != null) && new Set(v.map(x => String(x[t.key]))).size === v.length) {
        for (const x of v) out[t.table].set(String(x[t.key]), JSON.stringify(x));
        out[KV].set(ORDER + k, JSON.stringify(v.map(x => String(x[t.key]))));
      } else if (k === "sessions" && v && typeof v === "object" && !Array.isArray(v)) {
        for (const [h, s] of Object.entries(v)) out[SESSIONS].set(h, JSON.stringify(s));
      } else {
        out[KV].set(k, JSON.stringify(v)); // a collection with a missing/duplicate id is kept whole rather than lost
      }
    }
    return out;
  }

  let last = null; // what the database holds now, as returned by toRows()

  return {
    kind: "supabase",
    /** The whole store as JSON, or null when the database is empty (first run). */
    async get() {
      const data = {}, rows = {}, order = {};
      await Promise.all(ALL_TABLES.map(async t => { rows[t] = await readAll(t); }));
      if (ALL_TABLES.every(t => !rows[t].length)) { last = toRows({}); return null; }
      for (const r of rows[KV]) { if (r.id.startsWith(ORDER)) order[r.id.slice(ORDER.length)] = r.doc; else data[r.id] = r.doc; }
      for (const [k, t] of Object.entries(TABLES)) {
        const byId = new Map(rows[t.table].map(r => [r.id, r.doc]));
        if (!byId.size && k in data) continue; // kept whole in app_state
        const ids = order[k] || [...byId.keys()];
        const seen = new Set(ids);
        data[k] = ids.filter(id => byId.has(id)).map(id => byId.get(id)).concat([...byId.keys()].filter(id => !seen.has(id)).map(id => byId.get(id)));
      }
      data.sessions = Object.fromEntries(rows[SESSIONS].map(r => [r.id, r.doc]));
      last = toRows(data);
      return JSON.stringify(data);
    },
    /** Writes the rows that changed since the last successful save; removes rows that no longer exist. */
    async set(json) {
      if (!last) await this.get();
      const next = toRows(JSON.parse(json));
      for (const t of ALL_TABLES) {
        const before = last[t], after = next[t];
        const changed = [...after].filter(([id, doc]) => before.get(id) !== doc).map(([id, doc]) => ({ id, doc: JSON.parse(doc) }));
        for (let i = 0; i < changed.length; i += 500)
          await call("POST", `${t}?on_conflict=id`, changed.slice(i, i + 500), "resolution=merge-duplicates,return=minimal");
        const gone = [...before.keys()].filter(id => !after.has(id));
        for (let i = 0; i < gone.length; i += 100) await call("DELETE", `${t}?id=in.${encodeURIComponent(inList(gone.slice(i, i + 100)))}`);
        last[t] = after; // this table is now in sync, even if a later one fails (the retry resends only what's left)
      }
    },
  };
}

module.exports = { createSupabase, TABLES };
