/* VyaparBoss has two sides, chosen on the welcome screen:
     Buyers    → Buy, Orders, Suppliers (directory with filters), Insights
     Suppliers → Requests (quote in the app), Orders (move them along), My listing, Insights
   Team tools (network, sign-ups, outreach, supplier view, WhatsApp) sit behind the admin key.
   Loaded last; uses helpers from app.js and grow.js. */

const NAV={
  buyer:[["buy","Buy","i-buy"],["orders","Orders","i-orders"],["suppliers","Suppliers","i-store"],["insights","Insights","i-chart"]],
  supplier:[["requests","Requests","i-chat"],["sorders","Orders","i-orders"],["listing","My listing","i-store"],["sinsights","Insights","i-chart"]]
};
const ROLE_NAME={buyer:"Buyer",supplier:"Supplier"};
/* Who is using the app: a signed-in account's role, a guest buyer, or nobody yet (welcome screen). */
const role=()=>{const me=Repo.me;if(me&&!me.guest)return me.role;if(me?.guest||Repo.guest)return "buyer";return null;};
const signedIn=()=>!!(Repo.me&&!Repo.me.guest);
const teamOn=()=>Repo.mode==="server"?!!Repo.data.team:(()=>{try{return localStorage.getItem(KEY+".team")==="1";}catch(e){return false;}})();
const navFor=()=>(NAV[role()]||[]).concat(teamOn()?[["team","Team","i-shield"]]:[]);
/* Only tabs that belong to the current side can open; anything else lands on that side's first tab. */
function allowedTab(t){
  if(t==="team"||t==="account")return t==="account"&&!role()?"auth":t;
  const n=navFor();if(!role())return "auth";
  return n.some(x=>x[0]===t)?t:n[0][0];
}
/* Only touch the DOM when the markup actually changed, so typing and focus survive background refreshes. */
function setHTML(el,html){if(el&&el._html!==html){el.innerHTML=html;el._html=html;}}

/* ===================== NAV + ACCOUNT MENU ===================== */
function renderNav(){
  const items=navFor(),cur=document.querySelector(".view:not([hidden])")?.id?.slice(2);
  const btn=(k,l,i)=>`<button data-tab="${k}" ${cur===k?'aria-current="page"':""}><svg><use href="#${i}"/></svg>${l}${k==="orders"||k==="sorders"?`<span class="count" id="${k==="orders"?"ordCount":"sordCount"}" hidden></span>`:""}</button>`;
  const html=items.map(([k,l,i])=>btn(k,l,i)).join("");
  setHTML($("#tabs"),html);setHTML($("#bottomnav"),html);
  const bn=$("#bottomnav");if(bn)bn.style.gridTemplateColumns=`repeat(${Math.max(1,items.length)},1fr)`;
  renderOrdersCount();
}
function renderOrdersCount(){
  const n=store().orders.length,c=document.getElementById(role()==="supplier"?"sordCount":"ordCount");
  if(c){c.textContent=n;c.hidden=!n;}
}
function renderAcct(){
  const el=document.getElementById("acctPick");if(!el)return;
  const me=Repo.me,r=role(),open=el.open;
  const ini=me&&!me.guest?initials(me.business||me.name||me.email):"";
  const summary=signedIn()?`<summary aria-label="Your account"><span class="acct-av">${esc(ini)}</span></summary>`
    :`<summary aria-label="Log in or sign up"><span class="rp-long">${r?"Guest":"Log in"}</span><span class="rp-short">${r?"Guest":"Log in"}</span></summary>`;
  const body=signedIn()?`<p class="rp-h">${esc(me.name||me.email)}</p>
      <p class="rp-note">${esc(me.business||"")}${me.business?"<br>":""}${ROLE_NAME[me.role]} account${me.email?` · ${esc(me.email)}`:""}${me.demo?"<br>Demo account, saved in this browser":""}</p>
      <button data-action="go" data-tab="account">Account settings</button>
      <button data-action="acct-logout">Log out</button>`
    :`<p class="rp-note">${r?"You're looking around as a guest buyer. Create an account to keep your requests and orders.":"Buy or supply on VyaparBoss."}</p>
      <button data-action="acct-auth" data-v="signup">Create an account</button>
      <button data-action="acct-auth" data-v="login">Log in</button>`;
  const team=teamOn()?`<p class="rp-h">Team</p><button data-action="go" data-tab="team">Team tools</button>`:"";
  setHTML(el,summary+`<div class="rp-menu" role="menu">${body}${team}</div>`);
  el.open=open;
}
document.addEventListener("click",e=>{const d=document.getElementById("acctPick");if(d&&d.open&&!d.contains(e.target))d.open=false;});

