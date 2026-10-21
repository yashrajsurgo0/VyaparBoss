/* VyaparBoss — supplier discovery, freight, GST, landed-cost ranking, negotiation and record builders.
   Pure logic, no DOM: loaded by the browser (index.html) and by the server/tests (server/core.js). */

/* ===================== PRICING ===================== */
function tierPrice(o,q){let p=null;for(const [t,pr] of o.tiers) if(q>=t) p=pr;return p;}
function freightCost(w,d){const ptl=Math.max(1200,w*(2.5+0.006*d));if(w<1000)return{cost:ptl,mode:"Part load"};const trucks=Math.ceil(w/9000);const ftl=trucks*(9000+38*d);return ftl<ptl?{cost:ftl,mode:`${trucks} × 9 t truck`}:{cost:ptl,mode:"Part load"};}
// Suppliers without a track record yet are ranked on these neutral defaults.
const NEW_SUPPLIER={onTime:85,rating:4.0};
// Real records are blended with those defaults, as if every supplier started with two average orders,
// so one late delivery doesn't sink a new supplier and one good one doesn't crown them.
const PRIOR_ORDERS=2;
const onTimeOf=s=>s.track?.delivered?(NEW_SUPPLIER.onTime*PRIOR_ORDERS+s.track.onTime*100)/(PRIOR_ORDERS+s.track.delivered):s.onTime??NEW_SUPPLIER.onTime;
const ratingOf=s=>s.track?.rated?(NEW_SUPPLIER.rating*PRIOR_ORDERS+s.track.ratingSum)/(PRIOR_ORDERS+s.track.rated):s.rating??NEW_SUPPLIER.rating;

function quoteFor(s,r,neg={},live={}){
  const o=s.offers.find(x=>x.p===r.productId);const p=PMAP[r.productId];
  const d=km(s.city,r.city);
  const lq=live[s.id];
  const list=lq?lq.unit:tierPrice(o,r.qty);
  const unit=neg[s.id]?.price ?? list;
  const subtotal=unit*r.qty;
  const gst=subtotal*p.gst/100;
  const w=r.qty*p.kgPer;const f=freightCost(w,d);
  const landed=subtotal+gst+f.cost;
  const transit=Math.max(1,Math.ceil(d/450));
  const eta=(lq?lq.lead:s.lead)+transit;
  const intra=CITIES[s.city][2]===CITIES[r.city][2];
  return {s,o,d,list,unit,subtotal,gst,gstRate:p.gst,gstType:intra?"CGST + SGST":"IGST",weight:w,freight:f.cost,freightMode:f.mode,landed,per:landed/r.qty,transit,eta,ready:lq?lq.lead:s.lead,live:!!lq,meets:!r.deadline||eta<=r.deadline};
}
function discover(r,neg={},live=liveMap(r)){
  const eligible=[],excluded=[];
  for(const s of SUPPLIERS){
    const o=s.offers.find(x=>x.p===r.productId);if(!o||!CITIES[s.city])continue;
    const d=km(s.city,r.city);const moq=o.tiers[0][0];
    if(r.qty<moq){excluded.push({s,why:`Minimum order is ${qfmt(moq)} ${PMAP[r.productId].unit}`});continue;}
    if(r.qty>o.cap){excluded.push({s,why:`Capacity ${qfmt(o.cap)} ${PMAP[r.productId].unit} per order`});continue;}
    if(d>s.coverage){excluded.push({s,why:`Doesn't deliver to ${r.city} (${qfmt(d)} km; serves up to ${qfmt(s.coverage)} km)`});continue;}
    eligible.push(quoteFor(s,r,neg,live));
  }
  if(eligible.length){
    const min=Math.min(...eligible.map(q=>q.landed));
    for(const q of eligible) q.score=0.6*(min/q.landed)+0.25*(onTimeOf(q.s)/100)+0.15*(ratingOf(q.s)/5);
    eligible.sort((a,b)=>(b.meets-a.meets)||(b.score-a.score));
  }
  return {eligible,excluded,offering:eligible.length+excluded.length};
}
/* Negotiation Agent: each supplier concedes down to its floor (list × (1 − maxDisc)), never below. */
function negotiate(res,target){
  const neg={},out=[];
  for(const q of res.eligible){const floor=+(q.list*(1-(q.s.maxDisc??0.03))).toFixed(2);const price=Math.max(floor,Math.min(target,q.list));neg[q.s.id]={price};out.push({name:q.s.name,price,ok:price<=target});}
  return {neg,out:out.sort((x,y)=>y.ok-x.ok||x.price-y.price)};
}

