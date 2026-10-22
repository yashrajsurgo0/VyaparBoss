/* KaantaMandi has two sides, chosen on the welcome screen:
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
    :`<p class="rp-note">${r?"You're looking around as a guest buyer. Create an account to keep your requests and orders.":"Buy or supply on KaantaMandi."}</p>
      <button data-action="acct-auth" data-v="signup">Create an account</button>
      <button data-action="acct-auth" data-v="login">Log in</button>`;
  const team=teamOn()?`<p class="rp-h">Team</p><button data-action="go" data-tab="team">Team tools</button>`:"";
  setHTML(el,summary+`<div class="rp-menu" role="menu">${body}${team}</div>`);
  el.open=open;
}
document.addEventListener("click",e=>{const d=document.getElementById("acctPick");if(d&&d.open&&(!d.contains(e.target)||e.target.closest(".rp-menu [data-action]")))d.open=false;});

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
      <p class="hint"><button type="button" class="link" data-action="au-forgot">Forgot password?</button></p>
    </form>`;
  const errs=au.err.length?`<div class="errors" role="alert">${au.err.map(esc).join("<br>")}${au.wrongRole?`<br><button class="link" data-action="au-role" data-v="${au.wrongRole}">Switch to ${au.wrongRole==="supplier"?"I'm supplying":"I'm buying"}</button>`:""}</div>`:"";
  const legal=signup?`<p class="hint consent">By continuing you agree to the <a href="terms.html" target="_blank" rel="noopener">Terms</a> and <a href="privacy.html" target="_blank" rel="noopener">Privacy policy</a>.</p>`:"";
  const recover=au.mode==="forgot"?`<div class="card authcard">
      <p class="q-title">Reset your password</p>
      ${au.sent?`<p>If <b>${esc(au.sent)}</b> has a KaantaMandi account, we've emailed a link to choose a new password. It works for one hour. Check spam too.</p>`
        :`<form class="authform" data-form="au-forgot" novalidate><div class="fields"><div class="field wide"><label for="auEmail">Email you signed up with</label><input id="auEmail" type="email" autocomplete="email"></div></div>
        <button class="btn primary big" ${au.busy?"disabled":""}>${au.busy?"Sending…":"Email me a reset link"}</button></form>`}
      ${errs}<p class="hint"><button class="link" data-action="au-mode" data-v="login">Back to log in</button></p></div>`
    :au.mode==="reset"?`<div class="card authcard">
      <p class="q-title">Choose a new password</p>
      <form class="authform" data-form="au-reset" novalidate><div class="fields"><div class="field wide"><label for="auPass">New password</label><input id="auPass" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></div></div>
        <button class="btn primary big" ${au.busy?"disabled":""}>${au.busy?"Saving…":"Save and log in"}</button></form>
      ${errs}<p class="hint">This signs you out on other devices.</p></div>`:"";
  const panel=recover||(!r?"":`<div class="card authcard">
      <div class="seg" role="tablist" aria-label="Sign up or log in"><button data-action="au-mode" data-v="signup" aria-selected="${signup}">Sign up</button><button data-action="au-mode" data-v="login" aria-selected="${!signup}">Log in</button></div>
      ${au.inviteNote&&!sup?`<p class="note">You've been invited to buy for a team on KaantaMandi. Sign up or log in as a buyer to accept.</p>`:""}
      <p class="q-title">${signup?(sup?"Create your supplier account":"Create your buyer account"):(sup?"Log in as a supplier":"Log in as a buyer")}</p>
      ${providers}${emailForm}${errs}${legal}
      ${cfg.demo?`<p class="hint">This demo copy keeps your account in this browser only. Google, Apple and Facebook work on the live app once they're switched on.</p>`:""}
      <p class="hint authalt">${sup?`Prefer a call? <a href="#join/s">Leave your number</a> and we'll set you up.`:`Just looking? <button class="link" data-action="au-guest">Explore without an account</button>`}</p>
    </div>`);
  const h1=au.mode==="reset"||au.mode==="forgot"?"Let's get you back in.":!r?"Welcome to KaantaMandi.":sup?"Get orders you can actually serve.":"Buy smarter, delivered.";
  const lede=recover?"It happens to everyone.":!r?`${t("tagline")} Are you here to buy, or to supply?`:sup?"List free. Get only requests that fit what you make and where you deliver. Pay a small fee only when an order closes."
    :"Tell Bhai what you need. Compare verified suppliers on the full delivered price. Nothing is ordered until you approve.";
  // Keep what someone already typed when this screen redraws.
  const keep={};["auName","auBiz","auEmail","auPass","auPhone","auCity"].forEach(id=>{const i=document.getElementById(id);if(i)keep[id]=i.value;});
  el.innerHTML=`<div class="pubwrap welcomewrap">
    <section class="pubhero"><div><p class="hello">${esc(t("hello"))}</p><h1>${esc(h1)}</h1><p class="lede">${esc(lede)}</p></div>
      <svg class="bhai-l" role="img" aria-label="Bhai"><use href="#bhai"/></svg></section>
    ${recover?"":`<div class="roles">${roleBtn("buyer","I'm buying","Factories, exporters, traders, shops","art-truck")}${roleBtn("supplier","I'm supplying","Manufacturers, distributors, wholesalers","art-shop")}</div>`}
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
async function submitRecover(kind){
  const g=id=>document.getElementById(id)?.value??"";au.err=[];
  if(kind==="forgot"){
    const email=g("auEmail").trim();if(!isEmail(email)){au.err=["Enter the email you signed up with"];renderAuth();return;}
    au.busy=true;renderAuth();
    try{await Repo.forgot(email);au.busy=false;au.sent=email;renderAuth();}catch(e){au.busy=false;au.err=[e.message];renderAuth();}
  }else{
    const pw=g("auPass");if(pw.length<8){au.err=["Use a password of at least 8 characters"];renderAuth();return;}
    au.busy=true;renderAuth();
    try{const u=await Repo.resetPassword(au.token,pw);au.busy=false;au.token=null;au.mode="login";au.role=u.role;onSignedIn(u,false);toast("Password changed. You're logged in.");}
    catch(e){au.busy=false;au.err=[e.message];renderAuth();}
  }
}
function onSignedIn(u,created){
  au.inviteNote=false;if(pendingInvite&&u.role==="buyer")setTimeout(joinPending,50);
  Repo.setGuest(false);document.body.classList.remove("welcome");
  au={...au,email:false,err:[],busy:false};
  renderNav();renderAcct();
  const first=(u.name||"").split(/\s+/)[0];
  if(u.role==="supplier")showTab(Repo.myListing?"requests":"listing");
  else if(created&&!u.business)showTab("account");
  else showTab("buy");
  const confirm=created&&u.email&&!u.emailVerified&&Repo._cfg?.emailOn?" We've emailed you a link to confirm your address.":"";
  toast((created?(u.role==="supplier"?`Welcome${first?", "+first:""}! Add your listing to start getting requests.`:`Welcome${first?", "+first:""}!`):`Welcome back${first?", "+first:""}`)+confirm);
}

/* ===================== ACCOUNT ===================== */
function renderAccount(){
  const el=$("#v-account");const me=Repo.me;
  if(!signedIn()){setHTML(el,`<div class="panel empty">${ico("art-shop","")}<h2>You're browsing as a guest</h2><p>Create an account to keep your requests and orders, and to log in from any device.</p><div class="actions" style="justify-content:center"><button class="btn primary" data-action="acct-auth" data-v="signup">Create an account</button><button class="btn" data-action="acct-auth" data-v="login">Log in</button></div></div>`);return;}
  if(el.contains(document.activeElement))return;
  const unconfirmed=!me.demo&&me.email&&!me.emailVerified&&Repo._cfg?.emailOn;
  const before=el._html;
  setHTML(el,`<div class="pagehead"><div><h1>Your account</h1><p class="muted">${ROLE_NAME[me.role]} account${me.demo?" (demo, saved in this browser)":""}</p></div></div>
    ${unconfirmed?`<div class="note verifynote"><b>Confirm your email.</b> We sent a link to ${esc(me.email)}. Confirmed emails get order updates and can reset a password. <button class="link" data-action="acct-verify">Send it again</button></div>`:""}
    <form class="panel pad sform" data-form="account" novalidate>
      <div class="fields">
        <div class="field"><label for="acName">Your name</label><input id="acName" value="${esc(me.name)}" autocomplete="name"></div>
        <div class="field"><label for="acBiz">Business name</label><input id="acBiz" value="${esc(me.business)}" autocomplete="organization"></div>
        <div class="field"><label for="acEmail">Email</label><input id="acEmail" type="email" value="${esc(me.email)}" ${me.email?"readonly":""}></div>
        <div class="field"><label for="acPhone">Mobile</label><input id="acPhone" value="${esc(me.phone)}" inputmode="tel"></div>
        <div class="field"><label for="acCity">City</label><input id="acCity" value="${esc(me.city)}" list="acCities"><datalist id="acCities">${Object.keys(CITIES).sort().map(c=>`<option value="${c}">`).join("")}</datalist></div>
        <div class="field"><label for="acGstin">GSTIN (for tax invoices)</label><input id="acGstin" value="${esc(me.gstin||"")}" maxlength="15" autocapitalize="characters" class="num" placeholder="Optional"></div>
        <div class="field wide"><label for="acAddr">${me.role==="supplier"?"Business address":"Billing and delivery address"}</label><input id="acAddr" value="${esc(me.address||"")}" maxlength="300" autocomplete="street-address" placeholder="Shown on invoices"></div>
        ${me.role==="buyer"&&!me.org?.member?`<div class="field"><label for="acBudget">Monthly buying budget (₹)</label><input id="acBudget" type="number" min="0" step="1000" inputmode="numeric" value="${me.org?.budget||""}" placeholder="Optional"><span class="hint">Bhai warns you before an order goes over it.</span></div>`:""}
      </div>
      ${me.demo?"":`<div class="field checks"><label class="toggle"><input type="checkbox" id="acNotify" ${me.notify!==false?"checked":""}> Email me about my ${me.role==="supplier"?"new requests and orders":"quotes and orders"}</label></div>`}
      <p class="hint">Signs in with: ${[me.hasPassword||me.demo?"email and password":null,...(me.providers||[]).map(p=>p[0].toUpperCase()+p.slice(1))].filter(Boolean).join(", ")||"email"}.</p>
      <div class="actions"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-action="acct-logout">Log out</button></div>
    </form>
    ${me.role==="buyer"?`<section class="panel pad acctteam" id="teamBox">${me.org?.member?`<h2 class="sub">Your team</h2><p>You buy for <b>${esc(me.org.name)}</b>. ${me.org.limit==null?"You can place orders of any size.":me.org.limit===0?`Every order goes to ${esc(me.org.ownerName)} for approval first.`:`Orders above ${inr(me.org.limit)} go to ${esc(me.org.ownerName)} for approval first.`}</p><div class="actions"><button class="btn sm ghost" data-action="team-leave">Leave this team</button></div>`
      :`<h2 class="sub">Your team</h2><p class="muted">${me.demo?"Teams work on the live app.":"Loading…"}</p>`}</section>`:""}
    ${me.demo?"":`<details class="panel pad more acctmore"><summary>${me.hasPassword?"Change password":"Add a password"} ${ico("i-chev","")}</summary>
      <form class="sform" data-form="acct-pass" novalidate><div class="fields">
        ${me.hasPassword?`<div class="field"><label for="acCur">Current password</label><input id="acCur" type="password" autocomplete="current-password"></div>`:""}
        <div class="field"><label for="acNew">New password</label><input id="acNew" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></div>
      </div><div class="actions"><button class="btn">Save password</button></div></form>
    </details>`}
    <details class="panel pad more acctmore"><summary>Delete my account ${ico("i-chev","")}</summary>
      <form class="sform" data-form="acct-delete" novalidate>
        <p>This removes your account${me.role==="supplier"?" and your listing":""} and signs you out everywhere. Orders already placed stay as business records, without your name on them. This can't be undone.</p>
        <div class="field narrow"><label for="acDel">Type DELETE to confirm</label><input id="acDel" autocomplete="off" autocapitalize="characters"></div>
        <div class="actions"><button class="btn danger">Delete my account</button></div>
      </form>
    </details>
    <p class="hint">See our <a href="privacy.html" target="_blank" rel="noopener">privacy policy</a> and <a href="terms.html" target="_blank" rel="noopener">terms</a>.</p>`);
  if(el._html!==before&&me.role==="buyer"&&!me.org?.member&&!me.demo)loadTeam();
}

