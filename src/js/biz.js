/* KaantaMandi business model screens. Loaded after roles.js and uses helpers from app.js, grow.js and roles.js.
   - Buyer checkout add-ons (KaantaMandi Freight, Assured, inspection, insurance) and the services bill on each order
   - #pricing: public pricing page (supplier plans, commission, buyer services)
   - Supplier → Plan: current plan, usage, upgrade (Razorpay link or the team collects), payment history; win/loss report
   - Team → Economics: GMV, revenue by stream, take rate, contribution, cohorts, plan payments, a what-if and the pricing editor
   Money is always computed by engine.js (shared with the server); the server re-prices everything a buyer sends. */

const rpct=(v,d)=>{const n=(+v||0)*100;return (d!=null?n.toFixed(d):(Math.round(n*100)/100).toString())+"%";};
const money=v=>v<0?"−"+lakh(-v):lakh(v);
const pts=v=>(Math.round((+v||0)*10000)/100)+" points";
const planName=k=>Repo.pricing.plans[k]?.name||k;

/* ===================== BUYER: CHECKOUT ADD-ONS ===================== */
function checkoutTotals(q){
  const o={subtotal:Math.round(q.subtotal),gst:Math.round(q.gst),freight:Math.round(q.freight),landed:Math.round(q.landed)};
  applyServices(o,q,flow.extras||{},Repo.pricing);
  return {supplier:o.landed,services:o.services||null,total:orderTotal(o),freightBy:o.kmFreight?"km":"supplier"};
}
function addonsHTML(q){
  const sq=serviceQuotes(q,Repo.pricing),x=flow.extras||{},on=Object.values(x).some(Boolean);
  const row=(k,title,price,desc)=>`<label class="addon"><input type="checkbox" data-extra="${k}" ${x[k]?"checked":""}><span class="addon-t"><b>${title}</b><span class="num">${price}</span></span><small>${desc}</small></label>`;
  return `<details class="more addons" ${on?"open":""}><summary>Add-ons from KaantaMandi${on?` <span class="pill brand">${Object.values(x).filter(Boolean).length} added</span>`:""} ${ico("i-chev","")}</summary><div>
    ${sq.freight.usual>0?row("freight","KaantaMandi Freight",`${inr(sq.freight.price)} <s class="muted">${inr(sq.freight.usual)}</s>`,`Our partner carrier collects from ${esc(q.s.name)} and you track it here. ${inr(sq.freight.saves)} less than the supplier's freight, before 5% GST.`):""}
    ${row("assured","KaantaMandi Assured",inr(sq.assured.price),"Our team takes up any problem with this order (short, damaged or wrong goods) with the supplier until it's sorted. Arrives after the promised date? This fee comes back.")}
    ${row("inspection","Pre-dispatch inspection",inr(sq.inspection.price),`An inspector checks quantity and spec at ${esc(q.s.city)} before it leaves. The result shows on your order.`)}
    ${row("insurance","Transit insurance",inr(sq.insurance.price),"Cover for loss or damage on the way, for the goods value with GST, through our insurance partner. We confirm the cover before dispatch.")}
    <p class="hint">Billed by KaantaMandi on its own invoice with GST (18%, freight 5%), claimable as input credit. Indicative prices: our team confirms partner bookings with you. <a href="#pricing">How pricing works</a></p>
  </div></details>`;
}
function checkoutBreakdown(q,t){
  if(!t.services)return "";
  return `<table class="breakdown svc"><tbody>
    <tr><td>Supplier invoice${t.freightBy==="km"?" (goods + GST, no freight)":""}</td><td>${inr(t.supplier)}</td></tr>
    ${t.services.lines.map(l=>`<tr><td>${esc(l.label)} + GST</td><td>${inr(l.amount+l.gst)}</td></tr>`).join("")}
    <tr class="tot"><td>You pay in all</td><td>${inr(t.total)}</td></tr></tbody></table>`;
}

/* ===================== ORDERS: SERVICES BILL ===================== */
const SVC_PILL={due:["gold","Due"],paid:["good","Paid"],waived:["","Waived"]};
const INSP={booked:["gold","Booked"],passed:["good","Passed"],failed:["bad","Failed"]};
function servicesHTML(o,side){
  if(o.cancelled||o.sample)return "";
  const insp=o.inspection?`<span class="pill ${INSP[o.inspection.status][0]}">Inspection: ${INSP[o.inspection.status][1]}</span>${o.inspection.note?` <span class="muted">${esc(o.inspection.note)}</span>`:""}`:"";
  if(side==="supplier"){
    const notes=[];
    if(o.kmFreight)notes.push(`<b>KaantaMandi Freight.</b> Our partner carrier collects this order from you; don't add freight to your invoice. Enter their LR number when you hand it over.`);
    if(o.inspection)notes.push(`<b>Pre-dispatch inspection:</b> ${insp} ${o.inspection.status==="booked"?"Our team will call to fix a time before you dispatch.":""}`);
    return notes.length?`<div class="svcnote">${notes.map(n=>`<p>${n}</p>`).join("")}</div>`:"";
  }
  if(!o.services)return "";
  const [pc,pl]=SVC_PILL[o.services.status]||SVC_PILL.due,late=isLateDelivery(o)&&o.services.lines.some(l=>l.k==="assured");
  return `<div class="moneybox svcbox"><div class="ohead"><b>KaantaMandi services</b><span class="pill ${pc}">${pl}</span></div>
    <ul class="paylist">${o.services.lines.map(l=>`<li><span>${esc(l.label)}</span><span class="num">${inr(l.amount+l.gst)}${l.k==="assured"&&late?' <span class="pill good">Refunded: arrived late</span>':""}</span></li>`).join("")}</ul>
    <p class="hint">${inr(o.services.total)} with GST, on KaantaMandi's own invoice (separate from the supplier's). ${o.services.status==="due"?"Our team sends payment details with the invoice.":""}</p>
    ${insp?`<p>${insp}</p>`:""}${o.kmFreight?`<p class="hint">Freight by our partner carrier. You saved ${inr(Math.max(0,o.kmFreight.usual-(o.services.lines.find(l=>l.k==="freight")?.amount||0)))} on the supplier's freight.</p>`:""}</div>`;
}