/* ===================== SUPPLIER ONBOARDING ===================== */
/* Validates a supplier from the onboarding form or the API. Returns {ok, s, errors}. */
function normalizeSupplier(x){
  const errors=[];x=x||{};
  const str=(v,max)=>String(v??"").trim().slice(0,max);
  const int=(v,lo,hi,label)=>{const n=Math.round(Number(v));if(!isFinite(n)||n<lo||n>hi){errors.push(`${label} must be between ${lo} and ${hi}`);return lo;}return n;};
  const s={id:str(x.id,40)||null,name:str(x.name,80),city:str(x.city,40),area:str(x.area,80),gstin:str(x.gstin,15).toUpperCase(),
    terms:str(x.terms,140),certs:(Array.isArray(x.certs)?x.certs:String(x.certs||"").split(",")).map(c=>str(c,60)).filter(Boolean).slice(0,6),
    contact:str(x.contact,40),createdAt:Number(x.createdAt)||Date.now(),orders:Number(x.orders)||0};
  if(s.name.length<2)errors.push("Enter the supplier's business name");
  if(!CITIES[s.city])errors.push("Pick the city the supplier ships from");
  const g=checkGstin(s.gstin,s.city);
  if(!g.ok)errors.push(g.why);s.gstOk=g.ok;s.gstWarn=g.warn||null;
  s.lead=int(x.lead,1,60,"Days to dispatch");
  s.coverage=int(x.coverage,25,3500,"Delivery radius (km)");
  const disc=Number(x.maxDiscPct??(x.maxDisc!=null?x.maxDisc*100:3));
  if(!(disc>=0&&disc<=15))errors.push("Max negotiable discount must be 0–15%");
  s.maxDisc=Math.min(15,Math.max(0,disc||0))/100;
  s.onTime=x.onTime!=null&&x.onTime!==""&&isFinite(+x.onTime)?Math.min(100,Math.max(0,+x.onTime)):null;
  s.rating=x.rating!=null&&x.rating!==""&&isFinite(+x.rating)?Math.min(5,Math.max(1,+x.rating)):null;
  s.offers=[];
  (Array.isArray(x.offers)?x.offers:[]).forEach((o,i)=>{
    const p=PMAP[o?.p];if(!p){errors.push(`Product ${i+1}: choose a product`);return;}
    const tiers=Array.isArray(o.tiers)?o.tiers.map(t=>[+t[0],+t[1]]):parseTiers(o.tiersText);
    const okTiers=tiers&&tiers.length&&tiers.every((t,j)=>t[0]>0&&t[1]>0&&(!j||(t[0]>tiers[j-1][0]&&t[1]<=tiers[j-1][1])));
    if(!okTiers){errors.push(`${p.name}: price tiers must look like "500:17.9, 2000:16.2" with prices that don't rise as quantity rises`);return;}
    const cap=Math.round(Number(o.cap));
    if(!(cap>=tiers[0][0])){errors.push(`${p.name}: capacity per order must be at least the minimum order (${tiers[0][0]})`);return;}
    if(s.offers.some(x=>x.p===p.id)){errors.push(`${p.name} is listed twice`);return;}
    s.offers.push({p:p.id,tiers,cap});
  });
  if(!s.offers.length&&!errors.some(e=>/Product|tiers|capacity/.test(e)))errors.push("Add at least one product with its price tiers");
  return {ok:!errors.length,s,errors};
}

