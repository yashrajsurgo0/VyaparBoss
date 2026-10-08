/* VyaparBoss — Buyer Intelligence Agent: rule parser + Claude parser. Plain browser script (no build step); loaded in order by index.html. */
/* ===================== PARSING ===================== */
const HNUM={ek:1,do:2,teen:3,char:4,chaar:4,paanch:5,panch:5,chhe:6,saat:7,aath:8,nau:9,das:10,a:1,one:1,two:2,three:3,four:4,five:5,seven:7,ten:10};
const HWORD={ek:1,do:2,teen:3,char:4,chaar:4,paanch:5,panch:5,chhe:6,saat:7,aath:8,nau:9,das:10,bees:20,pachaas:50,sau:100,dedh:1.5,dhai:2.5,dhaai:2.5,adha:0.5};
const HMULT={sau:100,hazaar:1000,hazar:1000,hajar:1000,lakh:1e5,lac:1e5};
function ruleParse(text){
  let t=" "+text.toLowerCase().replace(/[–—]/g,"-")+" ";
  const out={product_id:null,quantity:null,unit:null,city:null,deadline_days:null};
  // product: longest keyword wins
  let best=0;for(const p of PRODUCTS)for(const k of p.keys){if(new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}([^a-z0-9]|$)`).test(t)&&k.length>best){best=k.length;out.product_id=p.id;}}
  // city
  for(const [a,c] of Object.entries(ALIASES)) if(new RegExp(`\\b${a}\\b`).test(t)) out.city=c;
  for(const c of Object.keys(CITIES)) if(new RegExp(`\\b${c.toLowerCase()}\\b`).test(t)) out.city=c;
  // deadline
  let m;
  if((m=t.match(/(\d+)\s*(din|dino|days?)\b/))){out.deadline_days=+m[1];t=t.replace(m[0]," ");}
  else if((m=t.match(/(\d+)\s*(weeks?|hafte|hafton|hafta)\b/))){out.deadline_days=7*+m[1];t=t.replace(m[0]," ");}
  else if((m=t.match(/\b(ek|do|teen|char|chaar|paanch|panch|saat|das|a|one|two|three|five|ten)\s*(din|days?|hafte|hafta|weeks?)\b/))){const n=HNUM[m[1]]||1;out.deadline_days=/hafte|hafta|week/.test(m[2])?7*n:n;t=t.replace(m[0]," ");}
  else if(/\b(kal|tomorrow)\b/.test(t))out.deadline_days=1;
  else if(/\bparso\b/.test(t))out.deadline_days=2;
  else if(/\bnext week\b/.test(t))out.deadline_days=7;
  // Hindi number words with a multiplier: "do hazaar" → 2000, "dedh lakh" → 150000, "paanch sau" → 500
  t=t.replace(new RegExp(`\\b(\\d+(?:\\.\\d+)?|${Object.keys(HWORD).join("|")})\\s*(sau|hazaar|hazar|hajar|lakh|lac)\\b`,"g"),(m,a,b)=>" "+String(Math.round((HWORD[a]??+a)*HMULT[b]))+" ");
  // mask spec numbers
  t=t.replace(/\d+\s*-?\s*(ply|mm|micron|lph|gsm|inch|in\b|m\b)/g," ").replace(/\d+:\d+:\d+/g," ").replace(/\d+\s*x\s*\d+/g," ");
  // quantity
  const qr=/(\d[\d,]*(?:\.\d+)?)\s*(k(?![a-z])|lakh|hazaar|hazar|thousand)?\s*(kgs?|kilos?|tonnes?|tons?|mt|t\b|pcs|pieces?|nos|units?|boxes|box|rolls?|bags?|crates?|cartons?|dabbe|dabba|spools?)?/g;
  while((m=qr.exec(t))){
    let n=parseFloat(m[1].replace(/,/g,""));if(!isFinite(n)||n===0)continue;
    if(m[2]==="k"||m[2]==="hazaar"||m[2]==="hazar"||m[2]==="thousand")n*=1000;if(m[2]==="lakh")n*=1e5;
    out.quantity=n;out.unit=m[3]||null;break;
  }
  return out;
}
function normUnit(u){if(!u)return null;u=u.toLowerCase();if(/^(kgs?|kilos?|kilograms?)$/.test(u))return"kg";if(/^(tonnes?|tons?|mt|t)$/.test(u))return"tonne";if(/^bags?$/.test(u))return"bag";if(/^spools?$/.test(u))return"spool";return"count";}
function applyParsed(p,base){
  const r={...(base||{})};const notes=[];
  if(p.product_id&&PMAP[p.product_id])r.productId=p.product_id;
  if(p.city&&CITIES[p.city])r.city=p.city;
  if(p.deadline_days)r.deadline=Math.round(p.deadline_days);
  if(p.quantity){
    let q=+p.quantity;const u=normUnit(p.unit);const prod=PMAP[r.productId];
    if(prod){
      if(u==="tonne"){q*=1000;if(prod.unit!=="kg"){q=Math.round(q/prod.kgPer);notes.push(`Converted ${qfmt(p.quantity)} t to about ${qfmt(q)} ${prod.unit} at ${prod.kgPer} kg each`);}}
      else if(u==="kg"&&prod.unit!=="kg"){q=Math.round(q/prod.kgPer);notes.push(`Converted ${qfmt(p.quantity)} kg to about ${qfmt(q)} ${prod.unit} at ${prod.kgPer} kg each`);}
      else if(u==="bag"&&prod.id==="npk"){q*=25;notes.push(`${qfmt(p.quantity)} bags × 25 kg = ${qfmt(q)} kg`);}
      else if(u==="spool"&&prod.id==="migwire"){q*=15;notes.push(`${qfmt(p.quantity)} spools × 15 kg = ${qfmt(q)} kg`);}
    } else if(u==="tonne") q*=1000;
    r.qty=Math.round(q);
  }
  if(p.notes)r.notes=p.notes;
  return {r,notes};
}
function missing(r){const m=[];if(!r?.productId)m.push("product");if(!r?.qty)m.push("quantity");if(!r?.city)m.push("city");return m;}

/* Prompts are shared by the browser (claude.ai artifact runtime) and the server (Anthropic API). */
function buildParsePrompt(text,partial){
  const catalog=PRODUCTS.map(p=>`${p.id}: ${p.name} (${p.spec}; sold per ${p.unit}${p.unit!=="kg"?`, ~${p.kgPer} kg each`:""})`).join("\n");
  return `You are Bhai, the friendly buying assistant of VyaparBoss, an Indian B2B procurement platform for small businesses. You talk like a helpful elder brother at a trusted wholesale shop: warm, short, practical. Read the buyer's message (English, Hindi or Hinglish) and extract a structured purchase requirement.

Catalog product ids (use only these):
${catalog}

Delivery cities we serve (use exact spelling): ${Object.keys(CITIES).join(", ")}

Requirement collected so far (merge with it; the new message overrides): ${JSON.stringify(partial?{product_id:partial.productId||null,quantity:partial.qty||null,city:partial.city||null,deadline_days:partial.deadline||null}:{})}

Buyer message: """${String(text).slice(0,2000)}"""

Reply with only this JSON object:
{"product_id": string|null, "quantity": number|null, "unit": string|null, "city": string|null, "deadline_days": number|null, "notes": string, "reply": string}
Rules: quantity is the number the buyer said and unit is the unit they used (kg, tonne, pcs, rolls, bags...). Keep the earlier values when the new message doesn't change them. deadline_days is days from today (a week = 7, kal = 1). If the city isn't in the list, use the nearest listed city and say so in notes. If no catalog product fits, product_id is null. notes: one short line of any spec details the buyer mentioned. reply: one short friendly sentence to the buyer, in the same language style they wrote in, that only restates what you understood or asks for what's missing (product, quantity or delivery city). Never promise availability, price, delivery time or that we "can arrange" anything: suppliers have not quoted yet.`;
}
function buildReplyPrompt(r,s,mine){
  const p=PMAP[r.productId];
  return `Write a short WhatsApp reply (3-4 sentences, Hinglish, polite and businesslike, no emojis) from Indian supplier "${s.name}" (${s.city}) answering a buyer RFQ on the VyaparBoss platform. RFQ: ${qfmt(r.qty)} ${p.unit} of ${p.name} (${p.spec}) delivered to ${r.city}${r.deadline?` within ${r.deadline} days`:""}. Our price: ${inr(mine.unit,2)} per ${unitOne(p.unit)} plus GST ${p.gst}%. Delivery in ${mine.eta} days. Payment terms: ${s.terms}. Certifications: ${(s.certs||[]).join(", ")||"none listed"}. Only use these facts; do not invent discounts or stock levels. Reply with only the message text.`;
}
/* Validate whatever the model returned before it touches the engine. */
function cleanParsed(x){
  if(!x||typeof x!=="object")return null;
  const num=v=>{const n=Number(v);return isFinite(n)&&n>0?n:null;};
  return {product_id:PMAP[x.product_id]?x.product_id:null,quantity:num(x.quantity),unit:typeof x.unit==="string"?x.unit:null,
    city:CITIES[x.city]?x.city:null,deadline_days:num(x.deadline_days),notes:typeof x.notes==="string"?x.notes.slice(0,200):"",reply:typeof x.reply==="string"?x.reply.slice(0,400):null};
}
