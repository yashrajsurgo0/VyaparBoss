/* VyaparBoss growth tools. Loaded after app.js and uses its helpers (ico, esc, toast, flow, ACTIONS…).
   Public pages (no tabs):  #join[/s|/b[/leadId]]  free sign-up for suppliers and buyers
                            #quote/<token>          a supplier sends their own price for one request
   Ops pages (admin key):   Suppliers → Sign-ups,  Insights → Outreach,  live quote links on the quotes card. */

/* ===================== PUBLIC ROUTES ===================== */
let pub={view:null,role:null,ref:"",cats:[],sent:null,err:[],busy:false,q:null,token:null};
function route(){
  const h=decodeURIComponent(location.hash||"");
  const m=h.match(/^#(join|quote)(?:\/([^/]*))?(?:\/([^/]*))?/);
  document.body.classList.toggle("public",!!m);
  if(!m){if(pub.view){pub.view=null;$("#v-public").hidden=true;showTab("buy");}return;}
  document.querySelectorAll(".view").forEach(v=>v.hidden=v.id!=="v-public");
  if(m[1]==="join"){
    if(pub.view!=="join")pub={view:"join",role:m[2]==="s"?"supplier":m[2]==="b"?"buyer":null,ref:m[3]||"",cats:[],sent:null,err:[],busy:false};
    renderJoin();
  }else{
    pub={view:"quote",token:m[2]||"",q:null,err:[],sent:null,busy:true};renderQuotePage();
    Repo.getQuote(pub.token).then(j=>{pub.q=j;pub.busy=false;renderQuotePage();})
      .catch(e=>{pub.busy=false;pub.err=[e.status===404?"This quote link isn't valid any more. Ask VyaparBoss for a new one.":"Couldn't load the request. Check your internet and refresh."];renderQuotePage();});
  }
  window.scrollTo({top:0});
}
const pubShell=(inner)=>`<div class="pubwrap">${inner}<p class="pubfoot">VyaparBoss by House of 24 Pvt. Ltd. · <a href="#">Open the app</a></p></div>`;

function renderJoin(){
  const el=$("#v-public");el.hidden=false;
  if(pub.sent){
    el.innerHTML=pubShell(`<div class="card done">${ico("art-done","art")}<h2>Shukriya! You're on the list.</h2>
      <p>${pub.role==="supplier"?"We'll call or WhatsApp you to add your rates and products. After that, you'll get buyer requests that match what you make, where you deliver."
        :"We'll call or WhatsApp you to understand what you buy. Meanwhile, you can try Bhai right now."}</p>
      <p class="hint">Sign-up number <b class="num">${esc(pub.sent)}</b></p>
      <div class="actions" style="justify-content:center"><a class="btn primary" href="#">${pub.role==="supplier"?"See how VyaparBoss works":"Try Bhai now"}</a></div></div>`);
    return;
  }
  const roleBtn=(r,t,s,icon)=>`<button class="rolecard" data-action="join-role" data-v="${r}" aria-pressed="${pub.role===r}">${ico(icon,"")}<b>${t}</b><span>${s}</span></button>`;
  let form="";
  if(pub.role){
    const sup=pub.role==="supplier";
    form=`<form class="card joinform" data-form="join" novalidate>
      <p class="q-title">${sup?"Tell us about your business":"Tell us about your buying"}</p>
      <div class="fields">
        <div class="field wide"><label for="jBiz">Business name</label><input id="jBiz" autocomplete="organization" placeholder="${sup?"e.g. Shree Ganesh Corrugators":"e.g. Moradabad Brass Exports"}"></div>
        <div class="field"><label for="jName">Your name</label><input id="jName" autocomplete="name"></div>
        <div class="field"><label for="jPhone">WhatsApp number</label><input id="jPhone" inputmode="tel" autocomplete="tel" placeholder="98xxxxxxxx"></div>
        <div class="field"><label for="jCity">City</label><input id="jCity" list="jCities" autocomplete="address-level2"><datalist id="jCities">${Object.keys(CITIES).sort().map(c=>`<option value="${c}">`).join("")}</datalist></div>
      </div>
      <p class="q-sub">${sup?"What do you make or sell?":"What do you buy regularly?"}</p>
      <div class="chips">${Object.entries(CATS).map(([k,l])=>`<button type="button" class="chip" data-action="join-cat" data-v="${k}" aria-pressed="${pub.cats.includes(k)}">${l}</button>`).join("")}</div>
      <div class="field wide"><label for="jWhat">${sup?"Products, in your words":"Items and rough quantities"}</label><input id="jWhat" placeholder="${sup?"e.g. 3-ply and 5-ply boxes, up to 20,000 a month":"e.g. 5-ply export cartons, 3,000 a month"}"></div>
      ${sup?"":`<p class="q-sub">Do you export?</p><div class="chips" data-group="exports">${EXPORT_STAGES.map(x=>`<button type="button" class="chip" data-action="join-pick" data-k="exports" data-v="${esc(x)}" aria-pressed="${pub.exports===x}">${x}</button>`).join("")}</div>
        <p class="q-sub">Monthly spend on these items</p><div class="chips">${MONTHLY_BANDS.map(x=>`<button type="button" class="chip" data-action="join-pick" data-k="monthly" data-v="${esc(x)}" aria-pressed="${pub.monthly===x}">${x}</button>`).join("")}</div>`}
      <details class="more"><summary>Add email${sup?" and GSTIN":""} (optional) ${ico("i-chev","")}</summary><div class="fields">
        <div class="field"><label for="jEmail">Email</label><input id="jEmail" type="email" autocomplete="email"></div>
        ${sup?`<div class="field"><label for="jGst">GSTIN</label><input id="jGst" maxlength="15" class="num" autocapitalize="characters"></div>`:""}
      </div></details>
      <input id="jHp" name="company_site" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
      <label class="approve"><input type="checkbox" id="jOk"><span>VyaparBoss can contact me by phone, WhatsApp or email about ${sup?"buyer requests":"my purchases"}. ${sup?"Listing is free; a small fee applies only on orders that close, agreed before the first one.":"It's free for buyers."}</span></label>
      ${pub.err.length?`<ul class="errors" role="alert">${pub.err.map(e=>`<li>${esc(e)}</li>`).join("")}</ul>`:""}
      <div class="actions"><button class="btn primary big" ${pub.busy?"disabled":""}>${pub.busy?"Sending…":sup?"List my business free":"Join free"}</button></div>
      ${pub.busy&&Repo.mode!=="server"?`<p class="hint">Waking up the server. This can take up to a minute the first time.</p>`:""}
    </form>`;
  }
  el.innerHTML=pubShell(`<section class="pubhero">
      <div><p class="hello">Namaste! Main Bhai hoon.</p><h1>${pub.role==="supplier"?"Buyers, without the lead packages.":pub.role==="buyer"?"Buy smarter, delivered.":"Join VyaparBoss, free."}</h1>
      <p class="lede">${pub.role==="supplier"?"List free. Get only requests you can actually serve. Pay a small fee only when an order closes."
        :pub.role==="buyer"?"Tell Bhai what you need. Compare verified suppliers on the full delivered price. Nothing is ordered until you approve."
        :"Vyapar bada, jhanjhat chhota! Pick one to start."}</p></div>
      <svg class="bhai-l" role="img" aria-label="Bhai"><use href="#bhai"/></svg></section>
    <div class="roles">${roleBtn("supplier","I make or sell","Manufacturers, traders, distributors","art-shop")}${roleBtn("buyer","I buy for my business","Factories, exporters, traders","art-truck")}</div>
    ${form}`);
}
function readJoin(){
  const g=id=>document.getElementById(id)?.value??"";
  return {role:pub.role,business:g("jBiz"),name:g("jName"),phone:g("jPhone"),city:g("jCity").trim(),what:g("jWhat"),email:g("jEmail"),gstin:g("jGst"),
    cats:pub.cats,exports:pub.exports||"",monthly:pub.monthly||"",ref:pub.ref,consent:!!document.getElementById("jOk")?.checked,company_site:g("jHp")};
}
let joinDraft=null;
function keepJoin(){joinDraft=readJoin();}
function restoreJoin(){if(!joinDraft)return;const s=(id,v)=>{const e=document.getElementById(id);if(e&&v!=null)e.value=v;};
  s("jBiz",joinDraft.business);s("jName",joinDraft.name);s("jPhone",joinDraft.phone);s("jCity",joinDraft.city);s("jWhat",joinDraft.what);s("jEmail",joinDraft.email);s("jGst",joinDraft.gstin);
  const ok=document.getElementById("jOk");if(ok)ok.checked=joinDraft.consent;}
function rerenderJoin(){keepJoin();renderJoin();restoreJoin();}
async function submitJoin(){
  const form=readJoin();const {ok,errors}=normalizeJoin(form);
  if(!ok){pub.err=errors;rerenderJoin();try{document.querySelector(".joinform .errors")?.scrollIntoView({block:"center"});}catch(e){}return;}
  pub.err=[];pub.busy=true;rerenderJoin();
  try{const j=await Repo.join(form);pub.sent=j.id||"received";joinDraft=null;renderJoin();}
  catch(e){pub.busy=false;pub.err=[e.message==="Failed to fetch"?"Couldn't reach VyaparBoss. Check your internet and try again.":e.message];rerenderJoin();}
}

function renderQuotePage(){
  const el=$("#v-public");el.hidden=false;
  if(pub.busy&&!pub.q){el.innerHTML=pubShell(`<div class="card"><p>Loading the request…</p>${Repo.mode!=="server"?`<p class="hint">The server may take up to a minute to wake up.</p>`:""}</div>`);return;}
  if(!pub.q){el.innerHTML=pubShell(`<div class="card"><h2>Hmm.</h2><p>${esc(pub.err[0]||"")}</p></div>`);return;}
  const {rfq,supplier,rateCard,quote}=pub.q;const one=unitOne(rfq.unit);
  const head=`<section class="pubhero"><div><p class="hello">Namaste, ${esc(supplier.name)}!</p><h1>A buyer needs a quote.</h1>
    <p class="lede">Send your own price. The buyer sees your delivered price (your rate + GST + freight) next to other suppliers. Nothing is final until the buyer approves and you confirm the order.</p></div>
    <svg class="bhai-l" role="img" aria-label="Bhai"><use href="#bhai"/></svg></section>`;
  const req=`<div class="card"><p class="q-title">Request ${esc(rfq.id)}</p><dl class="summary">
    <dt>Item</dt><dd>${esc(rfq.product)}<br><span class="muted">${esc(rfq.spec)}</span></dd>
    <dt>Quantity</dt><dd>${qfmt(rfq.qty)} ${esc(rfq.unit)}</dd>
    <dt>Deliver to</dt><dd>${esc(rfq.city)}</dd>
    <dt>Needed</dt><dd>${rfq.deadline?`Within ${rfq.deadline} days of ${dstr(rfq.date)}`:"No fixed date"}</dd></dl></div>`;
  if(!rfq.open){el.innerHTML=pubShell(head+req+`<div class="card"><p><b>This request is closed.</b> Thank you for your time; more requests will come your way.</p></div>`);return;}
  if(pub.sent&&!pub.edit){el.innerHTML=pubShell(head+req+`<div class="card done">${ico("art-done","art")}<h2>Quote sent!</h2>
    <p>${inr(pub.sent.unit,2)} per ${esc(one)} + GST ${rfq.gst}%, ready in ${pub.sent.lead} day${pub.sent.lead>1?"s":""}.</p>
    <div class="actions" style="justify-content:center"><button class="btn" data-action="quote-edit">Change my quote</button></div></div>`);return;}
  const cur=quote||{};
  el.innerHTML=pubShell(head+req+`<form class="card" data-form="quote" novalidate>
    <p class="q-title">${quote?"Update your quote":"Your quote"}</p>
    <div class="fields">
      <div class="field"><label for="qUnit">Price per ${esc(one)}, before GST (₹)</label><input id="qUnit" type="number" step="0.01" min="0" inputmode="decimal" value="${cur.unit??rateCard??""}"></div>
      <div class="field"><label for="qLead">Days to get it ready</label><input id="qLead" type="number" min="1" max="60" value="${cur.lead??""}"></div>
      <div class="field wide"><label for="qNote">Note for the buyer (optional)</label><input id="qNote" maxlength="200" value="${esc(cur.note||"")}" placeholder="e.g. 30% advance, balance on delivery"></div>
    </div>
    ${rateCard?`<p class="hint">Your saved rate for this quantity is ${inr(rateCard,2)}. Quote lower if you want the order more.</p>`:""}
    ${pub.err.length?`<ul class="errors" role="alert">${pub.err.map(e=>`<li>${esc(e)}</li>`).join("")}</ul>`:""}
    <div class="actions"><button class="btn primary big" ${pub.busy?"disabled":""}>${pub.busy?"Sending…":"Send quote"}</button></div></form>`);
}
async function submitQuote(){
  const q={unit:$("#qUnit").value,lead:$("#qLead").value,note:$("#qNote").value};
  const {ok,errors}=normalizeLiveQuote(q,pub.q.rateCard);
  if(!ok){pub.err=errors;renderQuotePage();return;}
  pub.busy=true;pub.err=[];
  try{const j=await Repo.sendQuote(pub.token,q);pub.sent=j.quote;pub.q.quote=j.quote;pub.edit=false;}
  catch(e){pub.err=[e.message];}
  pub.busy=false;renderQuotePage();
}

/* ===================== OPS GATE ===================== */
function opsGate(where){
  if(Repo.mode!=="server")return null;
  if(!Repo.adminKey)return `<div class="panel pad gate"><h3>Team only</h3><p class="muted">${where} Enter the admin key set on the server (ADMIN_KEY).</p>
    <form class="warow" data-form="admin-key"><input id="adminKey" type="password" autocomplete="current-password" placeholder="Admin key" aria-label="Admin key"><button class="btn primary">Unlock</button></form></div>`;
  return "";
}
function opsError(e,el,rerender){
  if(e.status===401){Repo.setAdminKey("");toast("That admin key didn't work.");rerender();return;}
  el.innerHTML=`<div class="panel pad"><p>${esc(e.message)}</p></div>`;
}

/* ===================== SIGN-UPS (Suppliers tab) ===================== */
let appsCache=null;
async function renderApps(){
  const el=$("#appsList");
  if(Repo.mode!=="server"){el.innerHTML=`<div class="panel empty">${ico("art-shop","")}<h2>Sign-ups come in on the live app</h2><p>Share your sign-up link: suppliers and buyers fill a 2-minute form, and their details land here for your team to call.</p>
    <div class="actions" style="justify-content:center"><a class="btn primary" href="#join">Open the sign-up page</a><button class="btn" data-action="copy-join">Copy sign-up link</button></div></div>`;return;}
  const gate=opsGate("Sign-ups include phone numbers, so they're for your team.");if(gate){el.innerHTML=gate;return;}
  if(!appsCache)el.innerHTML=`<p class="muted">Loading sign-ups…</p>`;
  try{appsCache=await Repo.applications();}catch(e){return opsError(e,el,renderApps);}
  const list=appsCache;
  const head=`<div class="toolbar"><p class="muted" style="margin:0">${list.length} sign-up${list.length===1?"":"s"}. Call new ones within a day; a fast first call is half the sale.</p>
    <a class="btn sm" href="#join">Sign-up page</a><button class="btn sm" data-action="copy-join">Copy link</button>${list.length?`<button class="btn sm ghost" data-action="apps-csv">Download CSV</button>`:""}</div>`;
  if(!list.length){el.innerHTML=head+`<div class="panel empty">${ico("art-shop","")}<h2>No sign-ups yet</h2><p>Send the sign-up link in your outreach emails and WhatsApp groups.</p></div>`;return;}
  const statusPill={new:"gold",contacted:"",onboarded:"good",rejected:"bad"};
  el.innerHTML=head+`<div class="applist">${list.map(a=>`<div class="panel ocard">
    <div class="ohead"><div><h3>${esc(a.business)}</h3><p class="meta">${a.role==="supplier"?"Supplier":"Buyer"} · ${esc(a.city)} · ${dstr(a.at)}${a.ref?` · from outreach`:""}</p></div><span class="pill ${statusPill[a.status]}">${esc(a.status)}</span></div>
    <p>${a.cats.map(c=>`<span class="tag">${esc(CATS[c])}</span>`).join(" ")} ${esc(a.what)}</p>
    <p class="hint">${esc(a.name)} · <a href="https://wa.me/91${esc(a.phone)}" target="_blank" rel="noopener">WhatsApp +91 ${esc(a.phone)}</a>${a.email?` · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a>`:""}${a.gstin?` · GSTIN <span class="num">${esc(a.gstin)}</span>`:""}${a.exports?` · ${esc(a.exports)}`:""}${a.monthly?` · ${esc(a.monthly)}/month`:""}</p>
    <div class="actions">${a.role==="supplier"&&a.status!=="onboarded"?`<button class="btn sm primary" data-action="app-onboard" data-id="${esc(a.id)}">Add as supplier</button>`:""}
      ${a.status==="new"?`<button class="btn sm" data-action="app-status" data-id="${esc(a.id)}" data-v="contacted">Mark called</button>`:""}
      ${a.role==="buyer"&&a.status!=="onboarded"?`<button class="btn sm" data-action="app-status" data-id="${esc(a.id)}" data-v="onboarded">Active buyer</button>`:""}
      ${a.status!=="rejected"&&a.status!=="onboarded"?`<button class="btn sm ghost" data-action="app-status" data-id="${esc(a.id)}" data-v="rejected">Not a fit</button>`:""}</div>
  </div>`).join("")}</div>`;
}
function onboardFromApp(id){
  const a=appsCache?.find(x=>x.id===id);if(!a)return;
  showSupplierView("network");openSupplierForm(null);sf.appId=a.id;
  renderSupplierForm({name:a.business,city:CITIES[a.city]?a.city:"",gstin:a.gstin,contact:"+91 "+a.phone,terms:""});
  toast("Fill in their rates and delivery range, then save.");
}

/* ===================== OUTREACH (Insights tab) ===================== */
let out={data:null,filter:"all",status:"new",q:"",sel:new Set(),tpl:"supplier_free",result:null,armed:false,busy:false};
async function renderOutreachView(){
  const el=$("#outreachBox");
  const gate=opsGate("Outreach uses your lead lists and sends email in your name.");if(gate){el.innerHTML=gate;return;}
  try{out.data=await Repo.leads();}catch(e){return opsError(e,el,renderOutreachView);}
  const {leads,outreach:o}=out.data;const st=o.settings||{};
  const shown=leads.filter(l=>(out.filter==="all"||l.segment===out.filter)&&(out.status==="all"||l.status===out.status)
    &&(!out.q||(l.business+" "+l.city+" "+l.product).toLowerCase().includes(out.q)));
  for(const id of [...out.sel])if(!leads.some(l=>l.id===id))out.sel.delete(id);
  const n=out.sel.size,first=leads.find(l=>out.sel.has(l.id))||shown[0];
  const base=Repo.mode==="server"?(o.publicUrl||location.origin)+"/":LIVE_API;
  const preview=first?renderOutreach(out.tpl,first,{senderName:st.senderName,senderAddress:st.senderAddress||"[your business address]",joinBase:base,unsubLink:()=>"[unsubscribe link]"}):null;
  const canSend=Repo.mode==="server"&&o.email;
  const counts=s=>leads.filter(l=>l.status===s).length;
  el.innerHTML=`
  <div class="panel pad steps-out">
    <h3>1. Who's writing</h3>
    <p class="hint">Every email shows your name and business address and has an unsubscribe link. That keeps you on the right side of spam rules and inboxes.</p>
    <div class="fields"><div class="field"><label for="oName">Your name</label><input id="oName" value="${esc(st.senderName||"")}" placeholder="e.g. Yashraj Surgoniwar"></div>
      <div class="field wide"><label for="oAddr">Business address (one line)</label><input id="oAddr" value="${esc(st.senderAddress||"")}" placeholder="House of 24 Pvt. Ltd., street, city, PIN"></div></div>
    <div class="actions"><button class="btn sm" data-action="o-settings">Save</button></div>
  </div>
  <div class="panel pad">
    <h3>2. Leads <span class="muted" style="font-weight:400">${leads.length} total · ${counts("new")} new · ${counts("emailed")} emailed · ${counts("joined")} joined</span></h3>
    <div class="toolbar"><label class="btn sm">${ico("i-plus")}Import CSV<input type="file" id="leadFile" accept=".csv,text/csv" hidden></label>
      <span class="hint">Columns like business_name, city, email, phone, products, segment. Duplicates are skipped.</span></div>
    ${leads.length?`<div class="toolbar">
      <div class="chips">${[["all","All"],["supplier","Suppliers"],["exporter","Exporters"]].map(([k,l])=>`<button class="chip" data-action="o-filter" data-v="${k}" aria-pressed="${out.filter===k}">${l}</button>`).join("")}</div>
      <select id="oStatus" aria-label="Status">${["all","new","emailed","replied","joined","not_interested","unsubscribed","bounced"].map(s=>`<option value="${s}" ${out.status===s?"selected":""}>${s==="all"?"Any status":s.replace("_"," ")}</option>`).join("")}</select>
      <input id="oSearch" type="search" placeholder="Search" value="${esc(out.q)}" aria-label="Search leads">
    </div>
    <div class="tablewrap"><table class="cmp leads"><thead><tr><th><input type="checkbox" id="oAll" aria-label="Select all shown with email" ${shown.length&&shown.filter(l=>l.email).every(l=>out.sel.has(l.id))?"checked":""}></th><th>Business</th><th>City</th><th>Product</th><th>Email</th><th>Status</th></tr></thead><tbody>
    ${shown.slice(0,300).map(l=>`<tr><td><input type="checkbox" data-lead="${esc(l.id)}" ${out.sel.has(l.id)?"checked":""} ${l.email?"":"disabled"} aria-label="Select ${esc(l.business)}"></td>
      <td><b>${esc(l.business)}</b>${l.website?`<br><a href="${esc(/^https?:/.test(l.website)?l.website:"https://"+l.website)}" target="_blank" rel="noopener" class="muted">${esc(l.website.replace(/^https?:\/\//,"").slice(0,32))}</a>`:""}</td>
      <td>${esc(l.city)}</td><td>${esc(l.product.slice(0,40))}</td><td>${l.email?esc(l.email):`<span class="muted">${l.phone?esc(l.phone):"none"}</span>`}</td>
      <td><select data-lead-status="${esc(l.id)}" aria-label="Status of ${esc(l.business)}">${["new","emailed","replied","joined","not_interested","unsubscribed","bounced"].map(s=>`<option value="${s}" ${l.status===s?"selected":""}>${s.replace("_"," ")}</option>`).join("")}</select></td></tr>`).join("")}
    </tbody></table></div>${shown.length>300?`<p class="hint">Showing 300 of ${shown.length}. Narrow with search or filters.</p>`:""}`
    :`<p class="muted">No leads yet. Import a CSV, for example the supplier and exporter lists Bhai researched.</p>`}
  </div>
  <div class="panel pad">
    <h3>3. Email ${n?`${n} selected lead${n>1?"s":""}`:"selected leads"}</h3>
    <div class="field narrow"><label for="oTpl">Template</label><select id="oTpl">${OUTREACH_TEMPLATES.map(t=>`<option value="${t.id}" ${out.tpl===t.id?"selected":""}>${esc(t.label)}</option>`).join("")}</select></div>
    ${preview?`<details class="more" open><summary>Preview for ${esc(first.business)} ${ico("i-chev","")}</summary><div class="mailprev"><p><b>Subject:</b> ${esc(preview.subject)}</p><pre>${esc(preview.text)}</pre></div></details>`:""}
    <div class="actions">
      ${canSend?`<button class="btn ${out.armed?"danger":"primary"}" data-action="o-send" ${n&&!out.busy?"":"disabled"}>${out.busy?"Sending…":out.armed?`Yes, send ${n} email${n>1?"s":""}`:`Send to ${n||"selected"}`}</button>`:""}
      <button class="btn" data-action="o-export" ${n?"":"disabled"}>Download for mail merge</button>
    </div>
    <p class="hint">${canSend?`Sends from ${esc(o.from)}. Daily limit ${o.cap}; ${Math.max(0,o.cap-o.sentToday)} left today. Skips unsubscribed leads, people who already got this email, and anyone emailed in the last 3 days.`
      :Repo.mode==="server"?"Sending isn't switched on yet: add EMAIL_PROVIDER, EMAIL_API_KEY and OUTREACH_FROM_EMAIL on the server. Meanwhile, download the CSV and use a Gmail mail-merge add-on."
      :"This copy can't send email. Download the CSV and use a Gmail mail-merge add-on, or use the live app."} Start with 20–30 a day from a new domain, and reply to every answer within a day.</p>
    ${out.result?`<div class="negres">${out.result}</div>`:""}
  </div>`;
}
async function importLeadFile(file){
  if(!file)return;
  try{const rows=parseCSV(await file.text());if(!rows.length){toast("That file has no rows.");return;}
    const seg=/export/i.test(file.name)?"exporter":null;
    const r=await Repo.importLeads(rows.map(x=>seg&&!x.segment?{...x,segment:"exporter-buyer"}:x));
    toast(`Added ${r.added} lead${r.added===1?"":"s"}${r.skipped?`, skipped ${r.skipped} duplicates`:""}`);renderOutreachView();}
  catch(e){fail(e);}
}
function exportMailMerge(){
  const {leads,outreach:o}=out.data;const st=o.settings||{};const base=Repo.mode==="server"?(o.publicUrl||location.origin)+"/":LIVE_API;
  const rows=leads.filter(l=>out.sel.has(l.id)&&l.email).map(l=>{const m=renderOutreach(out.tpl,l,{senderName:st.senderName,senderAddress:st.senderAddress,joinBase:base,
    unsubLink:()=>"Reply \"unsubscribe\" and we won't write again."});return {email:l.email,business:l.business,city:l.city,subject:m.subject,body:m.text};});
  download(`vyaparboss-outreach-${out.tpl}.csv`,toCSV(rows,["email","business","city","subject","body"]));
  toast(`${rows.length} emails ready. Mark them "emailed" after you send.`);
}
function download(name,text){
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type:"text/csv"}));a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
}
async function sendOutreach(btn){
  if(!out.armed){out.armed=true;renderOutreachView();setTimeout(()=>{if(out.armed){out.armed=false;renderOutreachView();}},6000);return;}
  out.armed=false;out.busy=true;renderOutreachView();
  try{const r=await Repo.outreach([...out.sel],out.tpl,true);
    const skipped=r.previews.filter(p=>p.skip);
    out.result=`<span><b style="color:var(--good)">Sent ${r.sent}</b></span>${skipped.length?`<span>Skipped ${skipped.length}: ${esc([...new Set(skipped.map(p=>p.skip))].join("; "))}</span>`:""}<span>${r.remaining} left today</span>`;
    out.sel.clear();toast(`Sent ${r.sent} email${r.sent===1?"":"s"}`);}
  catch(e){out.result=`<span>${esc(e.message)}</span>`;}
  out.busy=false;renderOutreachView();
}

/* ===================== LIVE QUOTES (quotes card, ops) ===================== */
let inv={rfq:null,list:null,busy:false};
function liveQuotesHTML(res){
  if(Repo.mode!=="server"||!Repo.adminKey||!flow.r.id)return "";
  const real=res.eligible.filter(q=>!q.s.sample);
  if(inv.rfq!==flow.r.id){inv={rfq:flow.r.id,list:null,busy:false};Repo.invites(flow.r.id).then(l=>{if(inv.rfq===flow.r.id){inv.list=l;if(flow.stage==="quotes")renderBuy();}}).catch(()=>{});}
  const asked=new Set((inv.list||[]).map(i=>i.sid)),toAsk=real.filter(q=>!asked.has(q.s.id));
  const p=PMAP[flow.r.productId];
  const msg=i=>encodeURIComponent(`Namaste ${i.sname}, VyaparBoss se. Ek buyer ko ${qfmt(flow.r.qty)} ${p.unit} ${p.name} chahiye, delivery ${flow.r.city}${flow.r.deadline?`, ${flow.r.deadline} din mein`:""}. Apna rate yahan bhejiye (1 minute): ${i.url}`);
  return `<details class="more" ${inv.list?.length?"open":""}><summary>Team: get real quotes from suppliers ${ico("i-chev","")}</summary><div>
    ${real.length?`<p class="hint">Send each onboarded supplier a link. Their price replaces the rate-card estimate as soon as they answer.</p>`:`<p class="hint">Only sample suppliers can serve this request. Onboard real ones from Suppliers → Sign-ups.</p>`}
    ${(inv.list||[]).length?`<ul class="invlist">${inv.list.map(i=>{const ph=phoneDigits(i.contact);return `<li><b>${esc(i.sname)}</b> ${i.quote?`<span class="pill good">Quoted ${inr(i.quote.unit,2)}, ready in ${i.quote.lead} d</span>`:`<span class="pill gold">Waiting</span>`}
      <span class="actions">${ph.length===10?`<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/91${ph}?text=${msg(i)}">WhatsApp</a>`:""}<button class="btn sm ghost" data-action="copy-text" data-v="${esc(i.url)}">Copy link</button></span></li>`;}).join("")}</ul>
`:""}
    <div class="actions">${(inv.list||[]).length?`<button class="btn sm" data-action="inv-refresh">Check for new quotes</button>`:""}
    ${toAsk.length?`<button class="btn sm primary" data-action="inv-send" ${inv.busy?"disabled":""}>Create links for ${toAsk.length} supplier${toAsk.length>1?"s":""}</button>`:""}</div>
  </div></details>`;
}
async function createInvites(){
  const res=discoverNow();const sids=res.eligible.filter(q=>!q.s.sample).map(q=>q.s.id);
  inv.busy=true;renderBuy();
  try{inv.list=await Repo.invites(flow.r.id,sids);toast("Links ready. Send them on WhatsApp.");}catch(e){if(e.status===401){Repo.setAdminKey("");}fail(e);}
  inv.busy=false;renderBuy();
}

/* ===================== ACTIONS + EVENTS ===================== */
const joinUrl=()=>(Repo.mode==="server"?location.origin+location.pathname:LIVE_API)+"#join";
function copyText(t){try{navigator.clipboard.writeText(t).then(()=>toast("Copied"),()=>toast(t));}catch(e){toast(t);}}
Object.assign(ACTIONS,{
  "join-role":a=>{keepJoin();pub.role=a.dataset.v;pub.err=[];renderJoin();restoreJoin();setTimeout(()=>$("#jBiz")?.focus(),30);},
  "join-cat":a=>{const c=a.dataset.v;pub.cats=pub.cats.includes(c)?pub.cats.filter(x=>x!==c):pub.cats.concat(c);rerenderJoin();},
  "join-pick":a=>{pub[a.dataset.k]=pub[a.dataset.k]===a.dataset.v?"":a.dataset.v;rerenderJoin();},
  "quote-edit":()=>{pub.edit=true;renderQuotePage();},
  "copy-join":()=>copyText(joinUrl()),
  "copy-text":a=>copyText(a.dataset.v),
  "apps-csv":()=>download("vyaparboss-signups.csv",toCSV(appsCache.map(a=>({...a,cats:a.cats.map(c=>CATS[c]).join("; "),at:new Date(a.at).toISOString()})),["id","at","role","status","business","name","phone","email","city","cats","what","gstin","exports","monthly","ref"])),
  "app-onboard":a=>onboardFromApp(a.dataset.id),
  "app-status":a=>Repo.updateApplication(a.dataset.id,{status:a.dataset.v}).then(renderApps).catch(fail),
  "o-filter":a=>{out.filter=a.dataset.v;renderOutreachView();},
  "o-settings":()=>Repo.saveOutreachSettings({senderName:$("#oName").value,senderAddress:$("#oAddr").value}).then(()=>{toast("Saved");renderOutreachView();}).catch(fail),
  "o-export":()=>exportMailMerge(),
  "o-send":a=>sendOutreach(a),
  "inv-send":()=>createInvites(),
  "inv-refresh":()=>{Repo.refresh().then(()=>Repo.invites(flow.r.id)).then(l=>{inv.list=l;renderBuy();toast(l.some(i=>i.quote)?"Quotes updated":"No new quotes yet");}).catch(fail);},
});
document.addEventListener("submit",e=>{
  const f=e.target.closest("form[data-form]");if(!f)return;
  if(f.dataset.form==="join"){e.preventDefault();submitJoin();}
  if(f.dataset.form==="quote"){e.preventDefault();submitQuote();}
  if(f.dataset.form==="admin-key"){e.preventDefault();const k=$("#adminKey").value.trim();if(!k)return;Repo.setAdminKey(k);
    Repo.adminCheck().then(()=>{toast("Unlocked for this browser session");appsCache=null;renderApps();renderOutreachView();if(flow.stage==="quotes")renderBuy();})
      .catch(err=>{Repo.setAdminKey("");toast(err.status===401?"That admin key didn't work.":err.message);});}
});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.id==="leadFile"){importLeadFile(t.files[0]);t.value="";return;}
  if(t.dataset?.lead){t.checked?out.sel.add(t.dataset.lead):out.sel.delete(t.dataset.lead);out.armed=false;renderOutreachView();return;}
  if(t.id==="oAll"){const shown=[...document.querySelectorAll("[data-lead]")].filter(x=>!x.disabled).map(x=>x.dataset.lead);shown.forEach(id=>t.checked?out.sel.add(id):out.sel.delete(id));renderOutreachView();return;}
  if(t.dataset?.leadStatus){Repo.updateLead(t.dataset.leadStatus,{status:t.value}).then(()=>toast("Updated")).catch(fail);return;}
  if(t.id==="oStatus"){out.status=t.value;renderOutreachView();return;}
  if(t.id==="oTpl"){out.tpl=t.value;renderOutreachView();return;}
});
document.addEventListener("input",e=>{if(e.target.id==="oSearch"){out.q=e.target.value.toLowerCase().trim();clearTimeout(out._t);out._t=setTimeout(()=>{renderOutreachView().then(()=>{const s=$("#oSearch");if(s){s.focus();s.setSelectionRange(s.value.length,s.value.length);}});},250);}});
window.addEventListener("hashchange",route);
function growBoot(){if(/^#(join|quote)/.test(location.hash))route();}
