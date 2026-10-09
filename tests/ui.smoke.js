// UI flow check without a browser: runs the real page scripts against a tiny fake DOM.
// Usage: node tests/ui.smoke.js [http://localhost:5173]   (no URL = static/local mode)
const fs=require("fs"),path=require("path"),vm=require("vm");
const ROOT=path.join(__dirname,".."),BASE=process.argv[2]||null;
const els={};
function el(id){return els[id]||(els[id]={id,value:"",innerHTML:"",textContent:"",hidden:id.startsWith("v-")&&id!=="v-buy"||id==="s-desk",disabled:false,checked:false,className:"",dataset:{},options:[],
  attrs:{},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},getAttribute(k){return this.attrs[k]},toggleAttribute(){},addEventListener(){},focus(){},select(){},scrollIntoView(){},
  querySelector(){return el(id+"-child")},querySelectorAll(){return []},closest(){return null},matches(){return false},classList:{add(){},remove(){}}});}
const bodyClasses=new Set();
const documentStub={querySelector:s=>el(s.replace(/^#/,"")),querySelectorAll:()=>[],getElementById:id=>el(id),addEventListener(){},hidden:false,activeElement:null,
  body:{classList:{add:c=>bodyClasses.add(c),remove:c=>bodyClasses.delete(c),contains:c=>bodyClasses.has(c),toggle:(c,on)=>on?bodyClasses.add(c):bodyClasses.delete(c)},appendChild(){}}};
const loc={protocol:BASE?"http:":"file:",hash:"",pathname:"/",search:"",origin:BASE||"null"};
const ls={"vyaparboss.v1.locale":"in_hi"},errors=[];
const ctx=vm.createContext({console:{log(){},warn(){},error:(...a)=>errors.push(a.join(" "))},document:documentStub,localStorage:{getItem:k=>ls[k]??null,setItem:(k,v)=>ls[k]=String(v)},
  location:loc,URLSearchParams,history:{replaceState(){loc.hash="";}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},addEventListener(){},fetch:(u,o)=>fetch(new URL(u,BASE+"/"),o),AbortController,setTimeout,clearTimeout,setInterval:()=>0,requestAnimationFrame:f=>f(),
  matchMedia:()=>({matches:false}),scrollTo(){},navigator:{},Date,Math,Intl,JSON,URL,Promise});
ctx.window=ctx;
const src=["data","util","engine","parser","repo","i18n","app","grow"].map(f=>fs.readFileSync(path.join(ROOT,"src/js",f+".js"),"utf8")).join("\n;\n");
vm.runInContext(src+"\nthis.__t={say:sayToBhai,Repo,get flow(){return flow},ACTIONS,renderAll,route,loc:location,get pub(){return pub},submitJoin,showInsightsView,showSupplierView,setLocale,get LOCALE(){return LOCALE}};",ctx);
const T=ctx.__t,wait=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;const check=(c,m)=>{console.log((c?"ok - ":"FAIL - ")+m);if(!c)fails++;};
const act=(name,ds={})=>T.ACTIONS[name]({dataset:ds,disabled:false,textContent:"",classList:{add(){},remove(){}},isConnected:true});
const buy=()=>els["v-buy"].innerHTML;
(async()=>{
  await wait(400);
  check(T.Repo.mode===(BASE?"server":"local"),"storage mode: "+T.Repo.mode);
  check(buy().includes("Bolo kya chahiye")&&buy().includes("Ask Bhai"),"start screen: one question, Ask Bhai");
  check(!buy().includes("Bhai's pick"),"start screen shows no quotes yet");

  // Path 1: type everything at once
  await T.say("Bhai 5000 3-ply boxes chahiye Ahmedabad mein, ek hafte mein");
  check(T.flow.stage==="quotes","typed request goes straight to quotes");
  check(/^RFQ-/.test(T.flow.r.id||""),"request recorded "+T.flow.r.id);
  check(buy().includes("Bhai's pick")&&buy().includes("Other options"),"best pick first, others below");
  check(buy().includes("See how")&&buy().includes("Compare all"),"details hidden behind expanders");
  act("show-neg");el("negTarget").value="14";act("negotiate");
  check(T.flow.negLast&&T.flow.negLast.length>0,"negotiation ran");
  const sid=T.flow.r&&buy().match(/data-action="choose" data-sid="([^"]+)"/)[1];
  act("choose",{sid});check(T.flow.stage==="confirm"&&buy().includes("Place order"),"choose leads to confirm");
  const before=T.Repo.data.orders.length;
  T.ACTIONS.approve({dataset:{},disabled:false});await wait(100);
  check(T.Repo.data.orders.length===before,"no order without the approval tick");
  el("okBox").checked=true;T.ACTIONS.approve({dataset:{},disabled:false});await wait(300);
  check(T.flow.stage==="done"&&T.Repo.data.orders.length===before+1,"order placed after approval: "+T.flow.po);
  check(buy().includes("Order placed")&&buy().includes("Track order"),"success screen");

  // Path 2: tap through, one question at a time
  act("new-req");check(T.flow.stage==="start","new request returns to start");
  act("cat",{cat:"agri"});check(buy().includes("Which agri inputs item?")&&!buy().includes("How many"),"category → only product choices shown");
  act("pick",{p:"drip"});check(buy().includes("How many rolls?")&&!buy().includes("Deliver to which city"),"product → only quantity asked");
  act("qty",{v:"40"});check(buy().includes("Deliver to which city?")&&!buy().includes("When do you need"),"quantity → only city asked");
  act("city",{v:"Pune"});check(buy().includes("When do you need it?"),"city → only date asked");
  act("deadline",{v:"7"});await wait(200);check(T.flow.stage==="quotes"&&T.flow.r.deadline===7,"date → quotes");
  const id1=T.flow.r.id;
  act("edit",{f:"qty"});check(T.flow.stage==="ask"&&buy().includes("How many rolls?"),"editing a field reopens just that question");
  act("qty",{v:"60"});await wait(200);check(T.flow.stage==="quotes"&&T.flow.r.qty===60&&T.flow.r.id===id1,"edit re-quotes the same request");
  await T.say("deliver to Jalgaon instead");await wait(100);
  check(T.flow.r.city==="Jalgaon"&&T.flow.stage==="quotes","follow-up message changes the city");
  await T.say("asdfgh");check(T.flow.msgs.at(-1).text.includes("samjha nahi"),"nonsense gets a friendly retry hint");

  // Other screens
  T.renderAll();
  check(els["v-orders"].innerHTML.includes("Orders")&&els["v-orders"].innerHTML.includes("Details"),"orders render");
  check(els.sgrid.innerHTML.includes("Shreeji")&&els.sgrid.innerHTML.includes("Rates and terms"),"suppliers render with details on demand");
  check(els.kpis.innerHTML.includes("Buyers saved"),"insights render");
  // Order again
  const po=T.Repo.data.orders[0].po;act("reorder",{po});
  check(T.flow.stage==="ask"&&buy().includes("When do you need it?")&&T.flow.r.qty===T.Repo.data.orders[0].qty,"order again pre-fills the request and asks only the date");

  // Public sign-up page
  T.loc.hash="#join/s/L0001";T.route();
  check(bodyClasses.has("public")&&els["v-public"].innerHTML.includes("List my business free"),"sign-up link opens the supplier form, no tabs");
  check(T.pub.role==="supplier"&&T.pub.ref==="L0001","sign-up remembers role and outreach lead");
  act("join-cat",{v:"pack"});check(T.pub.cats.includes("pack"),"category chip toggles");
  await T.submitJoin();check(els["v-public"].innerHTML.includes("Enter your business name"),"sign-up validates before sending");
  T.loc.hash="";T.route();check(!bodyClasses.has("public")&&!els["v-buy"].hidden,"leaving the sign-up returns to the app");

  // Ops screens
  T.showSupplierView("apps");check(els.appsList.innerHTML.length>50,"sign-ups view renders");
  T.showInsightsView("outreach");await wait(50);check(els.outreachBox.innerHTML.length>50,"outreach view renders");
  // Regions and languages
  T.setLocale("in_hi");act("new-req");check(buy().includes("Bolo kya chahiye"),"India · Hinglish hero");
  T.setLocale("gl_en");check(buy().includes("What do you need from India?")&&!/chahiye|Namaste|jugaad/.test(buy()),"Global hero is plain English");
  await T.say("5000 export cartons to Nhava Sheva in 7 days");
  check(T.flow.stage==="quotes"&&T.flow.r.city==="Nhava Sheva"&&buy().includes("Found")&&buy().includes("Indian rupees"),"Global: port delivery, English Bhai, rupee note");
  check(!/chahiye|Mil gaye|Pakka|karwao/.test(buy()),"no Hinglish in Global quotes");
  T.setLocale("in_en");check(!buy().includes("Indian rupees")&&!/karwao/.test(buy()),"India · English drops the Hinglish and the global note");
  T.setLocale("in_hi");check(buy().includes("thoda kam karwao"),"back to Hinglish");
  check(!errors.length,"no console errors "+errors.join(" | "));
  process.exitCode=fails?1:0;
})();
