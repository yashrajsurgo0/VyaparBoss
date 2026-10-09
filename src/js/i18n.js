/* VyaparBoss regions and languages. One app, three settings:
     in_hi  India · Hinglish  (the original voice)
     in_en  India · English
     gl_en  Global · English  (buyers anywhere sourcing from Indian suppliers)
   The logo, the name VyaparBoss and Bhai stay the same everywhere. Browser-only; loaded after repo.js, before app.js. */
const LOCALES={
  in_hi:{id:"in_hi",region:"in",lang:"hi",label:"India · Hinglish",short:"IN",htmlLang:"en-IN"},
  in_en:{id:"in_en",region:"in",lang:"en",label:"India · English",short:"IN",htmlLang:"en-IN"},
  gl_en:{id:"gl_en",region:"global",lang:"en",label:"Global · English",short:"GL",htmlLang:"en"}
};
const STR={
  hi:{
    tagline:"Vyapar bada, jhanjhat chhota!",
    bhaiTag:"Tu business badha, jugaad mera!",
    hello:"Namaste! Main Bhai hoon.",
    heroH1:"Bolo kya chahiye.",
    heroLede:"Tell me what your business needs to buy. I'll find verified suppliers and show you the full price, delivered to your door.",
    askPh:"e.g. 5000 corrugated boxes, Pune, 7 din",
    try:["5000 corrugated boxes, Pune, 7 din","2 tonne NPK 19:19:19 Indore","300 boxes nitrile gloves Chennai"],
    how1:"Type it the way you'd say it, in English, Hindi or Hinglish.",
    joinQ:"Supplier ho?",
    "ask.product":"Kya kharidna hai? Pick a category, or just type it in your own words.",
    "ask.qty":"{{name}}. Kitna chahiye?",
    "ask.city":"Delivery kahan chahiye?",
    "ask.deadline":"Kab tak chahiye?",
    notUnderstood:`Maaf kijiye, samjha nahi. Try something like "5000 boxes Pune 7 din", or pick from the options.`,
    pickN:"Mil gaye {{n}} options! My pick:", pick1:"Mila 1 option:",
    lateN:"Mil gaye {{n}} options", late1:"Mila 1 option",
    want:"{{name}} chahiye",
    confirmQ:"Pakka? Check the order once, then approve.",
    placed:"Ho gaya! Purchase order {{po}} is with {{name}}. I'll keep an eye on it.",
    negOk:"Baat ho gayi! {{n}} supplier{{s}} agreed to {{price}}. Updated prices below.",
    negNo:"Itna kam nahi hua. I got everyone's best counter-offer; prices below are updated.",
    catPicked:"{{cat}}, achha. Which one?",
    askBetter:"Bhai, thoda kam karwao? Ask for a better price",
    reorder:"Haan ji, same order again. I'll get fresh prices, since rates change. Kab tak chahiye?",
    basicMode:"Basic mode: understands common Hinglish and English requests without AI.",
    thanks:"Shukriya! You're on the list.",
    helloName:"Namaste, {{name}}!",
    supplierReply:"Namaste ji, {{s}} se. {{qty}} {{unit}} {{product}} ({{spec}}) ke liye hamara rate {{rate}} per {{one}} + GST {{gst}}% hai. {{city}} delivery {{eta}} din mein ho jayegi. Payment: {{terms}}. Confirm karein to order dispatch plan bhej dete hain."
  },
  en:{
    tagline:"Bigger business. Smaller hassle.",
    bhaiTag:"You grow the business. I'll handle the buying.",
    hello:"Hi, I'm Bhai.",
    heroH1:"What do you need?",
    heroLede:"Tell me what your business needs to buy. I'll find verified suppliers and show you the full price, delivered to your door.",
    askPh:"e.g. 5000 corrugated boxes to Pune in 7 days",
    try:["5000 corrugated boxes to Pune in 7 days","2 tonnes NPK 19:19:19 to Indore","300 boxes of nitrile gloves to Chennai"],
    how1:"Type it the way you'd say it, in plain words.",
    joinQ:"Are you a supplier?",
    "ask.product":"What are you buying? Pick a category, or just type it in your own words.",
    "ask.qty":"{{name}}. How much do you need?",
    "ask.city":"Where should it be delivered?",
    "ask.deadline":"When do you need it?",
    notUnderstood:`Sorry, I didn't get that. Try something like "5000 boxes to Pune in 7 days", or pick from the options.`,
    pickN:"Found {{n}} options. My pick:", pick1:"Found 1 option:",
    lateN:"Found {{n}} options", late1:"Found 1 option",
    want:"I'll go with {{name}}",
    confirmQ:"Ready? Check the order once, then approve.",
    placed:"Done! Purchase order {{po}} is with {{name}}. I'll keep an eye on it.",
    negOk:"Good news: {{n}} supplier{{s}} agreed to {{price}}. Updated prices below.",
    negNo:"They couldn't go that low. I got everyone's best counter-offer; prices below are updated.",
    catPicked:"{{cat}}. Which one?",
    askBetter:"Ask for a better price",
    reorder:"Same order again. I'll get fresh prices, since rates change. When do you need it?",
    basicMode:"Basic mode: understands common requests without AI.",
    thanks:"Thank you! You're on the list.",
    helloName:"Hello, {{name}}!",
    supplierReply:"Hello, this is {{s}}. For {{qty}} {{unit}} of {{product}} ({{spec}}), our rate is {{rate}} per {{one}} + GST {{gst}}%. Delivery to {{city}} in {{eta}} days. Payment: {{terms}}. Please confirm and we'll send the dispatch plan."
  },
  /* Global · English: only what differs from English. */
  gl:{
    heroH1:"What do you need from India?",
    heroLede:"Tell me what your business needs. I'll find verified Indian suppliers and show you the full price (rate, GST and freight) delivered to a city or port in India.",
    askPh:"e.g. 5000 export cartons to Nhava Sheva in 7 days",
    try:["5000 export cartons to Nhava Sheva in 7 days","50 ISPM-15 pallets to Mundra","300 boxes of nitrile gloves to Chennai"],
    joinQ:"Are you an Indian supplier?",
    "ask.city":"Deliver to which city or port in India?",
    globalNote:"Prices are in Indian rupees (₹), delivered to a city or port in India, with GST. Dollar figures are indicative at ₹{{rate}} = US$1 ({{asOf}}); you pay in rupees. Export freight and customs aren't included yet.",
    buyerLede:"Tell Bhai what you need from India. Compare verified Indian suppliers on the full delivered price. Nothing is ordered until you approve."
  }
};
/* Indicative only. Update with the day's rate when it moves a lot (source: RBI reference rate or any market quote). */
const USD_RATE={inrPerUsd:96.5,asOf:"9 Oct 2026"};
/* "≈ US$879" in Global mode, empty elsewhere. */
const usd=n=>isGlobal()?`≈ US$${Math.round(n/USD_RATE.inrPerUsd).toLocaleString("en-US")}`:"";
const TOP_CITIES_GLOBAL=["Nhava Sheva","Mundra","Chennai","Tuticorin","Kolkata","Kochi","Visakhapatnam","Delhi"];
const LOCALE_KEY="vyaparboss.v1.locale";

