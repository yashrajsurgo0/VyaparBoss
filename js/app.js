/* VyaparBoss — UI: chat, results, orders, supplier network, supplier desk, metrics. Plain browser script (no build step); loaded in order by index.html. */
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
async function send(text){
  text=text.trim();if(!text)return;
  $("#ask").value="";
  pushMsg({role:"u",text});
  const pending={role:"a",text:"Reading your requirement…",trace:[{t:"Buyer Intelligence Agent: extracting specs",run:true}]};
  pushMsg(pending);
  $("#sendBtn").disabled=true;
  const base=rfq&&missing(rfq).length?rfq:null; // continue an incomplete requirement
  let parsed,via="Rules",reply=null;
  if(ai&&aiState==="live"){
    try{parsed=await aiParse(text,base);via="Claude";reply=typeof parsed.reply==="string"?parsed.reply:null;}
    catch(e){if(["not_granted","sampling_disabled","not_declared","capability_disabled","capability_removed"].includes(e.code)){aiState="off";renderAiChip();}parsed=null;}
  }
  if(!parsed){parsed=ruleParse(text);via="Rules";}
  const {r,notes}=applyParsed(parsed,base);
  thread.pop();
  finishRequirement(r,notes,via,reply,false);
  $("#sendBtn").disabled=false;
}
function finishRequirement(r,notes,via,reply,isSample){
  rfq={...r,id:null};neg={};selected=null;
  const miss=missing(rfq);
  if(miss.length){
    let ask,chips=null;
    if(miss.includes("product")){ask="Kaunsa product chahiye? Abhi yeh categories live hain: packaging, industrial consumables aur agri inputs.";chips=["3-ply corrugated boxes","Food-grade LDPE film","Nitrile gloves","Drip lateral rolls","NPK 19:19:19"];}
    else if(miss.includes("quantity")){const u=PMAP[rfq.productId].unit;ask=`Kitna chahiye? Quantity in ${u} batayiye.`;}
    else {ask="Delivery kis city mein chahiye?";chips=["Pune","Mumbai","Ahmedabad","Delhi","Chennai","Bengaluru","Hyderabad","Indore"];}
    pushMsg({role:"a",via,text:(reply&&via==="Claude"?reply+"\n\n":"")+ask,chips});
    renderResults();return;
  }
  const res=discover(rfq);
  if(!isSample)recordRfq(res);
  const p=PMAP[rfq.productId];const ok=res.eligible.filter(q=>q.meets);
  const trace=[
    {t:`Buyer Intelligence: ${p.name}, ${qfmt(rfq.qty)} ${p.unit}, ${rfq.city}${rfq.deadline?`, ${rfq.deadline} days`:""}`},
    {t:`Supplier Discovery: ${res.eligible.length} of ${res.offering} suppliers qualify`},
    {t:`RFQ: ${res.eligible.length} quotes from verified rate cards`},
    {t:`Optimization: ranked on total landed cost`}
  ];
  let text;
  if(!res.eligible.length) text=`${res.offering} suppliers stock this, but none can take ${qfmt(rfq.qty)} ${p.unit} to ${rfq.city}. See the reasons on the right; changing quantity or city may open options.`;
  else if(!ok.length) text=`${res.eligible.length} suppliers can supply, but none can deliver within ${rfq.deadline} days. Fastest is ${Math.min(...res.eligible.map(q=>q.eta))} days.`;
  else {const b=ok[0];text=`Best option: ${b.s.name}, ${inr(b.landed)} landed (${inr(b.per,2)} per ${p.unit.replace(/s$/,"")}), delivery in about ${b.eta} days. Review and approve on the right.`;}
  if(notes.length)text+="\n"+notes.join("\n");
  pushMsg({role:"a",via,text:(reply&&via==="Claude"?reply+"\n\n":"")+text,trace});
  renderResults();
}
function recordRfq(res){
  store.seq.rfq++;const id=`RFQ-${fy().slice(2,4)}${fy().slice(5)}-${String(store.seq.rfq).padStart(4,"0")}`;
  rfq.id=id;
  store.rfqs.unshift({id,date:Date.now(),productId:rfq.productId,qty:rfq.qty,city:rfq.city,deadline:rfq.deadline||null,
    quotes:res.eligible.map(q=>({sid:q.s.id,unit:q.unit,landed:Math.round(q.landed),eta:q.eta,meets:q.meets})),status:"open",wonBy:null});
  save();
}
function updateRecordedRfq(res){
  if(!rfq?.id)return;const rec=store.rfqs.find(x=>x.id===rfq.id);if(!rec||rec.status!=="open")return;
  Object.assign(rec,{productId:rfq.productId,qty:rfq.qty,city:rfq.city,deadline:rfq.deadline||null,quotes:res.eligible.map(q=>({sid:q.s.id,unit:q.unit,landed:Math.round(q.landed),eta:q.eta,meets:q.meets}))});save();
}