/* ===================== WELCOME: choose a side, then sign up or log in ===================== */
let au={role:null,mode:"signup",email:false,err:[],busy:false,cfg:null,wrongRole:null};
function showAuth(r,mode){
  if(r)au.role=r;if(mode)au.mode=mode;au.err=[];au.wrongRole=null;
  document.body.classList.add("welcome");
  document.querySelectorAll(".view").forEach(v=>v.hidden=v.id!=="v-auth");
  try{localStorage.removeItem(KEY+".tab");}catch(e){}
  renderAuth();window.scrollTo({top:0});
  Repo.authConfig().then(c=>{au.cfg=c;renderAuth();}).catch(()=>{au.cfg={email:true};renderAuth();});
}
function renderAuth(){
  const el=$("#v-auth");el.hidden=false;
  const r=au.role,cfg=au.cfg||{},sup=r==="supplier",signup=au.mode==="signup";
  const roleBtn=(k,t,s,icon)=>`<button class="rolecard" data-action="au-role" data-v="${k}" aria-pressed="${r===k}">${ico(icon,"")}<b>${t}</b><span>${s}</span></button>`;
  const prov=(k,label)=>k==="google"&&cfg.google?`<div class="gsi" id="gsiBtn" aria-label="${label}"></div>`
    :`<button class="btn provider" data-action="au-provider" data-v="${k}">${label}</button>`;
  const providers=`<div class="providers">
      ${prov("google",`Continue with Google`)}${prov("apple",`Continue with Apple`)}${prov("facebook",`Continue with Facebook`)}
      <button class="btn provider ${au.email?"on":""}" data-action="au-email" aria-expanded="${au.email}">Continue with email</button>
    </div>`;
  const emailForm=!au.email?"":signup?`<form class="authform" data-form="au-signup" novalidate>
      <div class="fields">
        <div class="field"><label for="auName">Your name</label><input id="auName" autocomplete="name"></div>
        <div class="field"><label for="auBiz">Business name</label><input id="auBiz" autocomplete="organization" placeholder="${sup?"e.g. Shree Ganesh Corrugators":"e.g. Moradabad Brass Exports"}"></div>
        <div class="field wide"><label for="auEmail">Email</label><input id="auEmail" type="email" autocomplete="email"></div>
        <div class="field wide"><label for="auPass">Password</label><input id="auPass" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></div>
      </div>
      <details class="more"><summary>Add phone and city (optional) ${ico("i-chev","")}</summary><div class="fields">
        <div class="field"><label for="auPhone">Mobile</label><input id="auPhone" inputmode="tel" autocomplete="tel"></div>
        <div class="field"><label for="auCity">City</label><input id="auCity" list="auCities" autocomplete="address-level2"><datalist id="auCities">${Object.keys(CITIES).sort().map(c=>`<option value="${c}">`).join("")}</datalist></div>
      </div></details>
      <button class="btn primary big" ${au.busy?"disabled":""}>${au.busy?"Creating…":sup?"Create supplier account":"Create buyer account"}</button>
    </form>`:`<form class="authform" data-form="au-login" novalidate>
      <div class="fields">
        <div class="field wide"><label for="auEmail">Email</label><input id="auEmail" type="email" autocomplete="email"></div>
        <div class="field wide"><label for="auPass">Password</label><input id="auPass" type="password" autocomplete="current-password"></div>
      </div>
      <button class="btn primary big" ${au.busy?"disabled":""}>${au.busy?"Logging in…":"Log in"}</button>
    </form>`;
  const errs=au.err.length?`<div class="errors" role="alert">${au.err.map(esc).join("<br>")}${au.wrongRole?`<br><button class="link" data-action="au-role" data-v="${au.wrongRole}">Switch to ${au.wrongRole==="supplier"?"I'm supplying":"I'm buying"}</button>`:""}</div>`:"";
  const panel=!r?"":`<div class="card authcard">
      <div class="seg" role="tablist" aria-label="Sign up or log in"><button data-action="au-mode" data-v="signup" aria-selected="${signup}">Sign up</button><button data-action="au-mode" data-v="login" aria-selected="${!signup}">Log in</button></div>
      <p class="q-title">${signup?(sup?"Create your supplier account":"Create your buyer account"):(sup?"Log in as a supplier":"Log in as a buyer")}</p>
      ${providers}${emailForm}${errs}
      ${cfg.demo?`<p class="hint">This demo copy keeps your account in this browser only. Google, Apple and Facebook work on the live app once they're switched on.</p>`:""}
      <p class="hint authalt">${sup?`Prefer a call? <a href="#join/s">Leave your number</a> and we'll set you up.`:`Just looking? <button class="link" data-action="au-guest">Explore without an account</button>`}</p>
    </div>`;
  const h1=!r?"Welcome to VyaparBoss.":sup?"Get orders you can actually serve.":"Buy smarter, delivered.";
  const lede=!r?`${t("tagline")} Are you here to buy, or to supply?`:sup?"List free. Get only requests that fit what you make and where you deliver. Pay a small fee only when an order closes."
    :"Tell Bhai what you need. Compare verified suppliers on the full delivered price. Nothing is ordered until you approve.";
  // Keep what someone already typed when this screen redraws.
  const keep={};["auName","auBiz","auEmail","auPass","auPhone","auCity"].forEach(id=>{const i=document.getElementById(id);if(i)keep[id]=i.value;});
  el.innerHTML=`<div class="pubwrap welcomewrap">
    <section class="pubhero"><div><p class="hello">${esc(t("hello"))}</p><h1>${esc(h1)}</h1><p class="lede">${esc(lede)}</p></div>
      <svg class="bhai-l" role="img" aria-label="Bhai"><use href="#bhai"/></svg></section>
    <div class="roles">${roleBtn("buyer","I'm buying","Factories, exporters, traders, shops","art-truck")}${roleBtn("supplier","I'm supplying","Manufacturers, distributors, wholesalers","art-shop")}</div>
    ${panel}</div>`;
  Object.entries(keep).forEach(([id,v])=>{const i=document.getElementById(id);if(i)i.value=v;});
  if(r&&cfg.google)mountGoogle();
}
const scripts={};
function loadScript(src){return scripts[src]||(scripts[src]=new Promise((ok,no)=>{const s=document.createElement("script");s.src=src;s.async=true;s.onload=ok;s.onerror=()=>{delete scripts[src];no(new Error("Couldn't load the sign-in button. Check your connection."));};document.head.appendChild(s);}));}
async function mountGoogle(){
  const el=document.getElementById("gsiBtn");if(!el)return;
  try{
    await loadScript("https://accounts.google.com/gsi/client");
    google.accounts.id.initialize({client_id:au.cfg.google.clientId,callback:r=>finishOauth("google",{credential:r.credential})});
    google.accounts.id.renderButton(el,{theme:"outline",size:"large",shape:"pill",text:au.mode==="signup"?"signup_with":"signin_with",width:Math.min(380,Math.max(240,el.clientWidth||320))});
  }catch(e){el.outerHTML=`<button class="btn provider" data-action="au-provider" data-v="google">Continue with Google</button>`;}
}
async function startProvider(k){
  const cfg=au.cfg||{},name={google:"Google",apple:"Apple",facebook:"Facebook"}[k];
  if(!cfg[k]){au.err=[cfg.demo?`${name} sign-in works on the live app. Use email here.`:`${name} sign-in is being set up. Use email for now.`];au.wrongRole=null;renderAuth();return;}
  try{
    if(k==="apple"){
      await loadScript("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js");
      AppleID.auth.init({clientId:cfg.apple.clientId,scope:"name email",redirectURI:cfg.apple.redirectURI,usePopup:true});
      const r=await AppleID.auth.signIn();
      const n=r.user?.name?[r.user.name.firstName,r.user.name.lastName].filter(Boolean).join(" "):"";
      return finishOauth("apple",{credential:r.authorization.id_token,name:n});
    }
    if(k==="facebook"){
      await loadScript("https://connect.facebook.net/en_US/sdk.js");
      FB.init({appId:cfg.facebook.appId,version:"v21.0",cookie:false,xfbml:false});
      FB.login(resp=>{if(resp.authResponse)finishOauth("facebook",{accessToken:resp.authResponse.accessToken});},{scope:"public_profile,email"});
    }
  }catch(e){if(e?.error==="popup_closed_by_user")return;au.err=[e.message||`${name} sign-in didn't finish. Try again.`];renderAuth();}
}
async function finishOauth(provider,payload){
  au.busy=true;au.err=[];renderAuth();
  try{const j=await Repo.oauth(provider,au.role,payload);au.busy=false;onSignedIn(j.user,j.created);}
  catch(e){au.busy=false;au.err=[e.message];au.wrongRole=e.status===409?(au.role==="supplier"?"buyer":"supplier"):null;renderAuth();}
}
async function submitAuth(kind){
  const g=id=>document.getElementById(id)?.value??"";
  au.err=[];au.wrongRole=null;
  if(kind==="signup"){
    const form={role:au.role,name:g("auName"),business:g("auBiz"),email:g("auEmail"),password:g("auPass"),phone:g("auPhone"),city:g("auCity")};
    const {errors}=normalizeAccount(form);if(form.password.length<8)errors.push("Use a password of at least 8 characters");
    if(errors.length){au.err=errors;renderAuth();return;}
    au.busy=true;renderAuth();
    try{const u=await Repo.signup(form);au.busy=false;onSignedIn(u,true);}
    catch(e){au.busy=false;au.err=[e.message];if(/already has an account/.test(e.message))au.mode="login";renderAuth();}
  }else{
    const email=g("auEmail"),pass=g("auPass");
    if(!isEmail(email)||!pass){au.err=["Enter your email and password"];renderAuth();return;}
    au.busy=true;renderAuth();
    try{const u=await Repo.login(au.role,email,pass);au.busy=false;onSignedIn(u,false);}
    catch(e){au.busy=false;au.err=[e.message];au.wrongRole=e.status===409?(e.role||(au.role==="supplier"?"buyer":"supplier")):null;renderAuth();}
  }
}
function onSignedIn(u,created){
  Repo.setGuest(false);document.body.classList.remove("welcome");
  au={...au,email:false,err:[],busy:false};
  renderNav();renderAcct();
  const first=(u.name||"").split(/\s+/)[0];
  if(u.role==="supplier")showTab(Repo.myListing?"requests":"listing");
  else if(created&&!u.business)showTab("account");
  else showTab("buy");
  toast(created?(u.role==="supplier"?`Welcome${first?", "+first:""}! Add your listing to start getting requests.`:`Welcome${first?", "+first:""}!`):`Welcome back${first?", "+first:""}`);
}

