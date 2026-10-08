/* VyaparBoss — UI: chat, results, orders, supplier network, supplier desk, metrics. Plain browser script (no build step); loaded last by index.html. */
/* ===================== UI STATE ===================== */
let rfq=null;          // the working requirement
let thread=[];         // chat messages
let neg={};            // negotiated prices by supplier id for the current rfq
let negLast=null;      // last negotiation round, for display
let selected=null;     // selected supplier id
let ai=null;           // claude.ai artifact runtime `sample` function, or null
let aiState="pending"; // pending | server | live | off
const store=()=>Repo.data;
const fail=e=>{console.error(e);toast(e.message||"Something went wrong. Try again.");};

/* ===================== CHAT ===================== */
function pushMsg(m){thread.push(m);renderThread();}
function renderThread(){
  const el=$("#thread");
  el.innerHTML=thread.map(m=>{
    if(m.role==="u")return `<div class="msg u">${m.sample?'<span class="tag">Example request</span>':""}${esc(m.text)}</div>`;
    const chips=m.chips?`<div class="chips">${m.chips.map(c=>`<button class="chipbtn" data-action="chip" data-v="${esc(c)}">${esc(c)}</button>`).join("")}</div>`:"";
    const trace=m.trace?`<div class="trace">${m.trace.map(x=>`<span class="${x.run?"run":""}">${esc(x.t)}</span>`).join("")}</div>`:"";
    return `<div class="msg a"><span class="tag">VyaparBoss${m.via?` · ${esc(m.via)}`:""}</span>${esc(m.text)}${trace}${chips}</div>`;
  }).join("");
  el.scrollTop=el.scrollHeight;
}
/* Buyer Intelligence Agent: server Claude → in-artifact Claude → rule parser. */
async function understand(text,base){
  if(aiState==="server"){
    try{const j=await Repo.parse(text,base);const p=cleanParsed(j.parsed);if(p)return{parsed:p,via:j.via||"Claude"};}catch(e){console.warn("server parse failed",e);}
  }else if(ai&&aiState==="live"){
    try{const p=cleanParsed(await ai.json(buildParsePrompt(text,base),{modelTier:"quick",cache:false}));if(p)return{parsed:p,via:"Claude"};}
    catch(e){if(["not_granted","sampling_disabled","not_declared","capability_disabled","capability_removed"].includes(e.code)){aiState="off";renderAiChip();}}
  }
  return{parsed:ruleParse(text),via:"Rules"};
}
async function send(text){
  text=text.trim();if(!text)return;
  $("#ask").value="";
  pushMsg({role:"u",text});
  pushMsg({role:"a",text:"Reading your requirement…",trace:[{t:"Buyer Intelligence Agent: extracting specs",run:true}]});
  $("#sendBtn").disabled=true;
  const base=rfq&&missing(rfq).length?rfq:null; // continue an incomplete requirement
  const {parsed,via}=await understand(text,base);
  const reply=via!=="Rules"?parsed.reply:null;
  const {r,notes}=applyParsed(parsed,base);
  thread.pop();
  await finishRequirement(r,notes,via,reply,false);
  $("#sendBtn").disabled=false;
}
async function finishRequirement(r,notes,via,reply,isSample){
  rfq={...r,id:null};neg={};negLast=null;selected=null;
  const miss=missing(rfq);
  if(miss.length){
    let ask,chips=null;
    if(miss.includes("product")){ask="Kaunsa product chahiye? Abhi yeh categories live hain: packaging, industrial consumables aur agri inputs.";chips=["3-ply corrugated boxes","Food-grade LDPE film","Nitrile gloves","Drip lateral rolls","NPK 19:19:19"];}
    else if(miss.includes("quantity")){ask=`Kitna chahiye? Quantity in ${PMAP[rfq.productId].unit} batayiye.`;}
    else {ask="Delivery kis city mein chahiye?";chips=["Pune","Mumbai","Ahmedabad","Delhi","Chennai","Bengaluru","Hyderabad","Indore"];}
    pushMsg({role:"a",via,text:(reply?reply+"\n\n":"")+ask,chips});
    renderResults();return;
  }
  const res=discover(rfq,neg);
  if(!isSample)await recordRfq(res);
  const p=PMAP[rfq.productId];const ok=res.eligible.filter(q=>q.meets);
  const trace=[
    {t:`Buyer Intelligence: ${p.name}, ${qfmt(rfq.qty)} ${p.unit}, ${rfq.city}${rfq.deadline?`, ${rfq.deadline} days`:""}`},
    {t:`Supplier Discovery: ${res.eligible.length} of ${res.offering} suppliers qualify`},
    {t:`RFQ: ${res.eligible.length} quotes from verified rate cards`},
    {t:`Optimization: ranked on total landed cost`}
  ];
  let text;
  if(!res.eligible.length) text=res.offering?`${res.offering} suppliers stock this, but none can take ${qfmt(rfq.qty)} ${p.unit} to ${rfq.city}. See the reasons on the right; changing quantity or city may open options.`:`No supplier in the network offers ${p.name} yet. Add one under Supplier network.`;
  else if(!ok.length) text=`${res.eligible.length} suppliers can supply, but none can deliver within ${rfq.deadline} days. Fastest is ${Math.min(...res.eligible.map(q=>q.eta))} days.`;
  else {const b=ok[0];text=`Best option: ${b.s.name}, ${inr(b.landed)} landed (${inr(b.per,2)} per ${unitOne(p.unit)}), delivery in about ${b.eta} days. Review and approve on the right.`;}
  if(notes.length)text+="\n"+notes.join("\n");
  pushMsg({role:"a",via,text:(reply?reply+"\n\n":"")+text,trace});
  renderResults();
}
async function recordRfq(res){
  try{const rec=await Repo.createRfq(rfqRecord(rfq,res));rfq.id=rec.id;}catch(e){fail(e);}
}
let rfqSyncTimer=null;
function syncRecordedRfq(res){
  if(!rfq?.id)return;const rec=store().rfqs.find(x=>x.id===rfq.id);if(!rec||rec.status!=="open")return;
  const patch={productId:rfq.productId,qty:rfq.qty,city:rfq.city,deadline:rfq.deadline||null,quotes:quoteSummary(res)};
  if(JSON.stringify(patch)===JSON.stringify({productId:rec.productId,qty:rec.qty,city:rec.city,deadline:rec.deadline,quotes:rec.quotes}))return;
  Object.assign(rec,patch);clearTimeout(rfqSyncTimer);
  rfqSyncTimer=setTimeout(()=>Repo.updateRfq(rec.id,patch).catch(fail),600);
}