/* ===================== RESULTS PANE ===================== */
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

  const res=discover(rfq);updateRecordedRfq(res);
  const ok=res.eligible.filter(q=>q.meets),late=res.eligible.filter(q=>!q.meets);
  if(!selected||!res.eligible.find(q=>q.s.id===selected))selected=(ok[0]||res.eligible[0])?.s.id||null;
  const rec=ok[0];
  html+=`<div class="agents" style="margin-top:14px">
    <div class="agent"><b>Supplier Discovery</b><span class="k">${res.eligible.length}/${res.offering}</span> qualified on MOQ, capacity and route</div>
    <div class="agent"><b>RFQ</b><span class="k">${res.eligible.length}</span> quotes from verified rate cards</div>
    <div class="agent"><b>Optimization</b>${rec?`Lowest landed: <span class="k">${inr(Math.min(...ok.map(q=>q.landed)))}</span>`:"No on-time option"}</div>
    <div class="agent"><b>Deadline</b>${rfq.deadline?`<span class="k">${ok.length}</span> can deliver in ${rfq.deadline} days`:"Flexible"}</div>
  </div>`;
  // insight: cheapest ex-works vs cheapest landed
  if(ok.length>1){
    const cheapUnit=[...ok].sort((a,b)=>a.unit-b.unit)[0];const cheapLanded=[...ok].sort((a,b)=>a.landed-b.landed)[0];
    if(cheapUnit.s.id!==cheapLanded.s.id){html+=`<div class="insight" style="margin-top:12px"><span>💡</span><span><b>Lowest price isn't lowest cost.</b> ${esc(cheapUnit.s.name)} quotes the lowest unit price (${inr(cheapUnit.unit,2)}), but freight from ${cheapUnit.s.city} makes it ${inr(cheapUnit.landed-cheapLanded.landed)} dearer delivered than ${esc(cheapLanded.s.name)}.</span></div>`;}
    else{const avg=ok.reduce((a,q)=>a+q.landed,0)/ok.length;html+=`<div class="insight" style="margin-top:12px"><span>💡</span><span><b>${inr(avg-cheapLanded.landed)} below the average quote.</b> ${esc(cheapLanded.s.name)} is cheapest both ex-works and delivered to ${rfq.city}.</span></div>`;}
  }
  const maxScore=Math.max(...res.eligible.map(q=>q.score||0),1);
  const card=(q,i,isRec)=>{
    const tags=[`<span class="pill verify">✓ GST verified</span>`];
    if(q.s.audit)tags.push(`<span class="pill warn">${esc(q.s.audit)}</span>`);
    q.s.certs.slice(0,2).forEach(c=>tags.push(`<span class="pill">${esc(c)}</span>`));
    if(neg[q.s.id])tags.push(`<span class="pill acc">Negotiated −${((1-q.unit/q.list)*100).toFixed(1)}%</span>`);
    return `<div class="q ${q.s.id===selected?"sel":""} ${q.meets?"":"late"}" data-action="select" data-sid="${q.s.id}" tabindex="0" role="button" aria-pressed="${q.s.id===selected}">
      ${isRec?`<span class="rec">RECOMMENDED</span>`:""}
      <div class="who"><h4>${esc(q.s.name)}</h4><div class="loc">${esc(q.s.area)}, ${q.s.city} · ${qfmt(q.d)} km · ★ ${q.s.rating} · ${q.s.onTime}% on time</div><div class="tags">${tags.join("")}</div></div>
      <div class="money">
        <div><span>Unit price</span><span class="num">${inr(q.unit,2)}</span></div>
        <div><span>Goods</span><span class="num">${inr(q.subtotal)}</span></div>
        <div><span>GST ${q.gstRate}%</span><span class="num">${inr(q.gst)}</span></div>
        <div><span>Freight</span><span class="num">${inr(q.freight)}</span></div>
      </div>
      <div class="total"><div class="big">${inr(q.landed)}</div><div class="per">${inr(q.per,2)} landed / ${p.unit.replace(/s$/,"")}</div>
        <div class="eta">${q.meets?`<span class="pill good">${q.eta} days</span>`:`<span class="pill bad">${q.eta} days · late</span>`}</div></div>
      <span class="scorebar" style="width:${(q.score/maxScore*100).toFixed(0)}%"></span>
    </div>`;};
  html+=`<div class="ledgerhead"><h3>Landed-cost comparison</h3><span class="muted">Click a quote to select it</span></div><div class="quotes">`;
  if(!res.eligible.length)html+=`<div class="panel empty"><h3>No supplier qualifies</h3><p>Try a different quantity or a nearer delivery city.</p></div>`;
  ok.forEach((q,i)=>html+=card(q,i,i===0));
  if(late.length){html+=`<div class="eyebrow" style="margin-top:8px">Can't meet the ${rfq.deadline}-day deadline</div>`;late.forEach((q,i)=>html+=card(q,i,false));}
  html+=`</div>`;
  if(res.excluded.length)html+=`<details class="excluded"><summary>${res.excluded.length} supplier${res.excluded.length>1?"s":""} stock this but were excluded</summary><ul>${res.excluded.map(x=>`<li><b>${esc(x.s.name)}</b> (${x.s.city}): ${esc(x.why)}</li>`).join("")}</ul></details>`;

  const q=res.eligible.find(x=>x.s.id===selected);
  if(q){
    const lastNeg=neg._last;
    html+=`<div class="action">
      <div class="panel"><h4>${esc(q.s.name)} · cost breakdown</h4>
        <table class="breakdown"><tbody>
          <tr><td>${qfmt(rfq.qty)} ${p.unit} × ${inr(q.unit,2)}${q.unit!==q.list?` <span class="muted">(list ${inr(q.list,2)})</span>`:""}</td><td>${inr(q.subtotal)}</td></tr>
          <tr><td>${q.gstType} @ ${q.gstRate}%</td><td>${inr(q.gst)}</td></tr>
          <tr><td>Freight · ${q.freightMode}, ${qfmt(Math.round(q.weight))} kg over ${qfmt(q.d)} km</td><td>${inr(q.freight)}</td></tr>
          <tr class="tot"><td>Total landed cost</td><td>${inr(q.landed)}</td></tr>
        </tbody></table>
        <p class="muted" style="font-size:12.5px;margin:10px 0 0">Ready in ${q.s.lead} days + ${q.transit} day${q.transit>1?"s":""} transit. Terms: ${esc(q.s.terms)}. GST paid is usually claimable as input tax credit.</p>
      </div>
      <div class="panel"><h4>Negotiate, then approve</h4>
        <div class="negrow">
          <div class="field"><label for="fTarget">Target price per ${p.unit.replace(/s$/,"")} (₹)</label><input id="fTarget" type="number" step="0.01" min="0" value="${(q.list*0.95).toFixed(2)}"></div>
          <button class="btn" data-action="negotiate">Ask all suppliers</button>
        </div>
        ${lastNeg?`<div class="negout">${lastNeg.map(x=>`<span>${esc(x.name)}: ${x.ok?`<b style="color:var(--good)">accepted ${inr(x.price,2)}</b>`:`best ${inr(x.price,2)}`}</span>`).join("")}</div>`:`<p class="muted" style="font-size:12.5px;margin:8px 0 0">The negotiation agent only works inside your target. It never commits to a purchase.</p>`}
        <label class="approve"><input type="checkbox" id="fOk"><span>I approve buying ${qfmt(rfq.qty)} ${p.unit} from <b>${esc(q.s.name)}</b> for <b>${inr(q.landed)}</b> landed, delivered to ${rfq.city}.</span></label>
        <button class="btn primary" data-action="approve" id="approveBtn" disabled>Approve and raise PO</button>
      </div>
    </div>`;
  }
  el.innerHTML=html;
}