/* ===================== RECORDS ===================== */
const quoteSummary=res=>res.eligible.map(q=>({sid:q.s.id,unit:q.unit,landed:Math.round(q.landed),eta:q.eta,meets:q.meets,...(q.live?{live:true}:{})}));
function rfqRecord(r,res,extra={}){
  return {id:null,date:Date.now(),productId:r.productId,qty:r.qty,city:r.city,deadline:r.deadline||null,quotes:quoteSummary(res),status:"open",wonBy:null,source:"web",...extra};
}
function orderRecord(r,res,q,extra={}){
  const avg=res.eligible.reduce((a,x)=>a+x.landed,0)/res.eligible.length;const now=Date.now();
  return {po:null,date:now,productId:r.productId,qty:r.qty,city:r.city,sid:q.s.id,sname:q.s.name,scity:q.s.city,unit:q.unit,list:q.list,
    subtotal:Math.round(q.subtotal),gst:Math.round(q.gst),freight:Math.round(q.freight),landed:Math.round(q.landed),avg:Math.round(avg),
    eta:q.eta,promisedBy:now+q.eta*864e5,deadline:r.deadline||null,stage:0,history:[now],issue:null,rfqId:r.id||null,...extra};
}
/* Three example orders so Orders, Supplier desk and Metrics aren't empty on first open. */
function buildSampleData(){
  const data={orders:[],rfqs:[],seq:{po:0,rfq:0}};
  const mk=(productId,qty,city,deadline,daysAgo,stage)=>{
    const r={productId,qty,city,deadline};const res=discover(r);const q=res.eligible.find(x=>x.meets);if(!q)return;
    const t=Date.now()-daysAgo*864e5;
    const rid=rfqIdFor(++data.seq.rfq);
    data.rfqs.push(rfqRecord(r,res,{id:rid,date:t,status:"ordered",wonBy:q.s.id,sample:true}));
    data.orders.push(orderRecord({...r,id:rid},res,q,{po:poIdFor(++data.seq.po),date:t,promisedBy:t+q.eta*864e5,stage,history:Array.from({length:stage+1},(_,i)=>t+i*864e5),sample:true}));
  };
  mk("box3",8000,"Pune",7,9,4);
  mk("gloves",250,"Chennai",5,3,2);
  mk("npk",3000,"Nashik",6,1,1);
  data.orders.reverse();data.rfqs.reverse();
  return data;
}
/* Plain-text quote summary, used for WhatsApp replies. */
function quoteMessage(r,res){
  const p=PMAP[r.productId];const ok=res.eligible.filter(q=>q.meets);
  if(!res.eligible.length)return `${qfmt(r.qty)} ${p.unit} ${p.name} → ${r.city}: abhi koi verified supplier yeh order nahi le sakta. Quantity ya city badal ke dobara bhejiye.`;
  const top=(ok.length?ok:res.eligible).slice(0,3);
  const track=s=>s.onTime!=null?`${s.onTime}% on-time`:"naya supplier";
  const lines=top.map((q,i)=>`${i+1}. ${q.s.name} (${q.s.city}): ${inr(q.landed)} landed, ${inr(q.per,2)}/${unitOne(p.unit)}, ${q.eta} din, ${track(q.s)}${q.meets?"":" (deadline miss)"}`);
  const cheapest=top.reduce((a,b)=>b.landed<a.landed?b:a);
  const why=cheapest!==top[0]?`\nOption 1 ${inr(top[0].landed-cheapest.landed)} mehenga hai par delivery record behtar hai. Sabse sasta: option ${top.indexOf(cheapest)+1}.`:"";
  return `${r.id?`${r.id}\n`:""}${qfmt(r.qty)} ${p.unit} ${p.name} → ${r.city}${r.deadline?`, ${r.deadline} din mein`:""}\n\n${lines.join("\n")}${why}\n\nTotal landed = rate + GST + freight. Order karne ke liye reply karein "APPROVE 1" (ya 2/3).`;
}

