/* VyaparBoss UI. Bhai is the built-in buying assistant.
   Buy screen = a short conversation: each answer reveals the next question (product → quantity → city → date),
   then quotes (best pick first, details on demand), then approval. Plain browser script, loaded last. */

/* ===================== STATE ===================== */
const freshFlow=()=>({stage:"start",r:{},msgs:[],open:null,cat:null,sel:null,neg:{},negLast:null,showNeg:false,po:null,busy:false,newCard:true});
let flow=freshFlow();
let ai=null;           // claude.ai artifact runtime `sample` function, or null
let aiState="pending"; // pending | server | live | off
const store=()=>Repo.data;
const fail=e=>{console.error(e);toast(e.message||"Something went wrong. Try again.");};
const initials=n=>String(n).split(/\s+/).filter(w=>/^[A-Za-z]/.test(w)).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"S";
const ico=(id,cls="ic")=>`<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const CAT_INFO={pack:{icon:"cat-pack",name:"Packaging",hint:"Boxes, film, tape"},ind:{icon:"cat-ind",name:"Industrial",hint:"Safety, welding, cleaning"},agri:{icon:"cat-agri",name:"Agri inputs",hint:"Drip, crates, fertiliser"}};
const QTY_PRESETS={kg:[500,1000,2000,5000],pcs:[1000,5000,10000,25000],rolls:[20,50,100,500],boxes:[50,100,250,500]};
const TOP_CITIES=["Pune","Mumbai","Delhi","Ahmedabad","Bengaluru","Chennai","Hyderabad","Indore"];
const DEADLINES=[[3,"In 3 days"],[7,"Within a week"],[15,"In 2 weeks"],[0,"No rush"]];
const TRY=["5000 corrugated boxes, Pune, 7 din","2 tonne NPK 19:19:19 Indore","300 boxes nitrile gloves Chennai"];

/* ===================== BHAI'S BRAIN ===================== */
/* Server AI (Gemini/Claude) → Claude inside claude.ai → built-in Hinglish rules. */
async function understand(text,base){
  if(aiState==="server"){
    try{const j=await Repo.parse(text,base);const p=cleanParsed(j.parsed);if(p)return{parsed:p,via:j.via||"AI"};}catch(e){console.warn("server parse failed",e);}
  }else if(ai&&aiState==="live"){
    try{const p=cleanParsed(await ai.json(buildParsePrompt(text,base),{modelTier:"quick",cache:false}));if(p)return{parsed:p,via:"Claude"};}
    catch(e){if(["not_granted","sampling_disabled","not_declared","capability_disabled","capability_removed"].includes(e.code)){aiState="off";renderAiChip();}}
  }
  return{parsed:ruleParse(text),via:"Rules"};
}
const nextField=r=>!r.productId?"product":!r.qty?"qty":!r.city?"city":r.deadline===undefined?"deadline":null;
function askLine(f){
  const p=PMAP[flow.r.productId];
  return {product:"Kya kharidna hai? Pick a category, or just type it in your own words.",
    qty:`${p?p.name:"Got it"}. Kitna chahiye?`,city:"Delivery kahan chahiye?",deadline:"Kab tak chahiye?"}[f];
}
function bhai(text){flow.msgs.push({who:"b",text,fresh:true});}
function me(text){flow.msgs.push({who:"u",text});}
function fieldLabel(f,r=flow.r){
  const p=PMAP[r.productId];
  if(f==="product")return p?.name;
  if(f==="qty")return r.qty&&p?`${qfmt(r.qty)} ${p.unit}`:null;
  if(f==="city")return r.city;
  if(f==="deadline")return r.deadline===undefined?null:r.deadline?`Within ${r.deadline} days`:"No rush";
}

async function sayToBhai(text){
  text=text.trim();if(!text||flow.busy)return;
  if(flow.stage==="start"||flow.stage==="done"){flow=freshFlow();flow.stage="ask";}
  me(text);flow.busy=true;renderBuy();
  const before=JSON.stringify(flow.r);
  const {parsed,via}=await understand(text,flow.r);
  const {r,notes}=applyParsed(parsed,flow.r);
  if(r.productId!==flow.r.productId&&r.qty===flow.r.qty&&flow.r.qty)delete r.qty; // new product: old quantity no longer fits
  flow.busy=false;flow.open=null;
  const changed=JSON.stringify(r)!==before;
  if(!changed){
    bhai(`Maaf kijiye, samjha nahi. Try something like "5000 boxes Pune 7 din", or pick from the options.`);
    renderBuy();return;
  }
  // A typed request with product, quantity and city doesn't need a date question.
  if(r.deadline===undefined&&r.productId&&r.qty&&r.city&&!parsed.deadline_days)r.deadline=null;
  flow.r=r;flow.neg={};flow.negLast=null;
  if(parsed.product_id)flow.cat=PMAP[parsed.product_id].cat;
  const lead=via!=="Rules"&&parsed.reply?parsed.reply:null;
  if(notes.length)bhai(notes.join("\n"));
  await advance(lead);
}
async function advance(lead){
  const f=nextField(flow.r);
  if(f){flow.stage="ask";bhai(lead||askLine(f));flow.newCard=true;renderBuy();return;}
  await showQuotes(lead);
}
async function showQuotes(lead){
  const r=flow.r,p=PMAP[r.productId];
  const res=discover(r,flow.neg);
  try{
    if(!r.id){const rec=await Repo.createRfq(rfqRecord(r,res));r.id=rec.id;}
    else await Repo.updateRfq(r.id,{productId:r.productId,qty:r.qty,city:r.city,deadline:r.deadline||null,quotes:quoteSummary(res)});
  }catch(e){fail(e);}
  const ok=res.eligible.filter(q=>q.meets),best=ok[0]||res.eligible[0];
  flow.stage="quotes";flow.sel=null;flow.showNeg=false;flow.newCard=true;
  let line;
  if(!res.eligible.length)line=res.offering?`${res.offering} supplier${res.offering>1?"s":""} sell this, but none can take ${qfmt(r.qty)} ${p.unit} to ${r.city} right now. Try a different quantity or city.`:`No supplier in the network sells ${p.name} yet.`;
  else if(!ok.length)line=`${res.eligible.length>1?"Mil gaye":"Mila"} ${res.eligible.length} option${res.eligible.length>1?"s":""}, but none can make it in ${r.deadline} days. The fastest takes ${best.eta} days.`;
  else line=`${res.eligible.length>1?`Mil gaye ${res.eligible.length} options! My pick:`:"Mila 1 option:"} ${best.s.name}, ${inr(best.landed)} delivered to ${r.city}.`;
  bhai((lead?lead+"\n":"")+line);
  renderBuy();
}
function choose(sid){flow.sel=sid;flow.stage="confirm";flow.newCard=true;const q=discover(flow.r,flow.neg).eligible.find(x=>x.s.id===sid);me(`${q.s.name} chahiye`);bhai("Pakka? Check the order once, then approve.");renderBuy();}
async function approve(btn){
  const r=flow.r,res=discover(r,flow.neg),q=res.eligible.find(x=>x.s.id===flow.sel);if(!q)return;
  btn.disabled=true;
  try{
    const o=await Repo.createOrder(orderRecord(r,res,q),{status:"ordered",wonBy:q.s.id,quotes:quoteSummary(res)});
    flow.po=o.po;flow.stage="done";flow.newCard=true;
    bhai(`Ho gaya! Purchase order ${o.po} is with ${q.s.name}. I'll keep an eye on it.`);
    renderBuy();renderOrders();toast(`Order placed: ${o.po}`);
  }catch(e){fail(e);btn.disabled=false;}
}
function negotiateNow(){
  const target=parseFloat($("#negTarget")?.value);if(!(target>0)){toast("Enter the price you'd like to pay per unit.");return;}
  const r=negotiate(discover(flow.r),target);flow.neg=r.neg;flow.negLast=r.out;
  const acc=r.out.filter(x=>x.ok).length;
  bhai(acc?`Baat ho gayi! ${acc} supplier${acc>1?"s":""} agreed to ${inr(target,2)}. Updated prices below.`:`Itna kam nahi hua. I got everyone's best counter-offer; prices below are updated.`);
  flow.newCard=true;renderBuy();
}