/* ===================== ORDERS ===================== */
function raisePO(){
  const res=discover(rfq);const q=res.eligible.find(x=>x.s.id===selected);if(!q)return;
  const avg=res.eligible.reduce((a,x)=>a+x.landed,0)/res.eligible.length;
  store.seq.po++;const po=`VB/PO/${fy()}/${String(store.seq.po).padStart(4,"0")}`;
  const now=Date.now();
  store.orders.unshift({po,date:now,productId:rfq.productId,qty:rfq.qty,city:rfq.city,sid:q.s.id,unit:q.unit,list:q.list,subtotal:Math.round(q.subtotal),gst:Math.round(q.gst),freight:Math.round(q.freight),landed:Math.round(q.landed),avg:Math.round(avg),eta:q.eta,deadline:rfq.deadline||null,stage:0,history:[now],issue:null,rfqId:rfq.id});
  const rec=store.rfqs.find(x=>x.id===rfq.id);if(rec){rec.status="ordered";rec.wonBy=q.s.id;rec.quotes=res.eligible.map(x=>({sid:x.s.id,unit:x.unit,landed:Math.round(x.landed),eta:x.eta,meets:x.meets}));}
  save();
  pushMsg({role:"a",text:`PO ${po} raised with ${q.s.name} for ${inr(q.landed)}. I'll track dispatch and delivery in Orders.`});
  rfq=null;neg={};selected=null;renderResults();renderAll();toast(`PO ${po} raised`);
}
function renderOrders(){
  $("#ordCount").textContent=store.orders.length;
  const el=$("#orders");
  if(!store.orders.length){el.innerHTML=`<div class="panel empty"><h3>No orders yet</h3><p>Approve a quote on the Procure tab to raise your first purchase order.</p></div>`;return;}
  el.innerHTML=store.orders.map(o=>{const p=PMAP[o.productId],s=SMAP[o.sid];const due=new Date(o.date+o.eta*864e5);
    return `<div class="panel order">
      <div class="oh"><div><div class="po">${esc(o.po)} · ${dstr(o.date)}${o.sample?' · <span class="pill">Sample</span>':""}</div><h4>${qfmt(o.qty)} ${p.unit} · ${esc(p.name)}</h4></div>
        <div style="text-align:right"><div class="num" style="font-size:18px">${inr(o.landed)}</div><div class="muted" style="font-size:12px">saved ${inr(Math.max(0,o.avg-o.landed))} vs avg quote</div></div></div>
      <div class="facts"><div><span>Supplier</span>${esc(s.name)}, ${s.city}</div><div><span>Deliver to</span>${o.city}</div><div><span>Expected by</span>${dstr(due)}${o.deadline&&o.eta>o.deadline?' <span class="pill bad">late</span>':""}</div><div><span>Goods + GST + freight</span><span class="num" style="display:inline;color:inherit;font-size:13px">${inr(o.subtotal)} + ${inr(o.gst)} + ${inr(o.freight)}</span></div></div>
      <div class="steps">${STAGES.map((st,i)=>`<div class="step ${i<o.stage?"done":i===o.stage?(o.stage===4?"done":"now"):""}">${st}${o.history[i]?`<br><span class="muted">${dstr(o.history[i])}</span>`:""}</div>`).join("")}</div>
      ${o.issue?`<div class="insight" style="background:var(--bad-tint)"><span>⚠️</span><span><b style="color:var(--bad)">Issue reported:</b> ${esc(o.issue)}. Operations will contact ${esc(s.name)}.</span></div>`:""}
      <div class="acts">${o.stage<4?`<button class="btn sm" data-action="advance" data-po="${esc(o.po)}">Mark "${STAGES[o.stage+1]}"</button>`:`<span class="pill good">Delivered</span>`}
        ${o.issue?`<button class="btn sm ghost" data-action="resolve" data-po="${esc(o.po)}">Mark issue resolved</button>`:`<button class="btn sm ghost" data-action="issue" data-po="${esc(o.po)}">Report a problem</button>`}</div>
    </div>`;}).join("");
}