/* Account → Your team (owner): invite people, set each person's approval limit, remove them. */
let lastInvite=null;
async function loadTeam(){
  const box=document.getElementById("teamBox");if(!box)return;
  let o;try{o=await Repo.org();}catch(e){box.innerHTML=`<h2 class="sub">Your team</h2><p class="muted">${esc(e.message)}</p>`;return;}
  if(o.member)return;
  const lim=v=>v==null?"No limit":v===0?"Every order":"Above "+inr(v);
  box.innerHTML=`<h2 class="sub">Your team</h2>
    <p class="muted">Let colleagues place orders for ${esc(Repo.me.business||"your business")}. Orders above their limit, or past your monthly budget, wait for your approval before the supplier sees them.</p>
    ${o.pending?`<p class="note">${o.pending} order${o.pending>1?"s are":" is"} waiting for your approval. <button class="link" data-action="go" data-tab="orders">Review</button></p>`:""}
    ${o.members.length?`<ul class="memberlist">${o.members.map(m=>`<li><div><b>${esc(m.name||m.email)}</b><small>${esc(m.email)} · needs approval: ${lim(m.limit)}</small></div>
      <form class="replyrow" data-form="team-limit" data-id="${esc(m.id)}" novalidate><label class="sr" for="ml-${esc(m.id)}">Approval limit (₹)</label><input id="ml-${esc(m.id)}" type="number" min="0" step="1000" inputmode="numeric" value="${m.limit??""}" placeholder="No limit"><button class="btn sm">Save</button><button class="btn sm ghost" type="button" data-action="team-remove" data-id="${esc(m.id)}">Remove</button></form></li>`).join("")}</ul>`:""}
    ${o.invites.length?`<ul class="memberlist">${o.invites.map(i=>`<li><div><b>${esc(i.email)}</b><small>Invited · needs approval: ${lim(i.limit)} · expires ${fdate(i.exp)}</small></div><button class="btn sm ghost" data-action="team-uninvite" data-id="${esc(i.id)}">Cancel invite</button></li>`).join("")}</ul>`:""}
    ${lastInvite?`<div class="note invitelink"><b>Invite link for ${esc(lastInvite.email)}</b>${lastInvite.emailed?" (also emailed to them)":" (email isn't set up, so send this on WhatsApp)"}<input readonly value="${esc(lastInvite.link)}" id="invLink" aria-label="Invite link"><button class="btn sm" data-action="team-copy">Copy link</button></div>`:""}
    <form class="sform invform" data-form="team-invite" novalidate><div class="fields">
      <div class="field"><label for="tiEmail">Colleague's email</label><input id="tiEmail" type="email" autocomplete="off"></div>
      <div class="field"><label for="tiLimit">Needs your approval above (₹)</label><input id="tiLimit" type="number" min="0" step="1000" inputmode="numeric" placeholder="Empty = no limit, 0 = every order"></div>
    </div><button class="btn">Invite</button></form>`;
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
/* Supplier: each order shows the one next step (confirm → dispatch with LR number → on the way), then the buyer's receipt and rating. */
function supplierNext(o){
  const k=okey(o.po),po=esc(o.po),sh=o.shipment||{};
  if(o.cancelled)return `<p class="issue">Cancelled by ${o.cancelled.by==="supplier"?"you":o.cancelled.by==="buyer"?"the buyer":"the KaantaMandi team"}${o.cancelled.reason?`: ${esc(o.cancelled.reason)}`:""}.</p>`;
  const shipForm=(act,label)=>`<form class="oform" data-form="oact" data-act="${act}" data-po="${po}" data-side="supplier" novalidate><div class="fields">
      <div class="field"><label for="tr-${k}">Transporter or courier</label><input id="tr-${k}" name="transporter" maxlength="80" value="${esc(sh.transporter||"")}" placeholder="e.g. VRL Logistics"></div>
      <div class="field"><label for="lr-${k}">LR / AWB / docket no.</label><input id="lr-${k}" name="lr" maxlength="40" value="${esc(sh.lr||"")}" class="num"></div>
      <div class="field"><label for="vh-${k}">Vehicle no. (optional)</label><input id="vh-${k}" name="vehicle" maxlength="20" value="${esc(sh.vehicle||"")}" placeholder="MH 12 AB 1234"></div>
      <div class="field"><label for="ed-${k}">Expected delivery (optional)</label><input id="ed-${k}" name="eta" type="date" value="${sh.eta?new Date(sh.eta).toISOString().slice(0,10):""}"></div>
      <div class="field wide"><label for="sn-${k}">Note for the buyer (optional)</label><input id="sn-${k}" name="note" maxlength="200" value="${esc(sh.note||"")}" placeholder="e.g. 24 cartons, 2 bundles"></div>
    </div><button class="btn primary sm">${label}</button></form>`;
  if(o.stage===0)return `<div class="actions"><button class="btn sm primary" data-action="oact" data-act="confirm" data-po="${po}" data-side="supplier">Confirm order</button></div>
    <details class="more sub"><summary>Can't take this order? ${ico("i-chev","")}</summary><div><form class="oform replyrow" data-form="oact" data-act="cancel" data-po="${po}" data-side="supplier" novalidate>
      <label class="sr" for="dc-${k}">Reason</label><input id="dc-${k}" name="reason" maxlength="200" placeholder="Reason, e.g. no stock this week"><button class="btn sm danger">Decline</button></form>
      <p class="hint">Declining before you confirm is fine; the buyer picks another supplier. Declining after you confirm hurts your record.</p></div></details>`;
  if(o.stage===1)return `<details class="more nextstep" open><summary>Dispatch details ${ico("i-chev","")}</summary><div>${shipForm("dispatch","Mark dispatched")}<p class="hint">The buyer gets the LR number straight away, so they can track it with the transporter.</p></div></details>`;
  if(o.stage<4)return `${o.stage===2?`<div class="actions"><button class="btn sm primary" data-action="oact" data-act="transit" data-po="${po}" data-side="supplier">Mark on the way</button></div>`:`<p class="hint">Waiting for the buyer to confirm it arrived.</p>`}
    <details class="more sub"><summary>Change shipment details ${ico("i-chev","")}</summary><div>${shipForm("shipment","Save")}</div></details>`;
  return o.review?`<p class="hint">The buyer rated this order ${stars(o.review.stars)}${o.review.text?` “${esc(o.review.text)}”`:""}</p>`:`<p class="hint">Delivered. The buyer hasn't rated it yet.</p>`;
}
function renderSOrders(){
  const el=$("#v-sorders"),me=Repo.myListing;
  if(!me){setHTML(el,`<div class="pagehead"><div><h1>Orders</h1></div></div>`+needListing("orders buyers place with you show up here"));return;}
  const ae=document.activeElement;if(el.contains(ae)&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae?.tagName||""))return;
  const list=store().orders.filter(o=>o.sid===me.id);
  const t=me.track;
  const rec=t?.delivered?`<div class="kpis trackk">
      <div class="panel kpi"><span>On time</span><b>${me.onTime}%</b><small>${t.onTime} of ${t.delivered} delivered by the promised date</small></div>
      <div class="panel kpi"><span>Buyer rating</span><b>${me.rating!=null?me.rating:"–"}</b><small>${t.rated?`from ${t.rated} rating${t.rated>1?"s":""}`:"no ratings yet"}</small></div>
      <div class="panel kpi"><span>Problems</span><b>${t.disputes}</b><small>raised by buyers</small></div></div>
    <p class="hint">Buyers see these numbers, and Bhai uses them to rank suppliers. They come only from real orders and can't be edited.</p>`:"";
  setHTML(el,`<div class="pagehead"><div><h1>Orders</h1><p class="muted">Purchase orders buyers placed with you. Confirm, dispatch with the LR number, and the buyer can follow it.</p></div></div>${rec}
    <div class="olist">${list.length?list.map(o=>{const p=PMAP[o.productId];return `<div class="panel ocard${o.cancelled?" cancelled":""}">
      <div class="ohead"><div><h3>${qfmt(o.qty)} ${p.unit} ${esc(p.name)}</h3><p class="meta">To a buyer in ${esc(o.city)} · PO ${esc(o.po)} · ${dstr(o.date)}${o.sample?" · example":""}</p></div><div class="amt num">${inr(o.subtotal)}<small style="color:var(--muted)">goods, before GST</small></div></div>
      ${o.cancelled?"":`<div class="track" aria-hidden="true">${STAGES.map((_,i)=>`<i class="${i<o.stage||o.stage===4?"on":i===o.stage?"now":""}"></i>`).join("")}</div>`}
      <div class="ostatus"><b>${o.cancelled?"Cancelled":STAGES[o.stage]}</b><span class="muted">${o.stage===4?`Delivered ${fdate(o.history?.[4]||Date.now())}${o.history?.[4]>promisedBy(o)+432e5?' <span class="pill warn">Late</span>':' <span class="pill good">On time</span>'}`:o.cancelled?"":`You promised ${fdate(promisedBy(o))}${isLate(o)?' <span class="pill bad">Running late</span>':""}`}</span></div>
      ${shipmentHTML(o)}${receiptHTML(o)}
      ${supplierNext(o)}
      ${disputeHTML(o,"supplier")}
      ${moneyHTML(o,"supplier")}
      <div class="actions"><button class="btn sm ghost" data-action="print-po" data-po="${esc(o.po)}">Print PO</button></div>
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
  setHTML(el,`<div class="pagehead"><div><h1>My listing</h1><p class="muted">${me.verified?"Verified by KaantaMandi.":"Live. KaantaMandi will call to verify you; until then buyers see \"Not yet verified\"."}</p></div><button class="btn primary" data-action="listing-edit">Edit listing</button></div>
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
  const show={setup:"s-setup",ops:"s-ops",network:"s-network",apps:"s-apps",outreach:"i-outreach",desk:"s-desk",wa:"t-wa"};
  Object.entries(show).forEach(([k,id])=>{const e=document.getElementById(id);if(e)e.hidden=locked||k!==v;});
  if(locked)return;
  if(v==="setup"&&!quiet)renderSetup();
  if(v==="ops"&&!quiet)renderOps();
  if(v==="network")renderSuppliers();if(v==="desk")renderDesk();if(v==="wa")renderWhatsApp();
  if(!quiet){if(v==="apps")renderApps();if(v==="outreach")renderOutreachView();}
}
/* Team → Setup: what's switched on, and the one thing to do for each item that isn't. */
async function renderSetup(){
  const el=document.getElementById("s-setup");if(!el)return;
  if(Repo.mode!=="server"){setHTML(el,`<div class="panel empty">${ico("art-shop","")}<h2>Setup lives on the live app</h2><p>Open KaantaMandi on its server to see which keys are set.</p></div>`);return;}
  if(!el.innerHTML)el.innerHTML=`<p class="muted">Checking the server…</p>`;
  let s;try{s=await Repo.setup();}catch(e){el.innerHTML=`<div class="errors">${esc(e.message)}</div>`;el._html=null;return;}
  const c=s.counts,ago=t=>t?`${Math.max(1,Math.round((Date.now()-t)/6e4))} min ago`:"not yet";
  const item=(ok,title,detail,todo,must)=>`<li class="setup-i ${ok?"ok":must?"must":"opt"}"><span class="setup-dot" aria-hidden="true">${ok?"✓":must?"!":"·"}</span><div><b>${title}</b><p>${detail}</p>${ok||!todo?"":`<p class="setup-do">${todo}</p>`}</div><span class="pill ${ok?"good":must?"bad":""}">${ok?"On":must?"Do this first":"Optional"}</span></li>`;
  const st=s.storage,keep=st.kind!=="disk"||st.dataFile;
  const html=`<p class="muted lede-sm">Everything below is set in Render → vyaparboss → Environment. After saving, Render restarts the app and this page updates.</p>
    <ol class="setup">
      ${item(keep&&!st.error,"Data survives redeploys",st.kind==="upstash"?(st.error?`Saving to Upstash failed: ${esc(st.error)}`:`Saved to Upstash ${ago(st.lastSaved)}.`):st.dataFile?"Saved on a permanent disk (DATA_FILE).":"Data is on a temporary disk. A redeploy erases accounts and orders.",
        `Create a free Redis database at <a href="https://upstash.com" target="_blank" rel="noopener">upstash.com</a> (Mumbai region), then add <code>UPSTASH_REDIS_REST_URL</code> and <code>UPSTASH_REDIS_REST_TOKEN</code>.`,true)}
      ${item(true,"Team tools","The admin key is set; you're using it now.")}
      ${item(s.email.on,"Email",s.email.on?`Sending through ${esc(s.email.provider)} as ${esc(s.email.from)}.${s.email.contactTo?" Contact messages are forwarded.":" Add <code>CONTACT_TO</code> to get contact messages by email."}`:"Off: no password resets, email confirmation, order emails or outreach.",
        `Free Brevo account → SMTP &amp; API → API key. Add <code>EMAIL_API_KEY</code>, <code>OUTREACH_FROM_EMAIL</code> (a sender verified in Brevo) and <code>CONTACT_TO</code>.`,true)}
      ${item(s.signIn.google,"Sign in with Google",s.signIn.google?"On.":"Off: people sign in with email and password.",`Google Cloud → APIs &amp; Services → Credentials → OAuth client (Web), origin <code>${esc(s.publicUrl)}</code>. Add <code>GOOGLE_CLIENT_ID</code>. Steps in docs/SIGN_IN_SETUP.md.`)}
      ${item(s.signIn.apple,"Sign in with Apple",s.signIn.apple?"On.":"Off.","Needs the Apple Developer Program (US$99 a year). Add <code>APPLE_CLIENT_ID</code>.")}
      ${item(s.signIn.facebook,"Sign in with Facebook",s.signIn.facebook?"On.":"Off.","Needs a Meta developer app. Add <code>FACEBOOK_APP_ID</code> and <code>FACEBOOK_APP_SECRET</code>.")}
      ${item(!!s.ai,"Bhai's AI",s.ai?`Reading requests with ${esc(s.ai)}.`:"Off: Bhai uses the built-in rule reader.","Add <code>GEMINI_API_KEY</code> from aistudio.google.com.")}
      ${item(s.payments?.on&&s.payments?.webhook,"Online payments",s.payments?.on?`Razorpay ${s.payments.test?"in test mode (no real money)":"live"}${s.payments.webhook?".":", but the webhook secret is missing, so paid links won't be recorded."}`:"Off: buyers pay suppliers directly and record it.",
        `Razorpay dashboard → API keys (start with test keys) → add <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code>; Webhooks → URL <code>${esc(s.publicUrl)}/webhooks/razorpay</code>, event payment_link.paid → add <code>RAZORPAY_WEBHOOK_SECRET</code>. Before taking real money, set up Razorpay Route so payments go to suppliers, not to KaantaMandi.`)}
      ${item(s.whatsapp,"WhatsApp",s.whatsapp?"Connected.":"Not connected.","Needs a Meta business account. Steps in docs/WHATSAPP_SETUP.md.")}
      ${item(!c.samplesShown,"Real suppliers only",c.samplesShown?`The 20 example suppliers still show to buyers. ${c.listings} supplier${c.listings===1?"":"s"} listed themselves.`:"Example suppliers are hidden.","Once you have real suppliers for your first category, hide the examples in Network.")}
    </ol>
    <div class="kpis setup-k">
      <div class="panel kpi"><span>Buyers</span><b>${c.buyers}</b><small>${c.verifiedEmails} confirmed emails in all</small></div>
      <div class="panel kpi"><span>Suppliers</span><b>${c.suppliers}</b><small>${c.listings} listed, ${c.verifiedListings} verified</small></div>
      <div class="panel kpi"><span>Real requests</span><b>${c.requests}</b><small>${c.orders} order${c.orders===1?"":"s"}</small></div>
      <div class="panel kpi"><span>Inbox</span><b>${c.signups+c.messages}</b><small>${c.signups} sign-ups, ${c.messages} messages</small></div>
    </div>`;
  setHTML(el,html);
}
/* Team → Ops: is the marketplace working, and what needs a person today. */
const LEVEL={critical:["bad","Urgent"],serious:["warn","Today"],warning:["gold","Watch"]};
const pct=x=>x==null?"–":Math.round(x*100)+"%";
const hrs=x=>x==null?"–":x<1?"<1 h":x<48?Math.round(x)+" h":Math.round(x/24)+" days";
function weeksChart(weeks){
  const max=Math.max(1,...weeks.map(w=>w.gmv)),lbl=t=>new Date(t).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
  const top=lakh(max),last=weeks[weeks.length-1];
  return `<figure class="wchart"><figcaption><b>Orders by week</b> <span class="muted">order value by the week it was placed, last 8 weeks</span></figcaption>
    <div class="wplot" role="img" aria-label="Order value by week for the last 8 weeks; this week ${lakh(last.gmv)}">
      <div class="wgrid"><span>${top}</span><span>0</span></div>
      <div class="wbars">${weeks.map((w,i)=>`<div class="wcol" tabindex="0" data-tip="Week of ${lbl(w.start)}: ${inr(w.gmv)}, ${w.orders} order${w.orders===1?"":"s"}">${i===weeks.length-1&&w.gmv?`<em>${lakh(w.gmv)}</em>`:""}<i style="height:calc((100% - ${i===weeks.length-1&&w.gmv?18:0}px) * ${(w.gmv/max).toFixed(3)})"></i><small>${lbl(w.start)}</small></div>`).join("")}</div>
    </div>
    <details class="more sub"><summary>Show as a table ${ico("i-chev","")}</summary><div><table class="breakdown"><tbody>${weeks.map(w=>`<tr><td>Week of ${lbl(w.start)}</td><td>${w.orders} order${w.orders===1?"":"s"}</td><td>${inr(w.gmv)}</td></tr>`).join("")}</tbody></table></div></details>
  </figure>`;
}
async function renderOps(){
  const el=document.getElementById("s-ops");if(!el)return;
  if(Repo.mode!=="server"){setHTML(el,`<div class="panel empty">${ico("art-chart","")}<h2>Ops lives on the live app</h2><p>It reads real orders, requests and payments from the server.</p></div>`);return;}
  if(el.contains(document.activeElement)&&/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))return;
  if(!el.innerHTML)el.innerHTML=`<p class="muted">Loading…</p>`;
  let r;try{r=await Repo.opsReport();}catch(e){el.innerHTML=`<div class="errors">${esc(e.message)}</div>`;el._html=null;return;}
  const k=r.kpi;
  const tiles=[["Order value",lakh(k.gmv),`${lakh(k.gmv30)} in the last 30 days`],["Orders",String(k.orders),k.orders?`average ${lakh(k.aov)}`:"none yet"],
    ["Requests that became orders",pct(k.orderRate),`${k.requests} request${k.requests===1?"":"s"}`],["Supplier reply time",hrs(k.responseHours),`median, to their own price · ${pct(k.quoteRate)} of requests`],
    ["Time to confirm",hrs(k.confirmHours),"median, supplier confirming a PO"],["On time",pct(k.onTimeRate),`${k.delivered} delivered`],
    ["Orders with a problem",pct(k.disputeRate),`${k.openDisputes} open now · ${pct(k.cancelRate)} cancelled`],["Buyers who came back",pct(k.repeatRate),`${k.activeBuyers} active buyers, ${k.activeSuppliers} suppliers (30 days)`]];
  const fee=Math.round(r.feeRate*1000)/10;
  setHTML(el,`<section class="topsec"><h2 class="sub">Needs a person today</h2>
      ${r.alerts.length?`<ul class="alerts">${r.alerts.map(a=>`<li class="${a.level}"><span class="pill ${LEVEL[a.level][0]}">${LEVEL[a.level][1]}</span><div><b>${esc(a.title)}</b><small>${esc(a.detail)}</small></div></li>`).join("")}</ul>`:`<p class="hint">${ico("i-check","")}Nothing waiting. Every order is on track.</p>`}</section>
    <div class="kpis">${tiles.map(([a,b,c])=>`<div class="panel kpi"><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join("")}</div>
    <div class="panel pad">${weeksChart(r.weeks)}</div>
    ${r.disputes.length?`<section class="topsec"><h2 class="sub">Open problems</h2>${r.disputes.map(d=>`<div class="panel ocard"><div class="ohead"><div><h3>${esc(d.po)}: ${esc(d.issue)}</h3><p class="meta">${esc(d.supplier)} · ${inr(d.landed)} · opened ${fdate(d.opened)}</p></div></div>
      ${d.detail?`<p>“${esc(d.detail)}”</p>`:""}${d.msgs.length?`<ul class="thread">${d.msgs.map(m=>`<li class="${m.by}"><small>${m.by==="buyer"?"Buyer":m.by==="supplier"?"Supplier":"Team"} · ${fdate(m.at)}</small>${esc(m.text)}</li>`).join("")}</ul>`:""}
      <form class="oform" data-form="ops-resolve" data-po="${esc(d.po)}" novalidate><div class="fields">
        <div class="field"><label for="rs-${okey(d.po)}">Outcome</label><select id="rs-${okey(d.po)}">${Object.entries(RESOLUTIONS).filter(([v])=>v!=="withdrawn").map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select></div>
        <div class="field"><label for="rt-${okey(d.po)}">Note to both sides</label><input id="rt-${okey(d.po)}" maxlength="300"></div></div>
        <div class="actions"><button class="btn sm primary">Close the problem</button><button class="btn sm ghost" type="button" data-action="ops-msg" data-po="${esc(d.po)}">Send note only</button></div></form></div>`).join("")}</section>`:""}
    ${r.toSettle.length?`<section class="topsec"><h2 class="sub">Paid online, to settle</h2><ul class="memberlist">${r.toSettle.map(p=>`<li><div><b>${inr(p.amount)} to ${esc(p.supplier)}</b><small>${esc(p.po)} · ${fdate(p.at)}${p.test?" · test mode, no real money":""}</small></div><button class="btn sm" data-action="ops-settle" data-po="${esc(p.po)}" data-id="${esc(p.id)}">Mark settled</button></li>`).join("")}</ul></section>`:""}
    <section class="topsec"><h2 class="sub">KaantaMandi fees</h2>
      <p class="muted">A fee applies only to suppliers who agreed to it, from their next order. ${lakh(k.feesDue)} due, ${lakh(k.feesCollected)} collected.</p>
      <form class="replyrow feerate" data-form="ops-feerate" novalidate><label for="feeRate">Standard fee (% of goods)</label><input id="feeRate" type="number" min="0" max="10" step="0.1" value="${fee}"><button class="btn sm">Save</button></form>
      ${r.suppliers.length?`<ul class="memberlist">${r.suppliers.map(x=>`<li><div><b>${esc(x.name)}</b><small>${esc(x.city)}${x.verified?" · verified":""}${x.delivered?` · ${x.onTime}% on time over ${x.delivered}`:""}</small></div>
        <form class="replyrow" data-form="ops-supfee" data-sid="${esc(x.id)}" novalidate><label class="toggle"><input type="checkbox" id="fa-${esc(x.id)}" ${x.feeAgreed?"checked":""}> Fee agreed</label><label class="sr" for="fr-${esc(x.id)}">Their rate (%)</label><input id="fr-${esc(x.id)}" type="number" min="0" max="10" step="0.1" placeholder="${fee}%" value="${x.feeRate!=null?Math.round(x.feeRate*1000)/10:""}"><button class="btn sm">Save</button></form></li>`).join("")}</ul>`:`<p class="hint">Suppliers who list themselves show up here.</p>`}
      ${r.fees.length?`<div class="tablewrap"><table class="cmp"><thead><tr><th>Order</th><th>Supplier</th><th>Fee</th><th>Status</th></tr></thead><tbody>${r.fees.map(f=>`<tr><td>${esc(f.po)}</td><td>${esc(f.supplier)}</td><td>${inr(f.amount)}</td><td><select data-feestatus="${esc(f.po)}" aria-label="Fee status for ${esc(f.po)}">${["due","invoiced","collected","waived"].map(v=>`<option ${v===f.status?"selected":""}>${v}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`:""}
    </section>`);
}
function onTeamUnlocked(){teamView="setup";Repo.refresh().then(()=>{renderNav();renderAcct();showTab("team");showTeamView(teamView);}).catch(fail);}

/* ===================== RENDER + EVENTS ===================== */
function renderRoleViews(){
  renderNav();renderAcct();renderOrdersCount();
  const r=role(),vis=id=>!document.getElementById(id)?.hidden;
  if(r==="buyer"&&vis("v-suppliers"))renderDirectory();
  if(r==="supplier"){if(vis("v-requests"))renderRequests();if(vis("v-sorders"))renderSOrders();if(vis("v-listing"))renderListing();if(vis("v-sinsights"))renderSInsights();}
  if(vis("v-account"))renderAccount();
  if(vis("v-team"))showTeamView(teamView,!$("#teamGate").innerHTML&&document.getElementById(teamView==="apps"?"s-apps":"i-outreach")?.innerHTML!=="");
}
/* #reset/<token> from a password-reset email. The token leaves the address bar straight away. */
let pendingInvite=null;
function joinPending(){
  if(!pendingInvite)return;const tok=pendingInvite;pendingInvite=null;
  Repo.joinTeam(tok).then(u=>{toast(`You've joined ${u.org?.name||"the team"}`);renderAcct();showTab("orders");}).catch(e=>toast(e.message));
}
function resetRoute(){
  const ti=(location.hash||"").match(/^#team-invite\/([\w-]{20,})$/);
  if(ti){history.replaceState(null,"",location.pathname+location.search);pendingInvite=ti[1];
    if(signedIn()&&Repo.me.role==="buyer"){joinPending();return false;}
    au.inviteNote=true;showAuth("buyer","signup");return true;}
  const v=(location.hash||"").match(/^#verify\/([\w-]{20,})$/);
  if(v){history.replaceState(null,"",location.pathname+location.search);
    Repo.verifyEmail(v[1]).then(j=>{toast("Email confirmed. Thank you!");if(j.user){renderAcct();$("#v-account")._html=null;renderRoleViews();}}).catch(e=>toast(e.message));
    if(!role())showAuth(null,"login");return true;}
  const m=(location.hash||"").match(/^#reset\/([\w-]{20,})$/);if(!m)return false;
  au.token=m[1];history.replaceState(null,"",location.pathname+location.search);showAuth(null,"reset");return true;
}
window.addEventListener("hashchange",resetRoute);
function goHome(){const r=role();if(!r){showAuth();return;}showTab(navFor()[0][0]);}
function rolesBoot(){
  renderNav();renderAcct();
  if(Repo.mode==="server")Repo.authConfig().then(()=>{if(!document.getElementById("v-account")?.hidden){$("#v-account")._html=null;renderAccount();}}).catch(()=>{});
  if(/^#(join|quote)/.test(location.hash)){growBoot();return;}
  if(resetRoute())return;
  if(!role()){showAuth();return;}
  let t=null;try{t=localStorage.getItem(KEY+".tab");}catch(e){}
  showTab(t||navFor()[0][0]);
}
Object.assign(ACTIONS,{
  home:()=>goHome(),
  "au-role":a=>{au.role=a.dataset.v;au.err=[];au.wrongRole=null;renderAuth();},
  "au-mode":a=>{au.mode=a.dataset.v;au.err=[];au.wrongRole=null;au.sent=null;renderAuth();},
  "au-email":()=>{au.email=!au.email;renderAuth();if(au.email)setTimeout(()=>document.getElementById(au.mode==="signup"?"auName":"auEmail")?.focus(),30);},
  "au-provider":a=>startProvider(a.dataset.v),
  "ops-settle":a=>Repo.teamOrder(a.dataset.po,{settle:a.dataset.id}).then(()=>{toast("Marked settled");renderOps();}).catch(fail),
  "ops-msg":a=>{const t=document.getElementById("rt-"+okey(a.dataset.po))?.value||"";Repo.orderAction(a.dataset.po,{action:"reply",text:t},"team").then(()=>{toast("Note sent to both sides");renderOps();}).catch(fail);},
  "team-remove":a=>Repo.removeMember(a.dataset.id).then(()=>{toast("Removed from your team");loadTeam();}).catch(fail),
  "team-uninvite":a=>Repo.cancelInvite(a.dataset.id).then(()=>{toast("Invite cancelled");loadTeam();}).catch(fail),
  "team-copy":()=>{const i=document.getElementById("invLink");if(!i)return;const ok=()=>toast("Link copied");try{navigator.clipboard.writeText(i.value).then(ok,()=>{i.select();toast("Press Ctrl+C to copy");});}catch(e){i.select();}},
  "team-leave":()=>Repo.removeMember(Repo.me.id).then(()=>Repo.refresh()).then(()=>{toast("You left the team");$("#v-account")._html=null;renderAccount();}).catch(fail),
  "acct-verify":()=>Repo.resendVerify().then(j=>toast(j.already?"Your email is already confirmed":"Sent. Check your inbox and spam folder.")).catch(fail),
  "au-forgot":()=>{const e=document.getElementById("auEmail")?.value||"";au.mode="forgot";au.sent=null;au.err=[];renderAuth();const i=document.getElementById("auEmail");if(i){i.value=e;i.focus();}},
  "au-guest":()=>{Repo.setGuest(true);document.body.classList.remove("welcome");renderNav();renderAcct();showTab("buy");},
  "acct-auth":a=>{const d=document.getElementById("acctPick");if(d)d.open=false;showAuth(role()||null,a.dataset.v);},
  "acct-logout":async()=>{const d=document.getElementById("acctPick");if(d)d.open=false;await Repo.logout();flow=freshFlow();au={...au,role:null,mode:"login",email:false};toast("Logged out");showAuth();},
  "team-open":()=>{if(Repo.mode!=="server")try{localStorage.setItem(KEY+".team","1");}catch(e){}renderNav();renderAcct();showTab("team");showTeamView(teamView);},
  "rq-status":a=>{rq.status=a.dataset.v;renderRequests();},
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
  if(k==="au-forgot"||k==="au-reset"){e.preventDefault();submitRecover(k==="au-forgot"?"forgot":"reset");}
  if(k==="ops-resolve"){e.preventDefault();const po=f.dataset.po;
    Repo.orderAction(po,{action:"resolve",resolution:document.getElementById("rs-"+okey(po))?.value,note:document.getElementById("rt-"+okey(po))?.value||""},"team").then(()=>{toast("Problem closed. Both sides got an email.");renderOps();}).catch(fail);}
  if(k==="ops-feerate"){e.preventDefault();Repo.setFeeRate(document.getElementById("feeRate")?.value).then(()=>{toast("Standard fee saved");renderOps();}).catch(fail);}
  if(k==="ops-supfee"){e.preventDefault();const id=f.dataset.sid;
    Repo.setFeeTerms(id,!!document.getElementById("fa-"+id)?.checked,document.getElementById("fr-"+id)?.value??"").then(()=>{toast("Fee terms saved");document.activeElement?.blur?.();renderOps();}).catch(fail);}
  if(k==="team-invite"){e.preventDefault();const em=document.getElementById("tiEmail")?.value||"",lim=document.getElementById("tiLimit")?.value??"";
    Repo.invite(em,lim).then(j=>{lastInvite={email:em.trim().toLowerCase(),link:j.link,emailed:j.emailed};toast("Invite created");loadTeam();}).catch(fail);}
  if(k==="team-limit"){e.preventDefault();const v=document.getElementById("ml-"+f.dataset.id)?.value??"";
    Repo.setMemberLimit(f.dataset.id,v).then(()=>{toast("Limit saved");document.activeElement?.blur?.();loadTeam();}).catch(fail);}
  if(k==="acct-pass"){e.preventDefault();const cur=document.getElementById("acCur")?.value||"",nw=document.getElementById("acNew")?.value||"";
    if(nw.length<8){fail(new Error("Use a password of at least 8 characters"));return;}
    Repo.changePassword(cur,nw).then(()=>{toast("Password saved");$("#v-account")._html=null;document.activeElement?.blur?.();renderAccount();}).catch(fail);}
  if(k==="acct-delete"){e.preventDefault();if((document.getElementById("acDel")?.value||"").trim().toUpperCase()!=="DELETE"){fail(new Error("Type DELETE to confirm"));return;}
    Repo.deleteMe().then(()=>{flow=freshFlow();au={...au,role:null,mode:"signup",email:false};toast("Your account is deleted");showAuth();}).catch(fail);}
  if(k==="account"){e.preventDefault();const g=id=>document.getElementById(id)?.value??"";
    const nt=document.getElementById("acNotify"),bd=document.getElementById("acBudget");
    Repo.updateMe({name:g("acName"),business:g("acBiz"),email:g("acEmail"),phone:g("acPhone"),city:g("acCity"),gstin:g("acGstin"),address:g("acAddr"),...(nt?{notify:nt.checked}:{}),...(bd?{budgetMonthly:bd.value}:{})}).then(()=>{toast("Saved");$("#v-account")._html=null;document.activeElement?.blur?.();renderAccount();renderAcct();}).catch(fail);}
  if(k==="myquote"){e.preventDefault();const id=f.dataset.rfq,g=s=>document.getElementById(`mq-${s}-${id}`)?.value??"";
    const btn=f.querySelector("button");if(btn)btn.disabled=true;
    Repo.myQuote(id,{unit:g("u"),lead:g("l"),note:g("n")}).then(()=>{toast("Quote sent. The buyer sees it with GST and freight added.");document.activeElement?.blur?.();renderRequests();}).catch(err=>{if(btn)btn.disabled=false;fail(err);});}
});
document.addEventListener("input",e=>{
  if(e.target.id==="dq"){df.q=e.target.value.toLowerCase().trim();renderDirGrid();}
});
document.addEventListener("change",e=>{
  const t=e.target,id=t.id;
  if(t.dataset?.feestatus){Repo.teamOrder(t.dataset.feestatus,{fee:{status:t.value}}).then(()=>{toast("Fee status saved");t.blur?.();renderOps();}).catch(fail);return;}
  const num=v=>{const n=Number(v);return isFinite(n)&&n>0?n:0;};
  const map={dprod:()=>{df.product=t.value;if(!df.product){df.maxPrice=0;if(df.sort==="price")df.sort="best";}},dstate:()=>df.state=t.value,dcity:()=>{df.city=t.value;if(!df.city){df.maxKm=0;if(df.sort==="near")df.sort="best";}},
    dkm:()=>df.maxKm=num(t.value),dqty:()=>df.qty=Math.round(num(t.value)),dprice:()=>df.maxPrice=num(t.value),drate:()=>df.minRating=num(t.value),dver:()=>df.verified=t.checked,dontime:()=>df.ontime=t.checked,dsort:()=>df.sort=t.value};
  if(map[id]){map[id]();t.blur?.();renderDirectory();return;}
  if(id==="rqProd"){rq.product=t.value;t.blur?.();renderRequests();}
});
