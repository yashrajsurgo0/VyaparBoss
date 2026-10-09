/* VyaparBoss — where data lives.
   "server": the VyaparBoss backend (npm start) is reachable at api/* → shared data, Claude via the Anthropic API, WhatsApp.
   "local":  opened as a static page (GitHub Pages, file://, claude.ai) → data stays in this browser's localStorage. */
const KEY="vyaparboss.v1";
/* The always-on server. The static copy (GitHub Pages) sends sign-ups and supplier quotes here. */
const LIVE_API="https://vyaparboss.onrender.com/";
const Repo={
  mode:"local",
  info:{ai:false,whatsapp:false,model:null},
  data:{orders:[],rfqs:[],seq:{po:0,rfq:0},suppliers:[],useSamples:true,me:null,team:false},
  /* "Hide example orders" is a per-browser preference now that each person sees only their own data. */
  get hideSamples(){try{return localStorage.getItem(KEY+".hideSamples")==="1";}catch(e){return false;}},
  dropSamples(){if(this.hideSamples){this.data.orders=this.data.orders.filter(o=>!o.sample);this.data.rfqs=this.data.rfqs.filter(r=>!r.sample);}},

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
    let me=null;try{me=JSON.parse(localStorage.getItem(KEY+".me")||"null");}catch(e){}
    this.data.me=me;this.data.team=false;
    this.dropSamples();
    setSuppliers(this.data.suppliers,this.data.useSamples);
  },
  saveLocal(){try{const {me,team,...d}=this.data;localStorage.setItem(KEY,JSON.stringify(d));}catch(e){}},
  adminKey:(()=>{try{return sessionStorage.getItem(KEY+".admin")||"";}catch(e){return "";}})(),
  setAdminKey(k){this.adminKey=k||"";try{k?sessionStorage.setItem(KEY+".admin",k):sessionStorage.removeItem(KEY+".admin");}catch(e){}},
  async api(method,path,body,base=""){
    const headers=body?{"content-type":"application/json"}:{};
    if(this.adminKey&&/^api\/(admin|draft|whatsapp)/.test(path))headers["x-admin-key"]=this.adminKey;
    const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw Object.assign(new Error(j.error||`Server error ${r.status}`),{status:r.status});
    return j;
  },
  async refresh(){
    if(this.mode!=="server")return false;
    const headers=this.adminKey?{"x-admin-key":this.adminKey}:{};
    const r=await fetch("api/state",{headers});const j=await r.json();
    const sig=d=>JSON.stringify([d.rfqs.length,d.orders.length,d.suppliers.length,d.me?.id||"",!!d.team,d.rfqs.map(x=>x.myQuote?.unit||0)]);
    const before=sig(this.data);
    Object.assign(this.data,{me:null,team:false},j);this.dropSamples();setSuppliers(this.data.suppliers,this.data.useSamples);
    return before!==sig(this.data);
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
    try{localStorage.setItem(KEY+".hideSamples","1");}catch(e){}
    this.dropSamples();if(this.mode!=="server")this.saveLocal();
    return n;
  },
  async upsertSupplier(s){
    if(this.mode==="server"){const out=await this.api("PUT","api/admin/suppliers/"+encodeURIComponent(s.id||"new"),s);this.data.suppliers=this.data.suppliers.filter(x=>x.id!==out.id).concat(out);setSuppliers(this.data.suppliers,this.data.useSamples);return out;}
    if(!s.id)s.id="c"+Date.now().toString(36);
    s.createdAt=s.createdAt||Date.now();
    this.data.suppliers=this.data.suppliers.filter(x=>x.id!==s.id).concat(s);this.saveLocal();setSuppliers(this.data.suppliers,this.data.useSamples);return s;
  },
  async deleteSupplier(id){
    this.data.suppliers=this.data.suppliers.filter(x=>x.id!==id);setSuppliers(this.data.suppliers,this.data.useSamples);
    if(this.mode==="server")await this.api("DELETE","api/admin/suppliers/"+encodeURIComponent(id));else this.saveLocal();
  },
  async setUseSamples(v){
    this.data.useSamples=!!v;setSuppliers(this.data.suppliers,this.data.useSamples);
    if(this.mode==="server")await this.api("PUT","api/admin/settings",{useSamples:!!v});else this.saveLocal();
  },
  /* Server-side Claude (Anthropic API). Only call when info.ai is true. */
  async parse(text,partial,lang){return this.api("POST","api/parse",{text,partial,lang});},
  async draft(rfqId,sid){return this.api("POST","api/draft",{rfqId,sid});},
  /* WhatsApp intake (server only) */
  async waLog(){return this.api("GET","api/whatsapp/log");},
  async waSimulate(from,text){return this.api("POST","api/whatsapp/simulate",{from,text});},

  /* ===== Accounts. Server: real accounts and sessions. Static copy: a demo account kept in this browser. ===== */
  get me(){return this.data.me||null;},
  get guest(){try{return localStorage.getItem(KEY+".guest")==="1";}catch(e){return false;}},
  setGuest(v){try{v?localStorage.setItem(KEY+".guest","1"):localStorage.removeItem(KEY+".guest");}catch(e){}},
  async authConfig(){
    if(this.mode!=="server")return{email:true,google:null,apple:null,facebook:null,demo:true};
    if(!this._cfg)this._cfg=await this.api("GET","api/auth/config");return this._cfg;
  },
  saveLocalMe(){try{this.data.me?localStorage.setItem(KEY+".me",JSON.stringify(this.data.me)):localStorage.removeItem(KEY+".me");}catch(e){}},
  async signup(form){
    if(this.mode==="server"){const j=await this.api("POST","api/auth/signup",form);this.data.me=j.user;await this.refresh();return j.user;}
    const {ok,a,errors}=normalizeAccount(form);if(!ok)throw new Error(errors.join(". "));
    if(String(form.password||"").length<8)throw new Error("Use a password of at least 8 characters");
    this.data.me={...a,id:"local",guest:false,providers:[],supplierId:null,demo:true};this.saveLocalMe();
    try{localStorage.setItem(KEY+".acct",JSON.stringify(this.data.me));}catch(e){}return this.data.me;
  },
  async login(role,email,password){
    if(this.mode==="server"){const j=await this.api("POST","api/auth/login",{role,email,password});this.data.me=j.user;await this.refresh();return j.user;}
    let saved=null;try{saved=JSON.parse(localStorage.getItem(KEY+".acct")||"null");}catch(e){}
    if(!saved||saved.email!==String(email).trim().toLowerCase())throw new Error("No account with that email in this browser. This demo copy keeps accounts on one device; sign up first.");
    if(saved.role!==role)throw Object.assign(new Error(`This email has a ${saved.role} account. Choose "${saved.role==="supplier"?"I'm supplying":"I'm buying"}" to log in.`),{status:409,role:saved.role});
    this.data.me=saved;this.saveLocalMe();return saved;
  },
  async oauth(provider,role,payload){
    const j=await this.api("POST","api/auth/oauth",{provider,role,...payload});this.data.me=j.user;await this.refresh();return j;
  },
  async logout(){
    if(this.mode==="server"){try{await this.api("POST","api/auth/logout");}catch(e){}this.data.me=null;await this.refresh().catch(()=>{});}
    else{try{if(this.data.me)localStorage.setItem(KEY+".acct",JSON.stringify(this.data.me));}catch(e){}this.data.me=null;this.saveLocalMe();}
    this.setGuest(false);
  },
  async updateMe(patch){
    if(this.mode==="server"){const j=await this.api("PATCH","api/auth/me",patch);this.data.me=j.user;return j.user;}
    const {ok,a,errors}=normalizeAccount({...this.data.me,...patch});if(!ok)throw new Error(errors.join(". "));
    Object.assign(this.data.me,{name:a.name,business:a.business,phone:a.phone,city:a.city});this.saveLocalMe();return this.data.me;
  },
  /* Supplier account: its own listing, and quotes sent from the app. */
  get myListing(){return this.data.suppliers.find(s=>s.mine)||null;},
  async saveListing(s){
    if(this.mode==="server"){
      const out=await this.api("PUT","api/my/listing",s);
      this.data.suppliers=this.data.suppliers.filter(x=>x.id!==out.id).concat(out);if(this.data.me)this.data.me.supplierId=out.id;
      setSuppliers(this.data.suppliers,this.data.useSamples);return out;
    }
    const prev=this.myListing;s.id=prev?.id||"c"+Date.now().toString(36);Object.assign(s,{mine:true,selfListed:true,verified:false,createdAt:prev?.createdAt||Date.now()});
    this.data.suppliers=this.data.suppliers.filter(x=>x.id!==s.id).concat(s);this.data.me.supplierId=s.id;this.saveLocalMe();this.saveLocal();
    setSuppliers(this.data.suppliers,this.data.useSamples);return s;
  },
  async myQuote(rfqId,q){
    if(this.mode==="server"){const j=await this.api("POST","api/my/quotes",{rfqId,...q});const r=this.data.rfqs.find(x=>x.id===rfqId);if(r)r.myQuote=j.quote;return j.quote;}
    const r=this.data.rfqs.find(x=>x.id===rfqId),me=this.myListing;if(!r||!me)throw new Error("Request not found");
    const o=me.offers.find(x=>x.p===r.productId);const {ok,q:qq,errors}=normalizeLiveQuote(q,o?tierPrice(o,r.qty):null);if(!ok)throw new Error(errors.join(". "));
    r.invites=(r.invites||[]).filter(i=>i.sid!==me.id).concat({sid:me.id,sname:me.name,quote:qq,via:"app"});r.myQuote=qq;this.saveLocal();return qq;
  },
  async verifySupplier(id,verified){
    const out=await this.api("PATCH","api/admin/suppliers/"+encodeURIComponent(id),{verified});
    const s=this.data.suppliers.find(x=>x.id===id);if(s)s.verified=out.verified;setSuppliers(this.data.suppliers,this.data.useSamples);
  },

  /* Public pages: sign-up and supplier quote links. In the static copy these go to the live server. */
  get publicBase(){return this.mode==="server"?"":LIVE_API;},
  async track(ev,ref){try{await this.api("POST","api/track",{ev,ref},this.publicBase);}catch(e){}},
  async backup(){
    const r=await fetch("api/admin/backup",{headers:{"x-admin-key":this.adminKey}});
    if(!r.ok)throw Object.assign(new Error((await r.json().catch(()=>({}))).error||"Backup failed"),{status:r.status});
    return r.blob();
  },
  async restore(text){
    const r=await fetch("api/admin/restore",{method:"POST",headers:{"content-type":"application/json","x-admin-key":this.adminKey},body:text});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(j.error||"Restore failed"),{status:r.status});return j;
  },
  async join(form){return this.api("POST","api/join",form,this.publicBase);},
  async getQuote(token){return this.api("GET","api/quote/"+encodeURIComponent(token),null,this.publicBase);},
  async sendQuote(token,q){return this.api("POST","api/quote/"+encodeURIComponent(token),q,this.publicBase);},

  /* Ops tools (server + admin key). Leads also work in the static copy, kept in this browser. */
  get ops(){return this.mode==="server";},
  async adminCheck(){return this.api("GET","api/admin/check");},
  async applications(){return (await this.api("GET","api/admin/applications")).applications;},
  async updateApplication(id,patch){return this.api("PATCH","api/admin/applications/"+encodeURIComponent(id),patch);},
  async invites(rfqId,sids){return (await this.api(sids?"POST":"GET","api/admin/rfqs/"+encodeURIComponent(rfqId)+"/invites",sids?{sids}:undefined)).invites;},
  async leads(){
    if(this.ops)return this.api("GET","api/admin/leads");
    let l=null;try{l=JSON.parse(localStorage.getItem(KEY+".leads")||"null");}catch(e){}
    return l||{leads:[],outreach:{settings:{},sentToday:0,cap:30,email:false}};
  },
  saveLocalLeads(o){try{localStorage.setItem(KEY+".leads",JSON.stringify(o));}catch(e){}},
  async importLeads(rows){
    if(this.ops)return this.api("POST","api/admin/leads",{leads:rows});
    const o=await this.leads();const {added,skipped}=mergeLeads(o.leads,rows);
    let n=o.leads.reduce((m,l)=>Math.max(m,+String(l.id).slice(1)||0),0);added.forEach(l=>l.id="L"+String(++n).padStart(4,"0"));
    o.leads=o.leads.concat(added);this.saveLocalLeads(o);return {added:added.length,skipped:skipped.length,total:o.leads.length};
  },
  async updateLead(id,patch){
    if(this.ops)return this.api("PATCH","api/admin/leads/"+encodeURIComponent(id),patch);
    const o=await this.leads();const l=o.leads.find(x=>x.id===id);
    if(l){const {contacted,emailed,template,...rest}=patch;Object.assign(l,rest);
      if(contacted){l.lastContacted=Date.now();if(l.status==="new")l.status="contacted";}
      if(emailed){l.lastEmailed=Date.now();if(["new","contacted"].includes(l.status))l.status="emailed";l.sends=(l.sends||[]).concat({t:template||"manual",at:Date.now()}).slice(-10);}}
    this.saveLocalLeads(o);return l;
  },
  async deleteLead(id){
    if(this.ops)return this.api("DELETE","api/admin/leads/"+encodeURIComponent(id));
    const o=await this.leads();o.leads=o.leads.filter(x=>x.id!==id);this.saveLocalLeads(o);
  },
  async saveOutreachSettings(st){
    if(this.ops)return this.api("PUT","api/admin/outreach/settings",st);
    const o=await this.leads();o.outreach.settings={...o.outreach.settings,...st};this.saveLocalLeads(o);return o.outreach.settings;
  },
  async outreach(leadIds,templateId,send){return this.api("POST","api/admin/outreach",{leadIds,templateId,send:!!send});}
};