/* ===================== ACCOUNT ===================== */
function renderAccount(){
  const el=$("#v-account");const me=Repo.me;
  if(!signedIn()){setHTML(el,`<div class="panel empty">${ico("art-shop","")}<h2>You're browsing as a guest</h2><p>Create an account to keep your requests and orders, and to log in from any device.</p><div class="actions" style="justify-content:center"><button class="btn primary" data-action="acct-auth" data-v="signup">Create an account</button><button class="btn" data-action="acct-auth" data-v="login">Log in</button></div></div>`);return;}
  if(el.contains(document.activeElement))return;
  setHTML(el,`<div class="pagehead"><div><h1>Your account</h1><p class="muted">${ROLE_NAME[me.role]} account${me.demo?" (demo, saved in this browser)":""}</p></div></div>
    <form class="panel pad sform" data-form="account" novalidate>
      <div class="fields">
        <div class="field"><label for="acName">Your name</label><input id="acName" value="${esc(me.name)}" autocomplete="name"></div>
        <div class="field"><label for="acBiz">Business name</label><input id="acBiz" value="${esc(me.business)}" autocomplete="organization"></div>
        <div class="field"><label for="acEmail">Email</label><input id="acEmail" type="email" value="${esc(me.email)}" ${me.email?"readonly":""}></div>
        <div class="field"><label for="acPhone">Mobile</label><input id="acPhone" value="${esc(me.phone)}" inputmode="tel"></div>
        <div class="field"><label for="acCity">City</label><input id="acCity" value="${esc(me.city)}" list="acCities"><datalist id="acCities">${Object.keys(CITIES).sort().map(c=>`<option value="${c}">`).join("")}</datalist></div>
      </div>
      <p class="hint">Signs in with: ${[me.hasPassword||me.demo?"email and password":null,...(me.providers||[]).map(p=>p[0].toUpperCase()+p.slice(1))].filter(Boolean).join(", ")||"email"}.</p>
      <div class="actions"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-action="acct-logout">Log out</button></div>
    </form>`);
}

