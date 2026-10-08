/* VyaparBoss — where data lives.
   "server": the VyaparBoss backend (npm start) is reachable at api/* → shared data, Claude via the Anthropic API, WhatsApp.
   "local":  opened as a static page (GitHub Pages, file://, claude.ai) → data stays in this browser's localStorage. */
const KEY="vyaparboss.v1";
const Repo={
  mode:"local",
  info:{ai:false,whatsapp:false,model:null},
  data:{orders:[],rfqs:[],seq:{po:0,rfq:0},suppliers:[],useSamples:true},

  async init(){
    if(location.protocol.startsWith("http")){
      try{
        const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),2500);
        const h=await fetch("api/health",{signal:ctl.signal,headers:{accept:"application/json"}});clearTimeout(t);
        const j=h.ok?await h.json():null;
        if(j&&j.app==="vyaparboss"){this.mode="server";this.info=j;await this.refresh();return;}
      }catch(e){}
    }
    this.loadLocal();
  },
  loadLocal(){
    let s=null;try{s=JSON.parse(localStorage.getItem(KEY)||"null");}catch(e){}
    if(s&&s.orders){this.data={suppliers:[],useSamples:true,...s};}
    else{this.data={...buildSampleData(),suppliers:[],useSamples:true};this.saveLocal();}
    setSuppliers(this.data.suppliers,this.data.useSamples);
  },
  saveLocal(){try{localStorage.setItem(KEY,JSON.stringify(this.data));}catch(e){}},
  async api(method,path,body){
    const r=await fetch(path,{method,headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||`Server error ${r.status}`);
    return j;
  },
  async refresh(){
    if(this.mode!=="server")return false;
    const j=await this.api("GET","api/state");
    const before=JSON.stringify([this.data.rfqs.length,this.data.orders.length,this.data.suppliers.length]);
    Object.assign(this.data,j);setSuppliers(this.data.suppliers,this.data.useSamples);
    return before!==JSON.stringify([j.rfqs.length,j.orders.length,j.suppliers.length]);
  },

  async createRfq(rec){
    if(this.mode==="server"){const out=await this.api("POST","api/rfqs",rec);this.data.rfqs.unshift(out);return out;}
    rec.id=rfqIdFor(++this.data.seq.rfq);this.data.rfqs.unshift(rec);this.saveLocal();return rec;
  },
  async updateRfq(id,patch){
    const rec=this.data.rfqs.find(x=>x.id===id);if(rec)Object.assign(rec,patch);
    if(this.mode==="server")await this.api("PATCH","api/rfqs/"+encodeURIComponent(id),patch);else this.saveLocal();
  },
  async createOrder(order,rfqPatch){
    if(this.mode==="server"){
      const out=await this.api("POST","api/orders",{order,rfqPatch});
      this.data.orders.unshift(out);
      const rec=this.data.rfqs.find(x=>x.id===order.rfqId);if(rec&&rfqPatch)Object.assign(rec,rfqPatch);
      return out;
    }
    order.po=poIdFor(++this.data.seq.po);this.data.orders.unshift(order);
    const rec=this.data.rfqs.find(x=>x.id===order.rfqId);if(rec&&rfqPatch)Object.assign(rec,rfqPatch);
    this.saveLocal();return order;
  },
  async updateOrder(po,patch){
    const o=this.data.orders.find(x=>x.po===po);if(o)Object.assign(o,patch);
    if(this.mode==="server")await this.api("PATCH","api/orders/"+encodeURIComponent(po),patch);else this.saveLocal();
  },
  async clearSamples(){
    const n=this.data.orders.filter(o=>o.sample).length;
    this.data.orders=this.data.orders.filter(o=>!o.sample);this.data.rfqs=this.data.rfqs.filter(r=>!r.sample);
    if(this.mode==="server")await this.api("DELETE","api/samples");else this.saveLocal();
    return n;
  },
  async upsertSupplier(s){
    if(this.mode==="server"){const out=await this.api("PUT","api/suppliers/"+encodeURIComponent(s.id||"new"),s);this.data.suppliers=this.data.suppliers.filter(x=>x.id!==out.id).concat(out);setSuppliers(this.data.suppliers,this.data.useSamples);return out;}
    if(!s.id)s.id="c"+Date.now().toString(36);
    s.createdAt=s.createdAt||Date.now();
    this.data.suppliers=this.data.suppliers.filter(x=>x.id!==s.id).concat(s);this.saveLocal();setSuppliers(this.data.suppliers,this.data.useSamples);return s;
  },
  async deleteSupplier(id){
    this.data.suppliers=this.data.suppliers.filter(x=>x.id!==id);setSuppliers(this.data.suppliers,this.data.useSamples);
    if(this.mode==="server")await this.api("DELETE","api/suppliers/"+encodeURIComponent(id));else this.saveLocal();
  },
  async setUseSamples(v){
    this.data.useSamples=!!v;setSuppliers(this.data.suppliers,this.data.useSamples);
    if(this.mode==="server")await this.api("PUT","api/settings",{useSamples:!!v});else this.saveLocal();
  },
  /* Server-side Claude (Anthropic API). Only call when info.ai is true. */
  async parse(text,partial){return this.api("POST","api/parse",{text,partial});},
  async draft(rfqId,sid){return this.api("POST","api/draft",{rfqId,sid});}
};
