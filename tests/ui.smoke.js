// UI flow check without a browser: runs the real page scripts against a tiny fake DOM.
// Usage: node tests/ui.smoke.js [http://localhost:5173]   (no URL = static/local mode)
const fs=require("fs"),path=require("path"),vm=require("vm");
const ROOT=path.join(__dirname,".."),BASE=process.argv[2]||null;
const els={};
function el(id){return els[id]||(els[id]={id,value:"",innerHTML:"",textContent:"",hidden:id.startsWith("v-")&&id!=="v-buy"||id==="s-desk",disabled:false,checked:false,className:"",dataset:{},options:[],
  attrs:{},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},getAttribute(k){return this.attrs[k]},toggleAttribute(){},addEventListener(){},focus(){},select(){},scrollIntoView(){},
  querySelector(){return el(id+"-child")},querySelectorAll(){return []},closest(){return null},matches(){return false},classList:{add(){},remove(){}}});}
const documentStub={querySelector:s=>el(s.replace(/^#/,"")),querySelectorAll:()=>[],getElementById:id=>el(id),addEventListener(){},hidden:false,activeElement:null};
const ls={},errors=[];
const ctx=vm.createContext({console:{log(){},warn(){},error:(...a)=>errors.push(a.join(" "))},document:documentStub,localStorage:{getItem:k=>ls[k]??null,setItem:(k,v)=>ls[k]=String(v)},
  location:{protocol:BASE?"http:":"file:"},fetch:(u,o)=>fetch(new URL(u,BASE+"/"),o),AbortController,setTimeout,clearTimeout,setInterval:()=>0,requestAnimationFrame:f=>f(),
  matchMedia:()=>({matches:false}),scrollTo(){},navigator:{},Date,Math,Intl,JSON,URL,Promise});
ctx.window=ctx;
const src=["data","util","engine","parser","repo","app"].map(f=>fs.readFileSync(path.join(ROOT,"src/js",f+".js"),"utf8")).join("\n;\n");
vm.runInContext(src+"\nthis.__t={say:sayToBhai,Repo,get flow(){return flow},ACTIONS,renderAll};",ctx);
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
  check(!errors.length,"no console errors "+errors.join(" | "));
  process.exitCode=fails?1:0;
})();
