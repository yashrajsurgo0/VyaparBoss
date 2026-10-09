// Accounts and sessions. Zero dependencies.
// - Email + password (scrypt), and sign-in with Google, Apple or Facebook once their keys are set.
// - Sessions are random tokens in an HttpOnly cookie; only a hash of each token is stored.
// - Two kinds of account: "buyer" and "supplier". Guests get a light buyer session the first time they
//   create something, so their requests stay theirs; signing up keeps what they made as a guest.
const crypto = require("crypto");

const COOKIE = "vb_s";
const SESSION_DAYS = 30;
const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 32);
  return `s1$${salt.toString("base64")}$${h.toString("base64")}`;
}
function checkPassword(pw, stored) {
  try {
    const [v, s, h] = String(stored || "").split("$");
    if (v !== "s1") return false;
    const want = Buffer.from(h, "base64");
    const got = crypto.scryptSync(String(pw), Buffer.from(s, "base64"), want.length);
    return crypto.timingSafeEqual(got, want);
  } catch { return false; }
}

const b64urlJson = s => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

function createAuth({ store, env, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const providers = {
    google: env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID } : null,
    apple: env.APPLE_CLIENT_ID ? { clientId: env.APPLE_CLIENT_ID, redirectURI: env.APPLE_REDIRECT_URI || String(env.PUBLIC_URL || "https://vyaparboss.onrender.com").replace(/\/+$/, "") + "/" } : null,
    facebook: env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET ? { appId: env.FACEBOOK_APP_ID } : null,
  };
  store.data.users ||= [];
  store.data.sessions ||= {};
  store.data.seq.user ??= store.data.users.length;

  // ---------- sessions ----------
  const cookieOf = req => {
    const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`));
    return m ? m[1] : null;
  };
  function userOf(req) {
    const tok = cookieOf(req); if (!tok) return null;
    const s = store.data.sessions[sha(tok)];
    if (!s || s.exp < now()) return null;
    return store.data.users.find(u => u.id === s.uid) || null;
  }
  function startSession(req, res, uid) {
    const tok = crypto.randomBytes(24).toString("base64url");
    // Drop expired sessions now and then so the file doesn't grow forever.
    for (const [k, s] of Object.entries(store.data.sessions)) if (s.exp < now()) delete store.data.sessions[k];
    store.data.sessions[sha(tok)] = { uid, exp: now() + SESSION_DAYS * 864e5 };
    const secure = String(req.headers["x-forwarded-proto"] || "").includes("https") || req.socket.encrypted;
    res.setHeader("set-cookie", `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`);
  }
  function endSession(req, res) {
    const tok = cookieOf(req); if (tok) delete store.data.sessions[sha(tok)];
    res.setHeader("set-cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }
  /** The current user, creating a guest buyer if there is none (used when a visitor creates something). */
  function ensureUser(req, res) {
    const u = userOf(req); if (u) return u;
    const g = { id: "U" + String(++store.data.seq.user).padStart(5, "0"), role: "buyer", guest: true, createdAt: now() };
    store.data.users.push(g); startSession(req, res, g.id); store.save();
    return g;
  }
  const publicUser = u => u && ({ id: u.id, role: u.role, guest: !!u.guest, name: u.name || "", business: u.business || "", email: u.email || "",
    phone: u.phone || "", city: u.city || "", providers: Object.keys(u.providers || {}), hasPassword: !!u.pass, supplierId: u.supplierId || null });

  // ---------- accounts ----------
  const byEmail = e => e && store.data.users.find(u => !u.guest && u.email === String(e).toLowerCase());
  function wrongRole(u, role) {
    const other = u.role === "supplier" ? "a supplier" : "a buyer";
    return Object.assign(new Error(`This email has ${other} account. Choose "${u.role === "supplier" ? "I'm supplying" : "I'm buying"}" to log in.`), { status: 409, role: u.role });
  }
  /** A guest who signs up keeps the requests and orders they made as a guest. */
  function adoptGuest(req, user) {
    const g = userOf(req);
    if (!g || !g.guest || g.id === user.id) return;
    for (const r of store.data.rfqs) if (r.ownerId === g.id) r.ownerId = user.id;
    for (const o of store.data.orders) if (o.ownerId === g.id) o.ownerId = user.id;
    store.data.users = store.data.users.filter(u => u.id !== g.id);
  }
  function create(req, res, fields) {
    const u = { id: "U" + String(++store.data.seq.user).padStart(5, "0"), createdAt: now(), ...fields };
    adoptGuest(req, u);
    store.data.users.push(u); startSession(req, res, u.id); store.save();
    return u;
  }

  // ---------- sign-in providers ----------
  const jwks = {};
  async function keysFrom(url) {
    const c = jwks[url];
    if (c && c.at > now() - 36e5) return c.keys;
    const r = await fetchImpl(url); if (!r.ok) throw Object.assign(new Error("Couldn't reach the sign-in provider. Try again."), { status: 502 });
    const keys = (await r.json()).keys || [];
    jwks[url] = { at: now(), keys }; return keys;
  }
  /** Verifies an OpenID Connect ID token (RS256) against the provider's published keys. */
  async function verifyIdToken(token, { jwksUrl, issuers, aud }) {
    const bad = () => Object.assign(new Error("Sign-in didn't verify. Please try again."), { status: 401 });
    const parts = String(token || "").split("."); if (parts.length !== 3) throw bad();
    let head, body; try { head = b64urlJson(parts[0]); body = b64urlJson(parts[1]); } catch { throw bad(); }
    if (head.alg !== "RS256") throw bad();
    const jwk = (await keysFrom(jwksUrl)).find(k => k.kid === head.kid); if (!jwk) throw bad();
    const ok = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
    if (!ok || !issuers.includes(body.iss) || (Array.isArray(body.aud) ? !body.aud.includes(aud) : body.aud !== aud) || !(body.exp * 1000 > now())) throw bad();
    return body;
  }
  async function identify(provider, p) {
    const cfg = providers[provider];
    if (!cfg) throw Object.assign(new Error(`${provider[0].toUpperCase() + provider.slice(1)} sign-in isn't switched on yet. Use email for now.`), { status: 503 });
    if (provider === "google") {
      const t = await verifyIdToken(p.credential, { jwksUrl: "https://www.googleapis.com/oauth2/v3/certs", issuers: ["accounts.google.com", "https://accounts.google.com"], aud: cfg.clientId });
      return { sub: t.sub, email: t.email_verified ? t.email : null, name: t.name || "" };
    }
    if (provider === "apple") {
      const t = await verifyIdToken(p.credential, { jwksUrl: "https://appleid.apple.com/auth/keys", issuers: ["https://appleid.apple.com"], aud: cfg.clientId });
      // Apple sends the person's name only on the very first sign-in, from the browser.
      return { sub: t.sub, email: t.email && String(t.email_verified) === "true" ? t.email : null, name: String(p.name || "").slice(0, 80) };
    }
    // Facebook: check the access token belongs to our app, then read the profile.
    const app = `${cfg.appId}|${env.FACEBOOK_APP_SECRET}`;
    const dbg = await (await fetchImpl(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(p.accessToken || "")}&access_token=${encodeURIComponent(app)}`)).json().catch(() => ({}));
    if (!dbg.data?.is_valid || String(dbg.data.app_id) !== String(cfg.appId)) throw Object.assign(new Error("Sign-in didn't verify. Please try again."), { status: 401 });
    const me = await (await fetchImpl(`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(p.accessToken)}`)).json().catch(() => ({}));
    if (String(me.id) !== String(dbg.data.user_id)) throw Object.assign(new Error("Sign-in didn't verify. Please try again."), { status: 401 });
    // Facebook doesn't promise the email is verified, so it's never used to link to an existing account.
    return { sub: String(me.id), email: me.email || null, name: me.name || "", unverifiedEmail: true };
  }

  return {
    providers, userOf, ensureUser, publicUser, startSession, endSession,
    config: () => ({ email: true, google: providers.google, apple: providers.apple, facebook: providers.facebook && { appId: providers.facebook.appId } }),

    signup(req, res, a, password) {
      if (byEmail(a.email)) throw Object.assign(new Error("This email already has an account. Log in instead."), { status: 409 });
      if (String(password || "").length < 8) throw Object.assign(new Error("Use a password of at least 8 characters"), { status: 400 });
      return create(req, res, { ...a, email: a.email, pass: hashPassword(password), providers: {} });
    },
    login(req, res, role, email, password) {
      const u = byEmail(email);
      if (!u || !u.pass || !checkPassword(password, u.pass)) throw Object.assign(new Error(u && !u.pass ? `This email signs in with ${Object.keys(u.providers || {})[0] || "another method"}. Use that button.` : "Email or password is wrong"), { status: 401 });
      if (u.role !== role) throw wrongRole(u, role);
      adoptGuest(req, u); startSession(req, res, u.id); store.save();
      return u;
    },
    async oauth(req, res, provider, role, p) {
      const id = await identify(provider, p);
      let u = store.data.users.find(x => !x.guest && x.providers?.[provider] === id.sub) || (id.email && !id.unverifiedEmail && byEmail(id.email));
      if (!u && id.email && id.unverifiedEmail && byEmail(id.email)) throw Object.assign(new Error("This email already has an account. Log in with email first, then you can use Facebook too."), { status: 409 });
      if (u) {
        if (u.role !== role) throw wrongRole(u, role);
        u.providers = { ...u.providers, [provider]: id.sub };
        adoptGuest(req, u); startSession(req, res, u.id); store.save();
        return { user: u, created: false };
      }
      const name = String(p.profile?.name || id.name || "").trim().slice(0, 80);
      u = create(req, res, { role, name, business: String(p.profile?.business || "").trim().slice(0, 100), email: (id.email || "").toLowerCase(),
        phone: "", city: String(p.profile?.city || "").trim().slice(0, 60), providers: { [provider]: id.sub } });
      return { user: u, created: true };
    },
  };
}

module.exports = { createAuth, hashPassword, checkPassword, COOKIE };