/* ===================== BUY: RENDER ===================== */
function heroHTML(){
  return `<section class="hero">
    <div>
      <p class="hello">Namaste! Main Bhai hoon.</p>
      <h1>Bolo kya chahiye.</h1>
      <p class="lede">Tell me what your business needs to buy. I'll find verified suppliers and show you the full price, delivered to your door.</p>
      <form class="askbox" data-form="ask" role="search">
        <input id="heroAsk" autocomplete="off" placeholder="e.g. 5000 corrugated boxes, Pune, 7 din" aria-label="What do you need to buy?">
        <button class="btn primary">Ask Bhai</button>
      </form>
      <div class="try">Try: ${TRY.map(t=>`<button data-action="try" data-v="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      <p class="cats-title">Or pick what you're buying</p>
      <div class="cats">${Object.entries(CAT_INFO).map(([k,c])=>`<button class="cat" data-action="cat" data-cat="${k}">${ico(c.icon,"")}<b>${c.name}</b><span>${c.hint}</span></button>`).join("")}</div>
    </div>
    <div class="hero-art"><p class="bhai-says">Tu business badha, jugaad mera!</p><svg class="bhai-xl" role="img" aria-label="Bhai, your buying assistant"><use href="#bhai"/></svg></div>
  </section>
  <section class="how">
    <div><span class="n">1</span><p><b>Tell Bhai what you need</b><span>Type it the way you'd say it, in English, Hindi or Hinglish.</span></p></div>
    <div><span class="n">2</span><p><b>Compare delivered prices</b><span>Price, GST and freight in one number, from verified suppliers.</span></p></div>
    <div><span class="n">3</span><p><b>Approve and track</b><span>Nothing is ordered until you say yes.</span></p></div>
  </section>`;
}
function stepperHTML(){
  const idx={ask:0,quotes:1,confirm:2,done:3}[flow.stage]??0;
  return `<div class="stepper" aria-label="Progress">${["Your need","Quotes","Approve","Done"].map((s,i)=>`${i?'<i class="sep"></i>':""}<span class="${i===idx?"on":i<idx?"done":""}">${s}</span>`).join("")}</div>`;
}
function msgHTML(m){
  if(m.who==="u")return `<div class="msg u"><div class="bubble">${esc(m.text)}</div></div>`;
  return `<div class="msg b${m.fresh?" fresh":""}">${ico("bhai","av")}<div class="bubble"><span class="by">Bhai</span>${esc(m.text)}</div></div>`;
}
function reqPills(active){
  const fs=["product","qty","city","deadline"].filter(f=>fieldLabel(f)!=null);
  if(!fs.length)return "";
  const names={product:"Product",qty:"Quantity",city:"Deliver to",deadline:"Needed"};
  return `<div class="reqpills">${fs.map(f=>`<button class="req filled" data-action="edit" data-f="${f}" aria-pressed="${active===f}" title="Change ${names[f].toLowerCase()}">${ico("i-edit","")}<span><small>${names[f]}</small><b>${esc(fieldLabel(f))}</b></span></button>`).join("")}</div>`;
}
function askCard(){
  const f=flow.open||nextField(flow.r);const r=flow.r;const p=PMAP[r.productId];
  let body="";
  if(f==="product"){
    if(!flow.cat)body=`<p class="q-title">Pick a category</p><div class="cats small">${Object.entries(CAT_INFO).map(([k,c])=>`<button class="cat" data-action="cat" data-cat="${k}">${ico(c.icon,"")}<b>${c.name}</b></button>`).join("")}</div>`;
    else body=`<button class="back" data-action="cat" data-cat="">${ico("i-back","")}All categories</button>
      <p class="q-title">Which ${CAT_INFO[flow.cat].name.toLowerCase()} item?</p>
      <div class="ptiles">${PRODUCTS.filter(x=>x.cat===flow.cat).map(x=>`<button class="ptile" data-action="pick" data-p="${x.id}"><b>${esc(x.name)}</b><span>${esc(x.spec)}</span></button>`).join("")}</div>`;
  }else if(f==="qty"){
    const moqs=SUPPLIERS.flatMap(s=>s.offers.filter(o=>o.p===p.id).map(o=>o.tiers[0][0]));
    const pre=(QTY_PRESETS[p.unit]||QTY_PRESETS.pcs);
    body=`<p class="q-title">How many ${esc(p.unit)}?</p>
      <form class="qtyrow" data-form="qty"><div class="qtyin"><input id="qtyIn" type="number" min="1" inputmode="numeric" value="${r.qty||""}" aria-label="Quantity in ${esc(p.unit)}"><span>${esc(p.unit)}</span></div><button class="btn primary">Next</button></form>
      <div class="chips">${pre.map(n=>`<button class="chip" data-action="qty" data-v="${n}">${qfmt(n)}</button>`).join("")}</div>
      ${moqs.length?`<p class="hint">Suppliers in the network start from ${qfmt(Math.min(...moqs))} ${esc(p.unit)}.</p>`:""}`;
  }else if(f==="city"){
    const others=Object.keys(CITIES).filter(c=>!TOP_CITIES.includes(c)).sort();
    body=`<p class="q-title">Deliver to which city?</p>
      <div class="chips">${TOP_CITIES.map(c=>`<button class="chip" data-action="city" data-v="${c}" aria-pressed="${r.city===c}">${c}</button>`).join("")}</div>
      <div class="field narrow"><label for="cityOther">Another city</label><select id="cityOther"><option value="">Choose…</option>${others.map(c=>`<option ${r.city===c?"selected":""}>${c}</option>`).join("")}</select></div>`;
  }else if(f==="deadline"){
    body=`<p class="q-title">When do you need it?</p>
      <div class="chips">${DEADLINES.map(([d,l])=>`<button class="chip" data-action="deadline" data-v="${d}" aria-pressed="${(r.deadline||0)===d&&r.deadline!==undefined}">${l}</button>`).join("")}</div>`;
  }
  return `<div class="card${flow.newCard?" fresh":""}">${reqPills(f)}${body}${flow.open&&r.id?`<button class="link" data-action="cancel-edit">Keep it as it was</button>`:""}</div>`;
}
function trustPills(s){
  const t=[];
  t.push(s.sample?`<span class="pill good">${ico("i-shield","")}GST verified</span>`:s.gstOk?`<span class="pill good">${ico("i-shield","")}GSTIN checked</span>`:`<span class="pill warn">GSTIN not checked</span>`);
  if(s.onTime!=null)t.push(`<span class="pill">${s.onTime}% on time</span>`,`<span class="pill gold">${ico("i-star","")}${s.rating}</span>`);
  else t.push(`<span class="pill brand">New supplier</span>`);
  if(s.audit)t.push(`<span class="pill warn">${esc(s.audit)}</span>`);
  return t.join("");
}
function breakdownTable(q,p,r){
  return `<table class="breakdown"><tbody>
    <tr><td>${qfmt(r.qty)} ${p.unit} × ${inr(q.unit,2)}${q.unit<q.list?` <span class="muted">(was ${inr(q.list,2)})</span>`:""}</td><td>${inr(q.subtotal)}</td></tr>
    <tr><td>GST ${q.gstRate}% (${q.gstType})</td><td>${inr(q.gst)}</td></tr>
    <tr><td>Freight: ${q.freightMode.toLowerCase()}, ${qfmt(Math.round(q.weight))} kg over ${qfmt(q.d)} km</td><td>${inr(q.freight)}</td></tr>
    <tr class="tot"><td>Delivered to ${r.city}</td><td>${inr(q.landed)}</td></tr>
  </tbody></table><p class="hint">Ready in ${q.s.lead} day${q.s.lead>1?"s":""}, then ${q.transit} day${q.transit>1?"s":""} on the road. Payment: ${esc(q.s.terms||"to be agreed")}. GST you pay is usually claimable as input credit.</p>`;
}
function quotesCard(){
  const r=flow.r,p=PMAP[r.productId],res=discover(r,flow.neg);
  const ok=res.eligible.filter(q=>q.meets),late=res.eligible.filter(q=>!q.meets);
  const ranked=ok.concat(late),best=ranked[0];
  let html=`<div class="card${flow.newCard?" fresh":""}">${reqPills(null)}`;
  if(!best){
    html+=`<div class="empty" style="padding:10px">${ico("art-shop","")}<p>${res.offering?"No supplier can take this order as it stands.":"Nobody in the network sells this yet."}</p>
      <div class="actions">${res.offering?`<button class="btn" data-action="edit" data-f="qty">Change quantity</button><button class="btn" data-action="edit" data-f="city">Change city</button>`:""}<button class="btn ghost" data-action="go" data-tab="suppliers">Add a supplier</button></div></div>
      ${res.excluded.length?`<details class="more"><summary>Why each supplier said no ${ico("i-chev","")}</summary><div><ul class="excl">${res.excluded.map(x=>`<li><b>${esc(x.s.name)}</b>: ${esc(x.why)}</li>`).join("")}</ul></div></details>`:""}</div>`;
    return html;
  }
  const cheapest=ranked.reduce((a,b)=>b.landed<a.landed?b:a);
  const why=cheapest!==best&&best.meets?`<p class="note">${esc(cheapest.s.name)} is ${inr(best.landed-cheapest.landed)} cheaper${cheapest.meets?"":" but can't make your date"}. I picked ${esc(best.s.name)} for ${best.s.onTime!=null?`a better on-time record (${best.s.onTime}% vs ${cheapest.s.onTime??"no history"}${cheapest.s.onTime!=null?"%":""})`:"the overall balance of price and reliability"}.</p>`
    :ok.length>1?`<p class="note">This is also the cheapest delivered price, ${inr(ranked.slice(1).reduce((a,q)=>a+q.landed,0)/(ranked.length-1)-best.landed)} below the others on average.</p>`:"";
  html+=`<div class="best">
      <span class="tag">${ico("bhai","")}Bhai's pick</span>
      <div class="who"><div class="mono">${esc(initials(best.s.name))}</div><div><h3>${esc(best.s.name)}</h3><div class="where">${ico("i-pin","")}${esc(best.s.area?best.s.area+", ":"")}${best.s.city}, ${qfmt(best.d)} km away</div></div></div>
      <div class="trust">${trustPills(best.s)}${flow.neg[best.s.id]&&best.unit<best.list?`<span class="pill gold">${((1-best.unit/best.list)*100).toFixed(1)}% off after asking</span>`:""}</div>
      <div class="price"><div><div class="total num">${inr(best.landed)}</div><div class="sub">Delivered to ${r.city}, with GST and freight. ${inr(best.per,2)} per ${unitOne(p.unit)}.</div></div>
        <div class="eta${best.meets?"":" late"}">${ico("i-clock","")}${best.meets?`Arrives in about ${best.eta} days`:`Takes ${best.eta} days, after your date`}</div></div>
      ${why}
      <div class="actions"><button class="btn primary big" data-action="choose" data-sid="${esc(best.s.id)}">Choose ${esc(best.s.name.split(" ")[0])}</button></div>
      <details class="more"><summary>See how ${inr(best.landed)} adds up ${ico("i-chev","")}</summary><div>${breakdownTable(best,p,r)}</div></details>
    </div>`;
  const rest=ranked.slice(1,3);
  if(rest.length)html+=`<div class="others"><p class="q-title" style="font-size:17px">Other options</p>${rest.map(q=>`<div class="orow">
      <div><b>${esc(q.s.name)}</b><small>${q.s.city} · ${q.meets?`${q.eta} days`:`${q.eta} days, late`}${q.s.onTime!=null?` · ${q.s.onTime}% on time`:" · new supplier"}</small></div>
      <div class="amt">${inr(q.landed)}<small>${q.landed>best.landed?"+"+inr(q.landed-best.landed):inr(q.landed-best.landed)}</small></div>
      <button class="btn sm" data-action="choose" data-sid="${esc(q.s.id)}">Choose</button></div>`).join("")}</div>`;
  html+=`<details class="more"><summary>Compare all ${res.eligible.length} quotes${res.excluded.length?` and ${res.excluded.length} that couldn't quote`:""} ${ico("i-chev","")}</summary><div>
      <div class="tablewrap"><table class="cmp"><thead><tr><th>Supplier</th><th>Rate</th><th>Goods</th><th>GST</th><th>Freight</th><th>Delivered</th><th>Days</th></tr></thead><tbody>
      ${ranked.map(q=>`<tr><td>${esc(q.s.name)}</td><td>${inr(q.unit,2)}</td><td>${inr(q.subtotal)}</td><td>${inr(q.gst)}</td><td>${inr(q.freight)}</td><td><b>${inr(q.landed)}</b></td><td>${q.eta}${q.meets?"":" (late)"}</td></tr>`).join("")}
      </tbody></table></div>
      ${res.excluded.length?`<ul class="excl">${res.excluded.map(x=>`<li><b>${esc(x.s.name)}</b>: ${esc(x.why)}</li>`).join("")}</ul>`:""}
    </div></details>`;
  html+=flow.showNeg?`<div class="negbox"><div class="field"><label for="negTarget">Price you'd like per ${unitOne(p.unit)} (₹)</label><input id="negTarget" type="number" step="0.01" min="0" value="${(best.list*0.95).toFixed(2)}"></div><button class="btn marigold" data-action="negotiate">Ask all suppliers</button></div>
      <p class="hint">Bhai asks every supplier. Each one only goes as low as their own limit, and nothing is ordered.</p>
      ${flow.negLast?`<div class="negres">${flow.negLast.map(x=>`<span>${esc(x.name)}: ${x.ok?`<b style="color:var(--good)">agreed ${inr(x.price,2)}</b>`:`best ${inr(x.price,2)}`}</span>`).join("")}</div>`:""}`
    :`<p><button class="link" data-action="show-neg">Bhai, thoda kam karwao? Ask for a better price</button></p>`;
  return html+`</div>`;
}
function confirmCard(){
  const r=flow.r,p=PMAP[r.productId],q=discover(r,flow.neg).eligible.find(x=>x.s.id===flow.sel);
  if(!q){flow.stage="quotes";return quotesCard();}
  const by=new Date(Date.now()+q.eta*864e5);
  return `<div class="card${flow.newCard?" fresh":""}">
    <p class="q-title">Your order</p>
    <dl class="summary">
      <dt>Item</dt><dd>${esc(p.name)}</dd>
      <dt>Quantity</dt><dd>${qfmt(r.qty)} ${p.unit}</dd>
      <dt>Supplier</dt><dd>${esc(q.s.name)}, ${q.s.city}</dd>
      <dt>Deliver to</dt><dd>${r.city}, by about ${by.toLocaleDateString("en-IN",{day:"numeric",month:"long"})}</dd>
      <dt>Total</dt><dd class="num">${inr(q.landed)} <span class="muted" style="font-weight:400">with GST and freight</span></dd>
    </dl>
    <details class="more"><summary>Cost breakdown ${ico("i-chev","")}</summary><div>${breakdownTable(q,p,r)}</div></details>
    <label class="approve"><input type="checkbox" id="okBox"><span>I approve this purchase of ${qfmt(r.qty)} ${p.unit} for ${inr(q.landed)}.</span></label>
    <div class="actions"><button class="btn primary big" id="approveBtn" data-action="approve" disabled>Place order</button><button class="btn ghost" data-action="back-quotes">Back to quotes</button></div>
  </div>`;
}
function doneCard(){
  const o=store().orders.find(x=>x.po===flow.po);
  return `<div class="card done${flow.newCard?" fresh":""}">${ico("art-done","art")}
    <h2>Order placed</h2>
    <p>Purchase order <span class="po">${esc(flow.po)}</span> is with ${esc(o?.sname||SMAP[o?.sid]?.name||"the supplier")}.<br>You can follow it under Orders.</p>
    <div class="actions" style="justify-content:center"><button class="btn primary" data-action="go" data-tab="orders">Track order</button><button class="btn" data-action="new-req">Buy something else</button></div>
  </div>`;
}
function renderBuy(){
  const el=$("#v-buy");
  if(flow.stage==="start"){el.innerHTML=heroHTML();return;}
  const typed=$("#composer")?.value||"";
  const card=flow.busy?`<div class="msg b typing">${ico("bhai","av")}<div class="bubble" aria-label="Bhai is typing"><i></i><i></i><i></i></div></div>`
    :{ask:askCard,quotes:quotesCard,confirm:confirmCard,done:doneCard}[flow.stage]();
  el.innerHTML=`<div class="flow">
      <div class="flowtop">${stepperHTML()}<button class="btn sm ghost" data-action="new-req">${ico("i-plus")}New request</button></div>
      ${flow.msgs.map(msgHTML).join("")}
      ${card}
    </div>
    ${flow.stage==="done"?"":`<div class="composer"><form data-form="composer">${ico("bhai","av")}<input id="composer" autocomplete="off" placeholder="Message Bhai, e.g. make it 3000, or deliver to Mumbai" aria-label="Message Bhai"><button class="iconbtn" aria-label="Send">${ico("i-send","")}</button></form></div>`}`;
  const c=$("#composer");if(c)c.value=typed;
  const fresh=el.querySelector(".card.fresh,.typing")||el.querySelector(".msg:last-of-type");
  flow.msgs.forEach(m=>m.fresh=false);flow.newCard=false;
  if(fresh)requestAnimationFrame(()=>{try{fresh.scrollIntoView({block:"nearest",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});}catch(e){}});
}
function setField(f,v,said){
  const r=flow.r;flow.open=null;
  if(f==="product"){if(r.productId!==v){r.productId=v;delete r.qty;}flow.cat=PMAP[v].cat;}
  if(f==="qty")r.qty=v;
  if(f==="city")r.city=v;
  if(f==="deadline")r.deadline=v||null;
  flow.neg={};flow.negLast=null;
  me(said);
  if(!nextField(r))return showQuotes();
  bhai(askLine(nextField(r)));flow.newCard=true;renderBuy();
}

/* ===================== ORDERS ===================== */
function renderOrders(){
  const orders=store().orders,cnt=$("#ordCount");
  cnt.textContent=orders.length;cnt.hidden=!orders.length;
  const el=$("#v-orders");
  if(!orders.length){el.innerHTML=`<div class="pagehead"><div><h1>Orders</h1></div></div><div class="panel empty">${ico("art-truck","")}<h2>No orders yet</h2><p>When you approve a quote, the order shows up here so you can follow it to your door.</p><button class="btn primary" data-action="go" data-tab="buy">Start buying</button></div>`;return;}
  const samples=orders.some(o=>o.sample);
  el.innerHTML=`<div class="pagehead"><div><h1>Orders</h1><p class="muted">${orders.length} order${orders.length>1?"s":""}. Tap one for its full details.</p></div>${samples?`<button class="btn sm ghost" data-action="clear-samples">Remove example orders</button>`:""}</div>
  <div class="olist">${orders.map(o=>{
    const p=PMAP[o.productId],s=SMAP[o.sid],sname=s?.name||o.sname||"Supplier",scity=s?.city||o.scity||"";
    const due=new Date(o.date+o.eta*864e5),saved=Math.max(0,o.avg-o.landed),deliv=o.stage===4;
    return `<div class="panel ocard">
      <div class="ohead"><div><h3>${qfmt(o.qty)} ${p.unit} ${esc(p.name)}</h3><p class="meta">${esc(sname)}${scity?`, ${scity}`:""} to ${o.city}${o.sample?' <span class="pill">Example</span>':""}${o.source==="whatsapp"?' <span class="pill good">WhatsApp</span>':""}</p></div>
        <div class="amt num">${inr(o.landed)}${saved?`<small>You saved ${inr(saved)}</small>`:""}</div></div>
      <div class="track" aria-hidden="true">${STAGES.map((_,i)=>`<i class="${i<o.stage||deliv?"on":i===o.stage?"now":""}"></i>`).join("")}</div>
      <div class="ostatus"><b>${STAGES[o.stage]}</b><span class="muted">${deliv?`Delivered`:`Expected ${dstr(due)}`}${o.deadline&&o.eta>o.deadline?' <span class="pill bad">After your date</span>':""}</span></div>
      ${o.issue?`<p class="issue">Problem reported: ${esc(o.issue)}. VyaparBoss operations will call ${esc(sname)}.</p>`:""}
      <details class="more"><summary>Details ${ico("i-chev","")}</summary><div>
        <p class="hint">Purchase order <b class="num">${esc(o.po)}</b>, placed ${dstr(o.date)}</p>
        <table class="breakdown"><tbody><tr><td>Goods</td><td>${inr(o.subtotal)}</td></tr><tr><td>GST</td><td>${inr(o.gst)}</td></tr><tr><td>Freight</td><td>${inr(o.freight)}</td></tr><tr class="tot"><td>Total</td><td>${inr(o.landed)}</td></tr></tbody></table>
        <div class="steps">${STAGES.map((st,i)=>`<div class="${i<=o.stage?"on":""}">${st}${o.history[i]?`<br><span class="muted">${dstr(o.history[i])}</span>`:""}</div>`).join("")}</div>
        <div class="actions">${o.stage<4?`<button class="btn sm" data-action="advance" data-po="${esc(o.po)}">Mark as ${STAGES[o.stage+1].toLowerCase()}</button>`:""}
          ${o.issue?`<button class="btn sm ghost" data-action="resolve" data-po="${esc(o.po)}">Problem solved</button>`:`<button class="btn sm ghost" data-action="issue" data-po="${esc(o.po)}">Report a problem</button>`}</div>
      </div></details>
    </div>`;}).join("")}</div>`;
}

/* ===================== SUPPLIERS ===================== */
let scat="all";
function supplierCard(s){
  const offers=s.offers.filter(o=>PMAP[o.p]);
  return `<div class="panel scard">
    <div class="who"><div class="mono">${esc(initials(s.name))}</div><div><h3>${esc(s.name)}</h3><div class="where">${ico("i-pin","")}${esc(s.area?s.area+", ":"")}${s.city}</div></div></div>
    <div class="trust">${trustPills(s)}</div>
    ${s.onTime!=null?`<div class="stats3"><span><b>${s.orders??0}</b> orders</span>${s.yrs?`<span><b>${s.yrs}</b> years</span>`:""}<span>Delivers within <b>${qfmt(s.coverage)}</b> km</span></div>`:`<div class="stats3"><span>No orders yet</span><span>Delivers within <b>${qfmt(s.coverage)}</b> km</span></div>`}
    <div class="tags">${offers.map(o=>`<span class="tag">${esc(PMAP[o.p].name)}</span>`).join("")}</div>
    <details class="more"><summary>Rates and terms ${ico("i-chev","")}</summary><div>
      <ul class="plist">${offers.map(o=>`<li><span>${esc(PMAP[o.p].name)}</span><span>from ${inr(o.tiers[o.tiers.length-1][1],2)}/${unitOne(PMAP[o.p].unit)}, min ${qfmt(o.tiers[0][0])}</span></li>`).join("")}</ul>
      <p class="hint">GSTIN <span class="num">${esc(s.gstin||"not given")}</span>${s.sample?" (sample)":""}. Ready in ${s.lead} day${s.lead>1?"s":""}. ${s.terms?`Payment: ${esc(s.terms)}.`:""}${s.certs?.length?` Certified: ${s.certs.map(esc).join(", ")}.`:""}</p>
    </div></details>
    ${s.sample?"":`<div class="actions"><button class="btn sm" data-action="sf-edit" data-sid="${esc(s.id)}">Edit</button><button class="btn sm ghost" data-action="sf-remove" data-sid="${esc(s.id)}">Remove</button></div>`}
  </div>`;
}
function renderSuppliers(){
  const own=store().suppliers.length;
  $("#useSamples").checked=store().useSamples;
  $("#snetIntro").textContent=own?`${own} supplier${own===1?"":"s"} you added${store().useSamples?", plus 15 examples":""}. Ranked by delivered price and track record, not by who pays for listings.`
    :`15 example suppliers for now. Add your real suppliers and Bhai will quote from their rates.`;
  const q=($("#sq").value||"").toLowerCase().trim();
  const list=SUPPLIERS.filter(s=>(scat==="all"||s.offers.some(o=>PMAP[o.p]?.cat===scat))&&(!q||(s.name+" "+s.city+" "+(s.area||"")+" "+s.offers.map(o=>PMAP[o.p]?.name).join(" ")).toLowerCase().includes(q)));
  $("#sgrid").innerHTML=list.length?list.map(supplierCard).join("")
    :SUPPLIERS.length?`<div class="panel empty" style="grid-column:1/-1"><h2>No supplier matches</h2><p>Try another word, or clear the category filter.</p></div>`
    :`<div class="panel empty" style="grid-column:1/-1">${ico("art-shop","")}<h2>No suppliers yet</h2><p>Add the suppliers you already buy from. Bhai will start quoting from their rates straight away.</p><button class="btn primary" data-action="sf-open">${ico("i-plus")}Add supplier</button></div>`;
}
function showSupplierView(v){
  document.querySelectorAll("[data-sview]").forEach(b=>b.setAttribute("aria-selected",b.dataset.sview===v));
  $("#s-network").hidden=v!=="network";$("#s-desk").hidden=v!=="desk";
  if(v==="desk")renderDesk();
}

/* ===================== SUPPLIER ONBOARDING ===================== */
let sf=null; // form state: {id, offers:[{p,tiersText,cap}], errors}
function openSupplierForm(s){
  sf=s?{id:s.id,createdAt:s.createdAt,offers:s.offers.map(o=>({p:o.p,tiersText:tiersText(o.tiers),cap:o.cap})),errors:[]}
      :{id:null,offers:[{p:"",tiersText:"",cap:""}],errors:[]};
  renderSupplierForm(s||{});
  const box=$("#sform");box.hidden=false;
  try{box.scrollIntoView({behavior:"smooth",block:"start"});}catch(e){}
  setTimeout(()=>document.getElementById("sfName")?.focus(),50);
}
function closeSupplierForm(){sf=null;const box=$("#sform");box.hidden=true;box.innerHTML="";}
function offerRow(o,i){
  const opts=Object.entries(CATS).map(([c,l])=>`<optgroup label="${l}">${PRODUCTS.filter(x=>x.cat===c).map(x=>`<option value="${x.id}" ${x.id===o.p?"selected":""}>${esc(x.name)}</option>`).join("")}</optgroup>`).join("");
  const unit=PMAP[o.p]?unitOne(PMAP[o.p].unit):"unit";
  return `<div class="offer" data-i="${i}">
    <div class="field"><label for="sfP${i}">Product</label><select id="sfP${i}" data-off="p"><option value="">Choose…</option>${opts}</select></div>
    <div class="field tiers"><label for="sfT${i}">Rates (quantity:₹ per ${esc(unit)})</label><input id="sfT${i}" data-off="tiersText" placeholder="500:17.9, 2000:16.2, 10000:14.8" value="${esc(o.tiersText)}"></div>
    <div class="field"><label for="sfC${i}">Most per order</label><input id="sfC${i}" data-off="cap" type="number" min="1" inputmode="numeric" value="${esc(o.cap)}"></div>
    <button class="btn sm ghost" data-action="sf-del-offer" data-i="${i}" ${sf.offers.length<2?"disabled":""} aria-label="Remove this product">Remove</button>
  </div>`;
}
function renderSupplierForm(s){
  const cityOpts=Object.keys(CITIES).sort().map(c=>`<option ${c===s.city?"selected":""}>${c}</option>`).join("");
  const v=(k,d="")=>esc(s[k]??d);
  $("#sform").innerHTML=`<div class="panel sform">
    <div><h2>${sf.id?"Edit supplier":"Add a supplier"}</h2><p class="hint">Bhai quotes only from what you enter here: their rates, minimum order and how far they deliver.</p></div>
    <div class="fields">
      <div class="field wide"><label for="sfName">Business name</label><input id="sfName" value="${v("name")}" placeholder="e.g. Hadapsar Cartons Pvt. Ltd."></div>
      <div class="field"><label for="sfCity">Ships from</label><select id="sfCity"><option value="">Choose…</option>${cityOpts}</select></div>
      <div class="field"><label for="sfArea">Area or industrial estate</label><input id="sfArea" value="${v("area")}" placeholder="e.g. Hadapsar MIDC"></div>
      <div class="field wide"><label for="sfGst">GSTIN</label><input id="sfGst" value="${v("gstin")}" maxlength="15" autocapitalize="characters" placeholder="27AAPFU0939F1ZV" class="num"><span class="hint" id="sfGstHint">15 characters. Bhai checks it with the official checksum.</span></div>
      <div class="field"><label for="sfContact">WhatsApp number (optional)</label><input id="sfContact" value="${v("contact")}" inputmode="tel" placeholder="+91 98xxxxxxxx"></div>
      <div class="field"><label for="sfLead">Days to get an order ready</label><input id="sfLead" type="number" min="1" max="60" value="${v("lead",2)}"></div>
      <div class="field"><label for="sfCov">Delivers up to (km)</label><input id="sfCov" type="number" min="25" max="3500" value="${v("coverage",500)}"></div>
      <div class="field"><label for="sfDisc">Most discount they'll give (%)</label><input id="sfDisc" type="number" min="0" max="15" step="0.5" value="${esc(s.maxDiscPct??(s.maxDisc!=null?+(s.maxDisc*100).toFixed(1):3))}"></div>
      <div class="field wide"><label for="sfTerms">Payment terms</label><input id="sfTerms" value="${v("terms")}" placeholder="e.g. 30% advance, balance on delivery"></div>
      <div class="field wide"><label for="sfCerts">Certificates (separate with commas)</label><input id="sfCerts" value="${esc(Array.isArray(s.certs)?s.certs.join(", "):(s.certs||""))}" placeholder="ISO 9001, BIS licence"></div>
    </div>
    <div><h3 style="margin-bottom:8px">What they sell</h3>
      <div class="offers" id="sfOffers">${sf.offers.map(offerRow).join("")}</div>
      <p class="hint" style="margin-top:6px">Write each rate as "from quantity:price". The first quantity is their minimum order, and the price shouldn't go up as quantity goes up.</p>
      <button class="btn sm" data-action="sf-add-offer" style="margin-top:8px">${ico("i-plus")}Add another product</button>
    </div>
    ${sf.errors.length?`<ul class="errors" role="alert">${sf.errors.map(e=>`<li>${esc(e)}</li>`).join("")}</ul>`:""}
    <div class="actions"><button class="btn primary" data-action="sf-save">${sf.id?"Save changes":"Add supplier"}</button><button class="btn ghost" data-action="sf-cancel">Cancel</button></div>
  </div>`;
  updateGstHint();
}
function readOffers(){document.querySelectorAll("#sfOffers .offer").forEach(row=>{const o=sf.offers[+row.dataset.i];row.querySelectorAll("[data-off]").forEach(inp=>{o[inp.dataset.off]=inp.value;});});}
function readSupplierForm(){
  readOffers();
  const g=id=>document.getElementById(id)?.value??"";
  return {id:sf.id,createdAt:sf.createdAt,name:g("sfName"),city:g("sfCity"),area:g("sfArea"),gstin:g("sfGst"),contact:g("sfContact"),lead:g("sfLead"),coverage:g("sfCov"),maxDiscPct:g("sfDisc"),terms:g("sfTerms"),certs:g("sfCerts"),
    offers:sf.offers.filter(o=>o.p||o.tiersText||o.cap).map(o=>({p:o.p,tiersText:o.tiersText,cap:o.cap}))};
}
function updateGstHint(){
  const el=document.getElementById("sfGstHint"),v=document.getElementById("sfGst")?.value.trim();if(!el)return;
  if(!v){el.className="hint";el.textContent="15 characters. Bhai checks it with the official checksum.";return;}
  if(v.length<15){el.className="hint";el.textContent=`${v.length} of 15 characters`;return;}
  const r=checkGstin(v,document.getElementById("sfCity")?.value);
  el.className="hint "+(!r.ok?"bad":r.warn?"warn":"ok");el.textContent=!r.ok?r.why:r.warn||"Valid GSTIN. Confirm it on the GST portal before the first order.";
}
async function saveSupplier(btn){
  const input=readSupplierForm();
  const {ok,s,errors}=normalizeSupplier(input);
  if(!ok){sf.errors=errors;renderSupplierForm(input);return;}
  btn.disabled=true;
  try{
    const saved=await Repo.upsertSupplier(s);
    toast(`${saved.name} ${input.id?"updated":"added"}`);
    closeSupplierForm();renderSuppliers();if(flow.stage==="quotes")renderBuy();
  }catch(e){sf.errors=[e.message];renderSupplierForm(input);}
}

/* ===================== SUPPLIER VIEW ===================== */
function renderDesk(){
  const sel=$("#deskSel");const prev=sel.value;
  sel.innerHTML=SUPPLIERS.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}, ${s.city}</option>`).join("");
  if(prev&&SMAP[prev])sel.value=prev;
  else{const busy=SUPPLIERS.map(s=>[s.id,store().rfqs.filter(r=>r.quotes.some(q=>q.sid===s.id)).length]).sort((a,b)=>b[1]-a[1])[0];if(busy)sel.value=busy[0];}
  const sid=sel.value,s=SMAP[sid];
  if(!s){$("#deskList").innerHTML=`<div class="panel empty">${ico("art-shop","")}<h2>No suppliers yet</h2><p>Add a supplier first.</p></div>`;return;}
  const list=store().rfqs.filter(r=>r.quotes.some(q=>q.sid===sid));
  const canDraft=aiState==="server"||(ai&&aiState==="live");
  $("#deskList").innerHTML=list.length?list.map(r=>{const p=PMAP[r.productId],mine=r.quotes.find(q=>q.sid===sid);
    const rank=[...r.quotes].filter(q=>q.meets).sort((a,b)=>a.landed-b.landed).findIndex(q=>q.sid===sid)+1;
    const status=r.status==="ordered"?(r.wonBy===sid?`<span class="pill good">You won this order</span>`:`<span class="pill">Went to another supplier</span>`):`<span class="pill gold">Open</span>`;
    return `<div class="panel inbox"><div class="ohead"><div><h3>${qfmt(r.qty)} ${p.unit} ${esc(p.name)} to ${r.city}</h3><p class="meta">Request ${esc(r.id)}, ${dstr(r.date)}${r.sample?" (example)":""}${r.source==="whatsapp"?", via WhatsApp":""}</p></div>${status}</div>
      <div class="facts"><div><small>Your rate</small>${inr(mine.unit,2)} per ${unitOne(p.unit)}</div><div><small>Delivered total</small>${inr(mine.landed)}</div><div><small>Delivery</small>${mine.eta} days${mine.meets?"":", after their date"}</div><div><small>Your position</small>${mine.meets&&rank?`#${rank} of ${r.quotes.filter(q=>q.meets).length} on price`:"Can't make their date"}</div></div>
      <textarea id="reply-${esc(r.id)}" aria-label="Reply to the buyer">${esc(templateReply(r,s,mine))}</textarea>
      <div class="actions">${canDraft?`<button class="btn sm" data-action="draft" data-rfq="${esc(r.id)}">${ico("bhai")}Ask Bhai to write it</button>`:""}<button class="btn sm ghost" data-action="copy" data-rfq="${esc(r.id)}">Copy reply</button></div>
    </div>`;}).join(""):`<div class="panel empty">${ico("art-shop","")}<h2>No requests for ${esc(s.name)} yet</h2><p>Requests show up here when a buyer needs something this supplier sells, in a quantity and place they can serve.</p></div>`;
}
function templateReply(r,s,mine){const p=PMAP[r.productId];return `Namaste ji, ${s.name} se. ${qfmt(r.qty)} ${p.unit} ${p.name} (${p.spec}) ke liye hamara rate ${inr(mine.unit,2)} per ${unitOne(p.unit)} + GST ${p.gst}% hai. ${r.city} delivery ${mine.eta} din mein ho jayegi. Payment: ${s.terms||"advance"}. Confirm karein to order dispatch plan bhej dete hain.`;}
async function draftReply(id,btn){
  const r=store().rfqs.find(x=>x.id===id),s=SMAP[$("#deskSel").value],mine=r.quotes.find(q=>q.sid===s.id);const ta=document.getElementById("reply-"+id);
  btn.disabled=true;const prev=ta.value;ta.value="Bhai is writing…";
  try{
    if(aiState==="server"){ta.value=(await Repo.draft(id,s.id)).text;}
    else await ai(buildReplyPrompt(r,s,mine),{modelTier:"quick",cache:false,onText:({text})=>{ta.value=text;}});
  }catch(e){ta.value=e.text||prev;if(e.code!=="cancelled")toast(e.code==="rate_limited"?"Bhai is busy. Try again in a minute.":"Bhai couldn't write it right now. The standard reply is still there.");if(["not_granted","sampling_disabled"].includes(e.code)){aiState="off";renderAiChip();renderDesk();}}
  btn.disabled=false;
}

/* ===================== INSIGHTS ===================== */
function renderInsights(){
  const o=store().orders,gmv=o.reduce((a,x)=>a+x.landed,0),goods=o.reduce((a,x)=>a+x.subtotal,0),saved=o.reduce((a,x)=>a+Math.max(0,x.avg-x.landed),0);
  const rfqs=store().rfqs.length,conv=rfqs?store().rfqs.filter(r=>r.status==="ordered").length/rfqs:0;
  const k=[["Bought through VyaparBoss",lakh(gmv),`${o.length} order${o.length===1?"":"s"}, delivered value`],["Buyers saved",lakh(saved),"versus the average quote"],["Requests that became orders",(conv*100).toFixed(0)+"%",`${rfqs} request${rfqs===1?"":"s"} so far`],["Platform revenue",inr(goods*TAKE),`at a ${TAKE*100}% fee on goods`]];
  $("#kpis").innerHTML=k.map(([a,b,c])=>`<div class="panel kpi"><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join("");
  const by={};o.forEach(x=>{const c=PMAP[x.productId].cat;by[c]=(by[c]||0)+x.landed;});const max=Math.max(1,...Object.values(by));
  $("#catBars").innerHTML=o.length?Object.keys(CATS).map(c=>`<div class="bar"><span>${CAT_INFO[c].name}</span><div class="trackb"><div class="fill" style="width:${((by[c]||0)/max*100).toFixed(1)}%"></div></div><span>${lakh(by[c]||0)}</span></div>`).join("")
    :`<div class="empty" style="padding:6px">${ico("art-chart","")}<p>Spend shows up here after the first order.</p></div>`;
}

/* ===================== WHATSAPP ===================== */
let waChat=[];const WA_TEST_FROM="919800000001";
async function renderWhatsApp(){
  const el=$("#waPanel");
  if($("#v-insights").hidden&&el.innerHTML)return;
  const typed=$("#waInput")?.value||"",hadFocus=document.activeElement?.id==="waInput";
  if(Repo.mode!=="server"){
    el.innerHTML=`<div class="wahead"><h3>Bhai on WhatsApp</h3><span class="pill">Coming soon</span></div>
      <p class="muted">Buyers will text their needs to the VyaparBoss WhatsApp number and get quotes back from Bhai. Reply "APPROVE 1" places the order. This works on the live server, not in this demo copy.</p>`;return;
  }
  el.innerHTML=`<div class="wahead"><h3>Bhai on WhatsApp</h3>${Repo.info.whatsapp?`<span class="pill good">Connected</span>`:`<span class="pill gold">Practice mode</span>`}</div>
    <p class="muted">${Repo.info.whatsapp?"Chat as a buyer to test. These messages aren't sent to a phone.":"WhatsApp isn't connected yet. Chat here exactly as a buyer would on WhatsApp."}</p>
    <div class="wachat" id="waChat">${waChat.length?waChat.map(m=>`<div class="b ${m.dir}">${esc(m.text)}</div>`).join(""):`<div class="muted" style="font-size:14.5px">Try <b>5000 3-ply boxes Pune 7 din</b>, then <b>APPROVE 1</b>, then <b>STATUS</b>.</div>`}</div>
    <div class="warow"><input id="waInput" placeholder="Type as a buyer…" aria-label="Practice WhatsApp message"><button class="iconbtn" data-action="wa-send" aria-label="Send">${ico("i-send","")}</button></div>`;
  const c=$("#waChat");if(c)c.scrollTop=c.scrollHeight;
  const inp=$("#waInput");if(inp){inp.value=typed;if(hadFocus)inp.focus();}
}
async function waSend(){
  const inp=$("#waInput");const text=(inp?.value||"").trim();if(!text)return;
  waChat.push({dir:"in",text});inp.value="";renderWhatsApp();
  try{const {reply}=await Repo.waSimulate(WA_TEST_FROM,text);waChat.push({dir:"out",text:reply});await Repo.refresh();renderAll();}
  catch(e){waChat.push({dir:"out",text:e.message});renderWhatsApp();}
  setTimeout(()=>$("#waInput")?.focus(),0);
}

/* ===================== BHAI STATUS ===================== */
function renderAiChip(){
  const c=$("#aichip");const live=aiState==="server"||aiState==="live";
  c.className="bhai-status"+(live?" live":"");
  c.querySelector("span").textContent=aiState==="pending"?"Bhai…":"Bhai";
  c.title="Bhai: tu business badha, jugaad mera! "+(live?`Online (${aiState==="server"?(Repo.info.provider||"AI"):"Claude"}). Prices and suppliers always come from supplier rate cards.`
    :"Basic mode: understands common Hinglish and English requests without AI.");
}

/* ===================== NAVIGATION ===================== */
function renderAll(){renderOrders();renderSuppliers();if(!$("#s-desk").hidden)renderDesk();renderInsights();renderWhatsApp();}
function showTab(t){
  document.querySelectorAll("#tabs [data-tab],#bottomnav [data-tab]").forEach(b=>{if(b.dataset.tab===t)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});
  document.querySelectorAll(".view").forEach(v=>v.hidden=v.id!=="v-"+t);
  try{localStorage.setItem(KEY+".tab",t);}catch(e){}
  if(t==="buy")renderBuy();else renderAll();
  window.scrollTo({top:0});
  if(Repo.mode==="server")Repo.refresh().then(ch=>ch&&renderAll()).catch(()=>{});
}

const ACTIONS={
  go:a=>showTab(a.dataset.tab),
  try:a=>sayToBhai(a.dataset.v),
  cat:a=>{const c=a.dataset.cat||null;
    if(flow.stage==="start"||flow.stage==="done"){flow=freshFlow();flow.stage="ask";flow.cat=c;me(CAT_INFO[c].name);bhai(`${CAT_INFO[c].name}, achha. Which one?`);}
    else{flow.cat=c;flow.open="product";}
    flow.newCard=true;renderBuy();},
  pick:a=>setField("product",a.dataset.p,PMAP[a.dataset.p].name),
  qty:a=>setField("qty",+a.dataset.v,`${qfmt(+a.dataset.v)} ${PMAP[flow.r.productId].unit}`),
  city:a=>setField("city",a.dataset.v,a.dataset.v),
  deadline:a=>{const d=+a.dataset.v;setField("deadline",d,d?`Within ${d} days`:"No rush");},
  edit:a=>{flow.open=a.dataset.f;if(a.dataset.f==="product")flow.cat=null;flow.stage="ask";flow.newCard=true;renderBuy();},
  "cancel-edit":()=>{flow.open=null;flow.stage=nextField(flow.r)?"ask":"quotes";flow.newCard=true;renderBuy();},
  choose:a=>choose(a.dataset.sid),
  "back-quotes":()=>{flow.stage="quotes";flow.newCard=true;renderBuy();},
  approve:a=>{if($("#okBox")?.checked)approve(a);},
  "show-neg":()=>{flow.showNeg=true;renderBuy();setTimeout(()=>$("#negTarget")?.focus(),30);},
  negotiate:()=>negotiateNow(),
  "new-req":()=>{flow=freshFlow();renderBuy();setTimeout(()=>$("#heroAsk")?.focus(),30);},
  advance:a=>{const o=store().orders.find(x=>x.po===a.dataset.po);if(o&&o.stage<4){const history=o.history.slice();history[o.stage+1]=Date.now();Repo.updateOrder(o.po,{stage:o.stage+1,history}).catch(fail);renderOrders();}},
  issue:a=>{const o=store().orders.find(x=>x.po===a.dataset.po);if(o){Repo.updateOrder(o.po,{issue:o.stage>=3?"Short quantity received":"Dispatch delayed"}).catch(fail);renderOrders();}},
  resolve:a=>{Repo.updateOrder(a.dataset.po,{issue:null}).catch(fail);renderOrders();},
  "clear-samples":async()=>{try{const n=await Repo.clearSamples();renderAll();toast(n?`Removed ${n} example orders`:"No example orders left");}catch(e){fail(e);}},
  draft:a=>draftReply(a.dataset.rfq,a),
  copy:a=>{const ta=document.getElementById("reply-"+a.dataset.rfq);const done=()=>toast("Reply copied");try{navigator.clipboard.writeText(ta.value).then(done,()=>{ta.select();toast("Press Ctrl+C to copy");});}catch(err){ta.select();toast("Press Ctrl+C to copy");}},
  "wa-send":()=>waSend(),
  "sf-open":()=>{showSupplierView("network");openSupplierForm(null);},
  "sf-edit":a=>openSupplierForm(store().suppliers.find(x=>x.id===a.dataset.sid)),
  "sf-cancel":()=>closeSupplierForm(),
  "sf-save":a=>saveSupplier(a),
  "sf-add-offer":()=>{const cur=readSupplierForm();sf.offers.push({p:"",tiersText:"",cap:""});renderSupplierForm(cur);document.getElementById("sfP"+(sf.offers.length-1))?.focus();},
  "sf-del-offer":a=>{const cur=readSupplierForm();sf.offers.splice(+a.dataset.i,1);renderSupplierForm(cur);},
  "sf-remove":a=>{
    if(a.dataset.armed!=="1"){a.dataset.armed="1";a.textContent="Yes, remove";a.classList.add("danger");setTimeout(()=>{if(a.isConnected){a.dataset.armed="";a.textContent="Remove";a.classList.remove("danger");}},4000);return;}
    const s=SMAP[a.dataset.sid];Repo.deleteSupplier(a.dataset.sid).then(()=>{toast(`${s?.name||"Supplier"} removed`);renderSuppliers();if(flow.stage==="quotes")renderBuy();}).catch(fail);
  }
};
document.addEventListener("click",e=>{
  const nav=e.target.closest("#tabs [data-tab],#bottomnav [data-tab]");if(nav){showTab(nav.dataset.tab);return;}
  const sv=e.target.closest("[data-sview]");if(sv){showSupplierView(sv.dataset.sview);return;}
  const chip=e.target.closest("#scat [data-cat]");if(chip){scat=chip.dataset.cat;document.querySelectorAll("#scat [data-cat]").forEach(x=>x.setAttribute("aria-pressed",x===chip));renderSuppliers();return;}
  const a=e.target.closest("[data-action]");if(!a||!ACTIONS[a.dataset.action])return;
  if(a.tagName==="A")e.preventDefault();
  ACTIONS[a.dataset.action](a,e);
});
document.addEventListener("submit",e=>{
  const f=e.target.closest("form[data-form]");if(!f)return;e.preventDefault();
  if(f.dataset.form==="ask")sayToBhai($("#heroAsk").value);
  if(f.dataset.form==="composer"){const v=$("#composer").value;$("#composer").value="";sayToBhai(v);}
  if(f.dataset.form==="qty"){const n=Math.round(+$("#qtyIn").value);if(n>0)setField("qty",n,`${qfmt(n)} ${PMAP[flow.r.productId].unit}`);else toast("Enter a quantity above zero.");}
});
document.addEventListener("input",e=>{if(e.target.id==="sfGst")updateGstHint();if(e.target.id==="sq")renderSuppliers();});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.id==="waInput"){e.preventDefault();waSend();}});
document.addEventListener("change",e=>{
  const id=e.target.id;
  if(id==="okBox"){$("#approveBtn").disabled=!e.target.checked;return;}
  if(id==="cityOther"&&e.target.value){setField("city",e.target.value,e.target.value);return;}
  if(id==="useSamples"){Repo.setUseSamples(e.target.checked).then(()=>{renderSuppliers();if(flow.stage==="quotes")renderBuy();}).catch(fail);return;}
  if(id==="deskSel"){renderDesk();return;}
  if(id==="sfCity"){updateGstHint();return;}
  if(/^sfP\d+$/.test(id)){const cur=readSupplierForm();renderSupplierForm(cur);}
});

/* ===================== BOOT ===================== */
(async function boot(){
  renderBuy();renderAiChip();
  await Repo.init();
  if(Repo.mode==="server"){aiState=Repo.info.ai?"server":"off";setInterval(()=>{if(!document.hidden)Repo.refresh().then(ch=>ch&&renderAll()).catch(()=>{});},20000);}
  renderAiChip();renderAll();
  try{const t=localStorage.getItem(KEY+".tab");if(t&&t!=="buy"&&$(`#v-${t}`))showTab(t);}catch(e){}
  if(aiState==="pending"){
    if(window.claude?.use){claude.use("sample").then(s=>{ai=s;aiState=s?"live":"off";renderAiChip();}).catch(()=>{aiState="off";renderAiChip();});}
    else{aiState="off";renderAiChip();}
  }
})();
