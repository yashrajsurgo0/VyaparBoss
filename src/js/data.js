/* VyaparBoss — catalog, cities and sample supplier network. Plain browser script (no build step); loaded in order by index.html. */
/* ===================== DATA ===================== */
const CATS={pack:"Packaging",ind:"Industrial consumables",agri:"Agri inputs"};
const PRODUCTS=[
 {id:"box3",cat:"pack",name:"Corrugated box, 3-ply",spec:"Brown kraft, 12×10×8 in, 150 GSM",unit:"pcs",kgPer:0.28,hsn:"4819",gst:5,keys:["3 ply","3-ply","3ply","corrugated","carton","cartons","box","boxes","dabba","dabbe","gatta"]},
 {id:"box5",cat:"pack",name:"Corrugated box, 5-ply export",spec:"18×12×12 in, bursting strength 12 kg/cm²",unit:"pcs",kgPer:0.6,hsn:"4819",gst:5,keys:["5 ply","5-ply","5ply","export box","export boxes","heavy box","heavy boxes"]},
 {id:"ldpe",cat:"pack",name:"Food-grade LDPE film",spec:"50 micron virgin LDPE, food-contact grade",unit:"kg",kgPer:1,hsn:"3920",gst:18,keys:["food grade","food-grade","ldpe","packaging film","food packaging","packaging material","plastic film","poly film","pouch"]},
 {id:"tape",cat:"pack",name:"BOPP tape 48 mm × 65 m",spec:"Transparent, 40 micron",unit:"rolls",kgPer:0.2,hsn:"3919",gst:18,keys:["tape","bopp","cello tape","packing tape"]},
 {id:"stretch",cat:"pack",name:"Stretch wrap film",spec:"23 micron, 500 mm cast LLDPE",unit:"kg",kgPer:1,hsn:"3920",gst:18,keys:["stretch","stretch film","wrap film","pallet wrap"]},
 {id:"gloves",cat:"ind",name:"Nitrile gloves, box of 100",spec:"Powder-free, 4 mil, sizes M/L",unit:"boxes",kgPer:0.55,hsn:"4015",gst:18,keys:["gloves","nitrile","dastane","dastaane"]},
 {id:"helmet",cat:"ind",name:"Safety helmet, ISI marked",spec:"HDPE shell, ratchet, IS 2925",unit:"pcs",kgPer:0.4,hsn:"6506",gst:18,keys:["helmet","helmets","hard hat","safety helmet"]},
 {id:"wheel",cat:"ind",name:"Cutting wheel, 4 inch",spec:"105×1.2×16 mm, steel and stainless",unit:"pcs",kgPer:0.04,hsn:"6804",gst:18,keys:["cutting wheel","cutting wheels","cutting disc","grinding disc","cut off wheel"]},
 {id:"migwire",cat:"ind",name:"MIG welding wire ER70S-6",spec:"0.8 mm, 15 kg spools",unit:"kg",kgPer:1,hsn:"7229",gst:18,keys:["mig","welding wire","er70s","er70s-6","welding"]},
 {id:"cotton",cat:"ind",name:"Cotton waste, white",spec:"Machine-wiping grade",unit:"kg",kgPer:1,hsn:"5202",gst:5,keys:["cotton waste","wiping cloth","wiping","cotton"]},
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
 "Bengaluru":[12.97,77.59,"KA"],"Chennai":[13.08,80.27,"TN"],"Coimbatore":[11.02,76.96,"TN"],"Hyderabad":[17.39,78.49,"TS"],"Kolkata":[22.57,88.36,"WB"],"Kochi":[9.93,76.27,"KL"]
};
const ALIASES={bangalore:"Bengaluru",bengaluru:"Bengaluru",gurgaon:"Gurugram","new delhi":"Delhi",ncr:"Delhi",dilli:"Delhi",bombay:"Mumbai",calcutta:"Kolkata",madras:"Chennai",cochin:"Kochi",ambattur:"Chennai",vatva:"Ahmedabad",peenya:"Bengaluru",narela:"Delhi",pimpri:"Pune","chhatrapati sambhajinagar":"Aurangabad"};

