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
    /** Named order actions (engine.js applyOrderAction). Tells the side that didn't act; disputes also go to the team. */
    orderEvent(o, ev, actorId, who, teamInbox) {
      const p = prod(o.productId), buyer = userById(o.ownerId), sup = ownerOfSupplier(o.sid);
      const to = (u, subject, text) => { if (u && u.id !== actorId) later(mail(u, subject, text)); };
      const head = `${o.po}: ${qty(o.qty, p.unit)} ${p.name} to ${o.city}`;
      const sh = o.shipment;
      const msgs = {
        confirm: [buyer, `Order ${o.po} confirmed`, `${o.sname || "Your supplier"} confirmed your order.\n${head}\n\nTrack it: ${publicUrl}/#orders`],
        dispatch: [buyer, `Order ${o.po} dispatched`, `${o.sname || "Your supplier"} dispatched your order.\n${head}\nTransporter: ${sh?.transporter}\nLR / AWB: ${sh?.lr}${sh?.vehicle ? `\nVehicle: ${sh.vehicle}` : ""}${sh?.eta ? `\nExpected: ${new Date(sh.eta).toDateString()}` : ""}\n\nWhen it arrives, tell us how it went: ${publicUrl}/#orders`],
        transit: [buyer, `Order ${o.po} is on the way`, `${head}\n\nTrack it: ${publicUrl}/#orders`],
        deliver: [sup, `Order ${o.po} received by the buyer`, `The buyer marked order ${o.po} as received in good order. Thank you!\n\n${publicUrl}/#sorders`],
        deliver_issue: [sup, `Problem reported on order ${o.po}`, `The buyer received order ${o.po} and reported: ${o.issue}.${o.receipt?.note ? `\n"${o.receipt.note}"` : ""}\n\nPlease reply in the app so we can sort it out: ${publicUrl}/#sorders`],
        review: [sup, `New ${o.review?.stars}-star rating on order ${o.po}`, `The buyer rated order ${o.po}: ${"★".repeat(o.review?.stars || 0)}${o.review?.text ? `\n"${o.review.text}"` : ""}\n\n${publicUrl}/#sorders`],
        dispute: [sup, `Problem reported on order ${o.po}`, `The buyer reported a problem: ${o.issue}.${o.dispute?.detail ? `\n"${o.dispute.detail}"` : ""}\n\nPlease reply in the app: ${publicUrl}/#sorders`],
        resolve: null, withdraw: [sup, `Problem on order ${o.po} closed`, `The buyer withdrew the problem on order ${o.po}.`],
        cancel: [who === "buyer" ? sup : buyer, `Order ${o.po} cancelled`, `Order ${o.po} was cancelled by the ${who === "team" ? "VyaparBoss team" : who}.${o.cancelled?.reason ? `\nReason: ${o.cancelled.reason}` : ""}${who !== "buyer" ? `\n\nYour request is open again; pick another supplier here: ${publicUrl}/#orders` : ""}`],
        reply: [who === "buyer" ? sup : buyer, `New message about order ${o.po}`, `${(o.dispute?.msgs || []).slice(-1)[0]?.text || ""}\n\nReply in the app: ${publicUrl}/#${who === "buyer" ? "sorders" : "orders"}`],
      };
      if (ev === "resolve") {
        const r = core.RESOLUTIONS[o.dispute?.resolution] || "Resolved";
        for (const [u, tab] of [[buyer, "orders"], [sup, "sorders"]]) to(u, `Problem on order ${o.po} resolved`, `The VyaparBoss team closed the problem on order ${o.po}: ${r}.${o.dispute?.note ? `\n${o.dispute.note}` : ""}\n\n${publicUrl}/#${tab}`);
      } else if (msgs[ev]) to(...msgs[ev]);
      if (ev === "cancel" && who === "team") to(sup, `Order ${o.po} cancelled`, `Order ${o.po} was cancelled by the VyaparBoss team.`);
      if ((ev === "dispute" || ev === "deliver_issue") && teamInbox && mailer.configured)
        later(mailer.send({ to: teamInbox, subject: `[VyaparBoss] Problem on ${o.po}: ${o.issue}`, text: `${head}\nSupplier: ${o.sname}\n${o.dispute?.detail || o.receipt?.note || ""}\n\nTeam → Ops to resolve.` }));
    },
    /** A team member's order is over their limit or the budget: the owner decides. */
    approvalNeeded(o, owner, member) {
      const p = prod(o.productId);
      if (owner) later(mail(owner, `Approve ${member?.name || "a team member"}'s order: ${core.inr(o.landed)}`, `${member?.name || "A team member"} wants to order ${qty(o.qty, p.unit)} ${p.name} from ${o.sname} for ${core.inr(o.landed)} delivered to ${o.city}.\n\nWhy it needs you: ${o.approval?.why}\n\nThe supplier hasn't been sent anything yet. Approve or decline: ${publicUrl}/#orders`, { force: true }));
    },
    approvalDecided(o, member) {
      if (!member) return;
      const ok = o.approval?.status === "approved";
      later(mail(member, `Your order ${o.po} was ${ok ? "approved" : "not approved"}`, ok ? `Your order ${o.po} was approved and sent to ${o.sname}.\n\n${publicUrl}/#orders` : `Your order ${o.po} wasn't approved${o.approval?.note ? `: ${o.approval.note}` : ""}. The request is open again if you want to pick another option.\n\n${publicUrl}/#orders`, { force: true }));
    },
    /** A repeat order made a fresh request. */
    scheduleReady(owner, rfq, sc, best) {
      const p = prod(rfq.productId);
      later(mail(owner, `Your repeat order is ready to approve: ${qty(rfq.qty, p.unit)} ${p.name}`, `It's time for your repeat order (${(core.REPEAT_EVERY[sc.every] || "").toLowerCase()}): ${qty(rfq.qty, p.unit)} ${p.name} to ${rfq.city}.\n\n${best ? `Best option today: ${best.s.name}, ${core.inr(Math.round(best.landed))} delivered (rate + GST + freight).` : "No supplier can take it right now; you can change the quantity or city."}\n\nPrices are fresh, and nothing is ordered until you approve: ${publicUrl}/#orders`));
    },
    scheduleReminder(owner, rfq, sc) {
      const p = prod(rfq.productId);
      later(mail(owner, `Reminder: your repeat order of ${p.name} is still waiting`, `Your repeat order request ${rfq.id} (${qty(rfq.qty, p.unit)} ${p.name} to ${rfq.city}) is still waiting for your approval, so we didn't create another one.\n\n${publicUrl}/#orders`));
    },
    teamInvite(email, owner, link, limit) {
      if (!mailer.configured) return;
      const lim = limit == null ? "You can place orders of any size." : limit === 0 ? `Every order you place goes to ${owner.name || "the owner"} for approval first.` : `Orders above ${core.inr(limit)} go to ${owner.name || "the owner"} for approval first.`;
      later(mailer.send({ to: email, subject: `${owner.name || "Someone"} invited you to buy for ${owner.business || "their business"} on VyaparBoss`, text: `Namaste,\n\n${owner.name || "A VyaparBoss buyer"} invited you to place orders for ${owner.business || "their business"} on VyaparBoss. ${lim}\n\nAccept the invite (it works for 14 days): ${link}\n\nNot expecting this? Ignore this email.\n\n— VyaparBoss` }));
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