/* ===================== RESULTS PANE ===================== */
function supplierTags(s){
  const t=[];
  if(s.sample)t.push(`<span class="pill verify">✓ GST verified</span>`);
  else t.push(s.gstOk?`<span class="pill verify">✓ GSTIN format valid</span>`:`<span class="pill warn">GSTIN unchecked</span>`,`<span class="pill acc">New supplier</span>`);
  if(s.audit)t.push(`<span class="pill warn">${esc(s.audit)}</span>`);
  return t;
}
function renderResults(){
  const el=$("#results");
  if(!rfq){el.innerHTML=`<div class="panel empty"><h3>No requirement yet</h3><p>Tell the assistant what you need. It builds the RFQ here, finds qualified suppliers and compares landed cost.</p></div>`;return;}
  const p=PMAP[rfq.productId];const miss=missing(rfq);
  const prodOpts=Object.entries(CATS).map(([c,l])=>`<optgroup label="${l}">${PRODUCTS.filter(x=>x.cat===c).map(x=>`<option value="${x.id}" ${x.id===rfq.productId?"selected":""}>${esc(x.name)}</option>`).join("")}</optgroup>`).join("");
  const cityOpts=Object.keys(CITIES).sort().map(c=>`<option ${c===rfq.city?"selected":""}>${c}</option>`).join("");
  let html=`<div class="panel rfq">
    <div class="rfqhead"><div><div class="eyebrow">Structured requirement ${rfq.id?`· <span class="num">${rfq.id}</span>`:"· draft"}</div><h2>${p?esc(p.name):"Choose a product"}</h2></div>
    ${p?`<span class="pill">${CATS[p.cat]} · HSN ${p.hsn}</span>`:""}</div>
    <div class="fields">
      <div class="field wide ${miss.includes("product")?"miss":""}"><label for="fProd">Product</label><select id="fProd"><option value="">Select…</option>${prodOpts}</select></div>
      <div class="field ${miss.includes("quantity")?"miss":""}"><label for="fQty">Quantity${p?` (${p.unit})`:""}</label><input id="fQty" type="number" min="1" inputmode="numeric" value="${rfq.qty||""}"></div>
      <div class="field ${miss.includes("city")?"miss":""}"><label for="fCity">Deliver to</label><select id="fCity"><option value="">Select…</option>${cityOpts}</select></div>
      <div class="field"><label for="fDl">Needed within (days)</label><input id="fDl" type="number" min="1" inputmode="numeric" value="${rfq.deadline||""}" placeholder="Flexible"></div>
    </div>
    ${p?`<div class="specline">Spec: <b>${esc(p.spec)}</b>${rfq.notes?` · Buyer note: ${esc(rfq.notes)}`:""} · GST ${p.gst}% (illustrative)</div>`:""}
  </div>`;
  if(miss.length){html+=`<div class="panel empty" style="margin-top:14px"><h3>Missing: ${miss.join(", ")}</h3><p>Answer in the chat or fill the highlighted field to fetch quotes.</p></div>`;el.innerHTML=html;return;}

  const res=discover(rfq,neg);syncRecordedRfq(res);
  const ok=res.eligible.filter(q=>q.meets),late=res.eligible.filter(q=>!q.meets);
  if(!selected||!res.eligible.find(q=>q.s.id===selected))selected=(ok[0]||res.eligible[0])?.s.id||null;
  const rec=ok[0];
  html+=`<div class="agents" style="margin-top:14px">
    <div class="agent"><b>Supplier Discovery</b><span class="k">${res.eligible.length}/${res.offering}</span> qualified on MOQ, capacity and route</div>
    <div class="agent"><b>RFQ</b><span class="k">${res.eligible.length}</span> quotes from verified rate cards</div>
    <div class="agent"><b>Optimization</b>${rec?`Lowest landed: <span class="k">${inr(Math.min(...ok.map(q=>q.landed)))}</span>`:"No on-time option"}</div>
    <div class="agent"><b>Deadline</b>${rfq.deadline?`<span class="k">${ok.length}</span> can deliver in ${rfq.deadline} days`:"Flexible"}</div>
  </div>`;
  if(ok.length>1){
    const cheapUnit=[...ok].sort((a,b)=>a.unit-b.unit)[0];const cheapLanded=[...ok].sort((a,b)=>a.landed-b.landed)[0];
    if(cheapUnit.s.id!==cheapLanded.s.id){html+=`<div class="insight" style="margin-top:12px"><span>💡</span><span><b>Lowest price isn't lowest cost.</b> ${esc(cheapUnit.s.name)} quotes the lowest unit price (${inr(cheapUnit.unit,2)}), but freight from ${cheapUnit.s.city} makes it ${inr(cheapUnit.landed-cheapLanded.landed)} dearer delivered than ${esc(cheapLanded.s.name)}.</span></div>`;}
    else{const avg=ok.reduce((a,q)=>a+q.landed,0)/ok.length;html+=`<div class="insight" style="margin-top:12px"><span>💡</span><span><b>${inr(avg-cheapLanded.landed)} below the average quote.</b> ${esc(cheapLanded.s.name)} is cheapest both ex-works and delivered to ${rfq.city}.</span></div>`;}
  }
  const maxScore=Math.max(...res.eligible.map(q=>q.score||0),1);
  const card=(q,isRec)=>{
    const tags=supplierTags(q.s);
    (q.s.certs||[]).slice(0,2).forEach(c=>tags.push(`<span class="pill">${esc(c)}</span>`));
    if(neg[q.s.id]&&q.unit<q.list)tags.push(`<span class="pill acc">Negotiated −${((1-q.unit/q.list)*100).toFixed(1)}%</span>`);
    const track=q.s.onTime!=null?`★ ${q.s.rating} · ${q.s.onTime}% on time`:"No order history yet";
    return `<div class="q ${q.s.id===selected?"sel":""} ${q.meets?"":"late"}" data-action="select" data-sid="${esc(q.s.id)}" tabindex="0" role="button" aria-pressed="${q.s.id===selected}">
      ${isRec?`<span class="rec">RECOMMENDED</span>`:""}
      <div class="who"><h4>${esc(q.s.name)}</h4><div class="loc">${esc(q.s.area||"")}${q.s.area?", ":""}${q.s.city} · ${qfmt(q.d)} km · ${track}</div><div class="tags">${tags.join("")}</div></div>
      <div class="money">
        <div><span>Unit price</span><span class="num">${inr(q.unit,2)}</span></div>
        <div><span>Goods</span><span class="num">${inr(q.subtotal)}</span></div>
        <div><span>GST ${q.gstRate}%</span><span class="num">${inr(q.gst)}</span></div>
        <div><span>Freight</span><span class="num">${inr(q.freight)}</span></div>
      </div>
      <div class="total"><div class="big">${inr(q.landed)}</div><div class="per">${inr(q.per,2)} landed / ${unitOne(p.unit)}</div>
        <div class="eta">${q.meets?`<span class="pill good">${q.eta} days</span>`:`<span class="pill bad">${q.eta} days · late</span>`}</div></div>
      <span class="scorebar" style="width:${(q.score/maxScore*100).toFixed(0)}%"></span>
    </div>`;};
  html+=`<div class="ledgerhead"><h3>Landed-cost comparison</h3><span class="muted">Click a quote to select it</span></div><div class="quotes">`;
  if(!res.eligible.length)html+=`<div class="panel empty"><h3>No supplier qualifies</h3><p>Try a different quantity or a nearer delivery city.</p></div>`;
  ok.forEach((q,i)=>html+=card(q,i===0));
  if(late.length){html+=`<div class="eyebrow" style="margin-top:8px">Can't meet the ${rfq.deadline}-day deadline</div>`;late.forEach(q=>html+=card(q,false));}
  html+=`</div>`;
  if(res.excluded.length)html+=`<details class="excluded"><summary>${res.excluded.length} supplier${res.excluded.length>1?"s":""} stock this but were excluded</summary><ul>${res.excluded.map(x=>`<li><b>${esc(x.s.name)}</b> (${x.s.city}): ${esc(x.why)}</li>`).join("")}</ul></details>`;

  const q=res.eligible.find(x=>x.s.id===selected);
  if(q){
    html+=`<div class="action">
      <div class="panel"><h4>${esc(q.s.name)} · cost breakdown</h4>
        <table class="breakdown"><tbody>
          <tr><td>${qfmt(rfq.qty)} ${p.unit} × ${inr(q.unit,2)}${q.unit!==q.list?` <span class="muted">(list ${inr(q.list,2)})</span>`:""}</td><td>${inr(q.subtotal)}</td></tr>
          <tr><td>${q.gstType} @ ${q.gstRate}%</td><td>${inr(q.gst)}</td></tr>
          <tr><td>Freight · ${q.freightMode}, ${qfmt(Math.round(q.weight))} kg over ${qfmt(q.d)} km</td><td>${inr(q.freight)}</td></tr>
          <tr class="tot"><td>Total landed cost</td><td>${inr(q.landed)}</td></tr>
        </tbody></table>
        <p class="muted" style="font-size:12.5px;margin:10px 0 0">Ready in ${q.s.lead} days + ${q.transit} day${q.transit>1?"s":""} transit. Terms: ${esc(q.s.terms||"to be agreed")}. GST paid is usually claimable as input tax credit.</p>
      </div>
      <div class="panel"><h4>Negotiate, then approve</h4>
        <div class="negrow">
          <div class="field"><label for="fTarget">Target price per ${unitOne(p.unit)} (₹)</label><input id="fTarget" type="number" step="0.01" min="0" value="${(q.list*0.95).toFixed(2)}"></div>
          <button class="btn" data-action="negotiate">Ask all suppliers</button>
        </div>
        ${negLast?`<div class="negout">${negLast.map(x=>`<span>${esc(x.name)}: ${x.ok?`<b style="color:var(--good)">accepted ${inr(x.price,2)}</b>`:`best ${inr(x.price,2)}`}</span>`).join("")}</div>`:`<p class="muted" style="font-size:12.5px;margin:8px 0 0">The negotiation agent only works inside your target. It never commits to a purchase.</p>`}
        <label class="approve"><input type="checkbox" id="fOk"><span>I approve buying ${qfmt(rfq.qty)} ${p.unit} from <b>${esc(q.s.name)}</b> for <b>${inr(q.landed)}</b> landed, delivered to ${rfq.city}.</span></label>
        <button class="btn primary" data-action="approve" id="approveBtn" disabled>Approve and raise PO</button>
      </div>
    </div>`;
  }
  el.innerHTML=html;
}