/* ===================== PUBLIC: #pricing ===================== */
let pricingPeriod="monthly";
function planCards(P,period,current,cta){
  return `<div class="plans">${PLAN_KEYS.map(k=>{const pl=P.plans[k],price=period==="yearly"?pl.yearly:pl.monthly,mo=period==="yearly"?Math.round(pl.yearly/12):pl.monthly,best=k==="growth";
    return `<div class="panel plan${best?" best":""}${current===k?" current":""}">${best?'<span class="tag">Most suppliers start here</span>':""}
      <h3>${esc(pl.name)}</h3>
      <p class="price"><b>${price?inr(price):"₹0"}</b>${price?`<small>/${period==="yearly"?"year":"month"} + GST${period==="yearly"?` · ${inr(mo)}/month`:""}</small>`:"<small>forever</small>"}</p>
      <ul class="ticks">
        <li>Up to ${qfmt(pl.maxProducts)} products</li>
        <li>${pl.maxCats>=Object.keys(CATS).length?"Every category":`${pl.maxCats} categor${pl.maxCats>1?"ies":"y"}`}</li>
        <li>${pl.commissionOff?`${pts(pl.commissionOff)} off commission`:"Standard commission, only if you agree to it"}</li>
        <li>Online payouts in ${pl.payoutDays===1?"1 day":pl.payoutDays+" days"}</li>
        <li>${pl.winLoss?"Win/loss report: where you rank and why":"Requests, quotes and GST invoices"}</li>
      </ul>
      ${cta(k,price)}</div>`;}).join("")}</div>`;
}
function periodSeg(period,action){return `<div class="seg" role="tablist" aria-label="Billing period">${[["monthly","Monthly"],["yearly","Yearly (2 months free)"]].map(([v,l])=>`<button data-action="${action}" data-v="${v}" aria-selected="${period===v}">${l}</button>`).join("")}</div>`;}
function renderPricingPage(){
  const el=$("#v-public");el.hidden=false;const P=Repo.pricing,T=P.take;
  el.innerHTML=pubShell(`<div class="pubhero"><div><h1>Simple, fair pricing</h1>
      <p class="lede">Buyers use KaantaMandi free. Suppliers list free and see every request they can serve. Where a supplier agrees to it, a small commission applies only to orders they win.</p></div></div>
    <div class="panel pad fairbox"><b>Ranking is never for sale.</b> Bhai ranks quotes on the delivered price, on-time record and ratings. A plan or a fee never moves a supplier up.</div>
    <h2 class="sub">For suppliers</h2>
    ${periodSeg(pricingPeriod,"pr-period")}
    ${planCards(P,pricingPeriod,null,k=>`<a class="btn ${k==="growth"?"primary":""}" href="#join/s">${k==="free"?"List free":"Start free, upgrade any time"}</a>`)}
    <div class="panel pad"><h3>Commission on orders you win</h3><p class="hint">On the goods value, before GST and freight. Only for suppliers who agree to it; the rate is fixed when the order is placed.</p>
      <table class="breakdown pricetab"><tbody>${Object.entries(CATS).map(([c,n])=>`<tr><td>${esc(n)}</td><td>${rpct(T.byCat[c])}</td></tr>`).join("")}</tbody></table>
      <p class="hint">Orders above ${lakh(T.bigOrder)}: ${pts(T.bigOrderOff)} less. Growth and Pro take more off (above). Never below ${rpct(T.floor)}; at least ${inr(T.min)} and at most ${inr(T.cap)} per order.</p></div>
    <h2 class="sub">For buyers</h2>
    <div class="panel pad"><p><b>Free to use.</b> Ask Bhai, compare delivered prices, place and track orders, pay suppliers directly. Optional add-ons at checkout:</p>
      <table class="breakdown pricetab"><tbody>
        <tr><td><b>KaantaMandi Freight</b><br><small class="muted">Partner carrier, booked for you</small></td><td>${rpct(P.freight.discount,0)} below the supplier's freight</td></tr>
        <tr><td><b>KaantaMandi Assured</b><br><small class="muted">We take up problems with the supplier; refunded if late</small></td><td>${rpct(P.assured.rate)} of goods (${inr(P.assured.min)}–${inr(P.assured.cap)})</td></tr>
        <tr><td><b>Pre-dispatch inspection</b><br><small class="muted">Quantity and spec checked at the supplier</small></td><td>${inr(P.inspection.base)} + ${rpct(P.inspection.rate)} of goods</td></tr>
        <tr><td><b>Transit insurance</b><br><small class="muted">Through a licensed insurance partner</small></td><td>${rpct(P.insurance.rate)} of goods + GST (min ${inr(P.insurance.min)})</td></tr>
      </tbody></table><p class="hint">Add-ons are billed by KaantaMandi with GST (18%; freight 5%), claimable as input credit.</p></div>
    <div class="actions" style="justify-content:center"><a class="btn primary big" href="#">Start buying</a><a class="btn big" href="#join/s">List your business free</a></div>
    <p class="hint" style="text-align:center">Prices in Indian rupees. We'll tell you before any price changes for you.</p>`);
}