/* ===================== SUPPLIERS ===================== */
let scat="all";
function renderSuppliers(){
  const q=($("#sq").value||"").toLowerCase().trim();
  const list=SUPPLIERS.filter(s=>(scat==="all"||s.offers.some(o=>PMAP[o.p].cat===scat))&&(!q||(s.name+" "+s.city+" "+s.area+" "+s.offers.map(o=>PMAP[o.p].name).join(" ")).toLowerCase().includes(q)));
  $("#sgrid").innerHTML=list.length?list.map(s=>`<div class="panel scard">
    <div><h4>${esc(s.name)}</h4><div class="muted" style="font-size:12.5px">${esc(s.area)}, ${s.city} · ${s.yrs} yrs in business</div></div>
    <div style="display:flex;gap:4px;flex-wrap:wrap"><span class="pill verify">✓ GST verified</span>${s.audit?`<span class="pill warn">${esc(s.audit)}</span>`:`<span class="pill verify">✓ Site audited</span>`}${s.certs.map(c=>`<span class="pill">${esc(c)}</span>`).join("")}</div>
    <div class="gst">GSTIN ${s.gstin} <span class="muted">(sample)</span></div>
    <div class="stats"><div><span>On time</span><span class="num">${s.onTime}%</span></div><div><span>Rating</span><span class="num">★ ${s.rating}</span></div><div><span>Orders</span><span class="num">${s.orders}</span></div></div>
    <ul class="plist">${s.offers.map(o=>`<li><span>${esc(PMAP[o.p].name)}</span><span class="num">from ${inr(o.tiers[o.tiers.length-1][1],2)}/${PMAP[o.p].unit.replace(/s$/,"")} · MOQ ${qfmt(o.tiers[0][0])}</span></li>`).join("")}</ul>
    <div class="muted" style="font-size:12px">Delivers within ${qfmt(s.coverage)} km · ready in ${s.lead} day${s.lead>1?"s":""} · ${esc(s.terms)}</div>
  </div>`).join(""):`<div class="panel empty"><h3>No supplier matches</h3><p>Try another search term.</p></div>`;
}