/* ===================== ORDERS ===================== */
async function raisePO(){
  if(!rfq.id)await recordRfq(discover(rfq,neg));
  const res=discover(rfq,neg);const q=res.eligible.find(x=>x.s.id===selected);if(!q)return;
  $("#approveBtn").disabled=true;
  try{
    const o=await Repo.createOrder(orderRecord(rfq,res,q),{status:"ordered",wonBy:q.s.id,quotes:quoteSummary(res)});
    pushMsg({role:"a",text:`PO ${o.po} raised with ${q.s.name} for ${inr(q.landed)}. I'll track dispatch and delivery in Orders.`});
    rfq=null;neg={};negLast=null;selected=null;renderResults();renderAll();toast(`PO ${o.po} raised`);
  }catch(e){fail(e);$("#approveBtn").disabled=false;}
}
function renderOrders(){
  const orders=store().orders;
  $("#ordCount").textContent=orders.length;
  const el=$("#orders");
  if(!orders.length){el.innerHTML=`<div class="panel empty"><h3>No orders yet</h3><p>Approve a quote on the Procure tab to raise your first purchase order.</p></div>`;return;}
  el.innerHTML=orders.map(o=>{const p=PMAP[o.productId],s=SMAP[o.sid];const sname=s?.name||o.sname||"Supplier",scity=s?.city||o.scity||"";const due=new Date(o.date+o.eta*864e5);
    return `<div class="panel order">
      <div class="oh"><div><div class="po">${esc(o.po)} · ${dstr(o.date)}${o.sample?' · <span class="pill">Sample</span>':""}${o.source==="whatsapp"?' · <span class="pill verify">via WhatsApp</span>':""}</div><h4>${qfmt(o.qty)} ${p.unit} · ${esc(p.name)}</h4></div>
        <div style="text-align:right"><div class="num" style="font-size:18px">${inr(o.landed)}</div><div class="muted" style="font-size:12px">saved ${inr(Math.max(0,o.avg-o.landed))} vs avg quote</div></div></div>
      <div class="facts"><div><span>Supplier</span>${esc(sname)}${scity?`, ${scity}`:""}</div><div><span>Deliver to</span>${o.city}</div><div><span>Expected by</span>${dstr(due)}${o.deadline&&o.eta>o.deadline?' <span class="pill bad">late</span>':""}</div><div><span>Goods + GST + freight</span><span class="num" style="display:inline;color:inherit;font-size:13px">${inr(o.subtotal)} + ${inr(o.gst)} + ${inr(o.freight)}</span></div></div>
      <div class="steps">${STAGES.map((st,i)=>`<div class="step ${i<o.stage?"done":i===o.stage?(o.stage===4?"done":"now"):""}">${st}${o.history[i]?`<br><span class="muted">${dstr(o.history[i])}</span>`:""}</div>`).join("")}</div>
      ${o.issue?`<div class="insight" style="background:var(--bad-tint)"><span>⚠️</span><span><b style="color:var(--bad)">Issue reported:</b> ${esc(o.issue)}. Operations will contact ${esc(sname)}.</span></div>`:""}
      <div class="acts">${o.stage<4?`<button class="btn sm" data-action="advance" data-po="${esc(o.po)}">Mark "${STAGES[o.stage+1]}"</button>`:`<span class="pill good">Delivered</span>`}
        ${o.issue?`<button class="btn sm ghost" data-action="resolve" data-po="${esc(o.po)}">Mark issue resolved</button>`:`<button class="btn sm ghost" data-action="issue" data-po="${esc(o.po)}">Report a problem</button>`}</div>
    </div>`;}).join("");
}

