/* VyaparBoss — supplier discovery, freight, GST and landed-cost ranking. Plain browser script (no build step); loaded in order by index.html. */
/* ===================== STATE ===================== */
const KEY="vyaparboss.v1";
let store={orders:[],rfqs:[],seq:{po:0,rfq:0}};
function load(){try{const s=JSON.parse(localStorage.getItem(KEY)||"null");if(s&&s.orders)store=s;else seedSamples();}catch(e){seedSamples();}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(store));}catch(e){}}
let rfq=null;          // the working requirement
let thread=[];         // chat messages
let neg={};            // negotiated prices by supplier id for current rfq
let selected=null;     // selected supplier id
let ai=null;           // sample function or null
let aiState="pending"; // pending | live | off

/* ===================== ENGINE ===================== */
function tierPrice(o,q){let p=null;for(const [t,pr] of o.tiers) if(q>=t) p=pr;return p;}
function freightCost(w,d){const ptl=Math.max(1200,w*(2.5+0.006*d));if(w<1000)return{cost:ptl,mode:"Part load"};const trucks=Math.ceil(w/9000);const ftl=trucks*(9000+38*d);return ftl<ptl?{cost:ftl,mode:`${trucks} × 9 t truck`}:{cost:ptl,mode:"Part load"};}
function quoteFor(s,r){
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
function discover(r){
  const eligible=[],excluded=[];
  for(const s of SUPPLIERS){
    const o=s.offers.find(x=>x.p===r.productId);if(!o)continue;
    const d=km(s.city,r.city);const moq=o.tiers[0][0];
    if(r.qty<moq){excluded.push({s,why:`Minimum order is ${qfmt(moq)} ${PMAP[r.productId].unit}`});continue;}
    if(r.qty>o.cap){excluded.push({s,why:`Capacity ${qfmt(o.cap)} ${PMAP[r.productId].unit} per order`});continue;}
    if(d>s.coverage){excluded.push({s,why:`Doesn't deliver to ${r.city} (${qfmt(d)} km; serves up to ${qfmt(s.coverage)} km)`});continue;}
    eligible.push(quoteFor(s,r));
  }
  if(eligible.length){
    const min=Math.min(...eligible.map(q=>q.landed));
    for(const q of eligible) q.score=0.6*(min/q.landed)+0.25*(q.s.onTime/100)+0.15*(q.s.rating/5);
    eligible.sort((a,b)=>(b.meets-a.meets)||(b.score-a.score));
  }
  return {eligible,excluded,offering:eligible.length+excluded.length};
}
