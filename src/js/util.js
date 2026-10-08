/* VyaparBoss — formatting, geo and validation helpers. Plain browser script (no build step); loaded in order by index.html. */
/* ===================== UTIL ===================== */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const inr=(n,d=0)=>"₹"+Number(n).toLocaleString("en-IN",{minimumFractionDigits:d,maximumFractionDigits:d});
const qfmt=n=>Number(n).toLocaleString("en-IN");
const lakh=n=>n>=1e7?"₹"+(n/1e7).toFixed(2)+" Cr":n>=1e5?"₹"+(n/1e5).toFixed(2)+" L":inr(n);
const today=()=>new Date();
const dstr=d=>new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
const unitOne=u=>u.replace(/s$/,"");
function km(a,b){const [la1,lo1]=CITIES[a],[la2,lo2]=CITIES[b];const R=6371,r=Math.PI/180;const dl=(la2-la1)*r,dn=(lo2-lo1)*r;const h=Math.sin(dl/2)**2+Math.cos(la1*r)*Math.cos(la2*r)*Math.sin(dn/2)**2;const d=2*R*Math.asin(Math.sqrt(h))*1.3;return Math.max(25,Math.round(d));}
function fy(d=today()){d=new Date(d);const y=d.getMonth()>=3?d.getFullYear():d.getFullYear()-1;return `${y}-${String((y+1)%100).padStart(2,"0")}`;}
function rfqIdFor(n){const f=fy();return `RFQ-${f.slice(2,4)}${f.slice(5)}-${String(n).padStart(4,"0")}`;}
function poIdFor(n){return `VB/PO/${fy()}/${String(n).padStart(4,"0")}`;}
function toast(t){const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>el.hidden=true,2600);}

/* GSTIN: 2-digit state code + PAN (5 letters, 4 digits, 1 letter) + entity code + "Z" + check character (base-36 mod checksum). */
const GST_STATES={"01":"JK","02":"HP","03":"PB","04":"CH","05":"UK","06":"HR","07":"DL","08":"RJ","09":"UP","10":"BR","18":"AS","19":"WB","20":"JH","21":"OD","22":"CG","23":"MP","24":"GJ","27":"MH","29":"KA","30":"GA","32":"KL","33":"TN","34":"PY","36":"TS","37":"AP"};
function gstinCheckChar(first14){
  const cs="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";let sum=0;
  for(let i=0;i<14;i++){const v=cs.indexOf(first14[i])*(i%2?2:1);sum+=Math.floor(v/36)+(v%36);}
  return cs[(36-(sum%36))%36];
}
function checkGstin(g,city){
  g=String(g||"").trim().toUpperCase();
  if(!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g))return{ok:false,why:"GSTIN must be 15 characters: state code, PAN, entity code, Z, check character"};
  if(gstinCheckChar(g.slice(0,14))!==g[14])return{ok:false,why:"Check character doesn't match. Re-check the GSTIN for a typo"};
  const st=GST_STATES[g.slice(0,2)];
  if(city&&CITIES[city]&&st&&st!==CITIES[city][2])return{ok:true,warn:`GSTIN is registered in ${st}, but the supplier city is in ${CITIES[city][2]}`};
  return{ok:true};
}
/* "500:17.9, 2000:16.2" → [[500,17.9],[2000,16.2]] (sorted, validated) */
function parseTiers(str){
  const tiers=String(str||"").split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean).map(x=>{const m=x.match(/^([\d,]+)\s*[:@=]\s*₹?\s*([\d.]+)$/);return m?[+m[1].replace(/,/g,""),+m[2]]:null;});
  if(!tiers.length||tiers.some(t=>!t||!(t[0]>0)||!(t[1]>0)))return null;
  tiers.sort((a,b)=>a[0]-b[0]);
  for(let i=1;i<tiers.length;i++)if(tiers[i][0]===tiers[i-1][0]||tiers[i][1]>tiers[i-1][1])return null;
  return tiers;
}
const tiersText=t=>t.map(([q,p])=>`${q}:${p}`).join(", ");
