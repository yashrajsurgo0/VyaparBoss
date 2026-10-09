/* VyaparBoss — catalog, cities and sample supplier network. Plain browser script (no build step); loaded in order by index.html. */
/* ===================== DATA ===================== */
const CATS={pack:"Packaging",ind:"Industrial consumables",agri:"Agri inputs"};
const PRODUCTS=[
 {id:"box3",cat:"pack",name:"Corrugated box, 3-ply",spec:"Brown kraft, 12×10×8 in, 150 GSM",unit:"pcs",kgPer:0.28,hsn:"4819",gst:5,keys:["3 ply","3-ply","3ply","corrugated","carton","cartons","box","boxes","dabba","dabbe","gatta"]},
 {id:"box5",cat:"pack",name:"Corrugated box, 5-ply export",spec:"18×12×12 in, bursting strength 12 kg/cm²",unit:"pcs",kgPer:0.6,hsn:"4819",gst:5,keys:["5 ply","5-ply","5ply","export box","export boxes","export carton","export cartons","export packaging","heavy box","heavy boxes"]},
 {id:"ldpe",cat:"pack",name:"Food-grade LDPE film",spec:"50 micron virgin LDPE, food-contact grade",unit:"kg",kgPer:1,hsn:"3920",gst:18,keys:["food grade","food-grade","ldpe","packaging film","food packaging","packaging material","plastic film","poly film","pouch"]},
 {id:"tape",cat:"pack",name:"BOPP tape 48 mm × 65 m",spec:"Transparent, 40 micron",unit:"rolls",kgPer:0.2,hsn:"3919",gst:18,keys:["tape","bopp","cello tape","packing tape"]},
 {id:"stretch",cat:"pack",name:"Stretch wrap film",spec:"23 micron, 500 mm cast LLDPE",unit:"kg",kgPer:1,hsn:"3920",gst:18,keys:["stretch","stretch film","wrap film","pallet wrap"]},
 {id:"gloves",cat:"ind",name:"Nitrile gloves, box of 100",spec:"Powder-free, 4 mil, sizes M/L",unit:"boxes",kgPer:0.55,hsn:"4015",gst:18,keys:["gloves","nitrile","dastane","dastaane"]},
 {id:"helmet",cat:"ind",name:"Safety helmet, ISI marked",spec:"HDPE shell, ratchet, IS 2925",unit:"pcs",kgPer:0.4,hsn:"6506",gst:18,keys:["helmet","helmets","hard hat","safety helmet"]},
 {id:"wheel",cat:"ind",name:"Cutting wheel, 4 inch",spec:"105×1.2×16 mm, steel and stainless",unit:"pcs",kgPer:0.04,hsn:"6804",gst:18,keys:["cutting wheel","cutting wheels","cutting disc","grinding disc","cut off wheel"]},
 {id:"migwire",cat:"ind",name:"MIG welding wire ER70S-6",spec:"0.8 mm, 15 kg spools",unit:"kg",kgPer:1,hsn:"7229",gst:18,keys:["mig","welding wire","er70s","er70s-6","welding"]},
 {id:"cotton",cat:"ind",name:"Cotton waste, white",spec:"Machine-wiping grade",unit:"kg",kgPer:1,hsn:"5202",gst:5,keys:["cotton waste","wiping cloth","wiping","cotton"]},
 {id:"pallet",cat:"pack",name:"Wooden pallet, heat-treated",spec:"ISPM-15 stamped, 1200×1000 mm, 4-way entry",unit:"pcs",kgPer:22,hsn:"4415",gst:18,keys:["pallet","pallets","wooden pallet","ispm","ispm-15","heat treated pallet"]},
 {id:"desiccant",cat:"pack",name:"Container desiccant strip, 1 kg",spec:"Calcium chloride, hangs in 20/40 ft containers",unit:"pcs",kgPer:1.1,hsn:"3824",gst:18,keys:["desiccant","desiccants","silica gel","container dry","moisture absorber","container desiccant"]},
 {id:"drip",cat:"agri",name:"Drip lateral, 16 mm",spec:"Inline 4 LPH @ 40 cm, 400 m roll",unit:"rolls",kgPer:16,hsn:"8424",gst:5,keys:["drip","lateral","drip pipe","drip irrigation","irrigation","pipe"]},
 {id:"crate",cat:"agri",name:"HDPE produce crate, 25 kg",spec:"Ventilated, 600×400×300 mm",unit:"pcs",kgPer:1.9,hsn:"3923",gst:18,keys:["crate","crates","plastic crate","tokri","produce crate"]},
 {id:"mulch",cat:"agri",name:"Mulch film, silver-black",spec:"25 micron, 1.2 m width",unit:"kg",kgPer:1,hsn:"3920",gst:18,keys:["mulch","mulching","mulch film"]},
 {id:"npk",cat:"agri",name:"Water-soluble NPK 19:19:19",spec:"FCO-registered, 25 kg bags",unit:"kg",kgPer:1,hsn:"3105",gst:5,keys:["npk","19:19:19","fertilizer","fertiliser","khad","water soluble"]}
];
const PMAP=Object.fromEntries(PRODUCTS.map(p=>[p.id,p]));