/* ===================== GROWTH: LEADS, SIGN-UPS, LIVE QUOTES ===================== */
/* A lead from a researched CSV row (supplier or exporter lists). Only business contact details are kept. */
function normalizeLead(x){
  x=x||{};const str=(v,n)=>String(v??"").trim().slice(0,n);const errors=[];
  const segRaw=str(x.segment||x.type||(x.category?"supplier":""),60).toLowerCase();
  const lead={id:str(x.id,40)||null,business:str(x.business||x.business_name||x.name,100),city:str(x.city,60),state:str(x.state,40),
    segment:/supplier/.test(segRaw)&&!/buyer/.test(segRaw)?"supplier":/buyer|export/.test(segRaw)?"exporter":"supplier",
    product:str(x.product||x.products||x.cluster_product||x.category,120),website:str(x.website,200),
    email:(String(x.email||"").match(/[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[a-z]{2,}/i)||[""])[0].toLowerCase().slice(0,120),phone:str(x.phone,40),contact:str(x.contact||x.contact_name,80),
    source:str(x.source||x.source_url,300),notes:str(x.notes,1000),status:str(x.status,20)||"new",
    createdAt:Number(x.createdAt)||Date.now(),lastEmailed:Number(x.lastEmailed)||null,sends:Array.isArray(x.sends)?x.sends.slice(-10):[]};
  if(lead.business.length<2)errors.push("Business name is missing");
  if(lead.email&&!isEmail(lead.email)){lead.notes=(lead.notes+" (invalid email removed: "+lead.email+")").trim();lead.email="";}
  if(!LEAD_STATUSES.includes(lead.status))lead.status="new";
  lead.lastContacted=Number(x.lastContacted)||null;
  return {ok:!errors.length,lead,errors};
}
const leadKey=l=>(l.email||(l.business+"|"+l.city)).toLowerCase().replace(/\s+/g," ").trim();
/* Merge freshly imported leads into an existing list without duplicates (by email, else business + city). */
function mergeLeads(existing,incoming){
  const seen=new Set(existing.map(leadKey));const added=[],skipped=[];
  for(const raw of incoming){const {ok,lead}=normalizeLead(raw);if(!ok){skipped.push(raw);continue;}
    const k=leadKey(lead);if(seen.has(k)){skipped.push(raw);continue;}seen.add(k);added.push(lead);}
  return {added,skipped};
}
/* Variables for an outreach email. ctx: {senderName, senderAddress, joinBase, unsubLink(lead)} */
function outreachVars(lead,ctx){
  const first=lead.contact?lead.contact.replace(/^(mr|mrs|ms|shri|smt|dr)\.?\s+/i,"").split(/\s+/)[0]:"";
  const base=String(ctx.joinBase||"").replace(/#.*$/,"");
  const city=String(lead.city||"").replace(/\s*\(.*?\)\s*/g," ").trim();
  // "Moradabad (brassware/metal decor): metal" → "brassware": skip a leading city name and use what's in brackets.
  let raw=String(lead.product||"");const br=raw.match(/^([^(]+)\(([^)]+)\)/);
  if(br&&city&&br[1].trim().toLowerCase().startsWith(city.toLowerCase().split(" ")[0]))raw=br[2].split("/")[0];
  const product=raw.split(/[;|,(:]/)[0].replace(/\s+/g," ").trim().toLowerCase().slice(0,50).trim();
  return {business:lead.business,city:city||"your city",product:product||(lead.segment==="supplier"?"packaging":"export"),
    greeting:first?first+" ji":lead.business+" team",sender_name:ctx.senderName||"Team VyaparBoss",sender_address:ctx.senderAddress||"",
    join_link:`${base}#join/${lead.segment==="supplier"?"s":"b"}/${lead.id||""}`,unsub_link:ctx.unsubLink?ctx.unsubLink(lead):""};
}
function renderOutreach(tplId,lead,ctx){
  const t=OUTREACH_TEMPLATES.find(x=>x.id===tplId);if(!t)return null;
  const v=outreachVars(lead,ctx);return {to:lead.email,subject:fillTemplate(t.subject,v),text:fillTemplate(t.body,v)};
}
/* WhatsApp opener and call script for a lead, in the same honest voice as the emails. */
function renderWhatsAppPitch(lead,ctx){
  const msg=fillTemplate(WA_TEMPLATES[lead.segment==="supplier"?"supplier":"exporter"],outreachVars(lead,ctx));
  return lead.lastEmailed?msg.replace(/^(Namaste [^,]+,)/,`$1 maine ${dstr(lead.lastEmailed)} ko email bhi bheja tha.`):msg;
}
function renderCallScript(lead,ctx){
  const v=outreachVars(lead,ctx);const lines=CALL_SCRIPTS[lead.segment==="supplier"?"supplier":"exporter"].map(l=>fillTemplate(l,v));
  if(lead.lastEmailed)lines.splice(1,0,`Maine ${dstr(lead.lastEmailed)} ko aapko VyaparBoss ke baare mein email bheja tha. Kya aapne dekha? Ek minute mein bata deta hoon.`);
  return lines;
}
/* Self-serve sign-up from the public "Join" page. role: supplier | buyer. */
function normalizeJoin(x){
  x=x||{};const str=(v,n)=>String(v??"").trim().slice(0,n);const errors=[];
  // Global buyers give an international number with country code; Indian numbers are stored as 10 digits.
  const intl=x.region==="global"&&/^\s*(\+|00)/.test(String(x.phone||""))&&!/^\s*(\+|00)\s*91/.test(String(x.phone||""));
  const a={role:x.role==="buyer"?"buyer":"supplier",region:x.region==="global"?"global":"in",business:str(x.business,100),name:str(x.name,80),
    phone:intl?"+"+String(x.phone).replace(/\D/g,"").replace(/^00/,""):phoneDigits(x.phone),email:str(x.email,120).toLowerCase(),
    city:str(x.city,60),cats:(Array.isArray(x.cats)?x.cats:[]).filter(c=>CATS[c]).slice(0,3),what:str(x.what,300),gstin:str(x.gstin,15).toUpperCase(),
    monthly:MONTHLY_BANDS.includes(x.monthly)?x.monthly:"",exports:EXPORT_STAGES.includes(x.exports)?x.exports:"",ref:str(x.ref,40)};
  if(a.business.length<2)errors.push("Enter your business name");
  if(a.name.length<2)errors.push("Enter your name");
  if(intl?!/^\+\d{8,15}$/.test(a.phone):!/^[6-9]\d{9}$/.test(a.phone))errors.push(intl?"Enter your number with country code, e.g. +1 555 123 4567":a.region==="global"?"Enter a 10-digit Indian mobile, or your number with country code (+…)":"Enter a 10-digit mobile number");
  if(a.email&&!isEmail(a.email))errors.push("That email doesn't look right");
  if(a.city.length<2)errors.push("Enter your city");
  if(!a.cats.length&&a.what.length<3)errors.push(a.role==="supplier"?"Tell us what you make or sell":"Tell us what you buy");
  if(a.gstin){const g=checkGstin(a.gstin,CITIES[a.city]?a.city:null);if(!g.ok)errors.push(g.why);}
  if(x.consent!==true)errors.push("Please agree that VyaparBoss can contact you");
  // Optional rate card from suppliers, so the team doesn't have to collect it by phone.
  a.offers=[];
  if(a.role==="supplier")(Array.isArray(x.offers)?x.offers:[]).slice(0,4).forEach(o=>{
    if(!o||(!o.p&&!o.tiersText))return;const p=PMAP[o.p];
    if(!p){errors.push("Pick the product for each rate you added");return;}
    const tiers=parseTiers(o.tiersText);
    if(!tiers){errors.push(`${p.name}: write rates like "500:17.9, 2000:16.2" (quantity:₹ per ${unitOne(p.unit)})`);return;}
    const cap=Math.round(Number(o.cap))||tiers[tiers.length-1][0]*5;
    if(cap<tiers[0][0]){errors.push(`${p.name}: most per order must be at least your minimum order`);return;}
    if(!a.offers.some(y=>y.p===p.id))a.offers.push({p:p.id,tiers,cap});
  });
  const opt=(v,lo,hi)=>{const n=Math.round(Number(v));return v===""||v==null||!isFinite(n)?null:Math.min(hi,Math.max(lo,n));};
  a.coverage=opt(x.coverage,25,3500);a.lead=opt(x.lead,1,60);
  return {ok:!errors.length,a,errors};
}
/* Supplier's own quote from a quote link: price per unit (before GST) and days to get it ready. */
function normalizeLiveQuote(x,listPrice){
  x=x||{};const errors=[];const unit=Math.round(Number(x.unit)*100)/100,lead=Math.round(Number(x.lead));
  if(!(unit>0))errors.push("Enter your price per unit");
  else if(listPrice&&(unit>listPrice*5||unit<listPrice/5))errors.push("That price looks off by a lot. Check the unit (per piece, per kg…)");
  if(!(lead>=1&&lead<=60))errors.push("Days to get it ready must be 1–60");
  return {ok:!errors.length,q:{unit,lead,note:String(x.note??"").trim().slice(0,200),at:Date.now()},errors};
}
/* {sid:{unit,lead}} from an RFQ's invites, used by discover() so real quotes replace rate-card estimates. */
const liveMap=rfq=>Object.fromEntries((rfq?.invites||[]).filter(i=>i.quote).map(i=>[i.sid,i.quote]));

/* ===================== ACCOUNTS ===================== */
/* Sign-up details for a buyer or supplier account (password is checked by the server). */
function normalizeAccount(x){
  x=x||{};const str=(v,n)=>String(v??"").trim().slice(0,n);const errors=[];
  const a={role:x.role==="supplier"?"supplier":"buyer",name:str(x.name,80),business:str(x.business,100),email:str(x.email,120).toLowerCase(),
    phone:str(x.phone,20),city:str(x.city,60)};
  if(a.name.length<2)errors.push("Enter your name");
  if(a.business.length<2)errors.push("Enter your business name");
  if(!isEmail(a.email))errors.push("Enter a valid email");
  if(a.phone){const d=String(a.phone).replace(/[^\d+]/g,"");if(!/^(\+\d{8,15}|[6-9]\d{9}|91[6-9]\d{9})$/.test(d.replace(/^\+91/,"")))errors.push("Enter a 10-digit mobile, or a number with country code");}
  return {ok:!errors.length,a,errors};
}

/* ===================== DELIVERY, DISPUTES AND TRACK RECORD ===================== */
/* Who can do what to an order. Shared by the server and the offline demo so the rules are the same everywhere.
   who: "buyer" | "supplier" | "team". Returns {ok, ev} or {error}. Mutates the order. */
const ISSUE_REASONS={short:"Short quantity",damaged:"Damaged goods",wrong:"Wrong item or spec",quality:"Quality problem",late:"Late delivery",other:"Something else"};
const RECEIPT_CONDITIONS={ok:"All good",short:"Short quantity",damaged:"Some goods damaged",wrong:"Wrong item or spec",quality:"Quality problem"};
const RESOLUTIONS={replacement:"Replacement sent",credit:"Credit note issued",refund:"Refund",return:"Return and refund",none:"No action needed",withdrawn:"Withdrawn by the buyer"};
const promisedBy=o=>o.promisedBy||(o.date+(o.eta||0)*864e5);
function normalizeShipment(x){
  x=x||{};const str=(v,n)=>String(v??"").trim().slice(0,n);const errors=[];
  const s={transporter:str(x.transporter,80),lr:str(x.lr,40).toUpperCase(),vehicle:str(x.vehicle,20).toUpperCase().replace(/\s+/g," "),note:str(x.note,200),eta:null};
  if(s.transporter.length<2)errors.push("Enter the transporter or courier name");
  if(s.lr.length<3)errors.push("Enter the LR, AWB or docket number");
  if(x.eta){const t=Date.parse(String(x.eta).slice(0,10));if(!isFinite(t))errors.push("Expected delivery date doesn't look right");else s.eta=t;}
  return {ok:!errors.length,s,errors};
}
function normalizeReview(x){
  x=x||{};const stars=Math.round(Number(x.stars));const errors=[];
  if(!(stars>=1&&stars<=5))errors.push("Pick 1 to 5 stars");
  return {ok:!errors.length,r:{stars:Math.min(5,Math.max(1,stars||1)),text:String(x.text??"").trim().slice(0,300)},errors};
}
function applyOrderAction(o,a,who,now=Date.now()){
  a=a||{};const err=m=>({error:m});const is=(...r)=>who==="team"||r.includes(who);
  const set=st=>{o.history=(o.history||[o.date]).slice(0,5);for(let i=1;i<st;i++)o.history[i]=o.history[i]||now;o.history[st]=now;o.stage=st;};
  const txt=(v,n)=>String(v??"").trim().slice(0,n);
  if(o.cancelled&&a.action!=="reply")return err("This order was cancelled");
  if(o.approval?.status==="pending"&&a.action!=="cancel")return err("This order is waiting for approval from the account owner");
  const openDispute=(reason,detail)=>{o.dispute={status:"open",reason,detail:txt(detail,500),opened:now,by:who,msgs:[]};};
  let ev=a.action;
  switch(a.action){
    case "confirm":
      if(!is("supplier"))return err("Only the supplier confirms an order");
      if(o.stage!==0)return err("This order is already confirmed");
      set(1);break;
    case "dispatch":{
      if(!is("supplier"))return err("Only the supplier dispatches an order");
      if(o.stage>1)return err("This order is already dispatched");
      const {ok,s,errors}=normalizeShipment(a.shipment);if(!ok)return err(errors.join(". "));
      o.shipment={...s,at:now};set(2);break;}
    case "shipment":{
      if(!is("supplier"))return err("Only the supplier updates shipment details");
      if(o.stage<2||o.stage>3)return err("Shipment details can change only while the goods are on the way");
      const {ok,s,errors}=normalizeShipment(a.shipment);if(!ok)return err(errors.join(". "));
      o.shipment={...s,at:o.shipment?.at||now,edited:now};break;}
    case "transit":
      if(!is("supplier"))return err("Only the supplier updates delivery progress");
      if(o.stage!==2)return err("Mark it dispatched first");
      set(3);break;
    case "deliver":{
      if(!is("buyer"))return err("Only the buyer confirms what arrived");
      if(o.stage>=4)return err("Already marked as received");
      const c=RECEIPT_CONDITIONS[a.condition]?a.condition:"ok";
      o.receipt={condition:c,note:txt(a.note,300),at:now};set(4);
      if(c!=="ok"&&o.dispute?.status!=="open")openDispute(c,a.note);
      ev=c==="ok"?"deliver":"deliver_issue";break;}
    case "review":{
      if(!is("buyer"))return err("Only the buyer rates an order");
      if(o.stage<4)return err("Rate the supplier once the goods arrive");
      const {ok,r,errors}=normalizeReview(a);if(!ok)return err(errors.join(". "));
      o.review={...r,at:now};break;}
    case "dispute":
      if(!is("buyer"))return err("Only the buyer raises a problem");
      if(o.dispute?.status==="open")return err("There's already an open problem on this order");
      if(!ISSUE_REASONS[a.reason])return err("Pick what went wrong");
      openDispute(a.reason,a.detail);break;
    case "reply":{
      if(!o.dispute||o.dispute.status!=="open")return err("There's no open problem on this order");
      const t=txt(a.text,500);if(t.length<2)return err("Write a short message");
      o.dispute.msgs=(o.dispute.msgs||[]).concat({by:who,text:t,at:now}).slice(-30);break;}
    case "withdraw":
      if(!is("buyer"))return err("Only the buyer can withdraw a problem");
      if(o.dispute?.status!=="open")return err("There's no open problem on this order");
      Object.assign(o.dispute,{status:"resolved",resolution:"withdrawn",resolvedAt:now});break;
    case "resolve":
      if(who!=="team")return err("The VyaparBoss team closes problems");
      if(o.dispute?.status!=="open")return err("There's no open problem on this order");
      if(!RESOLUTIONS[a.resolution]||a.resolution==="withdrawn")return err("Pick how it was resolved");
      Object.assign(o.dispute,{status:"resolved",resolution:a.resolution,note:txt(a.note,300),resolvedAt:now});break;
    case "cancel":
      if(who==="buyer"&&o.stage>=2)return err("It's already dispatched. Raise a problem instead.");
      if(who==="supplier"&&o.stage!==0)return err("You can decline only before confirming. Talk to the VyaparBoss team.");
      if(o.stage>=4)return err("Delivered orders can't be cancelled");
      o.cancelled={by:who,reason:txt(a.reason,200),at:now};break;
    default:return err("Unknown action");
  }
  o.issue=o.dispute?.status==="open"?ISSUE_REASONS[o.dispute.reason]||"Problem reported":null;
  return {ok:true,ev};
}
/* A supplier's real record from delivered (non-sample) orders: on time = arrived by the promised date. */
function trackRecord(orders,sid){
  const mine=orders.filter(o=>o.sid===sid&&!o.sample&&!o.cancelled);
  const done=mine.filter(o=>o.stage===4&&o.history?.[4]);
  const onTime=done.filter(o=>o.history[4]<=promisedBy(o)+12*36e5).length;
  const rated=mine.filter(o=>o.review?.stars);
  return {orders:mine.length,delivered:done.length,onTime,pct:done.length?Math.round(onTime/done.length*100):null,
    rated:rated.length,ratingSum:rated.reduce((a,o)=>a+o.review.stars,0),avg:rated.length?+(rated.reduce((a,o)=>a+o.review.stars,0)/rated.length).toFixed(1):null,
    disputes:mine.filter(o=>o.dispute).length};
}
/* Writes the record onto a supplier: shown to buyers and used by ranking (blended with neutral defaults until there's enough history). */
function applyTrack(s,t){s.track={delivered:t.delivered,onTime:t.onTime,rated:t.rated,ratingSum:t.ratingSum,disputes:t.disputes};s.onTime=t.pct;s.rating=t.avg;s.orders=t.orders;return s;}

/* ===================== REPEAT BUYING AND BUDGETS ===================== */
/* A repeat order makes a fresh request on schedule, with fresh prices. It never places an order by itself. */
const REPEAT_EVERY={week:"Every week","2weeks":"Every 2 weeks",month:"Every month"};
function nextRun(from,every){
  const d=new Date(from);
  if(every==="week")d.setDate(d.getDate()+7);
  else if(every==="2weeks")d.setDate(d.getDate()+14);
  else{const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+1);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));}
  return d.getTime();
}
function normalizeSchedule(x,now=Date.now()){
  x=x||{};const errors=[];
  const s={productId:String(x.productId||""),qty:Math.round(Number(x.qty)),city:String(x.city||""),
    deadline:x.deadline==null||x.deadline===""||+x.deadline===0?null:Math.round(Number(x.deadline)),every:REPEAT_EVERY[x.every]?x.every:"",note:String(x.note??"").trim().slice(0,100)};
  if(!PMAP[s.productId])errors.push("Pick a product");
  if(!(s.qty>0))errors.push("Enter the quantity");
  if(!CITIES[s.city])errors.push("Pick the delivery city");
  if(s.deadline!=null&&!(s.deadline>=1&&s.deadline<=60))errors.push("Needed within must be 1–60 days");
  if(!s.every)errors.push("Pick how often");
  let start=x.start?Date.parse(String(x.start).slice(0,10)):NaN;
  if(x.start&&!isFinite(start))errors.push("Start date doesn't look right");
  if(!isFinite(start)||start<now-864e5)start=null;
  s.nextAt=start||nextRun(now,s.every||"month");
  return {ok:!errors.length,s,errors};
}
/* Spend this calendar month on real, live orders (not examples, cancelled or still awaiting approval). */
function monthSpend(orders,now=Date.now()){
  const d=new Date(now),m0=new Date(d.getFullYear(),d.getMonth(),1).getTime();
  return orders.filter(o=>!o.sample&&!o.cancelled&&o.date>=m0&&o.approval?.status!=="pending").reduce((a,o)=>a+(o.landed||0),0);
}