/* ===================== SUPPLIER DESK ===================== */
function renderDesk(){
  const sel=$("#deskSel");
  if(!sel.options.length){sel.innerHTML=SUPPLIERS.map(s=>`<option value="${s.id}">${esc(s.name)} · ${s.city}</option>`).join("");
    const busy=SUPPLIERS.map(s=>[s.id,store.rfqs.filter(r=>r.quotes.some(q=>q.sid===s.id)).length]).sort((a,b)=>b[1]-a[1])[0];if(busy)sel.value=busy[0];}
  const sid=sel.value,s=SMAP[sid];
  const list=store.rfqs.filter(r=>r.quotes.some(q=>q.sid===sid));
  $("#deskList").innerHTML=list.length?list.map(r=>{const p=PMAP[r.productId],mine=r.quotes.find(q=>q.sid===sid);
    const rank=[...r.quotes].filter(q=>q.meets).sort((a,b)=>a.landed-b.landed).findIndex(q=>q.sid===sid)+1;
    const status=r.status==="ordered"?(r.wonBy===sid?`<span class="pill good">Won · PO raised</span>`:`<span class="pill">Not selected</span>`):`<span class="pill acc">Open</span>`;
    return `<div class="panel inbox"><div class="ih"><div><div class="po num muted" style="font-size:12.5px">${esc(r.id)} · ${dstr(r.date)}${r.sample?" · Sample":""}</div><h4 style="margin:2px 0 0;font-size:15.5px">${qfmt(r.qty)} ${p.unit} ${esc(p.name)} → ${r.city}</h4></div>${status}</div>
      <div class="facts" style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px">
        <div><span class="muted" style="display:block;font-size:11.5px">Your auto-quote</span><span class="num">${inr(mine.unit,2)}/${p.unit.replace(/s$/,"")}</span></div>
        <div><span class="muted" style="display:block;font-size:11.5px">Your landed total</span><span class="num">${inr(mine.landed)}</span></div>
        <div><span class="muted" style="display:block;font-size:11.5px">Delivery</span>${mine.eta} days${mine.meets?"":" (misses deadline)"}</div>
        <div><span class="muted" style="display:block;font-size:11.5px">Rank on landed cost</span>${mine.meets&&rank?`#${rank} of ${r.quotes.filter(q=>q.meets).length}`:"Not ranked"}</div>
      </div>
      <textarea id="reply-${esc(r.id)}" aria-label="Reply to buyer">${esc(templateReply(r,s,mine))}</textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${ai&&aiState==="live"?`<button class="btn sm" data-action="draft" data-rfq="${esc(r.id)}">Redraft with sales assistant</button>`:""}<button class="btn sm ghost" data-action="copy" data-rfq="${esc(r.id)}">Copy reply</button></div>
    </div>`;}).join(""):`<div class="panel empty"><h3>No RFQs for ${esc(s.name)} yet</h3><p>RFQs appear here when a buyer's requirement matches this supplier's products, capacity and delivery area.</p></div>`;
}
function templateReply(r,s,mine){const p=PMAP[r.productId];return `Namaste ji, ${s.name} se. ${qfmt(r.qty)} ${p.unit} ${p.name} (${p.spec}) ke liye hamara rate ${inr(mine.unit,2)} per ${p.unit.replace(/s$/,"")} + GST ${p.gst}% hai. ${r.city} delivery ${mine.eta} din mein ho jayegi. Payment: ${s.terms}. Confirm karein to order dispatch plan bhej dete hain.`;}
async function draftReply(id,btn){
  const r=store.rfqs.find(x=>x.id===id),s=SMAP[$("#deskSel").value],mine=r.quotes.find(q=>q.sid===s.id),p=PMAP[r.productId];const ta=document.getElementById("reply-"+id);
  btn.disabled=true;const prev=ta.value;ta.value="Drafting…";
  try{await ai(`Write a short WhatsApp reply (3-4 sentences, Hinglish, polite and businesslike, no emojis) from Indian supplier "${s.name}" (${s.city}) answering a buyer RFQ on the VyaparBoss platform. RFQ: ${qfmt(r.qty)} ${p.unit} of ${p.name} (${p.spec}) delivered to ${r.city}${r.deadline?` within ${r.deadline} days`:""}. Our price: ${inr(mine.unit,2)} per ${p.unit.replace(/s$/,"")} plus GST ${p.gst}%. Delivery in ${mine.eta} days. Payment terms: ${s.terms}. Certifications: ${s.certs.join(", ")||"none listed"}. Only use these facts; do not invent discounts or stock levels. Reply with only the message text.`,{modelTier:"quick",cache:false,onText:({text})=>{ta.value=text;}});}
  catch(e){ta.value=e.text||prev;if(e.code!=="cancelled")toast(e.code==="rate_limited"?"Too many requests. Try again in a minute.":"Couldn't reach the sales assistant. The template reply is still there.");if(["not_granted","sampling_disabled"].includes(e.code)){aiState="off";renderAiChip();renderDesk();}}
  btn.disabled=false;
}

/* ===================== INSIGHTS ===================== */
function renderInsights(){
  const o=store.orders,gmv=o.reduce((a,x)=>a+x.landed,0),goods=o.reduce((a,x)=>a+x.subtotal,0),saved=o.reduce((a,x)=>a+Math.max(0,x.avg-x.landed),0);
  const rfqs=store.rfqs.length,conv=rfqs?store.rfqs.filter(r=>r.status==="ordered").length/rfqs:0;
  const del=o.filter(x=>x.stage===4).length,issues=o.filter(x=>x.issue).length;
  const k=[["GMV (landed)",lakh(gmv),`${o.length} purchase orders`],["Average order value",o.length?lakh(gmv/o.length):"—","landed, incl. GST and freight"],["Buyer savings",lakh(saved),"vs average of eligible quotes"],["RFQ → PO conversion",(conv*100).toFixed(0)+"%",`${rfqs} RFQs created`],["Est. platform revenue",inr(goods*TAKE),`at ${TAKE*100}% take rate on goods`],["Delivered / issues",`${del} / ${issues}`,"fulfillment health"]];
  $("#kpis").innerHTML=k.map(([a,b,c])=>`<div class="panel kpi"><span>${a}</span><span class="num">${b}</span><small>${c}</small></div>`).join("");
  const by={};o.forEach(x=>{const c=PMAP[x.productId].cat;by[c]=(by[c]||0)+x.landed;});const max=Math.max(1,...Object.values(by));
  $("#catBars").innerHTML=Object.keys(CATS).map(c=>`<div class="b"><span>${CATS[c]}</span><div class="track"><div class="fill" style="width:${((by[c]||0)/max*100).toFixed(1)}%"></div></div><span class="num">${lakh(by[c]||0)}</span></div>`).join("");
}

/* ===================== SAMPLES ===================== */
function seedSamples(){
  store={orders:[],rfqs:[],seq:{po:0,rfq:0}};
  const mk=(productId,qty,city,deadline,daysAgo,stage)=>{
    const r={productId,qty,city,deadline};const saveNeg=neg;neg={};const res=discover(r);neg=saveNeg;
    const ok=res.eligible.filter(q=>q.meets);const q=ok[0];const t=Date.now()-daysAgo*864e5;
    store.seq.rfq++;const rid=`RFQ-${fy().slice(2,4)}${fy().slice(5)}-${String(store.seq.rfq).padStart(4,"0")}`;
    store.rfqs.push({id:rid,date:t,productId,qty,city,deadline,quotes:res.eligible.map(x=>({sid:x.s.id,unit:x.unit,landed:Math.round(x.landed),eta:x.eta,meets:x.meets})),status:"ordered",wonBy:q.s.id,sample:true});
    store.seq.po++;const po=`VB/PO/${fy()}/${String(store.seq.po).padStart(4,"0")}`;
    const avg=res.eligible.reduce((a,x)=>a+x.landed,0)/res.eligible.length;
    store.orders.push({po,date:t,productId,qty,city,sid:q.s.id,unit:q.unit,list:q.list,subtotal:Math.round(q.subtotal),gst:Math.round(q.gst),freight:Math.round(q.freight),landed:Math.round(q.landed),avg:Math.round(avg),eta:q.eta,deadline,stage,history:Array.from({length:stage+1},(_,i)=>t+i*864e5),issue:null,sample:true,rfqId:rid});
  };
  mk("box3",8000,"Pune",7,9,4);
  mk("gloves",250,"Chennai",5,3,2);
  mk("npk",3000,"Nashik",6,1,1);
  store.orders.reverse();store.rfqs.reverse();save();
}

/* ===================== AI CHIP ===================== */
function renderAiChip(){const c=$("#aichip");c.className="aichip"+(aiState==="live"?" live":"");
  c.querySelector("span").textContent=aiState==="live"?"Claude reads your requests":aiState==="pending"?"Connecting to Claude…":"Offline parser (rules)";
  c.title=aiState==="live"?"Requests are understood by Claude; prices and suppliers always come from verified records.":"Claude isn't available in this view, so a built-in Hinglish rule parser reads requests.";}

/* ===================== WIRING ===================== */
function renderAll(){renderOrders();renderSuppliers();renderDesk();renderInsights();}
function showTab(t){document.querySelectorAll("#tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t));document.querySelectorAll(".view").forEach(v=>v.hidden=v.id!=="v-"+t);try{localStorage.setItem(KEY+".tab",t);}catch(e){}if(t!=="procure")renderAll();}
$("#tabs").addEventListener("click",e=>{const b=e.target.closest("button[data-tab]");if(b)showTab(b.dataset.tab);});
$("#sendBtn").addEventListener("click",()=>send($("#ask").value));
$("#ask").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send($("#ask").value);}});
$("#examples").innerHTML=EXAMPLES.map(x=>`<button class="chipbtn" data-action="example" data-v="${esc(x)}">${esc(x)}</button>`).join("");
$("#sq").addEventListener("input",renderSuppliers);
$("#scat").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;scat=b.dataset.cat;document.querySelectorAll("#scat button").forEach(x=>x.setAttribute("aria-pressed",x===b));renderSuppliers();});
$("#deskSel").addEventListener("change",renderDesk);

document.addEventListener("click",e=>{
  const a=e.target.closest("[data-action]");if(!a)return;const act=a.dataset.action;
  if(act==="example"){$("#ask").value=a.dataset.v;$("#ask").focus();}
  else if(act==="chip"){send(a.dataset.v);}
  else if(act==="select"){selected=a.dataset.sid;renderResults();}
  else if(act==="negotiate"){
    const target=parseFloat($("#fTarget").value);if(!(target>0)){toast("Enter a target price first.");return;}
    const res=(neg={},discover(rfq));const out=[];
    for(const q of res.eligible){const floor=+(q.list*(1-q.s.maxDisc)).toFixed(2);const price=Math.max(floor,Math.min(target,q.list));neg[q.s.id]={price};out.push({name:q.s.name,price,ok:price<=target});}
    neg._last=out.sort((x,y)=>y.ok-x.ok||x.price-y.price);
    const acc=out.filter(x=>x.ok).length;pushMsg({role:"a",text:`Negotiation Agent: asked ${out.length} suppliers for ${inr(target,2)}. ${acc?`${acc} accepted.`:"None could reach it; best counter-offers are applied."} Quotes re-ranked.`});
    renderResults();
  }
  else if(act==="approve"){if($("#fOk")?.checked)raisePO();}
  else if(act==="advance"){const o=store.orders.find(x=>x.po===a.dataset.po);if(o&&o.stage<4){o.stage++;o.history[o.stage]=Date.now();save();renderAll();}}
  else if(act==="issue"){const o=store.orders.find(x=>x.po===a.dataset.po);if(o){o.issue=o.stage>=3?"Short quantity received":"Dispatch delayed";save();renderAll();}}
  else if(act==="resolve"){const o=store.orders.find(x=>x.po===a.dataset.po);if(o){o.issue=null;save();renderAll();}}
  else if(act==="clear-samples"){const n=store.orders.filter(o=>o.sample).length;store.orders=store.orders.filter(o=>!o.sample);store.rfqs=store.rfqs.filter(r=>!r.sample);save();renderAll();toast(n?`Removed ${n} sample orders`:"No sample orders left");}
  else if(act==="draft"){draftReply(a.dataset.rfq,a);}
  else if(act==="copy"){const ta=document.getElementById("reply-"+a.dataset.rfq);const done=()=>toast("Reply copied");try{navigator.clipboard.writeText(ta.value).then(done,()=>{ta.select();toast("Press Ctrl/Cmd+C to copy");});}catch(err){ta.select();toast("Press Ctrl/Cmd+C to copy");}}
});
document.addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target.matches(".q[data-action]")){e.preventDefault();selected=e.target.dataset.sid;renderResults();}});
document.addEventListener("change",e=>{
  const id=e.target.id;
  if(id==="fOk"){$("#approveBtn").disabled=!e.target.checked;return;}
  if(!rfq||!["fProd","fQty","fCity","fDl"].includes(id))return;
  if(id==="fProd"){rfq.productId=e.target.value||null;neg={};}
  if(id==="fQty"){rfq.qty=Math.max(0,Math.round(+e.target.value))||null;neg={};}
  if(id==="fCity")rfq.city=e.target.value||null;
  if(id==="fDl")rfq.deadline=Math.round(+e.target.value)||null;
  const wasMissing=!rfq.id;
  if(wasMissing&&!missing(rfq).length){recordRfq(discover(rfq));}
  renderResults();
});

/* ===================== BOOT ===================== */
load();
(function boot(){
  const ex=EXAMPLES[0];thread.push({role:"u",text:ex,sample:true});
  const {r,notes}=applyParsed(ruleParse(ex),null);finishRequirement(r,notes,"Rules",null,true);
  renderAiChip();renderAll();
  try{const t=localStorage.getItem(KEY+".tab");if(t&&$(`#tabs button[data-tab="${t}"]`))showTab(t);}catch(e){}
  if(window.claude?.use){claude.use("sample").then(s=>{ai=s;aiState=s?"live":"off";renderAiChip();renderDesk();}).catch(()=>{aiState="off";renderAiChip();});}
  else{aiState="off";renderAiChip();}
})();
