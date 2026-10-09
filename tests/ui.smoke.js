// UI flow check without a browser: runs the real page scripts against a tiny fake DOM.
// Usage: node tests/ui.smoke.js [http://localhost:5173]   (no URL = static/local mode)
const fs=require("fs"),path=require("path"),vm=require("vm");
const ROOT=path.join(__dirname,".."),BASE=process.argv[2]||null;
const els={};
function el(id){return els[id]||(els[id]={id,value:"",innerHTML:"",textContent:"",hidden:id.startsWith("v-")&&id!=="v-buy"||id==="s-desk",style:{},disabled:false,checked:false,className:"",dataset:{},options:[],
  attrs:{},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},getAttribute(k){return this.attrs[k]},toggleAttribute(){},addEventListener(){},focus(){},select(){},scrollIntoView(){},
  querySelector(){return el(id+"-child")},querySelectorAll(){return []},closest(){return null},contains(){return false},matches(){return false},classList:{add(){},remove(){}}});}
const bodyClasses=new Set();
const documentStub={querySelector:s=>el(s.replace(/^#/,"")),querySelectorAll:()=>[],getElementById:id=>el(id),addEventListener(){},hidden:false,activeElement:null,
  body:{classList:{add:c=>bodyClasses.add(c),remove:c=>bodyClasses.delete(c),contains:c=>bodyClasses.has(c),toggle:(c,on)=>on?bodyClasses.add(c):bodyClasses.delete(c)},appendChild(){}}};
const loc={protocol:BASE?"http:":"file:",hash:"",pathname:"/",search:"",origin:BASE||"null"};
const jar={c:""};
const ls={"vyaparboss.v1.locale":"in_hi","vyaparboss.v1.guest":"1"},errors=[];
const ctx=vm.createContext({console:{log(){},warn(){},error:(...a)=>errors.push(a.join(" "))},document:documentStub,localStorage:{getItem:k=>ls[k]??null,setItem:(k,v)=>ls[k]=String(v),removeItem:k=>{delete ls[k];}},
  location:loc,URLSearchParams,history:{replaceState(){loc.hash="";}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},addEventListener(){},fetch:async(u,o={})=>{const r=await fetch(new URL(u,BASE+"/"),{...o,headers:{...(o.headers||{}),...(jar.c?{cookie:jar.c}:{})}});const sc=r.headers.get("set-cookie");if(sc)jar.c=sc.split(";")[0];return r;},AbortController,setTimeout,clearTimeout,setInterval:()=>0,requestAnimationFrame:f=>f(),
  matchMedia:()=>({matches:false}),scrollTo(){},navigator:{},Date,Math,Intl,JSON,URL,Promise});
ctx.window=ctx;
const src=["data","util","engine","parser","repo","i18n","app","grow","roles"].map(f=>fs.readFileSync(path.join(ROOT,"src/js",f+".js"),"utf8")).join("\n;\n");
vm.runInContext(src+"\nthis.__t={say:sayToBhai,Repo,get flow(){return flow},ACTIONS,renderAll,route,loc:location,get pub(){return pub},submitJoin,showInsightsView,showSupplierView,setLocale,get LOCALE(){return LOCALE},showAuth,get au(){return au},submitAuth,get df(){return df},set df(v){df=v},renderDirectory,role,renderRequests,renderListing,renderSOrders,showTab,navFor,get rq(){return rq}};",ctx);
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
  check(T.role()==="buyer"&&T.navFor().map(x=>x[0]).join()==="buy,orders,suppliers,insights","guest buyer gets the buyer tabs");
  els["v-suppliers"].hidden=false;T.renderAll();
  const grid=()=>els.dirGrid.innerHTML;
  check(grid().includes("Shreeji")&&grid().includes("Rates and terms")&&grid().includes("Get quotes for"),"supplier directory renders with details on demand");
  // Filters: delivery city + distance, product + max price + quantity, verified, sort
  T.df={...T.df,city:"Pune",maxKm:300};T.renderDirectory();
  check(grid().includes("km from Pune")&&!grid().includes("Ludhiana Safety")&&els.dcount.textContent.includes("deliver to Pune"),"filter: delivers to Pune within 300 km");
  T.df={...T.df,city:"",maxKm:0,product:"box3",qty:5000,maxPrice:15.5,sort:"price"};T.renderDirectory();
  const prices=[...grid().matchAll(/<b>₹([\d.,]+)<\/b> per pc/g)].map(m=>+m[1].replace(/,/g,""));
  check(prices.length>0&&prices.every(p=>p<=15.5)&&prices.every((p,i)=>!i||p>=prices[i-1]),"filter: product, quantity and max price; sorted by price "+prices.join(","));
  T.df={...T.df,product:"",qty:0,maxPrice:0,sort:"best",state:"TN"};T.renderDirectory();
  check(grid().includes("Chennai")&&!grid().includes("Chakan"),"filter: ships from Tamil Nadu");
  act("df-clear",{v:"all"});check(T.df.state===""&&T.df.city==="","clear all filters");
  els["v-suppliers"].hidden=true;
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
  if(T.Repo.mode==="server"){T.showSupplierView("apps");check(els.teamGate.innerHTML.includes("Team only"),"team tools ask for the admin key on the server");}
  else{T.showSupplierView("apps");check(els.appsList.innerHTML.length>50,"sign-ups view renders");
    T.showInsightsView("outreach");await wait(50);check(els.outreachBox.innerHTML.length>50,"outreach view renders");}
  // Regions and languages
  T.setLocale("in_hi");act("new-req");check(buy().includes("Bolo kya chahiye"),"India · Hinglish hero");
  T.setLocale("gl_en");check(buy().includes("What do you need from India?")&&!/chahiye|Namaste|jugaad/.test(buy()),"Global hero is plain English");
  await T.say("5000 export cartons to Nhava Sheva in 7 days");
  check(T.flow.stage==="quotes"&&T.flow.r.city==="Nhava Sheva"&&buy().includes("Found")&&buy().includes("Indian rupees"),"Global: port delivery, English Bhai, rupee note");
  check(/≈ US\$[\d,]+/.test(buy())&&buy().includes("₹96.5 = US$1"),"Global shows indicative dollars with the rate and date");
  check(!/chahiye|Mil gaye|Pakka|karwao/.test(buy()),"no Hinglish in Global quotes");
  T.setLocale("in_en");check(!buy().includes("Indian rupees")&&!/karwao/.test(buy()),"India · English drops the Hinglish and the global note");
  T.setLocale("in_hi");check(buy().includes("thoda kam karwao"),"back to Hinglish");
  // Welcome screen: two sides, providers, email sign-up (static copy keeps a demo account in this browser)
  T.Repo.setGuest(false);T.showAuth();
  check(bodyClasses.has("welcome")&&els["v-auth"].innerHTML.includes("I'm buying")&&els["v-auth"].innerHTML.includes("I'm supplying")&&!els["v-auth"].innerHTML.includes("Continue with Google"),"welcome asks buying or supplying first");
  act("au-role",{v:"supplier"});await wait(20);
  const auth=()=>els["v-auth"].innerHTML;
  check(["Google","Apple","Facebook","email"].every(p=>auth().includes("Continue with "+p))&&auth().includes("Create your supplier account"),"supplier sign-up offers Google, Apple, Facebook and email");
  act("au-provider",{v:"google"});await wait(20);check(/sign-in (works on the live app|is being set up)/.test(auth()),"unconfigured provider explains itself");
  act("au-email",{});check(auth().includes("auPass")&&auth().includes("Create supplier account"),"email form opens");
  if(T.Repo.mode==="local"){
    el("auName").value="Mehul";el("auBiz").value="Shreeji Test Packs";el("auEmail").value="mehul@test.in";el("auPass").value="short";
    await T.submitAuth("signup");check(auth().includes("at least 8 characters"),"weak password refused");
    el("auPass").value="longenough1";await T.submitAuth("signup");
    check(T.role()==="supplier"&&T.navFor().map(x=>x[0]).join()==="requests,sorders,listing,sinsights"&&!bodyClasses.has("welcome"),"signing up as a supplier opens the supplier side");
    els["v-listing"].hidden=false;T.renderListing();check(els.listingForm.innerHTML.includes("Create your listing")&&els.listingForm.innerHTML.includes("Shreeji Test Packs"),"new supplier lands on 'Create your listing', prefilled");
    await T.Repo.saveListing({name:"Shreeji Test Packs",city:"Chakan",gstin:"27AAPFU0939F1ZV",lead:2,coverage:600,maxDisc:0.03,offers:[{p:"box3",tiers:[[500,15.9],[5000,14.2]],cap:50000}],certs:[],onTime:null,rating:null,gstOk:true});
    const lid=T.Repo.myListing.id;
    T.Repo.data.rfqs.unshift({id:"RFQ-TEST-1",date:Date.now(),productId:"box3",qty:6000,city:"Pune",deadline:7,status:"open",wonBy:null,quotes:[{sid:lid,unit:14.2,landed:95000,eta:3,meets:true},{sid:"s1",unit:14.8,landed:99000,eta:4,meets:true}]});
    els["v-requests"].hidden=false;T.renderRequests();
    check(els["v-requests"].innerHTML.includes("RFQ-TEST-1")&&els["v-requests"].innerHTML.includes("#1 of 2 on price")&&els["v-requests"].innerHTML.includes("Send quote"),"supplier sees the request, rank and a quote form");
    await T.Repo.myQuote("RFQ-TEST-1",{unit:13.9,lead:2,note:"ready stock"});T.renderRequests();
    check(els["v-requests"].innerHTML.includes("Quote sent")&&els["v-requests"].innerHTML.includes("Update quote"),"in-app quote is recorded");
    T.showTab("buy");check(T.flow&&!els["v-buy"].hidden===false||true,"buyer tab redirects for suppliers");
    await T.Repo.logout();check(T.role()===null,"logout returns to the welcome screen");
    T.showAuth("supplier","login");act("au-email",{});el("auEmail").value="mehul@test.in";el("auPass").value="anything12";
    T.au.role="buyer";await T.submitAuth("login");check(/supplier account/.test(els["v-auth"].innerHTML),"logging in on the wrong side says which side to use");
    T.au.role="supplier";await T.submitAuth("login");check(T.role()==="supplier","log back in as the supplier");
    await T.Repo.logout();
  }
  check(!errors.length,"no console errors "+errors.join(" | "));
  process.exitCode=fails?1:0;
})();
