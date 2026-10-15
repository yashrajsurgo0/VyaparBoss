// Account emails: password reset, and short updates to buyers and suppliers about their own requests and orders.
// Only sent when the mailer is set up (EMAIL_PROVIDER etc.). Each person can switch updates off in Account.
// Never includes another party's contact details or a rival's price.
function createNotifier({ store, mailer, core, publicUrl, log = console }) {
  store.data.mailLog ||= [];
  const users = () => store.data.users || [];
  const userById = id => id && users().find(u => u.id === id && !u.guest && u.email);
  const ownerOfSupplier = sid => { const s = store.data.suppliers.find(x => x.id === sid); return s && userById(s.ownerId); };
  const qty = (n, unit) => `${Number(n).toLocaleString("en-IN")} ${unit}`;
  const foot = `\n\n— Bhai, VyaparBoss\n${publicUrl}\n\nYou get these because you have a VyaparBoss account. Turn them off in Account settings.`;

  async function mail(u, subject, text, { force = false } = {}) {
    if (!mailer.configured || !u || !u.email) return false;
    if (!force && u.notify === false) return false;
    const entry = { at: Date.now(), uid: u.id, subject, ok: false };
    try { await mailer.send({ to: u.email, subject, text: text + (force ? "" : foot) }); entry.ok = true; }
    catch (e) { entry.err = String(e.message).slice(0, 120); log.warn("Account email failed:", e.message); }
    store.data.mailLog = store.data.mailLog.concat(entry).slice(-300); store.save();
    return entry.ok;
  }
  const later = p => { p.catch(e => log.warn("notify:", e.message)); };
  const prod = id => core.PMAP[id] || { name: id, unit: "" };

  return {
    get on() { return mailer.configured; },
    passwordReset(u, link) {
      return mail(u, "Reset your VyaparBoss password", `Namaste${u.name ? " " + u.name.split(/\s+/)[0] : ""},\n\nSomeone (hopefully you) asked to reset the password for this VyaparBoss account. Open this link within one hour to choose a new one:\n\n${link}\n\nIf it wasn't you, ignore this email; your password stays the same.\n\n— VyaparBoss`, { force: true });
    },
    verifyEmail(u, link) {
      return mail(u, "Confirm your email for VyaparBoss", `Namaste${u.name ? " " + u.name.split(/\s+/)[0] : ""},\n\nPlease confirm this is your email by opening this link (it works for 7 days):\n\n${link}\n\nConfirmed emails get order and quote updates, and can reset a forgotten password.\n\nDidn't make a VyaparBoss account? Ignore this email.\n\n— VyaparBoss`, { force: true });
    },
    /** A buyer request that a supplier's listing qualifies for. Sent once per request. */
    newRequest(rfq) {
      if (!rfq || rfq.sample || rfq.notified || !Array.isArray(rfq.quotes) || !rfq.quotes.length) return;
      rfq.notified = Date.now();
      const p = prod(rfq.productId);
      for (const q of rfq.quotes) {
        const u = ownerOfSupplier(q.sid); if (!u) continue;
        later(mail(u, `New request: ${qty(rfq.qty, p.unit)} ${p.name} to ${rfq.city}`,
          `A buyer needs ${qty(rfq.qty, p.unit)} of ${p.name} delivered to ${rfq.city}${rfq.deadline ? ` within ${rfq.deadline} days` : ""}.\n\nYour listing fits this request. Send your price from the app: ${publicUrl}/#requests\n\nThe buyer sees the full delivered price (your rate + GST + freight). Lowest delivered price that meets the date is shown first.`));
      }
    },
    /** A supplier sent (or changed) a price on a buyer's request. */
    quoteReceived(rfq, sid) {
      const u = userById(rfq?.ownerId); if (!u) return;
      const s = store.data.suppliers.find(x => x.id === sid), p = prod(rfq.productId);
      later(mail(u, `${s?.name || "A supplier"} sent a price for ${p.name}`,
        `${s?.name || "A supplier"} sent their own price for your request ${rfq.id} (${qty(rfq.qty, p.unit)} ${p.name} to ${rfq.city}).\n\nCompare it with the others here: ${publicUrl}/#orders\n\nNothing is ordered until you approve.`));
    },
    orderPlaced(o) {
      const u = ownerOfSupplier(o.sid); if (!u) return;
      const p = prod(o.productId);
      later(mail(u, `New order ${o.po}: ${qty(o.qty, p.unit)} ${p.name}`,
        `You have a new purchase order on VyaparBoss.\n\nPO: ${o.po}\nItem: ${p.name}\nQuantity: ${qty(o.qty, p.unit)}\nDeliver to: ${o.city}\n\nOpen it and confirm: ${publicUrl}/#sorders`));
    },
    /** Order moved along. Tells whichever side didn't make the change. */
    orderStage(o, actorId) {
      const stage = (core.STAGES || [])[o.stage] || `stage ${o.stage}`;
      const buyer = userById(o.ownerId), sup = ownerOfSupplier(o.sid);
      if (buyer && buyer.id !== actorId) later(mail(buyer, `Order ${o.po}: ${stage}`, `Your order ${o.po} with ${o.sname || "your supplier"} is now: ${stage}.${o.issue ? `\nNote: ${o.issue}` : ""}\n\nTrack it: ${publicUrl}/#orders`));
      if (sup && sup.id !== actorId && o.stage === 4) later(mail(sup, `Order ${o.po} received by the buyer`, `The buyer marked order ${o.po} as received. Thank you!\n\n${publicUrl}/#sorders`));
    },
  };
}

module.exports = { createNotifier };