/* First visit: ?region=global|india&lang=en|hinglish wins, then the saved choice, then a guess from the time zone. */
function detectLocale(){
  try{
    const q=new URLSearchParams(location.search);const r=q.get("region"),l=q.get("lang");
    if(r||l){const id=r==="global"?"gl_en":l==="en"?"in_en":"in_hi";return id;}
  }catch(e){}
  try{const s=localStorage.getItem(LOCALE_KEY);if(s&&LOCALES[s])return s;}catch(e){}
  try{const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||"";if(tz&&!/^Asia\/(Kolkata|Calcutta)$/.test(tz))return "gl_en";}catch(e){}
  return "in_hi";
}
let LOCALE=LOCALES[detectLocale()];
/* Appearance: beige (light) is the house look for everyone; dark only when someone picks it.
   Uses data-look, not data-theme or prefers-color-scheme, so neither the device's dark mode
   nor a host page (e.g. claude.ai) can switch the site to dark. */
const THEME_KEY="vyaparboss.v1.theme";
let THEME=(()=>{try{return localStorage.getItem(THEME_KEY)==="dark"?"dark":"light";}catch(e){return "light";}})();
function applyTheme(){
  try{document.documentElement.dataset.look=THEME;const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=THEME==="dark"?"#1C140E":"#F1E4CC";}catch(e){}
}
function setTheme(v){THEME=v==="dark"?"dark":"light";try{localStorage.setItem(THEME_KEY,THEME);}catch(e){}applyTheme();renderRegionPicker();}
applyTheme();
const isGlobal=()=>LOCALE.region==="global";
/* t("key",{vars}) → text for the current region and language. Arrays come back as-is. */
function t(k,v={}){
  const s=(isGlobal()?STR.gl[k]:undefined)??STR[LOCALE.lang][k]??STR.en[k];
  if(s==null)return k;
  return Array.isArray(s)?s:fillTemplate(s,v);
}
const topCities=()=>isGlobal()?TOP_CITIES_GLOBAL:TOP_CITIES;

