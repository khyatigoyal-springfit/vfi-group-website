(function(){
const IMG={factory:"/assets/img/factory.jpg",spring:"/assets/img/spring.jpg",coil:"/assets/img/coil.jpg"};
/* ---------- site settings: edit these values ---------- */
const SITE={
  url:"https://www.vfigroup.org",
  updated:"13 November 2026",
  // Contact details from www.vfigroup.org. Empty values are hidden automatically.
  contact:{
    office:{title:"Corporate office",address:"Varahamurti Flexirub Industries Pvt. Ltd.\n401, K. M. Trade Tower (Hotel Radisson Blu)\nSector 14, Kaushambi\nGhaziabad, Uttar Pradesh 201010",phone:"+91 95993 37712",email:"care@vfigroup.org",map:"https://www.google.com/maps/search/?api=1&query=K.+M.+Trade+Tower+Kaushambi+Ghaziabad+201010"},
    sales:{title:"Business enquiries",phone:"+91 80101 61016",email:"info@vfigroup.org"},
    careers:{title:"Careers",email:"info@vfigroup.org"},
    factories:[{name:"Haridwar",city:"Uttarakhand · since 2007"},{name:"Coimbatore",city:"Tamil Nadu · since 2016"},{name:"Meerut",city:"Uttar Pradesh · since 2020"},{name:"Vadodara",city:"Gujarat · since 2020"}]
  }
};
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

const CAPS=[
 {t:"Foaming",g:"Materials",d:"Foam, memory foam and latex in virtually any density and elasticity, from India’s largest foam factory.",img:"/assets/img/caps/foam.jpg"},
 {t:"Bonnell springs",g:"Spring systems",d:"In-house Bonnell springs made from carbon manganese alloys.",img:"/assets/img/caps/bonnell.jpg"},
 {t:"Pocket springs",g:"Spring systems",d:"In-house pocket springs with zoning options, made from carbon manganese alloys.",img:"/assets/img/caps/pocket.jpg"},
 {t:"State-of-the-art machinery",g:"Production",d:"We use and procure the best technological infrastructure and equipment.",img:"/assets/img/caps/factory-floor.jpg"},
 {t:"Lab testing",g:"Quality",d:"Stress, elasticity and rebound testing, internally and through third parties, on all materials and finished products.",img:"/assets/img/caps/lab.jpg"},
 {t:"Mattresses",g:"Production",d:"Mattresses in almost any size or shape, even roll-packed for cost-effective shipping.",img:"/assets/img/caps/mattress.jpg"}
];
const PORTFOLIO=[
 {t:"Premium mattresses",d:"Five mattress brands made and marketed by VFI Group, from Springfit, launched in 2009, to Simmons Beautyrest and Serta.",c:["Springfit","Simmons Beautyrest","Serta","Durfi","Amore"]},
 {t:"Organic latex",d:"Organa, launched in 2024, makes 100% organic latex mattresses and bedding, sold in the USA, Canada, France, Italy, India and Thailand.",c:["Organa","Global latex factory"]},
 {t:"Furniture and sofa foam",d:"NOSag is Springfit’s sofa foam, made for furniture makers.",c:["NOSag","Seat foam","Back foam","Ergo foam","Safe foam"]},
 {t:"Luxury furniture",d:"Millo Luxe brings Italian luxury sofas and recliners, since 1974, to showrooms in 40+ cities including Dubai Design District.",c:["Millo Luxe","Sofas","Recliners"]},
 {t:"Private label and OEM",d:"We make private-label ranges for 20+ brands, and supply foam and spring units to our partners’ own specifications.",c:["20+ brands","Foam","Bonnell springs","Pocket springs"]},
 {t:"Hospitality and export",d:"We supply 200+ hotel branches, cater to 70% of the hospitality industry and export to 12 markets.",c:["200+ hotel branches","12 export markets","Dubai branch","USA branch"]}
];
const PLOGOS=[["springfit","Springfit"],["beautyrest","Simmons Beautyrest"],["serta","Serta"],["organa-black","Organa"],["durfi","Durfi"],["amore","Amore"],["milloluxe","Millo Luxe"],["nosag","NOSag"]];
const CERTS=[["CMAS","Carbon manganese alloy springs"],["CertiPUR-US","Certified foams","/assets/img/certs/certipur-us.png"],["CertiGuard","Germ-free technology","/assets/img/certs/certiguard.png"],["AeroSleep","Breathable foams","/assets/img/certs/aerosleep.png"],["MCTS","Mattress comprehensive testing"]];
const TECH=[
 {k:"CMAS",t:"Carbon manganese alloy springs",img:"cmas",d:"Advanced carbon manganese coils are stress-relieved and strengthened for a comfortable sleeping experience. Independent suspension coil units are heat-treated under controlled conditions for better resistance and durability."},
 {k:"CertiPUR-US",t:"Certified foams",img:"certipur",d:"CertiPUR-US approved foams are low-emission for indoor air quality, and made without ozone depleters, PBDEs, mercury, lead and heavy metals, formaldehyde or prohibited phthalates. VFI was awarded CertiPUR-US certification in 2021."},
 {k:"CertiGuard",t:"Germ-free technology",img:"certiguard",d:"Dust-mite allergens are the most common in Indian households and can cause restless sleep. CertiGuard brings cleanliness and protection into the mattress, for healthier rest and better sleep hygiene."},
 {k:"AeroSleep",t:"Breathable foams",img:"aerosleep",d:"An exclusive open-cell, sustainable system with temperature-regulating properties that gives the best ventilation and comfort in its league, introduced with Springfit mattresses."},
 {k:"MCTS",t:"Mattress comprehensive testing systems",img:"mcts",d:"Mechanical force testing systems perform compression and tensile tests on foam, furniture and mattresses, including the ASTM D3574 indentation force deflection (IFD) test and ISO 2439, with complete performance testing to EN 1957 and EN 1725."},
 {k:"Smart technology",t:"An AI-enabled future",img:"smart",d:"Smart mattresses use sensors to understand how you sleep and help improve it: sleep tracking, adjustable firmness, temperature control, position control and app integration."}
];
const APPS={
 "Retail":{p:"Ready-to-sell ranges for store and online retail, sold by some of the largest retailers, including roll-packed formats for e-commerce.",i:[["Innerspring mattresses","Bonnell and pocket spring builds on in-house spring systems."],["Foam mattresses","Foam and memory foam in virtually any density and elasticity."],["Pillows and accessories","Pillows, quilts, toppers and protectors to complete a range."]],e:"Retail partnership"},
 "Hospitality":{p:"Mattresses for more than 200 branches of the world’s renowned hotels, specified for durability and shipped across the globe.",i:[["Hotel mattresses","Pocket spring and foam builds suited to daily turnover."],["Soft furnishings","Pillows, quilts, toppers and protectors for guest rooms."],["Custom specifications","Constructions engineered to a property’s brief."]],e:"Hospitality"},
 "OEM":{p:"Foam, spring units and complete mattresses produced to your specification. We also develop existing vendor specifications.",i:[["Foam and memory foam","Any density and elasticity, as components or in full builds."],["Bonnell and pocket spring systems","Carbon manganese alloy springs, with zoning options."],["Smart mattresses","Sensor-enabled builds for sleep tracking and comfort control."]],e:"OEM manufacturing"},
 "Private label":{p:"Your brand, our manufacturing. We make white-label and private-label ranges for more than 20 brands.",i:[["Full mattress ranges","Foam, innerspring and latex lines developed to your positioning."],["Roll-packed production","Compressed formats for cost-effective shipping."],["Accessories","Pillows, quilts, toppers and protectors to extend the range."]],e:"Private label"},
 "International":{p:"Exporting to twelve markets through our branches in Dubai and the USA, including Canada, Australia, France and Singapore.",i:[["Export programmes","Specifications, packaging and documentation for overseas partners."],["Roll-packed logistics","Container-efficient formats for long-distance shipping."],["Certified materials","CertiPUR-US certified foams and comprehensive testing to EN and ASTM standards."]],e:"International"}
};
const PRODCATS=[["Innerspring mattresses","Bonnell and pocket spring cores made in-house."],["Foam mattresses","Foam and memory foam in any density and elasticity."],["Smart mattresses","Sensor-enabled sleep tracking and comfort control."],["Pillows and accessories","Pillows, quilts, toppers and protectors."]];
const BRANDS=[
 {n:"Springfit",tag:"India’s most trusted premium mattress brand",logo:"springfit",url:"https://www.springfit.com/",img:"springfit-life",range:"springfit-range",since:"Launched by VFI in 2009",d:"A world of premium mattresses and sleep solutions, crafted with precision and care from superior materials, with stunning aesthetics and unmatched craftsmanship. Comfort guaranteed, every night.",col:["Sleep","Club Class","Emporio","Autograph","Reactive","ProActiv","Luxury","Superfactive","Wellness"]},
 {n:"Simmons",s:"Beautyrest",tag:"Sleep first class",logo:"beautyrest",url:"https://www.simmonsbeautyrest.in/",img:"beautyrest-life",range:"beautyrest-range",since:"With VFI since 2021",d:"Quintessential proficiency and technology-driven products for ideal sleep since 1870. Every Simmons Beautyrest mattress is fashioned for one goal: ultimate luxurious, comfortable sleep.",col:["Beautyrest Black","Harmony","Recharge","TechCare"]},
 {n:"Serta",tag:"World’s most comfortable mattress",logo:"serta",url:"https://www.sertaindia.com/",img:"serta-life",range:"serta-range",since:"Part of VFI Group since 2022",d:"More than 90 years of helping people get the sleep they need, whether they sleep on their back, stomach or side, online or in store.",col:["iPedic","iLatex","iSeries","Antarctic","Perfect Sleeper","PerfectSpine"]},
 {n:"Organa",tag:"Redefining the essence of sleep",logo:"organa-black",url:"https://organamattress.in/",range:"organa-range",since:"Launched in 2024",d:"An international brand of 100% organic latex mattresses and bedding, founded on quality, innovation and sustainability, for consumers in the USA, Canada, France, Italy, India and Thailand.",col:["Latex Zone","Latex Grid","Latex Hybrid"]},
 {n:"Durfi",logo:"durfi",url:"https://www.durfi.com/",d:"A mattress brand in the VFI Group portfolio."},
 {n:"Amore",s:"Mattresses",logo:"amore",url:"https://www.amoremattress.com/",d:"A mattress brand in the VFI Group portfolio."},
 {n:"Millo Luxe",tag:"Founded in Florence. Loved worldwide.",logo:"milloluxe",url:"https://milloluxe.it/",img:"millo-life",sq:true,since:"Italia, since 1974",d:"Italian comfort with a touch of elegance and luxury. Sofas, recliners and loungescapes crafted by master artisans, with retailers and showrooms in more than 40 cities, including a showroom in Dubai Design District.",col:["Nimbus","Falcon","Caspian","Albatross","Zephyr","Avian","Tranquil","Heron","Celesta","Elysian"]},
 {n:"NOSag",tag:"Kuch bhi karlo. Dabega nahi.",logo:"nosag",url:"https://www.springfit.com/pages/nosag-foam",img:"nosag-life",sq:true,since:"Sofa foam by Springfit",d:"Springfit NOSag foam technology, engineered for resilient comfort, reliable support and long-lasting performance in sofas, chairs and furniture. A dedicated foam platform for furniture makers and seating brands.",col:["NOSag Seat Cushion","NOSag Back Cushion","NOSag Ergo Foam","NOSag Safe Foam"]}
];
const ROUTES=[["Retail partnership","Ranges and exclusive lines for store and online retail."],["Hospitality","Specified comfort for hotels and serviced residences."],["OEM manufacturing","Components and complete mattresses to your specification."],["Private label","Your brand, developed and made by VFI."],["Foam supply","Foam, memory foam and latex to your specification."],["International","Export partnerships through our branches in Dubai and the USA."]];
const RETAIL=[["amazon","Amazon"],["flipkart","Flipkart"],["walmart","Walmart"],["hometown","HomeTown"],["pepperfry","Pepperfry"],["homecentre","Home Centre"]];
const HOTELS=["Taj Coromandel","Taj Exotica, Andamans","The Oberoi","ITC Maurya","The Leela","JW Marriott, Mussoorie","Le Méridien","Grand Hyatt","The Lalit","The Lalit, London","Courtyard by Marriott","Fairfield by Marriott","Four Points by Sheraton","Radisson Blu","Holiday Inn","Sarovar","Lemon Tree","Royal Orchid","Fortune Park Panchwati","Red Fox","Cidade de Goa","The Local, Mexico"];
const MARKETS=["USA","Canada","Mexico","Australia","France","Dubai","China","Singapore","South Africa","South Korea","Taiwan","Thailand"];
const AWARDS=[["most-trusted-2024","Most Trusted Brands of India 2024"],["brand-icon-toi","The Brand Icon, Times of India"],["up-brand-leadership","UP Brand Leadership Awards"],["india-sme-100","India SME 100 Awards"],["brands-of-india","Brands of India"]];
const WHATWEDO=[["Private label","White and private-label manufacturing for more than 20 brands."],["Full sleep range","Mattresses, pillows, quilts, toppers and protectors."],["Vendor specifications","We develop and improve existing vendor specifications."],["Hotels worldwide","Hotel mattresses, manufactured and shipped across the globe."]];
const FOAM=[["Foam and memory foam","Produced in virtually any density and elasticity, for comfort layers, support cores and components."],["Latex","Natural latex from our own latex manufacturing factory, including 100% organic latex for Organa."],["Breathable foams","AeroSleep open-cell foams with temperature-regulating properties for better ventilation."],["Certified foams","CertiPUR-US certified: low emissions, and made without ozone depleters, PBDEs, heavy metals, formaldehyde or prohibited phthalates."],["Tested","Stress, elasticity and rebound testing, including ASTM D3574 indentation force deflection and ISO 2439."],["Furniture foam","Springfit NOSag sofa foam for seat cushions, back cushions and ergonomic seating, built not to sag."],["Scale","India’s largest foam factory, unveiled in 2024, supplying our own lines and partners."]];
const PRESENCE=[["India","Corporate office and six manufacturing units"],["Dubai","Branch for global exports"],["USA","Branch for global exports"]];
const GLANCE=[["Fastest growing","company"],["6","smart factories"],["50,000","mattresses a month capacity"],["8","brands in the portfolio"],["12","export markets"],["200+","hotel branches supplied"],["Dubai and USA","branches for global exports"],["1,100+","people across India"]];
const JOURNEY=[
 ["30+ years ago","Two mattresses a day","Mr. Mukesh Gupta starts with one mattress binding machine and a table in a very small space."],
 ["2007","Haridwar","Establishment of our manufacturing unit in Haridwar."],
 ["2009","Springfit","Launch of Springfit Premium Mattresses."],
 ["2012","Hypnos","Associated with Hypnos, one of the world’s most luxurious mattress brands."],
 ["2016","Coimbatore","Inauguration of our state-of-the-art Coimbatore factory."],
 ["2017","Brand faces","Bipasha Basu and Karan Singh Grover join as brand faces."],
 ["2020","Meerut and Vadodara","Two new factories inaugurated."],
 ["2021","Simmons Beautyrest","Collaboration with Simmons Beautyrest, and CertiPUR-US certification."],
 ["2022","Serta","Serta joins the group, and Kareena Kapoor is appointed brand ambassador."],
 ["2023","Latex","Acquisition of a global latex manufacturing factory."],
 ["2024","Organa","Launch of the 100% organic latex brand Organa, Times Business Awards and Most Trusted Brands of India 2024, and India’s largest foam factory."]
];
const PROC=[["Foam","Foam and memory foam produced and cut to specification."],["Springs","Bonnell or pocket spring units formed in-house."],["Assembly","Layers built up around the core."],["Finishing","Covers quilted, fitted and closed."],["Testing","Checked against internal and third-party standards."],["Packing","Flat-packed or roll-packed for delivery."]];
const SUS=[
 ["Education, training and skill development","We provide training and development, ensure fair compensation and benefits, and promote diversity and inclusion to cultivate creativity and excellence among our employees."],
 ["Healthcare and sanitation","We prioritise healthcare and sanitation as part of our commitment to community well-being, building healthier communities and contributing to sustainable development."],
 ["Environmental sustainability","We prioritise responsible resource use, pollution reduction and biodiversity preservation, involve communities in environmental awareness, and comply closely with legislation together with our supply-chain partners."],
 ["Employee welfare","We take care of our employees’ welfare and rights, educate them about their rights and help them practise those rights."],
 ["Community development","We support the social and economic development of the communities where we operate: contributing to charitable causes, creating employment and respecting human rights."],
 ["Ethical business practice","We work to prevent corruption, fraud and unfair competition, respect intellectual property rights and adhere to applicable laws and regulations."]
];
const VALS=[["Quality","Every product made to the standard our partners promise their customers."],["Accuracy","Specifications measured, made and tested precisely, at any volume."],["Safety","Safe workplaces for our people and safe, certified materials for sleepers."],["Reliance","Long partnerships built on dependable delivery and transparency."]];
const ROLES=[["Production","Foam, spring and mattress manufacturing across our factories."],["Engineering","Machinery, maintenance and process improvement."],["Quality","Laboratory testing and quality control."],["Business","Sales, partnerships, export, operations and support."]];
const CONDUCT=[
 {h:"Our employees",i:[["Equal opportunity","Fair working conditions, equitable wages, comprehensive health and safety measures, and the freedom to associate and bargain collectively."],["Human rights","We uphold human rights and safeguard the well-being of our employees and everyone connected to our organisation, across our operations and supply chains."],["Labour rights","We help employees know, understand and practise their labour rights, and actively prevent forced labour, child labour, discrimination, harassment and exploitation."]]},
 {h:"Preventing forced and child labour",i:[["Due diligence","We continuously identify, assess and monitor risks in our operations and supply networks, and act to prevent, reduce or correct any adverse impact."],["Policies and standards","Clear policies that prohibit forced and child labour, communicated across our operations and supply chain."],["Training and awareness","We train employees, managers, suppliers and contractors on human rights, with special attention to the most vulnerable, such as migrant workers, women and children."],["Grievance mechanisms","Accessible ways to raise complaints, investigated and settled in a timely and equitable manner."],["Reporting and disclosure","We report on our policies, practices and progress, and engage stakeholders on our efforts and challenges."]]},
 {h:"Our customers",i:[["Quality and safety","Products that are safe, high quality and compliant with relevant standards and regulations."],["Transparency","Precise information about our products, including materials, origin, price and warranty."],["Privacy","We value and uphold consumers’ privacy and data-protection rights."]]},
 {h:"Our environment and communities",i:[["Community","We uphold the rights of the communities where we operate or source materials, create employment, support local initiatives, meet our tax obligations and consult stakeholders."],["Environment","From research to production, resource use, waste and emissions, we follow domestic and international law and internal protocols to reduce our footprint and prevent pollution or harm."],["Health and safety","We comply with the Environment, Health and Safety (EHS) policies that apply in India to protect our workers, customers and communities."]]}
];
const DESC={home:"VFI Group makes mattresses, foam and soft furnishings: six factories, 50,000+ mattresses a month, eight brands and exports to 12 markets.",about:"Thirty years of comfort manufacturing: the journey, vision and values of VFI Group.",manufacturing:"Six smart factories producing foam, Bonnell and pocket springs and finished mattresses in-house.",innovation:"Material science, spring engineering and testing behind everything VFI makes.",products:"Mattresses, foam, spring systems and soft furnishings for retail, hospitality, OEM and private label.",brands:"The VFI Group brand portfolio: Springfit, Simmons Beautyrest, Serta, Organa, Durfi, Amore, Millo Luxe and NOSag sofa foam.",partnerships:"Retail, hospitality, OEM, private-label and international manufacturing partnerships.",sustainability:"How VFI Group looks after its people, communities and environment.",careers:"Careers in production, engineering, quality and business at VFI Group.",contact:"Contact VFI Group about retail, hospitality, OEM, private-label or international manufacturing.",privacy:"How VFI Group handles information sent through the website enquiry forms, including data use, sharing, retention and your choices.",terms:"Terms of use for the VFI Group website: information-only content, intellectual property, governed by Indian law.","code-of-conduct":"The VFI Group code of conduct for employees, suppliers and partners.","404":"Page not found."};
const PAGES=[["home","Home","/assets/img/story/craft-hand.jpg","The science of comfort. The art of manufacturing."],["about","About VFI","/assets/img/story/craft-thread.jpg","Our journey, mission and values."],["manufacturing","Manufacturing","/assets/img/story/craft-machine.jpg","Foam, springs and finished mattresses, made in-house."],["innovation","Innovation and quality","/assets/img/tech/aerosleep.jpg","Material science and testing behind everything we make."],["products","Products and solutions","/assets/img/story/springfit-life.jpg","For retail, hospitality, OEM and private label."],["brands","Our brands","/assets/img/story/serta-life.jpg","A portfolio built around comfort."],["partnerships","Global partnerships","/assets/img/story/global-footprint.jpg","How we work with businesses worldwide."],["sustainability","CSR policy","/assets/img/story/csr-banner.jpg","People, community and environment."],["careers","Careers","/assets/img/story/craft-hand.jpg","Join more than 1,100 people."],["contact","Contact","/assets/img/story/beautyrest-life.jpg","Start a conversation with our team."]];

/* ---------- rails ---------- */
function makeRail(host,cardsHTML){
  host.innerHTML=`<div class="rail">${cardsHTML}</div><div class="wrap rail-ctl"><button class="arr pv" aria-label="Previous"></button><button class="arr nx" aria-label="Next"></button><div class="rail-prog"><i></i></div></div>`;
  const r=$('.rail',host),pv=$('.pv',host),nx=$('.nx',host),bar=$('.rail-prog i',host);
  const upd=()=>{const max=r.scrollWidth-r.clientWidth;const w=Math.max(12,r.clientWidth/r.scrollWidth*100);bar.style.width=w+'%';bar.style.left=(max>0?r.scrollLeft/max*(100-w):0)+'%';pv.disabled=r.scrollLeft<4;nx.disabled=r.scrollLeft>max-4};
  const step=()=>{const c=$('.card:not(.hide),.btile',r);return c?c.getBoundingClientRect().width+19:400};
  pv.onclick=()=>r.scrollBy({left:-step(),behavior:reduce?'auto':'smooth'});nx.onclick=()=>r.scrollBy({left:step(),behavior:reduce?'auto':'smooth'});
  r.addEventListener('scroll',upd,{passive:true});addEventListener('resize',upd);
  let down=false,sx=0,sl=0,moved=false;
  r.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')return;down=true;moved=false;sx=e.clientX;sl=r.scrollLeft});
  addEventListener('pointermove',e=>{if(!down)return;const dx=e.clientX-sx;if(Math.abs(dx)>5){moved=true;r.classList.add('drag')}r.scrollLeft=sl-dx});
  addEventListener('pointerup',()=>{if(!down)return;down=false;setTimeout(()=>r.classList.remove('drag'),0)});
  r.addEventListener('click',e=>{if(moved){e.preventDefault();e.stopPropagation();moved=false}},true);
  setTimeout(upd,50);host._upd=upd;return r;
}
const capCards=CAPS.map(c=>`<article class="card" data-g="${c.g}"><div class="im"><img src="${c.img}" alt="${c.t}" loading="lazy" draggable="false" width="412" height="301"><span class="tg">${c.g}</span></div><h3>${c.t}</h3><p>${c.d}</p><a class="chev" href="/manufacturing" data-go="manufacturing">Learn more</a></article>`).join('');
$$('[data-rail="caps"]').forEach((h,i)=>{makeRail(h,capCards);const tabs=$('#capTabs'+(i?'2':''));const G=["All",...new Set(CAPS.map(c=>c.g))];tabs.innerHTML=G.map((g,j)=>`<button aria-pressed="${j===0}">${g}</button>`).join('');$$('button',tabs).forEach(b=>b.onclick=()=>{$$('button',tabs).forEach(x=>x.setAttribute('aria-pressed',x===b));$$('.card',h).forEach(c=>c.classList.toggle('hide',b.textContent!=='All'&&c.dataset.g!==b.textContent));$('.rail',h).scrollLeft=0;h._upd()})});
const bName=b=>b.n+(b.s&&b.s!=="Mattresses"?' '+b.s:'');
const bMark=b=>b.logo?`<img src="/assets/img/brands/${b.logo}.png" alt="${bName(b)}" draggable="false" loading="lazy">`:`<span class="wtxt">${b.n}${b.s?`<small>${b.s}</small>`:''}</span>`;
const brandCards=BRANDS.map(b=>{const cls=`btile${b.dark?' dk':''}`,inner=`<span class="m"><span>${b.since||'VFI Group'}</span><span>${b.url?'Visit site ↗':''}</span></span><span class="wm">${bMark(b)}</span><span class="m"><span>${b.tag||''}</span></span>`;return b.url?`<a class="${cls}" href="${b.url}" data-brandlink draggable="false" aria-label="Visit the ${bName(b)} website">${inner}</a>`:`<div class="${cls}">${inner}</div>`}).join('');
$$('[data-rail="brands"]').forEach(h=>makeRail(h,brandCards));

/* ---------- applications ---------- */
$$('[data-apps]').forEach(host=>{
  const K=Object.keys(APPS);
  host.innerHTML=`<div class="apps"><ul class="applist" role="tablist" aria-label="Applications">${K.map((k,i)=>`<li><button role="tab" aria-selected="${i===0}">${k}</button></li>`).join('')}</ul><div class="appd" role="tabpanel"></div></div>`;
  const pnl=$('.appd',host);const set=k=>{const a=APPS[k];$$('[role=tab]',host).forEach(b=>b.setAttribute('aria-selected',b.textContent===k));pnl.innerHTML=`<div class="fade"><h3>${k}</h3><p class="sub">${a.p} </p><ul>${a.i.map(([n,s])=>`<li><b>${n}</b><span>${s}</span></li>`).join('')}</ul><div class="acts"><button class="cta pri" data-enquire="${a.e}">Enquire about ${k.toLowerCase()}</button></div></div>`};
  $$('[role=tab]',host).forEach(b=>{b.onclick=()=>set(b.textContent);b.onmouseenter=()=>{if(matchMedia('(hover:hover)').matches)set(b.textContent)}});set(K[0]);
});


/* ---------- static fills ---------- */
$$('[data-portfolio]').forEach(h=>h.innerHTML=PORTFOLIO.map(p=>`<article class="pcard rv"><h3>${p.t}</h3><p>${p.d}</p><ul>${p.c.map(x=>`<li class="cert">${x}</li>`).join('')}</ul></article>`).join(''));
$$('[data-portlogos]').forEach(h=>h.innerHTML=PLOGOS.map(([f,n])=>{const b=BRANDS.find(x=>x.logo===f),img=`<img src="/assets/img/brands/${f}.png" alt="${n}" loading="lazy" width="300" height="109">`;return b&&b.url?`<span><a href="${b.url}" data-brandlink aria-label="Visit the ${n} website">${img}</a></span>`:`<span><a href="/brands" data-go="brands" aria-label="${n}">${img}</a></span>`}).join(''));
$$('[data-certs]').forEach(h=>h.innerHTML=CERTS.map(([n,d,im])=>`<span class="cert" title="${d}">${im?`<img src="${im}" alt="" aria-hidden="true" width="22" height="22" loading="lazy">`:''}${n}</span>`).join(''));
$$('[data-routes]').forEach(h=>h.innerHTML=`<ul class="routes">${ROUTES.map(([t,d])=>`<li><button data-enquire="${t}"><h3>${t}</h3><p>${d}</p><span class="chev">Enquire</span></button></li>`).join('')}</ul>`);
$$('[data-retail]').forEach(h=>h.innerHTML=RETAIL.map(([f,n])=>`<span><img src="/assets/img/partners/${f}.png" alt="${n}" loading="lazy" width="300" height="109"></span>`).join(''));
$$('[data-hotels]').forEach(h=>h.innerHTML=HOTELS.map(p=>`<span>${p}</span>`).join(''));
$$('[data-awards]').forEach(h=>h.innerHTML=AWARDS.map(([f,n])=>`<span><img src="/assets/img/awards/${f}.png" alt="${n}" title="${n}" loading="lazy" width="300" height="109"></span>`).join(''));
$('#foamList').innerHTML=FOAM.map(([t,d])=>`<li><b>${t}</b><span>${d}</span></li>`).join('');
$('#presence').innerHTML=PRESENCE.map(([t,d])=>`<li><b>${t}</b><span>${d}</span></li>`).join('');
$('#markets').innerHTML=MARKETS.map(m=>`<span class="cert">${m}</span>`).join('');
$('#prodcats').innerHTML=PRODCATS.map(([t,d])=>`<div><h3>${t}</h3><p>${d}</p></div>`).join('');
$('#whatwedo').innerHTML=WHATWEDO.map(([t,d])=>`<div><h3>${t}</h3><p>${d}</p></div>`).join('');
$('#glance').innerHTML=GLANCE.map(([n,l])=>`<li><b>${n}</b><span>${l}</span></li>`).join('');
$('#units').innerHTML=SITE.contact.factories.map(f=>`<div><h3>${f.name}</h3><p>${f.city}</p></div>`).join('');
$('#tech').innerHTML=TECH.map((t,i)=>`<article class="feat${i%2?' rev':''}"><div class="fim"><img src="/assets/img/tech/${t.img}.jpg" alt="${t.k}: ${t.t}" loading="lazy" width="960" height="801"></div><div class="ftx"><span class="kick">${String(i+1).padStart(2,'0')} · ${t.k}</span><h3 class="h-m">${t.t}</h3><p>${t.d}</p></div></article>`).join('');
$('#brandRows').innerHTML=BRANDS.filter(b=>b.img||b.range).map((b,i)=>`<article class="feat${i%2?' rev':''}" id="brand-${b.n.toLowerCase().replace(/\s+/g,'-')}"><div class="fim ${b.sq?'sq':'wide'}"><img src="/assets/img/story/${b.img||b.range}.jpg" alt="${bName(b)}" loading="lazy" width="1900" height="650"></div><div class="ftx">${b.logo?`<img class="blogo${b.dark?' dk':''}" src="/assets/img/brands/${b.logo}.png" alt="${bName(b)}" width="300" height="109" loading="lazy">`:`<h3 class="h-l">${b.n}</h3>`}<span class="kick">${b.tag}${b.since?' · '+b.since:''}</span><p>${b.d}</p>${b.col?`<div class="certs" style="margin:1rem 0 1.6rem">${b.col.map(c=>`<span class="cert">${c}</span>`).join('')}</div>`:''}${b.url?`<a class="chev" href="${b.url}" data-brandlink rel="noopener">Visit the ${bName(b)} website</a>`:''}</div></article>`).join('');
const ce=SITE.contact.careers.email;$('[data-careers-mail]').innerHTML=ce?`Email <a class="chev" href="mailto:${ce}?subject=Job%20application">${ce}</a> or use the form.`:'';
$('#tl').innerHTML=JOURNEY.map(([y,v,d])=>`<li><span class="y">${y}</span><div><h3>${v}</h3><p>${d}</p></div></li>`).join('');
$('#proc').innerHTML=PROC.map(([t,d],i)=>`<li><span class="n">Step ${i+1}</span><h3>${t}</h3><p>${d}</p></li>`).join('');
$('#sus').innerHTML=SUS.map(([t,d],i)=>`<div><span class="kick">${i+1}</span><h3>${t}</h3><p>${d}</p></div>`).join('');
$('#vals').innerHTML=VALS.map(([t,d])=>`<div><h3>${t}</h3><p>${d}</p></div>`).join('');
$('#roles').innerHTML=ROLES.map(([t,d])=>`<li><h3>${t}</h3><p>${d}</p><button class="chev" data-enquire="Careers" data-msg="I am interested in a role in ${t.toLowerCase()}.">Send résumé</button></li>`).join('');
$('#fBrands').innerHTML=BRANDS.map(b=>b.url?`<li><a href="${b.url}" data-brandlink rel="noopener">${bName(b)}</a></li>`:`<li><a href="/brands" data-go="brands">${bName(b)}</a></li>`).join('');
$('#yr').textContent=new Date().getFullYear();
$('#conduct').innerHTML=CONDUCT.map(g=>`<div class="cgroup"><h2 class="h-m">${g.h}</h2><div class="ppl" style="margin-top:1.6rem">${g.i.map(([t,d])=>`<div><h3>${t}</h3><p>${d}</p></div>`).join('')}</div></div>`).join('');
$$('[data-updated]').forEach(e=>e.textContent='Last updated '+SITE.updated);
(function(){const C=SITE.contact,esc=v=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const line=(k,v)=>!v?'':k==='email'?`<li><span>Email</span><a href="mailto:${esc(v)}">${esc(v)}</a></li>`:k==='phone'?`<li><span>Phone</span><a href="tel:${esc(v.replace(/[^+\d]/g,''))}">${esc(v)}</a></li>`:`<li><span>Address</span><address>${esc(v).replace(/\n/g,'<br>')}</address></li>`;
  const blocks=[C.office,C.sales,C.careers].map(b=>{const ls=['address','phone','email'].map(k=>line(k,b[k])).join('');return ls?`<div class="cblock"><h2 class="h-m">${esc(b.title)}</h2><ul class="cinfo">${ls}</ul></div>`:''}).join('');
  const mp=C.office.map?`<a class="chev" style="margin-top:1.2rem" href="${esc(C.office.map)}" target="_blank" rel="noopener">Open in Google Maps</a>`:'';
  const brs=`<div class="cblock"><h2 class="h-m">Global presence</h2><ul class="cinfo">${PRESENCE.map(([t,d])=>`<li><span>${t}</span><span>${d}</span></li>`).join('')}</ul></div>`;
  const fac=C.factories.length?`<div class="cblock"><h2 class="h-m">Manufacturing units</h2><ul class="cinfo">${C.factories.map(f=>`<li><span>${esc(f.name)}</span><span>${esc(f.city)}</span></li>`).join('')}</ul></div>`:'';
  const o=C.office;$('#fAddr').innerHTML=[o.address&&esc(o.address).replace(/\n/g,'<br>'),o.phone&&`<a href="tel:${esc(o.phone.replace(/[^+\d]/g,''))}">${esc(o.phone)}</a>`,o.email&&`<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>`].filter(Boolean).join('<br>');
  $('#contactInfo').innerHTML=(blocks||fac)?blocks.replace('</ul></div>','</ul>'+mp+'</div>')+brs+fac:`<h2 class="h-m">Corporate office</h2><p style="color:var(--ink-2);margin-top:1rem">Send us an enquiry with the form and the right team will reply directly.</p>`;
})();

/* ---------- overlay menu ---------- */
const ov=$('#ov'),mb=$('#menuBtn'),prev=$('#ovPrev');
$('#ovList').innerHTML=PAGES.map(([k,n],i)=>`<li style="transition-delay:${80+i*35}ms"><a href="${k==="home"?"/":"/"+k}" data-go="${k}" data-pv="${i}">${n}</a></li>`).join('');
prev.innerHTML=PAGES.map(([k,n,im],i)=>`<div class="pv${i===0?' on':''}" style="background-image:url(${im})"></div>`).join('')+`<div class="pvt"><h3 class="h-l"></h3><p></p></div>`;
const setPv=i=>{$$('.pv',prev).forEach((p,j)=>p.classList.toggle('on',j===i));$('.pvt h3',prev).textContent=PAGES[i][1];$('.pvt p',prev).textContent=PAGES[i][3]};setPv(0);
$$('[data-pv]').forEach(a=>{a.addEventListener('mouseenter',()=>setPv(+a.dataset.pv));a.addEventListener('focus',()=>setPv(+a.dataset.pv))});
const INERT=['header.nav','#main','footer','.tools'];
const setOv=o=>{const was=ov.classList.contains('open');if(o===was)return;ov.classList.toggle('open',o);ov.setAttribute('aria-hidden',!o);mb.setAttribute('aria-expanded',o);document.body.style.overflow=o?'hidden':'';
  if(o){ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-label','Site menu')}else{ov.removeAttribute('role');ov.removeAttribute('aria-modal');ov.removeAttribute('aria-label')}
  INERT.forEach(q=>$$(q).forEach(e=>o?e.setAttribute('inert',''):e.removeAttribute('inert')));
  if(o)setTimeout(()=>$('#ovClose').focus(),50);else mb.focus({preventScroll:true})};
ov.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const f=$$('a[href],button',ov).filter(x=>x.offsetParent);if(!f.length)return;const a=f[0],z=f[f.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}});
mb.onclick=()=>setOv(true);$('#ovClose').onclick=()=>setOv(false);

/* ---------- hero slideshow ---------- */
const hero=$('#hero'),slides=$$('.slide',hero),bars=$$('#bars button');let cur=0,timer=null,paused=reduce;const DUR=7000;
function go(i){cur=(i+slides.length)%slides.length;slides.forEach((s,j)=>s.classList.toggle('on',j===cur));bars.forEach((b,j)=>{b.classList.toggle('fin',j<cur);b.setAttribute('aria-current',j===cur);const sp=$('span',b);sp.style.animation='none';sp.offsetHeight;sp.style.animation=''});sched()}
function sched(){clearTimeout(timer);if(!paused)timer=setTimeout(()=>go(cur+1),DUR)}
bars.forEach((b,i)=>b.onclick=()=>go(i));
const pp=$('#pp');const setP=p=>{paused=p;hero.classList.toggle('paused',p);pp.setAttribute('aria-label',p?'Play slideshow':'Pause slideshow');pp.innerHTML=p?'<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M0 0l10 6-10 6z"/></svg>':'<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><rect width="3" height="12"/><rect x="7" width="3" height="12"/></svg>';if(p)clearTimeout(timer);else{bars[cur].querySelector('span').style.animation='none';bars[cur].querySelector('span').offsetHeight;bars[cur].querySelector('span').style.animation='';sched()}};
pp.onclick=()=>setP(!paused);if(reduce)setP(true);
let tx=0;hero.addEventListener('touchstart',e=>tx=e.touches[0].clientX,{passive:true});hero.addEventListener('touchend',e=>{const d=e.changedTouches[0].clientX-tx;if(Math.abs(d)>50)go(cur+(d<0?1:-1))});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(timer);else if(!paused)sched()});