/* ===================== SUPPLIERS ===================== */
let scat="all";
function supplierCard(s){
  const offers=s.offers.filter(o=>PMAP[o.p]);
  return `<div class="panel scard">
    <div><h4>${esc(s.name)}</h4><div class="muted" style="font-size:12.5px">${esc(s.area||"")}${s.area?", ":""}${s.city}${s.yrs?` · ${s.yrs} yrs in business`:""}</div></div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">${supplierTags(s).join("")}${s.sample&&!s.audit?`<span class="pill verify">✓ Site audited</span>`:""}${(s.certs||[]).map(c=>`<span class="pill">${esc(c)}</span>`).join("")}</div>
    <div class="gst">GSTIN ${esc(s.gstin||"—")}${s.sample?' <span class="muted">(sample)</span>':""}</div>
    <div class="stats"><div><span>On time</span><span class="num">${s.onTime!=null?s.onTime+"%":"—"}</span></div><div><span>Rating</span><span class="num">${s.rating!=null?"★ "+s.rating:"—"}</span></div><div><span>Orders</span><span class="num">${s.orders??0}</span></div></div>
    <ul class="plist">${offers.map(o=>`<li><span>${esc(PMAP[o.p].name)}</span><span class="num">from ${inr(o.tiers[o.tiers.length-1][1],2)}/${unitOne(PMAP[o.p].unit)} · MOQ ${qfmt(o.tiers[0][0])}</span></li>`).join("")}</ul>
    <div class="muted" style="font-size:12px">Delivers within ${qfmt(s.coverage)} km · ready in ${s.lead} day${s.lead>1?"s":""}${s.terms?` · ${esc(s.terms)}`:""}</div>
  </div>`;
}
function renderSuppliers(){
  const q=($("#sq").value||"").toLowerCase().trim();
  const list=SUPPLIERS.filter(s=>(scat==="all"||s.offers.some(o=>PMAP[o.p]?.cat===scat))&&(!q||(s.name+" "+s.city+" "+(s.area||"")+" "+s.offers.map(o=>PMAP[o.p]?.name).join(" ")).toLowerCase().includes(q)));
  $("#sgrid").innerHTML=list.length?list.map(supplierCard).join(""):`<div class="panel empty"><h3>No supplier matches</h3><p>Try another search term.</p></div>`;
}

