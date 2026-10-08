/* VyaparBoss — supplier discovery, freight, GST, landed-cost ranking, negotiation and record builders.
   Pure logic, no DOM: loaded by the browser (index.html) and by the server/tests (server/core.js). */

/* ===================== PRICING ===================== */
function tierPrice(o,q){let p=null;for(const [t,pr] of o.tiers) if(q>=t) p=pr;return p;}
function freightCost(w,d){const ptl=Math.max(1200,w*(2.5+0.006*d));if(w<1000)return{cost:ptl,mode:"Part load"};const trucks=Math.ceil(w/9000);const ftl=trucks*(9000+38*d);return ftl<ptl?{cost:ftl,mode:`${trucks} × 9 t truck`}:{cost:ptl,mode:"Part load"};}
// Suppliers without a track record yet are ranked on these neutral defaults.
const NEW_SUPPLIER={onTime:85,rating:4.0};
const onTimeOf=s=>s.onTime??NEW_SUPPLIER.onTime, ratingOf=s=>s.rating??NEW_SUPPLIER.rating;

function quoteFor(s,r,neg={}){
  const o=s.offers.find(x=>x.p===r.productId);const p=PMAP[r.productId];
  const d=km(s.city,r.city);
  const list=tierPrice(o,r.qty);
  const unit=neg[s.id]?.price ?? list;
  const subtotal=unit*r.qty;
  const gst=subtotal*p.gst/100;
  const w=r.qty*p.kgPer;const f=freightCost(w,d);
  const landed=subtotal+gst+f.cost;
  const transit=Math.max(1,Math.ceil(d/450));
  const eta=s.lead+transit;
  const intra=CITIES[s.city][2]===CITIES[r.city][2];
  return {s,o,d,list,unit,subtotal,gst,gstRate:p.gst,gstType:intra?"CGST + SGST":"IGST",weight:w,freight:f.cost,freightMode:f.mode,landed,per:landed/r.qty,transit,eta,meets:!r.deadline||eta<=r.deadline};
}
function discover(r,neg={}){
  const eligible=[],excluded=[];
  for(const s of SUPPLIERS){
    const o=s.offers.find(x=>x.p===r.productId);if(!o||!CITIES[s.city])continue;
    const d=km(s.city,r.city);const moq=o.tiers[0][0];
    if(r.qty<moq){excluded.push({s,why:`Minimum order is ${qfmt(moq)} ${PMAP[r.productId].unit}`});continue;}
    if(r.qty>o.cap){excluded.push({s,why:`Capacity ${qfmt(o.cap)} ${PMAP[r.productId].unit} per order`});continue;}
    if(d>s.coverage){excluded.push({s,why:`Doesn't deliver to ${r.city} (${qfmt(d)} km; serves up to ${qfmt(s.coverage)} km)`});continue;}
    eligible.push(quoteFor(s,r,neg));
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
const quoteSummary=res=>res.eligible.map(q=>({sid:q.s.id,unit:q.unit,landed:Math.round(q.landed),eta:q.eta,meets:q.meets}));
function rfqRecord(r,res,extra={}){
  return {id:null,date:Date.now(),productId:r.productId,qty:r.qty,city:r.city,deadline:r.deadline||null,quotes:quoteSummary(res),status:"open",wonBy:null,source:"web",...extra};
}
function orderRecord(r,res,q,extra={}){
  const avg=res.eligible.reduce((a,x)=>a+x.landed,0)/res.eligible.length;const now=Date.now();
  return {po:null,date:now,productId:r.productId,qty:r.qty,city:r.city,sid:q.s.id,sname:q.s.name,scity:q.s.city,unit:q.unit,list:q.list,
    subtotal:Math.round(q.subtotal),gst:Math.round(q.gst),freight:Math.round(q.freight),landed:Math.round(q.landed),avg:Math.round(avg),
    eta:q.eta,deadline:r.deadline||null,stage:0,history:[now],issue:null,rfqId:r.id||null,...extra};
}
/* Three example orders so Orders, Supplier desk and Metrics aren't empty on first open. */
function buildSampleData(){
  const data={orders:[],rfqs:[],seq:{po:0,rfq:0}};
  const mk=(productId,qty,city,deadline,daysAgo,stage)=>{
    const r={productId,qty,city,deadline};const res=discover(r);const q=res.eligible.find(x=>x.meets);if(!q)return;
    const t=Date.now()-daysAgo*864e5;
    const rid=rfqIdFor(++data.seq.rfq);
    data.rfqs.push(rfqRecord(r,res,{id:rid,date:t,status:"ordered",wonBy:q.s.id,sample:true}));
    data.orders.push(orderRecord({...r,id:rid},res,q,{po:poIdFor(++data.seq.po),date:t,stage,history:Array.from({length:stage+1},(_,i)=>t+i*864e5),sample:true}));
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
  const lines=top.map((q,i)=>`${i+1}. ${q.s.name} (${q.s.city}): ${inr(q.landed)} landed, ${inr(q.per,2)}/${unitOne(p.unit)}, ${q.eta} din${q.meets?"":" (deadline miss)"}`);
  return `${r.id?`${r.id}\n`:""}${qfmt(r.qty)} ${p.unit} ${p.name} → ${r.city}${r.deadline?`, ${r.deadline} din mein`:""}\n\n${lines.join("\n")}\n\nTotal landed = rate + GST + freight. Order karne ke liye reply karein "APPROVE 1" (ya 2/3).`;
}