/* ---------- router ---------- */
const VIEWS=$$('.view').map(v=>v.dataset.view);
const TITLES={home:"VFI Group | The Science of Comfort. The Art of Manufacturing.",about:"About VFI | VFI Group",manufacturing:"Manufacturing | VFI Group",innovation:"Innovation and Quality | VFI Group",products:"Products and Solutions | VFI Group",brands:"Our Brands | VFI Group",partnerships:"Global Partnerships | VFI Group",sustainability:"Sustainability | VFI Group",careers:"Careers | VFI Group",contact:"Contact | VFI Group",privacy:"Privacy Policy | VFI Group",terms:"Terms and Conditions | VFI Group","code-of-conduct":"Code of Conduct | VFI Group","404":"Page Not Found | VFI Group"};
const pathFor=v=>v==='home'?'/':'/'+v;
function viewFromPath(){const p=location.pathname.replace(/\/index\.html$/,'/').replace(/\/+$/,'')||'/';if(p==='/')return 'home';const v=decodeURIComponent(p.slice(1));return VIEWS.includes(v)&&v!=='404'?v:'404'}
function nav(v,hash){const url=pathFor(v)+(hash?'#'+hash:'');if(location.pathname+location.hash!==url)history.pushState({},'',url);route(hash)}
let firstRoute=true;
function route(hash){
  // support old #page links
  const lh=location.hash.slice(1);if(lh&&VIEWS.includes(lh)&&lh!=='404'&&!document.getElementById(lh)){history.replaceState({},'',pathFor(lh));}
  let h=viewFromPath();$$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===h));document.body.classList.toggle('inner',h!=='home');$$('.navlinks a').forEach(a=>a.dataset.go===h?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));document.title=TITLES[h]||TITLES.home;setMeta(h);setOv(false);closeDrawer();if(h==='home')go(0);else clearTimeout(timer);observe();$$('[data-rail]').forEach(r=>r._upd&&r._upd());
  const target=typeof hash==='string'?hash:(location.hash.slice(1)||'');const el=target&&document.getElementById(target);
  if(el)requestAnimationFrame(()=>el.scrollIntoView({behavior:reduce?'auto':'smooth'}));else scrollTo(0,0);
  if(!firstRoute)$('#main').focus({preventScroll:true});firstRoute=false;
}
function setMeta(h){const d=DESC[h]||DESC.home;const m=(sel,attr,val)=>{let e=$(sel);if(!e){e=document.createElement(sel.startsWith('link')?'link':'meta');const [k,v]=sel.match(/\[(\w+(?::\w+)?)="([^"]+)"\]/).slice(1);e.setAttribute(k,v);document.head.appendChild(e)}e.setAttribute(attr,val)};
  m('meta[name="description"]','content',d);m('meta[property="og:description"]','content',d);m('meta[property="og:title"]','content',TITLES[h]||TITLES.home);
  if(h==='404'){$$('link[rel="canonical"],meta[property="og:url"]').forEach(e=>e.remove())}else{m('link[rel="canonical"]','href',SITE.url+pathFor(h));m('meta[property="og:url"]','content',SITE.url+pathFor(h))}
  let rb=$('meta[name="robots"]');if(h==='404'){if(!rb){rb=document.createElement('meta');rb.name='robots';document.head.appendChild(rb)}rb.content='noindex'}else if(rb)rb.remove()}
document.addEventListener('click',e=>{
  if(e.defaultPrevented||e.button>0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey){if(e.target.closest('[data-go]'))return}
  const g=e.target.closest('[data-go]');if(g){e.preventDefault();nav(g.dataset.go);return}
  const s=e.target.closest('[data-scroll]');if(s){e.preventDefault();if(document.body.classList.contains('inner')){nav('home',s.dataset.scroll)}else{const el=document.getElementById(s.dataset.scroll);el&&el.scrollIntoView({behavior:reduce?'auto':'smooth'})}}
  const sn=e.target.closest('[data-sec]');if(sn){e.preventDefault();history.replaceState({},'','/#'+sn.dataset.sec);document.getElementById(sn.dataset.sec).scrollIntoView({behavior:reduce?'auto':'smooth'})}
  const q=e.target.closest('[data-enquire]');if(q){e.preventDefault();openDrawer(q.dataset.enquire,q.dataset.msg)}
});
document.addEventListener('click',e=>{const l=e.target.closest('a[data-brandlink]');if(!l||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();history.replaceState({},'','/');location.assign(l.href)});
addEventListener('popstate',()=>route());
if('scrollRestoration' in history)history.scrollRestoration='manual';
addEventListener('pageshow',e=>{if(e.persisted){route();scrollTo(0,0)}});
addEventListener('keydown',e=>{if(e.key==='Escape'){setOv(false);closeDrawer()}});

/* ---------- scroll ---------- */
const sub=$$('#subnav a');
function onScroll(){document.body.classList.toggle('scrolled',scrollY>200);
  if(!document.body.classList.contains('inner')){let act=null;$$('[data-sec-target]').forEach(s=>{if(s.getBoundingClientRect().top<innerHeight*.4)act=s.id});sub.forEach(a=>a.classList.toggle('on',a.dataset.sec===act));const on=$('#subnav a.on'),ul=$('#subnav');if(on&&ul._last!==act){ul._last=act;const l=on.offsetLeft-ul.offsetLeft;if(l<ul.scrollLeft||l+on.offsetWidth>ul.scrollLeft+ul.clientWidth)ul.scrollTo({left:l-20,behavior:'smooth'})}}
  if(!reduce)$$('.view.active [data-par]').forEach(b=>{const r=b.parentElement.getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight)b.style.transform=`translateY(${(r.top-innerHeight/2)*-.08}px)`});
}
addEventListener('scroll',onScroll,{passive:true});
$('#topBtn').onclick=()=>scrollTo({top:0,behavior:reduce?'auto':'smooth'});

/* ---------- theme ---------- */
const root=document.documentElement;const st=store.get('vfi-theme');if(st)root.dataset.theme=st;
$('#themeBtn').onclick=()=>{const dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;root.dataset.theme=dark?'light':'dark';store.set('vfi-theme',root.dataset.theme);toast(dark?'Light sections':'Dark sections')};

/* ---------- reveal & count ---------- */
let io;function observe(){if(io)io.disconnect();io=new IntersectionObserver(es=>es.forEach(en=>{if(!en.isIntersecting)return;const t=en.target;t.classList.add('in');const c=$('[data-count]',t);if(c)count(c);io.unobserve(t)}),{threshold:.15});$$('.view.active .rv:not(.in)').forEach(el=>io.observe(el))}
function count(el){if(el._d)return;el._d=1;const end=+el.dataset.count,f=n=>el.hasAttribute('data-fmt')?n.toLocaleString('en-IN'):n;if(reduce){el.textContent=f(end);return}const t0=performance.now();const tk=t=>{const p=Math.min(1,(t-t0)/1800),e=1-Math.pow(1-p,4);el.textContent=f(Math.round(end*e));if(p<1)requestAnimationFrame(tk)};requestAnimationFrame(tk)}

/* ---------- forms ---------- */
const TYPES=["Retail partnership","Hospitality","OEM manufacturing","Private label","Foam supply","International","Careers","Other"];
function buildForm(host,key){host.appendChild($('#formTpl').content.cloneNode(true));const w=host.lastElementChild,form=$('form',w),ch=$('[data-types]',w);let renderedAt=Date.now(),busy=false;
  $$('.fl',form).forEach(fl=>{const f=$('input,select,textarea',fl),l=$('label',fl),er=$('.err',fl);if(!f||!l)return;f.id=key+'-'+f.name;l.htmlFor=f.id;er.id=f.id+'-err';f.setAttribute('aria-describedby',er.id);if(f.required)f.setAttribute('aria-required','true')});
  ch.setAttribute('role','group');ch.setAttribute('aria-label','Enquiry type');
  ch.innerHTML=TYPES.map(t=>`<button type="button" aria-pressed="false">${t}</button>`).join('');let type='';
  const setType=t=>{type=t;$$('button',ch).forEach(b=>b.setAttribute('aria-pressed',b.textContent===t))};
  const F=$$('.fl input,.fl select,.fl textarea',form),hp=$('input[name=website]',form),stat=$('.fstat',form),sb=$('button[type=submit]',form);const save=()=>{const d={type};F.forEach(f=>d[f.name]=f.value);store.set(key,JSON.stringify(d))};
  $$('button',ch).forEach(b=>b.onclick=()=>{setType(b.textContent);save()});
  try{const d=JSON.parse(store.get(key)||'null');if(d){F.forEach(f=>{if(d[f.name])f.value=d[f.name]});if(d.type)setType(d.type)}}catch(e){}
  F.forEach(f=>f.addEventListener('input',()=>{save();f.closest('.fl').classList.remove('bad');$('.err',f.closest('.fl')).textContent=''}));
  const EMAIL='care@vfigroup.org',GENERIC='We could not send your enquiry right now. Your message is saved on this device. Please try again, or email '+EMAIL+'.';
  const say=(txt,err)=>{stat.textContent='';stat.setAttribute('role',err?'alert':'status');txt.split(EMAIL).forEach((p,i)=>{if(i){const a=document.createElement('a');a.href='mailto:'+EMAIL;a.textContent=EMAIL;stat.appendChild(a)}stat.appendChild(document.createTextNode(p))})};
  const showErr=(name,msg)=>{const f=$('[name='+name+']',form);if(!f)return false;const fl=f.closest('.fl');fl.classList.add('bad');$('.err',fl).textContent=msg;f.setAttribute('aria-invalid','true');return true};
  form.addEventListener('submit',e=>{e.preventDefault();if(busy)return;let ok=true,first=null;F.forEach(f=>{const fl=f.closest('.fl'),er=$('.err',fl);let m='';if(f.required&&!f.value.trim())m='Enter your '+({name:'full name',msg:'message',company:'company',email:'work email'}[f.name]);else if(f.type==='email'&&f.value&&!/^\S+@\S+\.\S+$/.test(f.value))m='Enter an email address like name@company.com';fl.classList.toggle('bad',!!m);er.textContent=m;if(m){ok=false;first=first||f}});F.forEach(f=>f.setAttribute('aria-invalid',f.closest('.fl').classList.contains('bad')));if(!ok){first.focus();return}
    busy=true;
    const d={type,website:hp.value,page:location.pathname,t:Date.now()-renderedAt};F.forEach(f=>d[f.name]=f.value.trim());
    sb.disabled=true;sb.textContent='Sending…';say('Sending your enquiry…');
    fetch('/api/enquiry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})
      .then(r=>r.json().catch(()=>({})).then(j=>({s:r.status,j})))
      .then(({s,j})=>{
        if(s===200&&j.ok){$('[data-sent-email]',w).textContent=d.email;$('[data-sent-ref]',w).textContent=j.ref||'—';w.classList.add('sent');store.set(key,'');form.reset();setType('');renderedAt=Date.now();toast('Enquiry sent');$('.done',w).focus();return}
        if(s===422&&j.errors&&typeof j.errors==='object'){
          const MAP={name:'name',company:'company',email:'email',country:'country',volume:'volume',message:'msg',msg:'msg',type:null,page:null};
          const extra=[];
          Object.keys(j.errors).forEach(k=>{const msg=String(j.errors[k]),n=Object.prototype.hasOwnProperty.call(MAP,k)?MAP[k]:null;if(!n||!showErr(n,msg))extra.push(msg)});
          const bad=F.find(f=>f.getAttribute('aria-invalid')==='true');
          const txt=[bad?'Please correct the highlighted fields.':'',...extra].filter(Boolean).join(' ');
          say(txt||GENERIC,true);if(bad)bad.focus();
          return}
        say(s===429?'Too many enquiries from your connection. Please wait about 10 minutes and try again, or email '+EMAIL+'.':GENERIC,true);toast('Enquiry not sent')})
      .catch(()=>{say(GENERIC,true);toast('Enquiry not sent')})
      .finally(()=>{busy=false;sb.disabled=false;sb.textContent='Send enquiry'})});
  const reset=()=>{form.reset();setType('');renderedAt=Date.now();$$('.fl',form).forEach(fl=>{fl.classList.remove('bad');const er=$('.err',fl);if(er)er.textContent=''});F.forEach(f=>f.removeAttribute('aria-invalid'));stat.setAttribute('role','status');stat.textContent='Drafts are saved on this device until you send.';w.classList.remove('sent')};
  $('[data-reset]',w).onclick=reset;
  return{setType,reset,isSent:()=>w.classList.contains('sent'),setMsg:m=>{const t=$('textarea',form);t.value=m;save()},resetClock:()=>{renderedAt=Date.now()},w};
}
const dF=buildForm($('#drawerForm'),'vfi-d'),cF=buildForm($('#inlineForm'),'vfi-c');
const drawer=$('#drawer');let lf=null;
function openDrawer(t,msg){if(dF.isSent())dF.reset();dF.resetClock();lf=document.activeElement;setOv(false);if(t)dF.setType(t);if(msg)dF.setMsg(msg);drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';setTimeout(()=>{const i=$('input[name=name]',drawer);i&&i.focus({preventScroll:true})},450)}
function closeDrawer(){if(!drawer.classList.contains('open'))return;drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');document.body.style.overflow='';lf&&lf.focus&&lf.focus()}
$$('[data-close]',drawer).forEach(b=>b.onclick=closeDrawer);
drawer.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const f=$$('button,input,select,textarea',drawer).filter(x=>x.offsetParent);const a=f[0],z=f[f.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}});

let tt;function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('on'),2600)}
route();onScroll();
})();