const CITIES={
 "Pune":[18.52,73.86,"MH"],"Chakan":[18.76,73.86,"MH"],"Mumbai":[19.08,72.88,"MH"],"Bhiwandi":[19.30,73.06,"MH"],"Nashik":[19.99,73.79,"MH"],"Jalgaon":[21.00,75.56,"MH"],"Nagpur":[21.15,79.09,"MH"],"Aurangabad":[19.88,75.34,"MH"],
 "Ahmedabad":[23.02,72.57,"GJ"],"Surat":[21.17,72.83,"GJ"],"Rajkot":[22.30,70.80,"GJ"],"Vapi":[20.37,72.90,"GJ"],
 "Delhi":[28.61,77.21,"DL"],"Gurugram":[28.46,77.03,"HR"],"Ludhiana":[30.90,75.85,"PB"],"Jaipur":[26.91,75.79,"RJ"],"Indore":[22.72,75.86,"MP"],"Lucknow":[26.85,80.95,"UP"],
 "Sangli":[16.85,74.58,"MH"],"Kolhapur":[16.70,74.24,"MH"],"Ratnagiri":[16.99,73.30,"MH"],
 "Vadodara":[22.31,73.18,"GJ"],"Morbi":[22.82,70.84,"GJ"],"Jamnagar":[22.47,70.06,"GJ"],"Unjha":[23.80,72.39,"GJ"],"Silvassa":[20.27,73.02,"DN"],"Daman":[20.40,72.83,"DN"],
 "Moradabad":[28.84,78.77,"UP"],"Kanpur":[26.45,80.33,"UP"],"Agra":[27.18,78.01,"UP"],"Firozabad":[27.15,78.40,"UP"],"Saharanpur":[29.96,77.55,"UP"],"Meerut":[28.98,77.71,"UP"],"Bhadohi":[25.40,82.57,"UP"],"Varanasi":[25.32,82.97,"UP"],
 "Panipat":[29.39,76.97,"HR"],"Jalandhar":[31.33,75.58,"PB"],"Jodhpur":[26.24,73.02,"RJ"],"Udaipur":[24.59,73.71,"RJ"],"Rudrapur":[28.98,79.40,"UK"],"Haridwar":[29.95,78.16,"UK"],"Baddi":[30.96,76.79,"HP"],
 "Tiruppur":[11.11,77.34,"TN"],"Karur":[10.96,78.08,"TN"],"Erode":[11.34,77.72,"TN"],"Salem":[11.66,78.15,"TN"],"Hosur":[12.74,77.83,"TN"],"Vaniyambadi":[12.68,78.62,"TN"],"Guntur":[16.31,80.44,"AP"],
 "Nhava Sheva":[18.95,72.95,"MH"],"Mundra":[22.84,69.72,"GJ"],"Tuticorin":[8.76,78.13,"TN"],"Visakhapatnam":[17.69,83.22,"AP"],
 "Bengaluru":[12.97,77.59,"KA"],"Chennai":[13.08,80.27,"TN"],"Coimbatore":[11.02,76.96,"TN"],"Hyderabad":[17.39,78.49,"TS"],"Kolkata":[22.57,88.36,"WB"],"Kochi":[9.93,76.27,"KL"]
};
const ALIASES={bangalore:"Bengaluru",bengaluru:"Bengaluru",gurgaon:"Gurugram","new delhi":"Delhi",ncr:"Delhi",dilli:"Delhi",bombay:"Mumbai",calcutta:"Kolkata",madras:"Chennai",cochin:"Kochi",ambattur:"Chennai",vatva:"Ahmedabad",peenya:"Bengaluru",narela:"Delhi",pimpri:"Pune","chhatrapati sambhajinagar":"Aurangabad",baroda:"Vadodara",morvi:"Morbi",tirupur:"Tiruppur",benares:"Varanasi",banaras:"Varanasi",kashi:"Varanasi","sant ravidas nagar":"Bhadohi",dadra:"Silvassa",jnpt:"Nhava Sheva","jawaharlal nehru port":"Nhava Sheva","nhava sheva port":"Nhava Sheva",thoothukudi:"Tuticorin",vizag:"Visakhapatnam"};