/* Static text in index.html carries data-i18n (text) or data-i18n-ph (placeholder). */
function applyStatic(){
  try{document.documentElement.lang=LOCALE.htmlLang;}catch(e){}
  document.querySelectorAll("[data-i18n]").forEach(el=>{el.textContent=t(el.dataset.i18n);});
  document.querySelectorAll("[data-i18n-ph]").forEach(el=>{el.placeholder=t(el.dataset.i18nPh);});
  const md=document.querySelector('meta[name="description"]');
  if(md)md.content=`${t("tagline")} Tell Bhai what your business needs; he finds verified suppliers and shows the full delivered price.`;
  renderRegionPicker();
}
function renderRegionPicker(){
  const el=document.getElementById("regionPick");if(!el)return;
  el.innerHTML=`<summary aria-label="Region and language: ${esc(LOCALE.label)}">${ico("i-globe","")}<span class="rp-long">${esc(LOCALE.label)}</span><span class="rp-short">${LOCALE.short}</span></summary>
    <div class="rp-menu" role="menu">
      <p class="rp-h">India</p>
      ${["in_hi","in_en"].map(id=>`<button role="menuitemradio" aria-checked="${LOCALE.id===id}" data-action="locale" data-v="${id}">${LOCALES[id].lang==="hi"?"Hinglish":"English"}</button>`).join("")}
      <p class="rp-h">Global</p>
      <button role="menuitemradio" aria-checked="${LOCALE.id==="gl_en"}" data-action="locale" data-v="gl_en">English</button>
      <p class="rp-note">Suppliers are in India. Global shows everything in plain English.</p>
      <p class="rp-h">Look</p>
      <button role="menuitemradio" aria-checked="${THEME==="light"}" data-action="theme" data-v="light">Beige</button>
      <button role="menuitemradio" aria-checked="${THEME==="dark"}" data-action="theme" data-v="dark">Dark</button>
    </div>`;
}
function setLocale(id){
  if(!LOCALES[id]||id===LOCALE.id)return;
  LOCALE=LOCALES[id];
  try{localStorage.setItem(LOCALE_KEY,id);}catch(e){}
  applyStatic();
  const d=document.getElementById("regionPick");if(d)d.open=false;
  if(typeof onLocaleChange==="function")onLocaleChange();
}
document.addEventListener("click",e=>{const d=document.getElementById("regionPick");if(d&&d.open&&!d.contains(e.target))d.open=false;});