/* ===================== SUPPLIER SIDE ===================== */
let rq={status:"open",product:"",q:""};
const myRfqs=()=>{const me=Repo.myListing;if(!me)return[];return store().rfqs.filter(r=>r.quotes.some(q=>q.sid===me.id));};
const rfqState=(r,sid)=>r.status!=="ordered"?"open":r.wonBy===sid?"won":"lost";
function rankOf(r,sid){if(r.rank!=null)return{rank:r.rank,of:r.of};const ok=r.quotes.filter(q=>q.meets).sort((a,b)=>a.landed-b.landed);return{rank:ok.findIndex(q=>q.sid===sid)+1,of:ok.length};}
function needListing(where){return `<div class="panel empty">${ico("art-shop","")}<h2>Add your listing first</h2><p>Tell buyers what you make, your rates and how far you deliver. Then ${where}.</p><button class="btn primary" data-action="go" data-tab="listing">Create my listing</button></div>`;}
function renderRequests(){
  const el=$("#v-requests"),me=Repo.myListing;
  if(el.contains(document.activeElement)&&document.activeElement.tagName!=="BUTTON")return;
  if(!me){setHTML(el,`<div class="pagehead"><div><h1>Buyer requests</h1></div></div>`+needListing("requests that fit will show up here"));return;}
  const all=myRfqs();const n=k=>all.filter(r=>rfqState(r,me.id)===k).length;
  const prods=[...new Set(all.map(r=>r.productId))];
  const list=all.filter(r=>(rq.status==="all"||rfqState(r,me.id)===rq.status)&&(!rq.product||r.productId===rq.product)&&(!rq.q||(r.city+" "+PMAP[r.productId].name).toLowerCase().includes(rq.q)));
  const card=r=>{
    const p=PMAP[r.productId],mine=r.quotes.find(q=>q.sid===me.id),st=rfqState(r,me.id),{rank,of}=rankOf(r,me.id),my=r.myQuote||r.invites?.find(i=>i.sid===me.id)?.quote;
    const pill=st==="won"?`<span class="pill good">You won this order</span>`:st==="lost"?`<span class="pill">Went to another supplier</span>`:my?`<span class="pill good">${ico("i-check","")}Quote sent</span>`:`<span class="pill gold">Open: send your price</span>`;
    return `<div class="panel inbox">
      <div class="ohead"><div><h3>${qfmt(r.qty)} ${p.unit} ${esc(p.name)} to ${esc(r.city)}</h3><p class="meta">${esc(r.id)} · ${dstr(r.date)}${r.deadline?` · needed within ${r.deadline} days`:""}${r.sample?" · example":""}</p></div>${pill}</div>
      <div class="facts"><div><small>Your rate card</small>${inr(mine.unit,2)} per ${unitOne(p.unit)}</div><div><small>Buyer sees (with GST + freight)</small>${inr(mine.landed)}</div><div><small>Delivery</small>${mine.eta} days${mine.meets?"":", after their date"}</div><div><small>Your position</small>${mine.meets&&rank?`#${rank} of ${of} on price`:"Can't make their date"}</div></div>
      ${st==="open"?`<form class="quoteform" data-form="myquote" data-rfq="${esc(r.id)}" novalidate>
        <div class="field"><label for="mq-u-${esc(r.id)}">Your price per ${unitOne(p.unit)}, before GST (₹)</label><input id="mq-u-${esc(r.id)}" type="number" step="0.01" min="0" inputmode="decimal" value="${my?.unit??mine.unit}"></div>
        <div class="field"><label for="mq-l-${esc(r.id)}">Days to get it ready</label><input id="mq-l-${esc(r.id)}" type="number" min="1" max="60" value="${my?.lead??me.lead}"></div>
        <div class="field grow"><label for="mq-n-${esc(r.id)}">Note (optional)</label><input id="mq-n-${esc(r.id)}" maxlength="200" value="${esc(my?.note||"")}" placeholder="e.g. 30% advance, balance on delivery"></div>
        <button class="btn primary">${my?"Update quote":"Send quote"}</button>
      </form>`:""}
    </div>`;};
  setHTML(el,`<div class="pagehead"><div><h1>Buyer requests</h1><p class="muted">Requests that fit what you sell, the quantity you can handle and where you deliver. Send your own price; the buyer sees it with GST and freight added.</p></div></div>
    <div class="toolbar">
      <div class="chips">${[["open","Open",n("open")],["won","Won",n("won")],["lost","Closed",n("lost")],["all","All",all.length]].map(([k,l,c])=>`<button class="chip" data-action="rq-status" data-v="${k}" aria-pressed="${rq.status===k}">${l} (${c})</button>`).join("")}</div>
      ${prods.length>1?`<select id="rqProd" aria-label="Product"><option value="">All products</option>${prods.map(id=>`<option value="${id}" ${rq.product===id?"selected":""}>${esc(PMAP[id].name)}</option>`).join("")}</select>`:""}
    </div>
    <div class="desklist">${list.length?list.map(card).join(""):`<div class="panel empty">${ico("art-truck","")}<h2>${all.length?"Nothing here":"No requests yet"}</h2><p>${all.length?"Try another filter.":"When a buyer needs something you sell, in a quantity and place you can serve, it shows up here. Keep your rates current in My listing."}</p></div>`}</div>`);
}
const NEXT_STAGE=["Confirm order","Mark dispatched","Mark in transit","Mark delivered"];
function renderSOrders(){
  const el=$("#v-sorders"),me=Repo.myListing;
  if(!me){setHTML(el,`<div class="pagehead"><div><h1>Orders</h1></div></div>`+needListing("orders buyers place with you show up here"));return;}
  const list=store().orders.filter(o=>o.sid===me.id);
  setHTML(el,`<div class="pagehead"><div><h1>Orders</h1><p class="muted">Purchase orders buyers placed with you. Move each one along so the buyer can see where it is.</p></div></div>
    <div class="olist">${list.length?list.map(o=>{const p=PMAP[o.productId];return `<div class="panel ocard">
      <div class="ohead"><div><h3>${qfmt(o.qty)} ${p.unit} ${esc(p.name)}</h3><p class="meta">To a buyer in ${esc(o.city)} · PO ${esc(o.po)} · ${dstr(o.date)}</p></div><div class="amt num">${inr(o.subtotal)}<small style="color:var(--muted)">goods, before GST</small></div></div>
      <div class="track" aria-hidden="true">${STAGES.map((_,i)=>`<i class="${i<o.stage||o.stage===4?"on":i===o.stage?"now":""}"></i>`).join("")}</div>
      <div class="ostatus"><b>${STAGES[o.stage]}</b><span class="muted">${o.stage===4?"Delivered":`Buyer expects it by ${dstr(o.date+o.eta*864e5)}`}</span></div>
      ${o.issue?`<p class="issue">Buyer reported: ${esc(o.issue)}</p>`:""}
      ${o.stage<4?`<div class="actions"><button class="btn sm primary" data-action="so-next" data-po="${esc(o.po)}">${NEXT_STAGE[o.stage]}</button></div>`:""}
    </div>`;}).join(""):`<div class="panel empty">${ico("art-truck","")}<h2>No orders yet</h2><p>When a buyer approves your quote, the purchase order shows up here.</p><button class="btn" data-action="go" data-tab="requests">See requests</button></div>`}</div>`);
}
function renderListing(){
  const el=$("#v-listing");if(sf&&sf.box==="listingForm")return;
  const me=Repo.myListing,acct=Repo.me||{};
  if(!me){
    el.innerHTML=`<div class="pagehead"><div><h1>My listing</h1><p class="muted">This is what buyers' requests are matched against. Takes about 3 minutes.</p></div></div><div id="listingForm"></div>`;el._html=null;
    openSupplierForm(null,"listingForm");
    renderSupplierForm({name:acct.business||"",city:CITIES[acct.city]?acct.city:"",contact:acct.phone||""});
    return;
  }
  setHTML(el,`<div class="pagehead"><div><h1>My listing</h1><p class="muted">${me.verified?"Verified by VyaparBoss.":"Live. VyaparBoss will call to verify you; until then buyers see \"Not yet verified\"."}</p></div><button class="btn primary" data-action="listing-edit">Edit listing</button></div>
    <div class="sgrid">${supplierCard({...me,sample:true,_own:true})}</div>
    <div id="listingForm"></div>`);
}
function renderSInsights(){
  const el=$("#v-sinsights"),me=Repo.myListing;
  if(!me){setHTML(el,`<div class="pagehead"><div><h1>Insights</h1></div></div>`+needListing("you'll see how your quotes are doing"));return;}
  const rs=myRfqs(),sent=rs.filter(r=>r.myQuote||r.invites?.some(i=>i.sid===me.id&&i.quote)).length,won=store().orders.filter(o=>o.sid===me.id),val=won.reduce((a,o)=>a+o.subtotal,0);
  const k=[["Requests you qualified for",String(rs.length),"matched to your products and delivery area"],["Quotes you sent",String(sent),rs.length?`${Math.round(sent/rs.length*100)}% of requests`:"—"],["Orders won",String(won.length),rs.length?`${Math.round(won.length/rs.length*100)}% of requests`:"—"],["Value of orders",lakh(val),"goods, before GST"]];
  setHTML(el,`<div class="pagehead"><div><h1>Insights</h1><p class="muted">How your listing and quotes are doing.</p></div></div>
    <div class="kpis">${k.map(([a,b,c])=>`<div class="panel kpi"><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join("")}</div>
    <p class="hint">Tip: requests where you're not #1 on price often go to the cheapest delivered quote. Check your rates in My listing, or send a sharper quote from Requests.</p>`);
}

