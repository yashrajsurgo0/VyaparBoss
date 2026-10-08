/* VyaparBoss — formatting and geo helpers. Plain browser script (no build step); loaded in order by index.html. */
/* ===================== UTIL ===================== */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const inr=(n,d=0)=>"₹"+Number(n).toLocaleString("en-IN",{minimumFractionDigits:d,maximumFractionDigits:d});
const qfmt=n=>Number(n).toLocaleString("en-IN");
const lakh=n=>n>=1e7?"₹"+(n/1e7).toFixed(2)+" Cr":n>=1e5?"₹"+(n/1e5).toFixed(2)+" L":inr(n);
const today=()=>new Date();
const dstr=d=>new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
function km(a,b){const [la1,lo1]=CITIES[a],[la2,lo2]=CITIES[b];const R=6371,r=Math.PI/180;const dl=(la2-la1)*r,dn=(lo2-lo1)*r;const h=Math.sin(dl/2)**2+Math.cos(la1*r)*Math.cos(la2*r)*Math.sin(dn/2)**2;const d=2*R*Math.asin(Math.sqrt(h))*1.3;return Math.max(25,Math.round(d));}
function fy(){const d=today();const y=d.getMonth()>=3?d.getFullYear():d.getFullYear()-1;return `${y}-${String((y+1)%100).padStart(2,"0")}`;}
function toast(t){const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>el.hidden=true,2600);}