const S=(id,name,city,area,gstin,o)=>({id,name,city,area,gstin,...o});
const SUPPLIERS=[
 S("s1","Shreeji Corrugators","Chakan","Chakan MIDC","27AAKFS4821M1Z3",{yrs:11,rating:4.6,onTime:94,orders:312,lead:3,coverage:900,maxDisc:.04,terms:"30% advance, balance on delivery",certs:["ISO 9001"],offers:[{p:"box3",tiers:[[500,17.9],[2000,16.2],[10000,14.8]],cap:60000},{p:"box5",tiers:[[300,41],[1500,37.5],[5000,34.9]],cap:20000}]}),
 S("s2","Bhiwandi Packaging Hub","Bhiwandi","Kalher","27AAGCB7710K1Z8",{yrs:8,rating:4.3,onTime:88,orders:540,lead:2,coverage:900,maxDisc:.05,terms:"Full advance",certs:[],offers:[{p:"box3",tiers:[[1000,16.9],[5000,15.4],[20000,14.1]],cap:100000},{p:"tape",tiers:[[100,38],[500,34],[2000,31]],cap:20000},{p:"stretch",tiers:[[50,168],[300,156],[1000,148]],cap:8000}]}),
 S("s3","Vapi Polyfilms","Vapi","GIDC Vapi","24AACCV3390F1Z1",{yrs:14,rating:4.5,onTime:92,orders:205,lead:4,coverage:1500,maxDisc:.03,terms:"15-day credit after 3 orders",certs:["ISO 9001","Food-contact test report"],offers:[{p:"ldpe",tiers:[[200,142],[1000,134],[5000,127]],cap:30000},{p:"stretch",tiers:[[100,160],[500,151],[2000,143]],cap:15000},{p:"mulch",tiers:[[200,165],[1000,155],[5000,148]],cap:20000}]}),
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
 S("s14","Narela Pack & Ship","Delhi","Narela DSIIDC","07AAGFN3348K1Z6",{yrs:9,rating:4.4,onTime:90,orders:300,lead:2,coverage:900,maxDisc:.04,terms:"30% advance",certs:["ISO 9001"],offers:[{p:"box3",tiers:[[500,18.6],[3000,16.9],[15000,15.3]],cap:50000},{p:"box5",tiers:[[200,43],[1000,39]],cap:12000},{p:"tape",tiers:[[100,39],[1000,33.5]],cap:15000},{p:"stretch",tiers:[[50,172],[500,158]],cap:6000}]}),
 S("s15","Peenya Packaging Works","Bengaluru","Peenya Industrial Area","29AACFP7709G1Z3",{yrs:12,rating:4.2,onTime:87,orders:240,lead:3,coverage:800,maxDisc:.04,terms:"50% advance",certs:["ISO 9001","Food-contact test report"],offers:[{p:"box3",tiers:[[500,17.4],[5000,15.6]],cap:40000},{p:"box5",tiers:[[300,40],[2000,36.5]],cap:15000},{p:"ldpe",tiers:[[200,146],[1000,138]],cap:8000}]})
];
const SMAP=Object.fromEntries(SUPPLIERS.map(s=>[s.id,s]));
const STAGES=["PO sent","Confirmed by supplier","Dispatched","In transit","Delivered"];
const TAKE=0.015;

const EXAMPLES=[
 "Need 2000 kg food-grade packaging material delivered to Pune within 5 days",
 "Bhai 5000 3-ply boxes chahiye Ahmedabad mein, ek hafte mein",
 "Jalgaon ke liye 40 rolls drip lateral, 10 din",
 "300 boxes nitrile gloves Chennai plant ke liye, 3 din",
 "2 tonne NPK 19:19:19 Indore"
];