const S=(id,name,city,area,gstin,o)=>({id,name,city,area,gstin,...o});
const SAMPLE_SUPPLIERS=[
 S("s1","Shreeji Corrugators","Chakan","Chakan MIDC","27AAKFS4821M1Z3",{yrs:11,rating:4.6,onTime:94,orders:312,lead:3,coverage:900,maxDisc:.04,terms:"30% advance, balance on delivery",certs:["ISO 9001"],offers:[{p:"box3",tiers:[[500,17.9],[2000,16.2],[10000,14.8]],cap:60000},{p:"box5",tiers:[[300,41],[1500,37.5],[5000,34.9]],cap:20000}]}),
 S("s2","Bhiwandi Packaging Hub","Bhiwandi","Kalher","27AAGCB7710K1Z8",{yrs:8,rating:4.3,onTime:88,orders:540,lead:2,coverage:900,maxDisc:.05,terms:"Full advance",certs:[],offers:[{p:"box3",tiers:[[1000,16.9],[5000,15.4],[20000,14.1]],cap:100000},{p:"tape",tiers:[[100,38],[500,34],[2000,31]],cap:20000},{p:"stretch",tiers:[[50,168],[300,156],[1000,148]],cap:8000},{p:"pallet",tiers:[[20,1450],[100,1320],[500,1210]],cap:3000}]}),
 S("s3","Vapi Polyfilms","Vapi","GIDC Vapi","24AACCV3390F1Z1",{yrs:14,rating:4.5,onTime:92,orders:205,lead:4,coverage:1500,maxDisc:.03,terms:"15-day credit after 3 orders",certs:["ISO 9001","Food-contact test report"],offers:[{p:"ldpe",tiers:[[200,142],[1000,134],[5000,127]],cap:30000},{p:"stretch",tiers:[[100,160],[500,151],[2000,143]],cap:15000},{p:"mulch",tiers:[[200,165],[1000,155],[5000,148]],cap:20000},{p:"desiccant",tiers:[[100,118],[1000,104],[5000,97]],cap:20000}]}),
 S("s4","Deccan Flexipack","Hyderabad","Jeedimetla","36AAFCD5126P1Z6",{yrs:6,rating:4.4,onTime:90,orders:160,lead:3,coverage:1200,maxDisc:.04,terms:"50% advance",certs:["Food-contact test report"],offers:[{p:"ldpe",tiers:[[100,149],[500,140],[3000,132]],cap:12000},{p:"tape",tiers:[[200,36],[1000,32.5]],cap:10000}]}),
 S("s5","Vatva Polymers","Ahmedabad","Vatva GIDC","24AABFV2208L1Z4",{yrs:19,rating:4.1,onTime:83,orders:410,lead:5,coverage:1800,maxDisc:.06,terms:"50% advance",certs:["ISO 9001","Food-contact test report"],offers:[{p:"ldpe",tiers:[[500,136],[2000,129],[8000,123]],cap:40000},{p:"crate",tiers:[[100,265],[500,248],[2000,236]],cap:10000},{p:"mulch",tiers:[[300,158],[1500,149]],cap:15000}]}),
 S("s6","Ludhiana Safety Gear Co.","Ludhiana","Focal Point","03AAMCL6614Q1Z2",{yrs:12,rating:4.5,onTime:91,orders:280,lead:4,coverage:2500,maxDisc:.05,terms:"Full advance; 30-day credit for repeat buyers",certs:["BIS licence (IS 2925)"],offers:[{p:"gloves",tiers:[[20,285],[100,262],[500,245]],cap:5000},{p:"helmet",tiers:[[50,128],[200,116],[1000,105]],cap:8000},{p:"wheel",tiers:[[200,14.5],[1000,12.8],[5000,11.6]],cap:40000}]}),
 S("s7","Ambattur Industrial Supplies","Chennai","Ambattur Industrial Estate","33AAHFA4470C1Z9",{yrs:16,rating:4.7,onTime:95,orders:390,lead:2,coverage:900,maxDisc:.03,terms:"21-day credit",certs:["ISO 9001"],offers:[{p:"gloves",tiers:[[50,279],[200,259]],cap:3000},{p:"wheel",tiers:[[100,15.2],[500,13.4],[3000,12.2]],cap:30000},{p:"migwire",tiers:[[60,128],[300,119],[1500,112]],cap:9000},{p:"cotton",tiers:[[100,62],[500,56],[2000,51]],cap:12000}]}),
 S("s8","Pune MRO Mart","Pune","Bhosari MIDC","27AAPFP9035H1Z5",{yrs:5,rating:4.8,onTime:96,orders:175,lead:1,coverage:350,maxDisc:.02,terms:"Cash on delivery for verified buyers",certs:[],offers:[{p:"helmet",tiers:[[20,139],[100,124]],cap:1500},{p:"gloves",tiers:[[10,298],[50,276]],cap:800},{p:"migwire",tiers:[[30,134],[150,124]],cap:2000},{p:"cotton",tiers:[[50,66],[300,59]],cap:4000}]}),
 S("s9","Rajkot Weldtech","Rajkot","Aji GIDC","24AAKFR8852B1Z7",{yrs:9,rating:4.2,onTime:86,orders:220,lead:3,coverage:2000,maxDisc:.05,terms:"Full advance",certs:["ISO 9001"],offers:[{p:"migwire",tiers:[[150,118],[750,110],[3000,104]],cap:20000},{p:"wheel",tiers:[[500,12.1],[2500,11.0]],cap:50000}]}),
 S("s10","Jalgaon Agro Irrigation","Jalgaon","Jalgaon MIDC","27AACCJ1187E1Z0",{yrs:13,rating:4.6,onTime:93,orders:260,lead:3,coverage:1200,maxDisc:.04,terms:"30% advance; FPO credit on approval",certs:["BIS IS 13488"],offers:[{p:"drip",tiers:[[10,2350],[50,2190],[200,2050]],cap:3000},{p:"mulch",tiers:[[200,152],[1000,145]],cap:10000}]}),
 S("s11","Nashik Kisan Inputs","Nashik","Ambad MIDC","27AAJFN2290D1Z4",{yrs:7,rating:4.4,onTime:89,orders:330,lead:2,coverage:700,maxDisc:.04,terms:"Advance; credit for FPOs",certs:["FCO dealer registration"],offers:[{p:"npk",tiers:[[250,118],[1000,109],[5000,101]],cap:40000},{p:"crate",tiers:[[50,279],[300,259]],cap:4000},{p:"drip",tiers:[[5,2420],[30,2280]],cap:600}]}),
 S("s12","Kovai Agri Tech","Coimbatore","SIDCO Kurichi","33AABCK6631N1Z2",{yrs:10,rating:4.3,onTime:90,orders:190,lead:4,coverage:1100,maxDisc:.05,terms:"50% advance",certs:["BIS IS 13488","FCO dealer registration"],offers:[{p:"drip",tiers:[[10,2290],[100,2120]],cap:2000},{p:"crate",tiers:[[100,258],[1000,241]],cap:8000},{p:"npk",tiers:[[500,114],[2500,106]],cap:25000}]}),
 S("s13","Malwa Krishi Bhandar","Indore","Sanwer Road","23AAQFM5512J1Z8",{yrs:4,rating:4.0,onTime:85,orders:95,lead:2,coverage:800,maxDisc:.06,audit:"Factory audit pending",terms:"Full advance",certs:["FCO dealer registration"],offers:[{p:"npk",tiers:[[100,121],[1000,111]],cap:15000},{p:"mulch",tiers:[[100,169],[500,159]],cap:5000},{p:"crate",tiers:[[50,284]],cap:1500}]}),
 S("s14","Narela Pack & Ship","Delhi","Narela DSIIDC","07AAGFN3348K1Z6",{yrs:9,rating:4.4,onTime:90,orders:300,lead:2,coverage:900,maxDisc:.04,terms:"30% advance",certs:["ISO 9001"],offers:[{p:"box3",tiers:[[500,18.6],[3000,16.9],[15000,15.3]],cap:50000},{p:"box5",tiers:[[200,43],[1000,39]],cap:12000},{p:"tape",tiers:[[100,39],[1000,33.5]],cap:15000},{p:"stretch",tiers:[[50,172],[500,158]],cap:6000},{p:"pallet",tiers:[[20,1520],[200,1380]],cap:2000},{p:"desiccant",tiers:[[200,112],[2000,101]],cap:10000}]}),
 S("s15","Peenya Packaging Works","Bengaluru","Peenya Industrial Area","29AACFP7709G1Z3",{yrs:12,rating:4.2,onTime:87,orders:240,lead:3,coverage:800,maxDisc:.04,terms:"50% advance",certs:["ISO 9001","Food-contact test report"],offers:[{p:"box3",tiers:[[500,17.4],[5000,15.6]],cap:40000},{p:"box5",tiers:[[300,40],[2000,36.5]],cap:15000},{p:"ldpe",tiers:[[200,146],[1000,138]],cap:8000}]})
];
SAMPLE_SUPPLIERS.forEach(s=>{s.sample=true;});
// Live supplier list = sample network (optional) + suppliers onboarded through the app.
let SUPPLIERS=SAMPLE_SUPPLIERS.slice();
let SMAP=Object.fromEntries(SUPPLIERS.map(s=>[s.id,s]));
function setSuppliers(custom,useSamples=true){
  SUPPLIERS=(useSamples?SAMPLE_SUPPLIERS:[]).concat(custom||[]);
  SMAP=Object.fromEntries(SUPPLIERS.map(s=>[s.id,s]));
}
const STAGES=["PO sent","Confirmed by supplier","Dispatched","In transit","Delivered"];
const TAKE=0.015;