/* ===================== SUPPLIER: PLAN ===================== */
function renderPlan(){
  const el=$("#v-plan");if(!el)return;const me=Repo.myListing,P=Repo.pricing;
  if(!me){setHTML(el,`<div class="pagehead"><div><h1>Your plan</h1></div></div>`+needListing("you can pick a plan"));return;}
  const k=planOf(me),pl=P.plans[k],cats=new Set(me.offers.map(o=>PMAP[o.p]?.cat)).size,pays=store().planPayments||[],pend=pays.find(p=>p.status==="pending");
  const left=me.planUntil?Math.ceil((me.planUntil-Date.now())/864e5):null;
  const meter=(n,max,label)=>`<div class="meter"><span>${label}</span><b class="num">${n} of ${qfmt(max)}</b><i style="--w:${Math.min(100,Math.round(n/max*100))}%"></i></div>`;
  const cta=(key,price)=>key==="free"?(k==="free"?`<button class="btn" disabled>Your plan</button>`:`<p class="hint">Your plan moves to Free when it ends. Nothing to cancel.</p>`)
    :`<button class="btn ${key==="growth"?"primary":""}" data-action="plan-buy" data-v="${key}">${k===key?`Renew ${esc(P.plans[key].name)}`:`Switch to ${esc(P.plans[key].name)}`}: ${inr(price)}</button>`;
  setHTML(el,`<div class="pagehead"><div><h1>Your plan</h1><p class="muted">Plans add products, categories, a lower commission and faster payouts. They never change how Bhai ranks you.</p></div></div>
    <div class="panel pad planmine"><div class="ohead"><div><span class="muted">Current plan</span><h2>${esc(pl.name)}</h2>
      <p class="hint">${k==="free"?"Free, no end date.":`${me.planPeriod==="yearly"?"Yearly":"Monthly"} · until ${new Date(me.planUntil).toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"})}${left!=null&&left<=7?` <span class="pill warn">${left} day${left===1?"":"s"} left</span>`:""}`}</p></div></div>
      ${meter(me.offers.length,pl.maxProducts,"Products")}${meter(cats,pl.maxCats,"Categories")}</div>
    ${pend?`<div class="note">${pend.url?`Your ${esc(planName(pend.plan))} plan is waiting for payment of ${inr(pend.amount+pend.gst)} (with GST). <a class="btn sm primary" href="${esc(pend.url)}" target="_blank" rel="noopener">Pay now</a>`:`You asked for ${esc(planName(pend.plan))} (${pend.period}). Our team will call to collect ${inr(pend.amount+pend.gst)} with GST and switch it on.`}</div>`:""}
    ${periodSeg(pricingPeriod,"pr-period")}
    ${planCards(P,pricingPeriod,k,cta)}
    ${pays.length?`<details class="more"><summary>Plan payments ${ico("i-chev","")}</summary><div><ul class="paylist">${pays.slice().reverse().map(p=>`<li><span>${esc(planName(p.plan))}, ${p.period} · ${fdate(p.at)}</span><span class="num">${inr(p.amount+p.gst)} <span class="pill ${p.status==="paid"?"good":p.status==="pending"?"gold":""}">${esc(p.status)}</span></span></li>`).join("")}</ul></div></details>`:""}
    <p class="hint"><a href="#pricing">Full pricing</a>, including commission by category.</p>`);
}
/* Supplier Insights: where you rank on the requests you qualified for (Growth and Pro). */
function winLossHTML(me){
  const pl=Repo.pricing.plans[planOf(me)],rs=myRfqs().filter(r=>r.rank);
  if(!pl.winLoss)return `<div class="panel pad locked"><h3>Win/loss report</h3><p class="muted">See where you ranked on every request, how far you were from the winning delivered price, and which requests you lost on delivery time. On Growth and Pro.</p><button class="btn sm primary" data-action="go" data-tab="plan">See plans</button></div>`;
  if(!rs.length)return `<div class="panel pad"><h3>Win/loss report</h3><p class="muted">Nothing to report yet. It fills in as requests come in.</p></div>`;
  const won=store().orders.filter(o=>o.sid===me.id).map(o=>o.rfqId),first=rs.filter(r=>r.rank===1).length,avg=(rs.reduce((a,r)=>a+r.rank,0)/rs.length).toFixed(1);
  return `<div class="panel pad"><h3>Win/loss report</h3><div class="kpis">
      <div class="kpi"><span>Ranked #1</span><b>${first}</b><small>of ${rs.length} requests</small></div>
      <div class="kpi"><span>Average rank</span><b>${avg}</b><small>on delivered price</small></div>
      <div class="kpi"><span>Won</span><b>${rs.filter(r=>won.includes(r.id)).length}</b><small>became your order</small></div></div>
    <ul class="paylist">${rs.slice(0,12).map(r=>{const p=PMAP[r.productId];return `<li><span>${qfmt(r.qty)} ${p.unit} ${esc(p.name)} to ${esc(r.city)} · ${fdate(r.date)}</span><span>${won.includes(r.id)?'<span class="pill good">Won</span>':`<span class="pill ${r.rank===1?"gold":""}">#${r.rank} of ${r.of}</span>`}</span></li>`;}).join("")}</ul>
    <p class="hint">Rank is on the delivered price among suppliers who could meet the date. Rivals' prices stay private.</p></div>`;
}

/* ===================== TEAM: ECONOMICS ===================== */
let econ={days:30,data:null,busy:false,what:null,editing:null};
async function renderEconomics(){
  const el=document.getElementById("s-econ");if(!el)return;
  if(!econ.data&&!econ.busy){econ.busy=true;el.innerHTML=`<p class="muted">Adding up…</p>`;el._html=null;
    try{econ.data=await Repo.economics(econ.days);}catch(e){econ.busy=false;setHTML(el,`<div class="errors">${esc(e.message)}</div>`);return;}econ.busy=false;}
  const e=econ.data;if(!e)return;const P=pricingWith(e.pricing);
  const ae=document.activeElement;if(el.contains(ae)&&/^(INPUT|SELECT|TEXTAREA)$/.test(ae?.tagName||""))return;
  const S={commission:"Commission",plans:"Supplier plans",assured:"Assured",freight:"Freight margin",inspection:"Inspection margin",insurance:"Insurance share"};
  const max=Math.max(1,...Object.values(e.streams));
  const k=[["GMV",lakh(e.gmv),`${e.orders} order${e.orders===1?"":"s"} · average ${lakh(e.aov)}`],["Revenue",lakh(e.revenue),`take rate ${rpct(e.takeRate,2)} of GMV`],
    ["Contribution",money(e.contribution),e.orders?`${inr(e.perOrder)} per order after variable costs`:"no orders yet"],["Supplier plans (MRR)",lakh(e.mrr),`${e.payingSuppliers} paying supplier${e.payingSuppliers===1?"":"s"}`],
    ["Requests → orders",e.conversion==null?"–":rpct(e.conversion,0),`${e.requests} requests`],["New buyers",String(e.newBuyers),e.cac!=null?(P.costs.marketingMonthly?`CAC ${inr(e.cac)}${e.payback!=null?` · payback ${e.payback} months`:""}`:"add marketing spend in Pricing to see CAC"):"set marketing spend below for CAC"]];
  const per=n=>e.orders?inr(Math.round(n/e.orders)):"–";
  const w=econ.what||={orders:Math.max(50,e.orders*4),aov:e.aov||150000,takeRate:P.take.byCat.pack,feeShare:0.6,attach:{freight:0.25,assured:0.3,inspection:0.05,insurance:0.2},growth:Math.max(10,e.planMix.growth),pro:Math.max(2,e.planMix.pro),marketing:P.costs.marketingMonthly||100000,onlineShare:0.3};
  const m=projectMonth(w,P);
  setHTML(el,`<div class="toolbar">${[30,90,365].map(d=>`<button class="chip" data-action="econ-days" data-v="${d}" aria-pressed="${econ.days===d}">Last ${d===365?"12 months":d+" days"}</button>`).join("")}${e.local?'<span class="hint">Demo data in this browser</span>':""}</div>
    <div class="kpis">${k.map(([a,b,c])=>`<div class="panel kpi"><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join("")}</div>
    <div class="two">
      <div class="panel pad"><h3>Revenue by stream</h3><div class="bars">${Object.entries(S).map(([s,l])=>`<div class="bar"><span>${l}</span><div class="trackb"><div class="fill" style="width:${Math.round(e.streams[s]/max*100)}%"></div></div><span>${lakh(Math.round(e.streams[s]))}</span></div>`).join("")}</div>
        <p class="hint">Net of partner costs (carrier, inspector, insurer) and Assured refunds. Plans count when paid.</p></div>
      <div class="panel pad"><h3>One order, on average</h3><table class="breakdown"><tbody>
        ${Object.entries(S).filter(([s])=>s!=="plans").map(([s,l])=>`<tr><td>${l}</td><td>${per(e.streams[s])}</td></tr>`).join("")}
        <tr><td>Payment gateway</td><td>− ${per(e.varCosts.gateway)}</td></tr><tr><td>Ops (calls, follow-up)</td><td>− ${per(e.varCosts.ops)}</td></tr><tr><td>AI (requests, drafts)</td><td>− ${per(e.varCosts.ai)}</td></tr>
        <tr class="tot"><td>Contribution per order</td><td>${per(e.contribution-e.streams.plans)}</td></tr></tbody></table>
        <p class="hint">Attach rates: freight ${rpct(e.attach.freight,0)}, Assured ${rpct(e.attach.assured,0)}, inspection ${rpct(e.attach.inspection,0)}, insurance ${rpct(e.attach.insurance,0)}. ${rpct(e.feeShare,0)} of orders carry a commission.</p></div>
    </div>
    <div class="panel pad"><h3>Buyers who came back</h3>${e.cohorts.length?`<div class="tablewrap"><table class="cmp"><thead><tr><th>First order</th><th>Buyers</th><th>Month 1</th><th>Month 2</th><th>Month 3</th></tr></thead><tbody>
      ${e.cohorts.map(c=>`<tr><td>${esc(c.month)}</td><td>${c.buyers}</td>${c.back.map(v=>`<td>${v==null?"–":v+"%"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="hint">Share of each month's new buyers who ordered again 1, 2 and 3 months later. Repeat buying is what makes the model work.</p>`:`<p class="muted">Fills in after the first real orders.</p>`}</div>
    <div class="two">
      <div class="panel pad"><h3>Plan payments</h3>${e.planPayments.length?`<ul class="paylist">${e.planPayments.slice(0,15).map(p=>`<li><span>${esc(p.supplier)} · ${esc(planName(p.plan))}, ${p.period} · ${fdate(p.at)}</span><span class="num">${inr(p.amount+p.gst)} ${p.status==="pending"?`<button class="btn sm primary" data-action="pp-paid" data-id="${esc(p.id)}">Mark paid</button><button class="btn sm ghost" data-action="pp-cancel" data-id="${esc(p.id)}">Cancel</button>`:`<span class="pill ${p.status==="paid"?"good":""}">${esc(p.status)}</span>`}</span></li>`).join("")}</ul>`:`<p class="muted">No plan purchases yet.</p>`}
        <p class="hint">Plan mix: ${PLAN_KEYS.map(k=>`${esc(P.plans[k].name)} ${e.planMix[k]}`).join(" · ")}. Online payments switch plans on by themselves; mark the rest paid once collected.</p></div>
      <div class="panel pad"><h3>Services to bill</h3>${e.services.length?`<ul class="paylist">${e.services.slice(0,15).map(s=>`<li><span><b class="num">${esc(s.po)}</b> ${esc(s.buyer)}<br><small class="muted">${s.lines.map(esc).join(", ")}</small></span><span class="num">${inr(s.total)}
          <select data-svcstatus="${esc(s.po)}" aria-label="Status for ${esc(s.po)}">${["due","paid","waived"].map(v=>`<option ${s.status===v?"selected":""}>${v}</option>`).join("")}</select>
          ${s.inspection?`<select data-inspstatus="${esc(s.po)}" aria-label="Inspection for ${esc(s.po)}">${["booked","passed","failed"].map(v=>`<option ${s.inspection===v?"selected":""}>${v}</option>`).join("")}</select>`:""}</span></li>`).join("")}</ul>`:`<p class="muted">No add-ons booked yet.</p>`}</div>
    </div>
    <div class="panel pad whatif"><h3>What if?</h3><p class="hint">A month at these volumes, with today's pricing. Use it to test prices before changing them.</p>
      <form class="fields" data-form="whatif" novalidate>
        ${[["orders","Orders a month",w.orders,1],["aov","Average order (₹)",w.aov,1000],["feeShare","Share of orders with commission",w.feeShare,0.05],["takeRate","Commission rate",w.takeRate,0.0025],["growth","Suppliers on Growth",w.growth,1],["pro","Suppliers on Pro",w.pro,1],["marketing","Marketing a month (₹)",w.marketing,1000],["onlineShare","Share paid online",w.onlineShare,0.05]]
          .map(([id,l,v,st])=>`<div class="field"><label for="wf-${id}">${l}</label><input id="wf-${id}" name="${id}" type="number" step="${st}" min="0" value="${v}" inputmode="decimal"></div>`).join("")}
        ${["freight","assured","inspection","insurance"].map(a=>`<div class="field"><label for="wa-${a}">${SERVICE_NAMES[a]} take-up</label><input id="wa-${a}" name="attach.${a}" type="number" step="0.05" min="0" max="1" value="${w.attach[a]}" inputmode="decimal"></div>`).join("")}
        <div class="field"><label>&nbsp;</label><button class="btn primary">Work it out</button></div>
      </form>
      <div class="kpis">${[["GMV",lakh(m.gmv)],["Revenue",lakh(m.revenue)],["Take rate",rpct(m.takeRate,2)],["Costs incl. marketing",lakh(m.costs)],["Contribution",money(m.contribution)]].map(([a,b])=>`<div class="kpi"><span>${a}</span><b class="${a==="Contribution"&&m.contribution<0?"neg":""}">${b}</b></div>`).join("")}</div>
      <p class="hint">${Object.entries(m.streams).map(([s,v])=>`${S[s]} ${lakh(v)}`).join(" · ")}</p></div>
    <details class="more panel pad" ${econ.editing?"open":""}><summary><b>Pricing</b> (plans, commission, add-ons, cost assumptions) ${ico("i-chev","")}</summary><div>${pricingForm(P)}</div></details>`);
}
function pricingForm(P){
  const f=(id,label,v,step,hint)=>`<div class="field"><label for="pf-${id.replace(/\./g,"-")}">${label}</label><input id="pf-${id.replace(/\./g,"-")}" name="${id}" type="number" step="${step}" min="0" value="${v}" inputmode="decimal">${hint?`<small class="hint">${hint}</small>`:""}</div>`;
  return `<form data-form="pricing" novalidate>
    <h4>Supplier plans</h4><div class="fields">${PLAN_KEYS.filter(k=>k!=="free").map(k=>{const pl=P.plans[k];return f(`plans.${k}.monthly`,`${pl.name}: ₹ a month`,pl.monthly,1)+f(`plans.${k}.yearly`,`${pl.name}: ₹ a year`,pl.yearly,1)+f(`plans.${k}.commissionOff`,`${pl.name}: commission off (0.0025 = 0.25 points)`,pl.commissionOff,0.0005);}).join("")}
      ${PLAN_KEYS.map(k=>f(`plans.${k}.maxProducts`,`${P.plans[k].name}: products`,P.plans[k].maxProducts,1)+f(`plans.${k}.maxCats`,`${P.plans[k].name}: categories`,P.plans[k].maxCats,1)).join("")}</div>
    <h4>Commission (0.02 = 2% of goods)</h4><div class="fields">${Object.entries(CATS).map(([c,n])=>f(`take.byCat.${c}`,n,P.take.byCat[c],0.0025)).join("")}
      ${f("take.bigOrder","Big order from (₹)",P.take.bigOrder,10000)}${f("take.bigOrderOff","Big order discount",P.take.bigOrderOff,0.0005)}${f("take.min","Minimum per order (₹)",P.take.min,1)}${f("take.cap","Cap per order (₹)",P.take.cap,100)}</div>
    <h4>Buyer add-ons</h4><div class="fields">${f("assured.rate","Assured rate",P.assured.rate,0.001)}${f("assured.min","Assured minimum (₹)",P.assured.min,1)}${f("assured.cap","Assured cap (₹)",P.assured.cap,100)}
      ${f("freight.discount","Freight: below supplier's rate",P.freight.discount,0.01)}${f("freight.costShare","Freight: partner cost share",P.freight.costShare,0.01,"of the supplier's usual freight")}
      ${f("inspection.base","Inspection base (₹)",P.inspection.base,50)}${f("inspection.rate","Inspection rate",P.inspection.rate,0.0005)}${f("inspection.costShare","Inspection: inspector's share",P.inspection.costShare,0.05)}
      ${f("insurance.rate","Insurance rate",P.insurance.rate,0.0005)}${f("insurance.min","Insurance minimum (₹)",P.insurance.min,10)}${f("insurance.costShare","Insurance: insurer's share",P.insurance.costShare,0.05)}</div>
    <h4>Cost assumptions (team only)</h4><div class="fields">${f("costs.gatewayPct","Payment gateway",P.costs.gatewayPct,0.001)}${f("costs.opsPerOrder","Ops cost per order (₹)",P.costs.opsPerOrder,10)}${f("costs.aiPerRequest","AI cost per request (₹)",P.costs.aiPerRequest,0.5)}${f("costs.marketingMonthly","Marketing a month (₹)",P.costs.marketingMonthly,1000)}</div>
    <div class="actions"><button class="btn primary">Save pricing</button><button class="btn ghost" type="button" data-action="pricing-reset">Back to defaults</button></div>
    <p class="hint">New prices apply to new orders and plan purchases. Orders already placed keep the rate they were placed at.</p></form>`;
}
/* Reads a form of "a.b.c"-named number inputs into a nested object. */
function formNested(f){const out={};f.querySelectorAll("input[name]").forEach(i=>{if(i.value==="")return;const ks=i.name.split(".");let o=out;ks.slice(0,-1).forEach(k=>o=o[k]||={});o[ks[ks.length-1]]=Number(i.value);});return out;}

/* ===================== WIRING ===================== */
function renderBizViews(){if(!document.getElementById("v-plan")?.hidden)renderPlan();}
Object.assign(ACTIONS,{
  "pr-period":a=>{pricingPeriod=a.dataset.v;if(pub?.view==="pricing")renderPricingPage();else renderPlan();},
  "plan-buy":a=>{const b=a;b.disabled=true;Repo.buyPlan(a.dataset.v,pricingPeriod).then(j=>{if(j.url){toast("Opening Razorpay to pay");window.open(j.url,"_blank","noopener");}else toast("Request sent. Our team will call to collect the payment.");$("#v-plan")._html=null;renderPlan();}).catch(e=>{b.disabled=false;fail(e);});},
  "econ-days":a=>{econ.days=+a.dataset.v;econ.data=null;renderEconomics();},
  "pp-paid":a=>Repo.decidePlanPayment(a.dataset.id,"paid").then(()=>{toast("Plan switched on");econ.data=null;renderEconomics();}).catch(fail),
  "pp-cancel":a=>Repo.decidePlanPayment(a.dataset.id,"cancelled").then(()=>{toast("Cancelled");econ.data=null;renderEconomics();}).catch(fail),
  "pricing-reset":()=>Repo.resetPricing().then(()=>{toast("Default pricing restored");econ.data=null;econ.editing=null;renderEconomics();}).catch(fail),
});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.dataset?.extra){flow.extras={...(flow.extras||{}),[t.dataset.extra]:t.checked};flow.newCard=false;renderBuy();return;}
  if(t.dataset?.svcstatus){Repo.serviceStatus(t.dataset.svcstatus,{services:{status:t.value}}).then(()=>{toast("Saved");t.blur?.();econ.data=null;renderEconomics();}).catch(fail);return;}
  if(t.dataset?.inspstatus){Repo.serviceStatus(t.dataset.inspstatus,{inspection:{status:t.value}}).then(()=>{toast("Inspection updated. The buyer and supplier see it on the order.");t.blur?.();econ.data=null;renderEconomics();}).catch(fail);return;}
});
document.addEventListener("submit",e=>{
  const f=e.target.closest("form[data-form]");if(!f)return;const k=f.dataset.form;
  if(k==="whatif"){e.preventDefault();const v=formNested(f);econ.what={...econ.what,...v,attach:{...econ.what.attach,...(v.attach||{})}};document.activeElement?.blur?.();$("#s-econ")._html=null;renderEconomics();}
  if(k==="pricing"){e.preventDefault();econ.editing=true;Repo.savePricing(formNested(f)).then(()=>{toast("Pricing saved. It applies to new orders and plans.");econ.data=null;document.activeElement?.blur?.();renderEconomics();}).catch(fail);}
});