/* ===================== BUYER SIDE: supplier directory with filters ===================== */
let df={q:"",cat:"all",product:"",state:"",city:"",maxKm:0,qty:0,maxPrice:0,minRating:0,verified:false,ontime:false,sort:"best",open:false};
const isVerified=s=>!!(s.sample||s.verified||(!s.selfListed&&s.gstOk));
const priceFor=(o,qty)=>tierPrice(o,qty&&qty>=o.tiers[0][0]?qty:o.tiers[0][0]);
function dirResults(){
  const city=CITIES[df.city]?df.city:"";
  const rows=[];
  for(const s of SUPPLIERS){
    if(!CITIES[s.city])continue;
    const offers=s.offers.filter(o=>PMAP[o.p]&&(df.cat==="all"||PMAP[o.p].cat===df.cat)&&(!df.product||o.p===df.product));
    if(!offers.length)continue;
    if(df.q&&!(s.name+" "+s.city+" "+(s.area||"")+" "+s.offers.map(o=>PMAP[o.p]?.name).join(" ")).toLowerCase().includes(df.q))continue;
    if(df.state&&CITIES[s.city][2]!==df.state)continue;
    const d=city?km(s.city,city):null;
    if(city&&d>s.coverage)continue;
    if(city&&df.maxKm&&d>df.maxKm)continue;
    const fit=df.qty?offers.filter(o=>df.qty>=o.tiers[0][0]&&df.qty<=o.cap):offers;
    if(!fit.length)continue;
    const o=df.product?fit[0]:null,price=o?priceFor(o,df.qty):null;
    if(df.maxPrice&&o&&price>df.maxPrice)continue;
    if(df.minRating&&(s.rating??0)<df.minRating)continue;
    if(df.verified&&!isVerified(s))continue;
    if(df.ontime&&(s.onTime??0)<90)continue;
    rows.push({s,d,o,price});
  }
  const by={best:(a,b)=>isVerified(b.s)-isVerified(a.s)||((b.s.rating??4)*(b.s.onTime??85))-((a.s.rating??4)*(a.s.onTime??85)),
    price:(a,b)=>(a.price??1e12)-(b.price??1e12),near:(a,b)=>(a.d??1e9)-(b.d??1e9),rated:(a,b)=>(b.s.rating??0)-(a.s.rating??0),ontime:(a,b)=>(b.s.onTime??0)-(a.s.onTime??0)};
  return rows.sort(by[df.sort]||by.best);
}
function dirActive(){
  const a=[];
  if(df.product)a.push(["product",PMAP[df.product].name]);
  if(df.state)a.push(["state",`Ships from ${STATE_NAMES[df.state]||df.state}`]);
  if(df.city)a.push(["city",`Delivers to ${df.city}`]);
  if(df.maxKm)a.push(["maxKm",`Within ${qfmt(df.maxKm)} km`]);
  if(df.qty)a.push(["qty",`Takes ${qfmt(df.qty)}`]);
  if(df.maxPrice)a.push(["maxPrice",`Up to ${inr(df.maxPrice,2)}`]);
  if(df.minRating)a.push(["minRating",`${df.minRating}+ rating`]);
  if(df.verified)a.push(["verified","Verified only"]);
  if(df.ontime)a.push(["ontime","90%+ on time"]);
  return a;
}
function renderDirectory(){
  const tools=$("#dirTools");if(!tools)return;
  if(tools.contains(document.activeElement)&&/INPUT|SELECT/.test(document.activeElement.tagName)){renderDirGrid();return;}
  const states=[...new Set(SUPPLIERS.filter(s=>CITIES[s.city]).map(s=>CITIES[s.city][2]))].sort((a,b)=>(STATE_NAMES[a]||a).localeCompare(STATE_NAMES[b]||b));
  const prods=PRODUCTS.filter(p=>df.cat==="all"||p.cat===df.cat);
  const active=dirActive(),unit=df.product?unitOne(PMAP[df.product].unit):"unit";
  setHTML(tools,`<div class="dirbar">
      <input id="dq" type="search" value="${esc(df.q)}" placeholder="Search by name, city or product" aria-label="Search suppliers">
      <button class="btn ${df.open||active.length?"on":""}" data-action="df-toggle" aria-expanded="${df.open}">Filters${active.length?` (${active.length})`:""}</button>
      <label class="sortsel"><span>Sort</span><select id="dsort" aria-label="Sort suppliers">${[["best","Best match"],["price","Price: low to high"],["near","Nearest to delivery city"],["rated","Top rated"],["ontime","Most on time"]].map(([k,l])=>`<option value="${k}" ${df.sort===k?"selected":""} ${(k==="price"&&!df.product)||(k==="near"&&!df.city)?"disabled":""}>${l}${k==="price"&&!df.product?" (pick a product)":k==="near"&&!df.city?" (pick a city)":""}</option>`).join("")}</select></label>
    </div>
    <div class="chips dcats">${[["all","All"],...Object.entries(CAT_INFO).map(([k,c])=>[k,c.name])].map(([k,l])=>`<button class="chip" data-action="df-cat" data-v="${k}" aria-pressed="${df.cat===k}">${l}</button>`).join("")}</div>
    ${df.open?`<div class="panel pad filterpanel"><div class="fields">
      <div class="field"><label for="dprod">Product</label><select id="dprod"><option value="">Any product</option>${prods.map(p=>`<option value="${p.id}" ${df.product===p.id?"selected":""}>${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="dstate">Ships from</label><select id="dstate"><option value="">Anywhere in India</option>${states.map(c=>`<option value="${c}" ${df.state===c?"selected":""}>${esc(STATE_NAMES[c]||c)}</option>`).join("")}</select></div>
      <div class="field"><label for="dcity">Delivers to</label><select id="dcity"><option value="">Any city</option>${Object.keys(CITIES).sort().map(c=>`<option ${df.city===c?"selected":""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label for="dkm">Distance from that city</label><select id="dkm" ${df.city?"":"disabled"}>${[[0,"Any distance"],[100,"Within 100 km"],[300,"Within 300 km"],[500,"Within 500 km"],[1000,"Within 1,000 km"]].map(([v,l])=>`<option value="${v}" ${df.maxKm===v?"selected":""}>${l}</option>`).join("")}</select></div>
      <div class="field"><label for="dqty">Quantity you need</label><input id="dqty" type="number" min="1" inputmode="numeric" value="${df.qty||""}" placeholder="e.g. 5000"></div>
      <div class="field"><label for="dprice">Max price per ${esc(unit)} (₹)</label><input id="dprice" type="number" min="0" step="0.01" inputmode="decimal" value="${df.maxPrice||""}" ${df.product?"":"disabled"} placeholder="${df.product?"e.g. 16":"Pick a product first"}"></div>
      <div class="field"><label for="drate">Buyer rating</label><select id="drate">${[[0,"Any rating"],[4,"4.0 and up"],[4.5,"4.5 and up"]].map(([v,l])=>`<option value="${v}" ${df.minRating===v?"selected":""}>${l}</option>`).join("")}</select></div>
      <div class="field checks"><label class="toggle"><input type="checkbox" id="dver" ${df.verified?"checked":""}> Verified suppliers only</label><label class="toggle"><input type="checkbox" id="dontime" ${df.ontime?"checked":""}> 90%+ on-time deliveries</label></div>
    </div></div>`:""}
    ${active.length?`<div class="activef">${active.map(([k,l])=>`<button class="chip on" data-action="df-clear" data-v="${k}" aria-label="Remove filter: ${esc(l)}">${esc(l)} ×</button>`).join("")}<button class="link" data-action="df-clear" data-v="all">Clear all</button></div>`:""}
    <p class="hint" id="dcount"></p>`);
  renderDirGrid();
}
function renderDirGrid(){
  const rows=dirResults(),p=df.product&&PMAP[df.product];
  const c=$("#dcount");if(c)c.textContent=`${rows.length} supplier${rows.length===1?"":"s"}${df.city?` that deliver to ${df.city}`:""}`;
  setHTML($("#dirGrid"),rows.length?rows.map(({s,d,o,price})=>`<div class="panel scard">
      <div class="who"><div class="mono">${esc(initials(s.name))}</div><div><h3>${esc(s.name)}</h3><div class="where">${ico("i-pin","")}${esc(s.area?s.area+", ":"")}${s.city}${d!=null?` · ${qfmt(d)} km from ${esc(df.city)}`:""}</div></div></div>
      <div class="trust">${trustPills(s)}</div>
      ${o?`<p class="dprice"><b>${inr(price,2)}</b> per ${unitOne(p.unit)} ${df.qty&&df.qty>=o.tiers[0][0]?`for ${qfmt(df.qty)}`:`at the minimum order of ${qfmt(o.tiers[0][0])}`}<span class="muted">, before GST and freight</span></p>`:""}
      <div class="tags">${s.offers.filter(x=>PMAP[x.p]).map(x=>`<span class="tag">${esc(PMAP[x.p].name)}</span>`).join("")}</div>
      <details class="more"><summary>Rates and terms ${ico("i-chev","")}</summary><div>
        <ul class="plist">${s.offers.filter(x=>PMAP[x.p]).map(x=>`<li><span>${esc(PMAP[x.p].name)}</span><span>from ${inr(x.tiers[x.tiers.length-1][1],2)}/${unitOne(PMAP[x.p].unit)}, min ${qfmt(x.tiers[0][0])}</span></li>`).join("")}</ul>
        <p class="hint">Ready in ${s.lead} day${s.lead>1?"s":""}. Delivers up to ${qfmt(s.coverage)} km. ${s.terms?`Payment: ${esc(s.terms)}.`:""}${s.certs?.length?` Certified: ${s.certs.map(esc).join(", ")}.`:""}</p>
      </div></details>
      <div class="actions"><button class="btn sm primary" data-action="df-quote" data-sid="${esc(s.id)}">Get quotes for ${esc((o?PMAP[o.p]:PMAP[s.offers[0].p]).name.split(",")[0])}</button></div>
    </div>`).join(""):`<div class="panel empty" style="grid-column:1/-1">${ico("art-shop","")}<h2>No supplier matches</h2><p>Loosen a filter, or invite the supplier you already buy from.</p><div class="actions" style="justify-content:center"><button class="btn" data-action="df-clear" data-v="all">Clear filters</button><button class="btn ghost" data-action="copy-join">Copy invite link</button></div></div>`);
  setHTML($("#dirInvite"),`<div class="joinband"><div><b>Don't see your supplier?</b> Invite them. Listing is free, and they'll get your requests here.</div><button class="btn marigold" data-action="copy-join">Copy invite link</button></div>`);
}
/* "Get quotes" from a supplier card starts a buy request for that product; Bhai still compares everyone. */
function quoteFromDirectory(sid){
  const s=SMAP[sid];if(!s)return;
  const o=(df.product&&s.offers.find(x=>x.p===df.product))||s.offers.find(x=>PMAP[x.p]&&(df.cat==="all"||PMAP[x.p].cat===df.cat))||s.offers[0];
  const city=CITIES[df.city]?df.city:CITIES[Repo.me?.city]?Repo.me.city:undefined;
  flow=freshFlow();flow.stage="ask";flow.cat=PMAP[o.p].cat;flow.r={productId:o.p,...(df.qty?{qty:df.qty}:{}),...(city?{city}:{})};
  me(`${PMAP[o.p].name}${df.qty?`, ${qfmt(df.qty)} ${PMAP[o.p].unit}`:""}${city?` to ${city}`:""}`);
  showTab("buy");advance();
}

/* ===================== TEAM ===================== */
let teamView="network";
function showTeamView(v,quiet){
  teamView=v;
  document.querySelectorAll("[data-tview]").forEach(b=>b.setAttribute("aria-selected",b.dataset.tview===v));
  const locked=Repo.mode==="server"&&!Repo.data.team;
  const gate=$("#teamGate");
  if(locked){gate.innerHTML=`<div class="panel pad gate"><h3>Team only</h3><p class="muted">Enter the admin key set on the server (ADMIN_KEY) to manage suppliers, sign-ups and outreach.</p>
      <form class="warow" data-form="admin-key"><input id="adminKey" type="password" autocomplete="current-password" placeholder="Admin key" aria-label="Admin key"><button class="btn primary">Unlock</button></form></div>`;}
  else gate.innerHTML="";
  const show={network:"s-network",apps:"s-apps",outreach:"i-outreach",desk:"s-desk",wa:"t-wa"};
  Object.entries(show).forEach(([k,id])=>{const e=document.getElementById(id);if(e)e.hidden=locked||k!==v;});
  if(locked)return;
  if(v==="network")renderSuppliers();if(v==="desk")renderDesk();if(v==="wa")renderWhatsApp();
  if(!quiet){if(v==="apps")renderApps();if(v==="outreach")renderOutreachView();}
}
function onTeamUnlocked(){Repo.refresh().then(()=>{renderNav();renderAcct();showTab("team");showTeamView(teamView);}).catch(fail);}

/* ===================== RENDER + EVENTS ===================== */
function renderRoleViews(){
  renderNav();renderAcct();renderOrdersCount();
  const r=role(),vis=id=>!document.getElementById(id)?.hidden;
  if(r==="buyer"&&vis("v-suppliers"))renderDirectory();
  if(r==="supplier"){if(vis("v-requests"))renderRequests();if(vis("v-sorders"))renderSOrders();if(vis("v-listing"))renderListing();if(vis("v-sinsights"))renderSInsights();}
  if(vis("v-account"))renderAccount();
  if(vis("v-team"))showTeamView(teamView,!$("#teamGate").innerHTML&&document.getElementById(teamView==="apps"?"s-apps":"i-outreach")?.innerHTML!=="");
}
function goHome(){const r=role();if(!r){showAuth();return;}showTab(navFor()[0][0]);}
function rolesBoot(){
  renderNav();renderAcct();
  if(/^#(join|quote)/.test(location.hash)){growBoot();return;}
  if(!role()){showAuth();return;}
  let t=null;try{t=localStorage.getItem(KEY+".tab");}catch(e){}
  showTab(t||navFor()[0][0]);
}
Object.assign(ACTIONS,{
  home:()=>goHome(),
  "au-role":a=>{au.role=a.dataset.v;au.err=[];au.wrongRole=null;renderAuth();},
  "au-mode":a=>{au.mode=a.dataset.v;au.err=[];au.wrongRole=null;renderAuth();},
  "au-email":()=>{au.email=!au.email;renderAuth();if(au.email)setTimeout(()=>document.getElementById(au.mode==="signup"?"auName":"auEmail")?.focus(),30);},
  "au-provider":a=>startProvider(a.dataset.v),
  "au-guest":()=>{Repo.setGuest(true);document.body.classList.remove("welcome");renderNav();renderAcct();showTab("buy");},
  "acct-auth":a=>{const d=document.getElementById("acctPick");if(d)d.open=false;showAuth(role()||null,a.dataset.v);},
  "acct-logout":async()=>{const d=document.getElementById("acctPick");if(d)d.open=false;await Repo.logout();flow=freshFlow();au={...au,role:null,mode:"login",email:false};toast("Logged out");showAuth();},
  "team-open":()=>{if(Repo.mode!=="server")try{localStorage.setItem(KEY+".team","1");}catch(e){}renderNav();renderAcct();showTab("team");showTeamView(teamView);},
  "rq-status":a=>{rq.status=a.dataset.v;renderRequests();},
  "so-next":a=>{const o=store().orders.find(x=>x.po===a.dataset.po);if(!o||o.stage>=4)return;const history=o.history.slice();history[o.stage+1]=Date.now();
    Repo.updateOrder(o.po,{stage:o.stage+1,history}).then(()=>{toast(`${STAGES[o.stage]}`);renderSOrders();}).catch(fail);renderSOrders();},
  "listing-edit":()=>{const me=Repo.myListing;if(!me)return;$("#v-listing").innerHTML=`<div class="pagehead"><div><h1>My listing</h1></div></div><div id="listingForm"></div>`;$("#v-listing")._html=null;openSupplierForm(me,"listingForm");},
  "df-toggle":()=>{df.open=!df.open;renderDirectory();},
  "df-cat":a=>{df.cat=a.dataset.v;if(df.product&&df.cat!=="all"&&PMAP[df.product].cat!==df.cat){df.product="";df.maxPrice=0;if(df.sort==="price")df.sort="best";}renderDirectory();},
  "df-clear":a=>{const k=a.dataset.v;
    if(k==="all")df={...df,q:"",cat:"all",product:"",state:"",city:"",maxKm:0,qty:0,maxPrice:0,minRating:0,verified:false,ontime:false,sort:"best"};
    else{df[k]=typeof df[k]==="boolean"?false:typeof df[k]==="number"?0:"";if(k==="product"){df.maxPrice=0;if(df.sort==="price")df.sort="best";}if(k==="city"){df.maxKm=0;if(df.sort==="near")df.sort="best";}}
    renderDirectory();},
  "df-quote":a=>quoteFromDirectory(a.dataset.sid),
});
document.addEventListener("submit",e=>{
  const f=e.target.closest("form[data-form]");if(!f)return;const k=f.dataset.form;
  if(k==="au-signup"||k==="au-login"){e.preventDefault();submitAuth(k==="au-signup"?"signup":"login");}
  if(k==="account"){e.preventDefault();const g=id=>document.getElementById(id)?.value??"";
    Repo.updateMe({name:g("acName"),business:g("acBiz"),email:g("acEmail"),phone:g("acPhone"),city:g("acCity")}).then(()=>{toast("Saved");$("#v-account")._html=null;document.activeElement?.blur?.();renderAccount();renderAcct();}).catch(fail);}
  if(k==="myquote"){e.preventDefault();const id=f.dataset.rfq,g=s=>document.getElementById(`mq-${s}-${id}`)?.value??"";
    const btn=f.querySelector("button");if(btn)btn.disabled=true;
    Repo.myQuote(id,{unit:g("u"),lead:g("l"),note:g("n")}).then(()=>{toast("Quote sent. The buyer sees it with GST and freight added.");document.activeElement?.blur?.();renderRequests();}).catch(err=>{if(btn)btn.disabled=false;fail(err);});}
});
document.addEventListener("input",e=>{
  if(e.target.id==="dq"){df.q=e.target.value.toLowerCase().trim();renderDirGrid();}
});
document.addEventListener("change",e=>{
  const t=e.target,id=t.id;
  const num=v=>{const n=Number(v);return isFinite(n)&&n>0?n:0;};
  const map={dprod:()=>{df.product=t.value;if(!df.product){df.maxPrice=0;if(df.sort==="price")df.sort="best";}},dstate:()=>df.state=t.value,dcity:()=>{df.city=t.value;if(!df.city){df.maxKm=0;if(df.sort==="near")df.sort="best";}},
    dkm:()=>df.maxKm=num(t.value),dqty:()=>df.qty=Math.round(num(t.value)),dprice:()=>df.maxPrice=num(t.value),drate:()=>df.minRating=num(t.value),dver:()=>df.verified=t.checked,dontime:()=>df.ontime=t.checked,dsort:()=>df.sort=t.value};
  if(map[id]){map[id]();t.blur?.();renderDirectory();return;}
  if(id==="rqProd"){rq.product=t.value;t.blur?.();renderRequests();}
});