const EXAMPLES=[
 "Need 2000 kg food-grade packaging material delivered to Pune within 5 days",
 "Bhai 5000 3-ply boxes chahiye Ahmedabad mein, ek hafte mein",
 "Jalgaon ke liye 40 rolls drip lateral, 10 din",
 "300 boxes nitrile gloves Chennai plant ke liye, 3 din",
 "2 tonne NPK 19:19:19 Indore"
];

/* ===================== OUTREACH ===================== */
/* Email templates for inviting suppliers and buyers. {{placeholders}} are filled by fillTemplate().
   Honest by design: no invented numbers, no price or delivery promises, sender identity and opt-out in every mail. */
const OUTREACH_TEMPLATES=[
 {id:"supplier_free",label:"Supplier: free listing",audience:"supplier",
  subject:"Free listing for {{business}}: buyer requests for {{product}}",
  body:`Namaste {{greeting}},

I'm {{sender_name}} from VyaparBoss (House of 24 Pvt. Ltd.). We're building a buying assistant for Indian MSMEs: a business tells our assistant, Bhai, what it needs, and we pass the request only to suppliers who make that product, can handle that quantity and deliver to that city.

We're inviting a small group of {{product}} makers around {{city}} into our pilot:
- Listing is free. No annual package.
- You only get requests you can fulfil, with quantity, city and date already filled in.
- You quote your own price. A small fee applies only on orders that actually close, and we'll agree it with you before the first one.

If this sounds useful, list your business in 2 minutes: {{join_link}}
Or reply to this email with your WhatsApp number and I'll call you.

Dhanyavaad,
{{sender_name}}
VyaparBoss, House of 24 Pvt. Ltd.
{{sender_address}}

Don't want these emails? {{unsub_link}}`},
 {id:"exporter_buyer",label:"Exporter: packaging at delivered price",audience:"buyer",
  subject:"Export cartons and packaging for {{business}}, compared in one message",
  body:`Namaste {{greeting}},

I'm {{sender_name}} from VyaparBoss (House of 24 Pvt. Ltd.). We help growing exporters in places like {{city}} buy export packaging and consumables without calling ten vendors: 5-ply export cartons, heat-treated pallets, stretch film, tape and container desiccants.

You tell our assistant, Bhai, what you need, in English or Hinglish. Bhai compares suppliers on the full delivered price (rate + GST + freight) and their delivery time, and nothing is ordered until you approve it. It's free for buyers.

We're running a small pilot with {{product}} exporters. Would a 10-minute call this week be useful? You can also try it here: {{join_link}}

Dhanyavaad,
{{sender_name}}
VyaparBoss, House of 24 Pvt. Ltd.
{{sender_address}}

Don't want these emails? {{unsub_link}}`},
 {id:"followup",label:"Follow-up (short)",audience:"any",
  subject:"Re: {{business}} and VyaparBoss",
  body:`Namaste {{greeting}},

Just following up on my note from last week. If it's useful, the 2-minute sign-up is here: {{join_link}}
If it's not a fit, no problem at all; reply "no" and I won't write again.

{{sender_name}}
VyaparBoss, House of 24 Pvt. Ltd.
{{sender_address}}

Unsubscribe: {{unsub_link}}`}
];
const MONTHLY_BANDS=["Under ₹50,000","₹50,000 – 2 lakh","₹2 – 10 lakh","Over ₹10 lakh"];
const EXPORT_STAGES=["Already exporting","Starting exports","Not exporting"];


