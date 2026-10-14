// Optional off-server copy of the database, so data survives redeploys on hosts with a temporary disk
// (Render's free plan wipes data/ on every deploy). Uses Upstash Redis over its REST API: free tier,
// no driver, no dependency. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to switch it on.
//
// How it works: on boot the server pulls the snapshot into data/db.json before it starts; after every
// change it pushes the whole file back (debounced, so a burst of changes is one write). If the snapshot
// can't be read on boot the server refuses to start, so an empty disk never overwrites good data.
const fs = require("fs");
const path = require("path");

function createRemote(env, fetchImpl = globalThis.fetch) {
  const url = String(env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, ""), token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const key = env.UPSTASH_KEY || "vyaparboss:db";
  async function cmd(args) {
    const r = await fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(`Upstash: ${j.error || "HTTP " + r.status}`);
    return j.result;
  }
  return {
    kind: "upstash", key,
    get: () => cmd(["GET", key]),
    async set(json) {
      await cmd(["SET", key, json]);
      // One rolling copy per day, kept 14 days, in case a bad change needs undoing.
      await cmd(["SET", `${key}:day:${new Date().toISOString().slice(0, 10)}`, json, "EX", String(14 * 86400)]).catch(() => {});
    },
  };
}

/** Before the server starts: copy the remote snapshot onto disk. Retries, then throws (never starts empty). */
async function pullSnapshot(remote, file, { tries = 4, waitMs = 1500 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const json = await remote.get();
      if (json == null) return "empty"; // first run: the local file (or fresh seed) gets pushed up
      JSON.parse(json); // refuse to write something that isn't valid
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + ".tmp", json); fs.renameSync(file + ".tmp", file);
      return "restored";
    } catch (e) { last = e; await new Promise(r => setTimeout(r, waitMs * (i + 1))); }
  }
  throw new Error(`Couldn't read the saved database (${last && last.message}). Not starting, so nothing gets overwritten.`);
}

/** Pushes store.data after each save, at most once per `delayMs`. flush() pushes now (used on shutdown). */
function attachRemote(store, remote, { delayMs = 1200, log = console } = {}) {
  let timer = null, running = Promise.resolve(), dirty = false, failures = 0;
  const status = { kind: remote.kind, lastSaved: null, lastError: null };
  const push = () => {
    timer = null; if (!dirty) return running;
    dirty = false;
    const json = JSON.stringify(store.data);
    running = running.then(() => remote.set(json)).then(() => { status.lastSaved = Date.now(); status.lastError = null; failures = 0; }, e => {
      status.lastError = e.message; dirty = true; failures++;
      log.error("Remote save failed, will retry:", e.message);
      if (!timer) timer = setTimeout(push, Math.min(60000, delayMs * 2 ** failures));
    });
    return running;
  };
  store.onSave = () => { dirty = true; if (!timer) timer = setTimeout(push, delayMs); };
  return { status, flush: () => { if (timer) { clearTimeout(timer); timer = null; } return push(); } };
}

module.exports = { createRemote, pullSnapshot, attachRemote };