/* ===================== SUPPLIER DESK ===================== */
function renderDesk(){
  const sel=$("#deskSel");const prev=sel.value;
  sel.innerHTML=SUPPLIERS.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} · ${s.city}</option>`).join("");
  if(prev&&SMAP[prev])sel.value=prev;
  else{const busy=SUPPLIERS.map(s=>[s.id,store().rfqs.filter(r=>r.quotes.some(q=>q.sid===s.id)).length]).sort((a,b)=>b[1]-a[1])[0];if(busy)sel.value=busy[0];}
  const sid=sel.value,s=SMAP[sid];
  if(!s){$("#deskList").innerHTML=`<div class="panel empty"><h3>No suppliers yet</h3><p>Add a supplier under Supplier network.</p></div>`;return;}
  const list=store().rfqs.filter(r=>r.quotes.some(q=>q.sid===sid));
  const canDraft=aiState==="server"||(ai&&aiState==="live");
  $("#deskList").innerHTML=list.length?list.map(r=>{const p=PMAP[r.productId],mine=r.quotes.find(q=>q.sid===sid);
    const rank=[...r.quotes].filter(q=>q.meets).sort((a,b)=>a.landed-b.landed).findIndex(q=>q.sid===sid)+1;
    const status=r.status==="ordered"?(r.wonBy===sid?`<span class="pill good">Won · PO raised</span>`:`<span class="pill">Not selected</span>`):`<span class="pill acc">Open</span>`;
    return `<div class="panel inbox"><div class="ih"><div><div class="po num muted" style="font-size:12.5px">${esc(r.id)} · ${dstr(r.date)}${r.sample?" · Sample":""}${r.source==="whatsapp"?" · via WhatsApp":""}</div><h4 style="margin:2px 0 0;font-size:15.5px">${qfmt(r.qty)} ${p.unit} ${esc(p.name)} → ${r.city}</h4></div>${status}</div>
      <div class="facts" style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px">
        <div><span class="muted" style="display:block;font-size:11.5px">Your auto-quote</span><span class="num">${inr(mine.unit,2)}/${unitOne(p.unit)}</span></div>
        <div><span class="muted" style="display:block;font-size:11.5px">Your landed total</span><span class="num">${inr(mine.landed)}</span></div>
        <div><span class="muted" style="display:block;font-size:11.5px">Delivery</span>${mine.eta} days${mine.meets?"":" (misses deadline)"}</div>
        <div><span class="muted" style="display:block;font-size:11.5px">Rank on landed cost</span>${mine.meets&&rank?`#${rank} of ${r.quotes.filter(q=>q.meets).length}`:"Not ranked"}</div>
      </div>
      <textarea id="reply-${esc(r.id)}" aria-label="Reply to buyer">${esc(templateReply(r,s,mine))}</textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${canDraft?`<button class="btn sm" data-action="draft" data-rfq="${esc(r.id)}">Redraft with sales assistant</button>`:""}<button class="btn sm ghost" data-action="copy" data-rfq="${esc(r.id)}">Copy reply</button></div>
    </div>`;}).join(""):`<div class="panel empty"><h3>No RFQs for ${esc(s.name)} yet</h3><p>RFQs appear here when a buyer's requirement matches this supplier's products, capacity and delivery area.</p></div>`;
}
function templateReply(r,s,mine){const p=PMAP[r.productId];return `Namaste ji, ${s.name} se. ${qfmt(r.qty)} ${p.unit} ${p.name} (${p.spec}) ke liye hamara rate ${inr(mine.unit,2)} per ${unitOne(p.unit)} + GST ${p.gst}% hai. ${r.city} delivery ${mine.eta} din mein ho jayegi. Payment: ${s.terms||"advance"}. Confirm karein to order dispatch plan bhej dete hain.`;}
async function draftReply(id,btn){
  const r=store().rfqs.find(x=>x.id===id),s=SMAP[$("#deskSel").value],mine=r.quotes.find(q=>q.sid===s.id);const ta=document.getElementById("reply-"+id);
  btn.disabled=true;const prev=ta.value;ta.value="Drafting…";
  try{
    if(aiState==="server"){ta.value=(await Repo.draft(id,s.id)).text;}
    else await ai(buildReplyPrompt(r,s,mine),{modelTier:"quick",cache:false,onText:({text})=>{ta.value=text;}});
  }catch(e){ta.value=e.text||prev;if(e.code!=="cancelled")toast(e.code==="rate_limited"?"Too many requests. Try again in a minute.":"Couldn't reach the sales assistant. The template reply is still there.");if(["not_granted","sampling_disabled"].includes(e.code)){aiState="off";renderAiChip();renderDesk();}}
  btn.disabled=false;
}

/* ===================== INSIGHTS ===================== */
function renderInsights(){
  const o=store().orders,gmv=o.reduce((a,x)=>a+x.landed,0),goods=o.reduce((a,x)=>a+x.subtotal,0),saved=o.reduce((a,x)=>a+Math.max(0,x.avg-x.landed),0);
  const rfqs=store().rfqs.length,conv=rfqs?store().rfqs.filter(r=>r.status==="ordered").length/rfqs:0;
  const del=o.filter(x=>x.stage===4).length,issues=o.filter(x=>x.issue).length;
  const wa=store().rfqs.filter(r=>r.source==="whatsapp").length;
  const k=[["GMV (landed)",lakh(gmv),`${o.length} purchase orders`],["Average order value",o.length?lakh(gmv/o.length):"—","landed, incl. GST and freight"],["Buyer savings",lakh(saved),"vs average of eligible quotes"],["RFQ → PO conversion",(conv*100).toFixed(0)+"%",`${rfqs} RFQs · ${wa} via WhatsApp`],["Est. platform revenue",inr(goods*TAKE),`at ${TAKE*100}% take rate on goods`],["Delivered / issues",`${del} / ${issues}`,"fulfillment health"]];
  $("#kpis").innerHTML=k.map(([a,b,c])=>`<div class="panel kpi"><span>${a}</span><span class="num">${b}</span><small>${c}</small></div>`).join("");
  const by={};o.forEach(x=>{const c=PMAP[x.productId].cat;by[c]=(by[c]||0)+x.landed;});const max=Math.max(1,...Object.values(by));
  $("#catBars").innerHTML=Object.keys(CATS).map(c=>`<div class="b"><span>${CATS[c]}</span><div class="track"><div class="fill" style="width:${((by[c]||0)/max*100).toFixed(1)}%"></div></div><span class="num">${lakh(by[c]||0)}</span></div>`).join("");
}

/* ===================== AI CHIP ===================== */
function renderAiChip(){const c=$("#aichip");const live=aiState==="server"||aiState==="live";c.className="aichip"+(live?" live":"");
  c.querySelector("span").textContent=aiState==="server"?"Claude via VyaparBoss server":aiState==="live"?"Claude reads your requests":aiState==="pending"?"Connecting…":(Repo.mode==="server"?"Server · rule parser":"Offline parser (rules)");
  c.title=live?"Requests are understood by Claude; prices and suppliers always come from supplier records.":Repo.mode==="server"?"Server running without ANTHROPIC_API_KEY, so the built-in Hinglish rule parser reads requests.":"Claude isn't available here, so a built-in Hinglish rule parser reads requests.";}

/* ===================== WIRING ===================== */
function renderAll(){renderOrders();renderSuppliers();renderDesk();renderInsights();}
function showTab(t){document.querySelectorAll("#tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t));document.querySelectorAll(".view").forEach(v=>v.hidden=v.id!=="v-"+t);try{localStorage.setItem(KEY+".tab",t);}catch(e){}if(t!=="procure")renderAll();if(Repo.mode==="server")Repo.refresh().then(ch=>ch&&renderAll()).catch(()=>{});}
$("#tabs").addEventListener("click",e=>{const b=e.target.closest("button[data-tab]");if(b)showTab(b.dataset.tab);});
$("#sendBtn").addEventListener("click",()=>send($("#ask").value));
$("#ask").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send($("#ask").value);}});
$("#examples").innerHTML=EXAMPLES.map(x=>`<button class="chipbtn" data-action="example" data-v="${esc(x)}">${esc(x)}</button>`).join("");
$("#sq").addEventListener("input",renderSuppliers);
$("#scat").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;scat=b.dataset.cat;document.querySelectorAll("#scat button").forEach(x=>x.setAttribute("aria-pressed",x===b));renderSuppliers();});
$("#deskSel").addEventListener("change",renderDesk);

const ACTIONS={
  example:a=>{$("#ask").value=a.dataset.v;$("#ask").focus();},
  chip:a=>send(a.dataset.v),
  select:a=>{selected=a.dataset.sid;renderResults();},
  negotiate:()=>{
    const target=parseFloat($("#fTarget").value);if(!(target>0)){toast("Enter a target price first.");return;}
    const r=negotiate(discover(rfq),target);neg=r.neg;negLast=r.out;
    const acc=r.out.filter(x=>x.ok).length;pushMsg({role:"a",text:`Negotiation Agent: asked ${r.out.length} suppliers for ${inr(target,2)}. ${acc?`${acc} accepted.`:"None could reach it; best counter-offers are applied."} Quotes re-ranked.`});
    renderResults();
  },
  approve:()=>{if($("#fOk")?.checked)raisePO();},
  advance:a=>{const o=store().orders.find(x=>x.po===a.dataset.po);if(o&&o.stage<4){const history=o.history.slice();history[o.stage+1]=Date.now();Repo.updateOrder(o.po,{stage:o.stage+1,history}).catch(fail);renderAll();}},
  issue:a=>{const o=store().orders.find(x=>x.po===a.dataset.po);if(o){Repo.updateOrder(o.po,{issue:o.stage>=3?"Short quantity received":"Dispatch delayed"}).catch(fail);renderAll();}},
  resolve:a=>{Repo.updateOrder(a.dataset.po,{issue:null}).catch(fail);renderAll();},
  "clear-samples":async()=>{try{const n=await Repo.clearSamples();renderAll();toast(n?`Removed ${n} sample orders`:"No sample orders left");}catch(e){fail(e);}},
  draft:a=>draftReply(a.dataset.rfq,a),
  copy:a=>{const ta=document.getElementById("reply-"+a.dataset.rfq);const done=()=>toast("Reply copied");try{navigator.clipboard.writeText(ta.value).then(done,()=>{ta.select();toast("Press Ctrl/Cmd+C to copy");});}catch(err){ta.select();toast("Press Ctrl/Cmd+C to copy");}}
};
document.addEventListener("click",e=>{const a=e.target.closest("[data-action]");if(a&&ACTIONS[a.dataset.action])ACTIONS[a.dataset.action](a,e);});
document.addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target.matches(".q[data-action]")){e.preventDefault();selected=e.target.dataset.sid;renderResults();}});
document.addEventListener("change",e=>{
  const id=e.target.id;
  if(id==="fOk"){$("#approveBtn").disabled=!e.target.checked;return;}
  if(!rfq||!["fProd","fQty","fCity","fDl"].includes(id))return;
  if(id==="fProd"){rfq.productId=e.target.value||null;neg={};negLast=null;}
  if(id==="fQty"){rfq.qty=Math.max(0,Math.round(+e.target.value))||null;neg={};negLast=null;}
  if(id==="fCity")rfq.city=e.target.value||null;
  if(id==="fDl")rfq.deadline=Math.round(+e.target.value)||null;
  if(!rfq.id&&!missing(rfq).length){recordRfq(discover(rfq,neg)).then(renderResults);}
  renderResults();
});

/* ===================== BOOT ===================== */
(async function boot(){
  await Repo.init();
  const ex=EXAMPLES[0];thread.push({role:"u",text:ex,sample:true});
  const {r,notes}=applyParsed(ruleParse(ex),null);await finishRequirement(r,notes,"Rules",null,true);
  if(Repo.mode==="server"){aiState=Repo.info.ai?"server":"off";setInterval(()=>{if(!document.hidden)Repo.refresh().then(ch=>ch&&renderAll()).catch(()=>{});},20000);}
  renderAiChip();renderAll();
  try{const t=localStorage.getItem(KEY+".tab");if(t&&$(`#tabs button[data-tab="${t}"]`))showTab(t);}catch(e){}
  if(aiState==="pending"){
    if(window.claude?.use){claude.use("sample").then(s=>{ai=s;aiState=s?"live":"off";renderAiChip();renderDesk();}).catch(()=>{aiState="off";renderAiChip();});}
    else{aiState="off";renderAiChip();}
  }
})();