/* Lead pipeline, phone-first outreach. Small Indian firms answer WhatsApp and calls far more than email. */
const LEAD_STATUSES=["new","contacted","emailed","replied","joined","not_interested","unsubscribed","bounced"];
const WA_TEMPLATES={
 supplier:`Namaste {{greeting}}, main {{sender_name}}, VyaparBoss se (House of 24 Pvt. Ltd.). Hum MSME buyers ke liye buying assistant bana rahe hain. {{city}} ke aas-paas ke {{product}} makers ko pilot mein free listing de rahe hain: sirf woh orders milenge jo aap serve kar sakein, aur fee sirf closed order par (pehle se tay). 2 minute ka sign-up: {{join_link}}
Interest na ho to "no" likh dijiye, dobara message nahi karenge.`,
 exporter:`Namaste {{greeting}}, main {{sender_name}}, VyaparBoss se (House of 24 Pvt. Ltd.). Export cartons, pallets, stretch film jaise items ke liye hum kai suppliers ka delivered price (rate + GST + freight) ek saath dikhate hain; aapki approval ke bina kuch order nahi hota, aur buyers ke liye free hai. {{product}} exporters ke saath chhota pilot chal raha hai. Dekhna chahenge? {{join_link}}
Interest na ho to "no" likh dijiye, dobara message nahi karenge.`
};
const CALL_SCRIPTS={
 supplier:["Namaste, main {{sender_name}}, VyaparBoss se bol raha hoon. Kya {{business}} ke owner ya sales head se baat ho sakti hai?",
  "Hum MSME buyers ke liye buying assistant bana rahe hain. Buyer apni zaroorat batata hai, aur request sirf un suppliers ko jaati hai jo woh product, woh quantity aur woh city serve kar sakte hain.",
  "Listing free hai. Koi annual package nahi. Fee sirf us order par jo close ho, aur woh pehle aapke saath tay karenge.",
  "Ask: kaunse products, minimum order kitna, kitne km tak delivery, rough rate kya hai?",
  "Close: main aapko WhatsApp par 2-minute sign-up link bhejta hoon. Pehli buyer request aate hi call karunga.",
  "Don't promise orders, volumes or prices. If they say no, thank them and mark 'not interested'."],
 exporter:["Namaste, main {{sender_name}}, VyaparBoss se. Kya {{business}} mein packaging ya purchase dekhne wale se baat ho sakti hai?",
  "Export cartons, pallets, stretch film, desiccants: aap abhi kahan se lete hain, aur kitne vendors ko call karna padta hai?",
  "Hum kai verified suppliers ka delivered price (rate + GST + freight) ek message mein dikhate hain. Aapki approval ke bina kuch order nahi hota. Buyers ke liye free.",
  "Ask: monthly kitna lagta hai, kaunsa item sabse zyada pareshan karta hai, last price kya tha?",
  "Close: agli requirement aaye to WhatsApp par bata dijiye, hum quotes laa denge. Sign-up link bhej raha hoon.",
  "Don't promise savings or delivery dates. If they say no, thank them and mark 'not interested'."]
};
