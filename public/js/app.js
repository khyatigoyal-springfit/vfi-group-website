(function(){
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const root=document.documentElement;{const st=store.get('vfi-theme');if(st)root.dataset.theme=st}

/* ---------- forms ---------- */
const TYPES=["Retail partnership","Hospitality","OEM manufacturing","Private label","Foam supply","International","Careers","Other"];
function buildForm(host,key){host.appendChild($('#formTpl').content.cloneNode(true));const w=host.lastElementChild,form=$('form',w),ch=$('[data-types]',w);let renderedAt=Date.now(),busy=false;
  $$('.fl',form).forEach(fl=>{const f=$('input,select,textarea',fl),l=$('label',fl),er=$('.err',fl);if(!f||!l)return;f.id=key+'-'+f.name;l.htmlFor=f.id;er.id=f.id+'-err';f.setAttribute('aria-describedby',er.id);if(f.required)f.setAttribute('aria-required','true')});
  ch.setAttribute('role','group');ch.setAttribute('aria-label','Enquiry type');
  ch.innerHTML=TYPES.map(t=>`<button type="button" aria-pressed="false">${t}</button>`).join('');let type='';
  const setType=t=>{type=t;$$('button',ch).forEach(b=>b.setAttribute('aria-pressed',b.textContent===t))};
  const F=$$('.fl input,.fl select,.fl textarea',form),hp=$('input[name=website]',form),stat=$('.fstat',form),sb=$('button[type=submit]',form);const save=()=>{const d={type};F.forEach(f=>d[f.name]=f.value);store.set(key,JSON.stringify(d))};
  $$('button',ch).forEach(b=>b.onclick=()=>{setType(b.textContent);save()});
  try{const d=JSON.parse(store.get(key)||'null');if(d){F.forEach(f=>{if(d[f.name])f.value=d[f.name]});if(d.type)setType(d.type)}}catch(er){}
  F.forEach(f=>f.addEventListener('input',()=>{save();f.closest('.fl').classList.remove('bad');$('.err',f.closest('.fl')).textContent=''}));
  const EMAIL='care@vfigroup.org',GENERIC='We could not send your enquiry right now. Your message is saved on this device. Please try again, or email '+EMAIL+'.';
  const say=(txt,err)=>{stat.textContent='';stat.setAttribute('role',err?'alert':'status');txt.split(EMAIL).forEach((p,i)=>{if(i){const a=document.createElement('a');a.href='mailto:'+encodeURIComponent(EMAIL).replace(/%40/g,'@');a.textContent=EMAIL;stat.appendChild(a)}stat.appendChild(document.createTextNode(p))})};
  const showErr=(name,msg)=>{const f=$('[name='+name+']',form);if(!f)return false;const fl=f.closest('.fl');fl.classList.add('bad');$('.err',fl).textContent=msg;f.setAttribute('aria-invalid','true');return true};
  form.addEventListener('submit',ev=>{ev.preventDefault();if(busy)return;let ok=true,first=null;F.forEach(f=>{const fl=f.closest('.fl'),er=$('.err',fl);let m='';if(f.required&&!f.value.trim())m='Enter your '+({name:'full name',msg:'message',company:'company',email:'work email'}[f.name]);else if(f.type==='email'&&f.value&&!/^\S+@\S+\.\S+$/.test(f.value))m='Enter an email address like name@company.com';fl.classList.toggle('bad',!!m);er.textContent=m;if(m){ok=false;first=first||f}});F.forEach(f=>f.setAttribute('aria-invalid',f.closest('.fl').classList.contains('bad')));if(!ok){first.focus();return}
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
let tt;function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('on'),2600)}

/* ---------- content loading (CMS) ---------- */
// /api/content (published) -> /content/default.json. ?preview=1 tries /api/content?draft=1 first (editor session cookie).
const PREVIEW_REQ=new URLSearchParams(location.search).get('preview')==='1';
function getJSON(url,opts,ms){const ac=new AbortController(),t=setTimeout(()=>ac.abort(),ms||2500);
  return fetch(url,Object.assign({signal:ac.signal},opts)).then(r=>{if(!r.ok)throw new Error('http '+r.status);return r.json()}).then(j=>{if(!j||typeof j!=='object'||Array.isArray(j)||!j.settings||!j.seo)throw new Error('bad content');return j}).finally(()=>clearTimeout(t))}
function boot(){
  const pub=()=>getJSON('/api/content',{cache:'no-cache'}).catch(()=>getJSON('/content/default.json',{cache:'no-cache'},5000)).then(c=>({c,draft:false}));
  if(!PREVIEW_REQ)return pub();
  return getJSON('/api/content?draft=1',{cache:'no-store',credentials:'same-origin'}).then(c=>({c,draft:true})).catch(pub);
}
boot().then(r=>start(r.c,r.draft),()=>{root.setAttribute('data-content-error','')});

function start(C,draft){
/* ---------- helpers: content is editable, so everything is escaped ---------- */
const A=v=>Array.isArray(v)?v:[],S=v=>v==null?'':String(v);
const e=v=>S(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const u=v=>{v=S(v).trim();return /^(https?:|mailto:|tel:|#|\/(?!\/))/i.test(v)?v:''};
const im=v=>{v=S(v).trim();return /^(\/(?!\/)|https:\/\/)/.test(v)?v:''};
// URL for use inside CSS url("..."): percent-encodes quotes, parentheses and backslashes so a value cannot close the url() or inject declarations
const cssUrl=s=>encodeURI(String(s)).replace(/["'()\\]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const O=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const P=(x,a,b)=>A(x).map(i=>[O(i)[a],O(i)[b]]);
const sec=(k,f)=>A(O(C[k])[f]);

/* ---------- content -> view data ---------- */
const ST=O(C.settings),CT=O(ST.contact);
const SITE={url:S(ST.url),updated:S(ST.updated),contact:{office:O(CT.office),sales:O(CT.sales),careers:O(CT.careers),factories:A(ST.factories).map(O)}};
const CAPS=sec('capabilities','items').map(c=>({t:c.title,g:c.group,d:c.description,img:c.image}));
const PORTFOLIO=sec('portfolio','categories').map(p=>({t:p.title,d:p.description,c:A(p.tags)}));
const PLOGOS=sec('portfolio','logos').map(l=>[l.image,l.name]);
const CERTS=sec('technologies','badges').map(b=>[b.name,b.description,b.icon]);
const TECH=sec('technologies','items').map(t=>({k:t.label,t:t.title,d:t.description,img:t.image}));
const APPS={};sec('solutions','tabs').forEach(t=>{APPS[S(t.name)]={p:t.intro,i:P(t.items,'title','description'),e:t.enquiryType}});
const PRODCATS=P(O(C.solutions).categories,'title','description');
const BRANDS=sec('brands','items').map(b=>({n:b.name,s:b.suffix,tag:b.tagline,logo:b.logo,url:u(b.url),img:b.image,sq:b.imageShape==='Square',since:b.since,d:b.description,col:A(b.collections)}));
const ROUTES=P(O(C.routes).items,'title','description');
const RETAIL=sec('retail','items').map(r=>[r.logo,r.name]);
const HOTELS=sec('hotels','names');
const MARKETS=sec('markets','names');
const AWARDS=sec('awards','items').map(a=>[a.image,a.name]);
const WHATWEDO=P(O(C.whatWeDo).items,'title','description');
const FOAM=P(O(C.foam).items,'title','description');
const PRESENCE=P(ST.presence,'name','description');
const GLANCE=P(O(C.glance).items,'value','label');
const JOURNEY=sec('timeline','items').map(t=>[t.year,t.title,t.description]);
const PROC=P(O(C.process).steps,'title','description');
const SUS=P(O(C.csr).items,'title','description');
const VALS=P(O(C.values).items,'title','description');
const ROLES=P(O(C.careers).roles,'title','description');
const CONDUCT=sec('conduct','groups').map(g=>({h:O(g).heading,i:P(O(g).items,'title','description')}));
const TITLES={},DESC={};Object.keys(O(C.seo)).forEach(k=>{TITLES[k]=O(C.seo[k]).title;DESC[k]=O(C.seo[k]).description});
const PAGES=A(ST.menu).map(m=>[O(m).page,O(m).label,O(m).image,O(m).blurb]);
const TX=O(C.texts);
const PQ=draft?'?preview=1':'';

/* ---------- editable page texts ([data-cms]) ---------- */
$$('[data-cms]').forEach(el=>{const v=TX[el.dataset.cms];if(typeof v!=='string'||!v.trim()||el.textContent===v.replace(/\n/g,''))return;el.textContent='';v.split('\n').forEach((p,i)=>{if(i)el.appendChild(document.createElement('br'));el.appendChild(document.createTextNode(p))})});

/* ---------- hero slideshow + scale figures from content ---------- */
const HL={'Open enquiry form':['enquire',''],'Open enquiry form (International)':['enquire','International'],'Open enquiry form (Retail partnership)':['enquire','Retail partnership'],'Open enquiry form (Hospitality)':['enquire','Hospitality'],'Open enquiry form (OEM manufacturing)':['enquire','OEM manufacturing'],'Open enquiry form (Private label)':['enquire','Private label'],'Open enquiry form (Foam supply)':['enquire','Foam supply'],
 'Scroll to Overview':['scroll','overview'],'Scroll to Scale':['scroll','scale'],'Scroll to Capabilities':['scroll','capabilities'],'Scroll to Portfolio':['scroll','portfolio-glance'],'Scroll to Solutions':['scroll','solutions'],'Scroll to Brands':['scroll','portfolio'],'Scroll to Partnerships':['scroll','partners'],'Scroll to Awards':['scroll','awards']};
['about','manufacturing','innovation','products','brands','partnerships','sustainability','careers','contact'].forEach(p=>{HL['Go to '+p.charAt(0).toUpperCase()+p.slice(1)+' page']=['go',p]});HL['Go to Home page']=['go','home'];
const heroBtn=(cls,label,link)=>{const [k,v]=HL[link]||HL['Open enquiry form'];return k==='go'?`<a class="cta ${cls}" href="${v==='home'?'/':'/'+v}" data-go="${v}">${e(label)}</a>`:k==='scroll'?`<button class="cta ${cls}" data-scroll="${v}">${e(label)}</button>`:`<button class="cta ${cls}" data-enquire="${e(v)}">${e(label)}</button>`};
{const HS=sec('hero','slides').map(O);if(HS.length){const h=$('#hero');$$('.slide',h).forEach(s=>s.remove());
  $('.hctl',h).insertAdjacentHTML('beforebegin',HS.map((s,i)=>{const t=i===0?'h1':'h2';return `<div class="slide${i===0?' on':' shade'}" aria-roledescription="slide" aria-label="${i+1} of ${HS.length}"><div class="bg${s.imageFocus==='Soft left crop'?' p-beauty':''}" style="background-image:url(&quot;${e(cssUrl(im(s.image)))}&quot;)"></div>${s.imageNote?`<span class="cap-note">${e(s.imageNote)}</span>`:''}<div class="txt wrap"><span class="kick">${e(s.kicker)}</span><${t} class="h-xl">${e(s.heading)}</${t}><p class="sub">${e(s.text)}</p><div class="acts">${heroBtn('pri',s.primaryLabel,s.primaryLink)}${heroBtn('sec',s.secondaryLabel,s.secondaryLink)}</div></div></div>`}).join(''));
  $('#bars').innerHTML=HS.map((s,i)=>`<button${i===0?' aria-current="true"':''}><span></span>${e(s.tabLabel)}</button>`).join('')}}
{const SC=O(C.scale);if(Array.isArray(SC.figures)&&SC.figures.length)$('[data-scale]').innerHTML=SC.figures.map(f=>`<div class="sc rv"><div class="n"><span data-count="${+O(f).value||0}"${O(f).numberStyle==='Thousands separators'?' data-fmt':''}>0</span>${O(f).suffix?`<sup>${e(O(f).suffix)}</sup>`:''}</div><div class="l">${e(O(f).label)}</div></div>`).join('');
  if(Array.isArray(SC.highlights))$('[data-highlights]').innerHTML=SC.highlights.map(x=>`<span class="cert">${e(x)}</span>`).join('');
  if(Array.isArray(SC.keyFacts))$('[data-keyfacts]').innerHTML=SC.keyFacts.map(f=>`<div><b>${e(O(f).value)}</b><span>${e(O(f).label)}</span></div>`).join('')}

/* ---------- rails ---------- */
function makeRail(host,cardsHTML){
  host.innerHTML=`<div class="rail">${cardsHTML}</div><div class="wrap rail-ctl"><button class="arr pv" aria-label="Previous"></button><button class="arr nx" aria-label="Next"></button><div class="rail-prog"><i></i></div></div>`;
  const r=$('.rail',host),pv=$('.pv',host),nx=$('.nx',host),bar=$('.rail-prog i',host);
  const upd=()=>{const max=r.scrollWidth-r.clientWidth;const w=Math.max(12,r.clientWidth/r.scrollWidth*100);bar.style.width=w+'%';bar.style.left=(max>0?r.scrollLeft/max*(100-w):0)+'%';pv.disabled=r.scrollLeft<4;nx.disabled=r.scrollLeft>max-4};
  const step=()=>{const c=$('.card:not(.hide),.btile',r);return c?c.getBoundingClientRect().width+19:400};
  pv.onclick=()=>r.scrollBy({left:-step(),behavior:reduce?'auto':'smooth'});nx.onclick=()=>r.scrollBy({left:step(),behavior:reduce?'auto':'smooth'});
  r.addEventListener('scroll',upd,{passive:true});addEventListener('resize',upd);
  let down=false,sx=0,sl=0,moved=false;
  r.addEventListener('pointerdown',ev=>{if(ev.pointerType!=='mouse')return;down=true;moved=false;sx=ev.clientX;sl=r.scrollLeft});
  addEventListener('pointermove',ev=>{if(!down)return;const dx=ev.clientX-sx;if(Math.abs(dx)>5){moved=true;r.classList.add('drag')}r.scrollLeft=sl-dx});
  addEventListener('pointerup',()=>{if(!down)return;down=false;setTimeout(()=>r.classList.remove('drag'),0)});
  r.addEventListener('click',ev=>{if(moved){ev.preventDefault();ev.stopPropagation();moved=false}},true);
  setTimeout(upd,50);host._upd=upd;return r;
}
const capCards=CAPS.map(c=>`<article class="card" data-g="${e(c.g)}"><div class="im"><img src="${e(im(c.img))}" alt="${e(c.t)}" loading="lazy" draggable="false" width="412" height="301"><span class="tg">${e(c.g)}</span></div><h3>${e(c.t)}</h3><p>${e(c.d)}</p><a class="chev" href="/manufacturing" data-go="manufacturing">Learn more</a></article>`).join('');
$$('[data-rail="caps"]').forEach((h,i)=>{makeRail(h,capCards);const tabs=$('#capTabs'+(i?'2':''));const G=["All",...new Set(CAPS.map(c=>S(c.g)))];tabs.innerHTML=G.map((g,j)=>`<button aria-pressed="${j===0}">${e(g)}</button>`).join('');$$('button',tabs).forEach(b=>b.onclick=()=>{$$('button',tabs).forEach(x=>x.setAttribute('aria-pressed',x===b));$$('.card',h).forEach(c=>c.classList.toggle('hide',b.textContent!=='All'&&c.dataset.g!==b.textContent));$('.rail',h).scrollLeft=0;h._upd()})});
const bName=b=>S(b.n)+(b.s&&b.s!=="Mattresses"?' '+b.s:'');
const bMark=b=>b.logo?`<img src="${e(im(b.logo))}" alt="${e(bName(b))}" draggable="false" loading="lazy">`:`<span class="wtxt">${e(b.n)}${b.s?`<small>${e(b.s)}</small>`:''}</span>`;
const brandCards=BRANDS.map(b=>{const cls=`btile${b.dark?' dk':''}`,inner=`<span class="m"><span>${e(b.since||'VFI Group')}</span><span>${b.url?'Visit site ↗':''}</span></span><span class="wm">${bMark(b)}</span><span class="m"><span>${e(b.tag)}</span></span>`;return b.url?`<a class="${cls}" href="${e(b.url)}" data-brandlink draggable="false" aria-label="Visit the ${e(bName(b))} website">${inner}</a>`:`<div class="${cls}">${inner}</div>`}).join('');
$$('[data-rail="brands"]').forEach(h=>makeRail(h,brandCards));

/* ---------- applications ---------- */
$$('[data-apps]').forEach(host=>{
  const K=Object.keys(APPS);if(!K.length)return;
  host.innerHTML=`<div class="apps"><ul class="applist" role="tablist" aria-label="Applications">${K.map((k,i)=>`<li><button role="tab" aria-selected="${i===0}">${e(k)}</button></li>`).join('')}</ul><div class="appd" role="tabpanel"></div></div>`;
  const pnl=$('.appd',host);const set=k=>{const a=APPS[k];$$('[role=tab]',host).forEach(b=>b.setAttribute('aria-selected',b.textContent===k));pnl.innerHTML=`<div class="fade"><h3>${e(k)}</h3><p class="sub">${e(a.p)} </p><ul>${a.i.map(([n,s])=>`<li><b>${e(n)}</b><span>${e(s)}</span></li>`).join('')}</ul><div class="acts"><button class="cta pri" data-enquire="${e(a.e)}">Enquire about ${e(k.toLowerCase())}</button></div></div>`};
  $$('[role=tab]',host).forEach(b=>{b.onclick=()=>set(b.textContent);b.onmouseenter=()=>{if(matchMedia('(hover:hover)').matches)set(b.textContent)}});set(K[0]);
});


/* ---------- static fills ---------- */
const li=(t,d)=>`<li><b>${e(t)}</b><span>${e(d)}</span></li>`,td=(t,d)=>`<div><h3>${e(t)}</h3><p>${e(d)}</p></div>`;
$$('[data-portfolio]').forEach(h=>h.innerHTML=PORTFOLIO.map(p=>`<article class="pcard rv"><h3>${e(p.t)}</h3><p>${e(p.d)}</p><ul>${p.c.map(x=>`<li class="cert">${e(x)}</li>`).join('')}</ul></article>`).join(''));
$$('[data-portlogos]').forEach(h=>h.innerHTML=PLOGOS.map(([f,n])=>{const b=BRANDS.find(x=>(x.logo&&x.logo===f)||bName(x)===n),img=`<img src="${e(im(f))}" alt="${e(n)}" loading="lazy" width="300" height="109">`;return b&&b.url?`<span><a href="${e(b.url)}" data-brandlink aria-label="Visit the ${e(n)} website">${img}</a></span>`:`<span><a href="/brands" data-go="brands" aria-label="${e(n)}">${img}</a></span>`}).join(''));
$$('[data-certs]').forEach(h=>h.innerHTML=CERTS.map(([n,d,ic])=>`<span class="cert" title="${e(d)}">${ic?`<img src="${e(im(ic))}" alt="" aria-hidden="true" width="22" height="22" loading="lazy">`:''}${e(n)}</span>`).join(''));
$$('[data-routes]').forEach(h=>h.innerHTML=`<ul class="routes">${ROUTES.map(([t,d])=>`<li><button data-enquire="${e(t)}"><h3>${e(t)}</h3><p>${e(d)}</p><span class="chev">Enquire</span></button></li>`).join('')}</ul>`);
$$('[data-retail]').forEach(h=>h.innerHTML=RETAIL.map(([f,n])=>`<span><img src="${e(im(f))}" alt="${e(n)}" loading="lazy" width="300" height="109"></span>`).join(''));
$$('[data-hotels]').forEach(h=>h.innerHTML=HOTELS.map(p=>`<span>${e(p)}</span>`).join(''));
$$('[data-awards]').forEach(h=>h.innerHTML=AWARDS.map(([f,n])=>`<span><img src="${e(im(f))}" alt="${e(n)}" title="${e(n)}" loading="lazy" width="300" height="109"></span>`).join(''));
$('#foamList').innerHTML=FOAM.map(([t,d])=>li(t,d)).join('');
$('#presence').innerHTML=PRESENCE.map(([t,d])=>li(t,d)).join('');
$('#markets').innerHTML=MARKETS.map(m=>`<span class="cert">${e(m)}</span>`).join('');
$('#prodcats').innerHTML=PRODCATS.map(([t,d])=>td(t,d)).join('');
$('#whatwedo').innerHTML=WHATWEDO.map(([t,d])=>td(t,d)).join('');
$('#glance').innerHTML=GLANCE.map(([n,l])=>`<li><b>${e(n)}</b><span>${e(l)}</span></li>`).join('');
$('#units').innerHTML=SITE.contact.factories.map(f=>td(f.name,f.city)).join('');
$('#tech').innerHTML=TECH.map((t,i)=>`<article class="feat${i%2?' rev':''}"><div class="fim"><img src="${e(im(t.img))}" alt="${e(t.k)}: ${e(t.t)}" loading="lazy" width="960" height="801"></div><div class="ftx"><span class="kick">${String(i+1).padStart(2,'0')} · ${e(t.k)}</span><h3 class="h-m">${e(t.t)}</h3><p>${e(t.d)}</p></div></article>`).join('');
$('#brandRows').innerHTML=BRANDS.filter(b=>b.img).map((b,i)=>`<article class="feat${i%2?' rev':''}" id="brand-${e(S(b.n).toLowerCase().replace(/\s+/g,'-'))}"><div class="fim ${b.sq?'sq':'wide'}"><img src="${e(im(b.img))}" alt="${e(bName(b))}" loading="lazy" width="1900" height="650"></div><div class="ftx">${b.logo?`<img class="blogo${b.dark?' dk':''}" src="${e(im(b.logo))}" alt="${e(bName(b))}" width="300" height="109" loading="lazy">`:`<h3 class="h-l">${e(b.n)}</h3>`}<span class="kick">${e(b.tag)}${b.since?' · '+e(b.since):''}</span><p>${e(b.d)}</p>${b.col.length?`<div class="certs" style="margin:1rem 0 1.6rem">${b.col.map(c=>`<span class="cert">${e(c)}</span>`).join('')}</div>`:''}${b.url?`<a class="chev" href="${e(b.url)}" data-brandlink rel="noopener">Visit the ${e(bName(b))} website</a>`:''}</div></article>`).join('');
const ce=S(SITE.contact.careers.email);$('[data-careers-mail]').innerHTML=ce?`Email <a class="chev" href="mailto:${e(encodeURIComponent(ce).replace(/%40/g,'@'))}?subject=Job%20application">${e(ce)}</a> or use the form.`:'';
$('#tl').innerHTML=JOURNEY.map(([y,v,d])=>`<li><span class="y">${e(y)}</span><div><h3>${e(v)}</h3><p>${e(d)}</p></div></li>`).join('');
$('#proc').innerHTML=PROC.map(([t,d],i)=>`<li><span class="n">Step ${i+1}</span><h3>${e(t)}</h3><p>${e(d)}</p></li>`).join('');
$('#sus').innerHTML=SUS.map(([t,d],i)=>`<div><span class="kick">${i+1}</span><h3>${e(t)}</h3><p>${e(d)}</p></div>`).join('');
$('#vals').innerHTML=VALS.map(([t,d])=>td(t,d)).join('');
$('#roles').innerHTML=ROLES.map(([t,d])=>`<li><h3>${e(t)}</h3><p>${e(d)}</p><button class="chev" data-enquire="Careers" data-msg="I am interested in a role in ${e(S(t).toLowerCase())}.">Send résumé</button></li>`).join('');
$('#fBrands').innerHTML=BRANDS.map(b=>b.url?`<li><a href="${e(b.url)}" data-brandlink rel="noopener">${e(bName(b))}</a></li>`:`<li><a href="/brands" data-go="brands">${e(bName(b))}</a></li>`).join('');
$('#yr').textContent=new Date().getFullYear();
$('#conduct').innerHTML=CONDUCT.map(g=>`<div class="cgroup"><h2 class="h-m">${e(g.h)}</h2><div class="ppl" style="margin-top:1.6rem">${g.i.map(([t,d])=>td(t,d)).join('')}</div></div>`).join('');
$$('[data-updated]').forEach(el=>el.textContent='Last updated '+SITE.updated);
(function(){const CT=SITE.contact;
  const line=(k,v)=>!v?'':k==='email'?`<li><span>Email</span><a href="mailto:${e(encodeURIComponent(S(v)).replace(/%40/g,'@'))}">${e(v)}</a></li>`:k==='phone'?`<li><span>Phone</span><a href="tel:${e(S(v).replace(/[^+\d]/g,''))}">${e(v)}</a></li>`:`<li><span>Address</span><address>${e(v).replace(/\n/g,'<br>')}</address></li>`;
  const blocks=[CT.office,CT.sales,CT.careers].map(b=>{const ls=['address','phone','email'].map(k=>line(k,b[k])).join('');return ls?`<div class="cblock"><h2 class="h-m">${e(b.title)}</h2><ul class="cinfo">${ls}</ul></div>`:''}).join('');
  const mp=u(CT.office.map)?`<a class="chev" style="margin-top:1.2rem" href="${e(u(CT.office.map))}" target="_blank" rel="noopener">Open in Google Maps</a>`:'';
  const brs=`<div class="cblock"><h2 class="h-m">Global presence</h2><ul class="cinfo">${PRESENCE.map(([t,d])=>`<li><span>${e(t)}</span><span>${e(d)}</span></li>`).join('')}</ul></div>`;
  const fac=CT.factories.length?`<div class="cblock"><h2 class="h-m">Manufacturing units</h2><ul class="cinfo">${CT.factories.map(f=>`<li><span>${e(f.name)}</span><span>${e(f.city)}</span></li>`).join('')}</ul></div>`:'';
  const o=CT.office;$('#fAddr').innerHTML=[o.address&&e(o.address).replace(/\n/g,'<br>'),o.phone&&`<a href="tel:${e(S(o.phone).replace(/[^+\d]/g,''))}">${e(o.phone)}</a>`,o.email&&`<a href="mailto:${e(encodeURIComponent(S(o.email)).replace(/%40/g,'@'))}">${e(o.email)}</a>`].filter(Boolean).join('<br>');
  $('#contactInfo').innerHTML=(blocks||fac)?blocks.replace('</ul></div>','</ul>'+mp+'</div>')+brs+fac:`<h2 class="h-m">Corporate office</h2><p style="color:var(--ink-2);margin-top:1rem">Send us an enquiry with the form and the right team will reply directly.</p>`;
})();

/* ---------- overlay menu ---------- */
const ov=$('#ov'),mb=$('#menuBtn'),prev=$('#ovPrev');
$('#ovList').innerHTML=PAGES.map(([k,n],i)=>`<li style="transition-delay:${80+i*35}ms"><a href="${k==="home"?"/":"/"+e(k)}" data-go="${e(k)}" data-pv="${i}">${e(n)}</a></li>`).join('');
prev.innerHTML=PAGES.map(([k,n,imgp],i)=>`<div class="pv${i===0?' on':''}" style="background-image:url(&quot;${e(cssUrl(im(imgp)))}&quot;)"></div>`).join('')+`<div class="pvt"><h3 class="h-l"></h3><p></p></div>`;
const setPv=i=>{if(!PAGES[i])return;$$('.pv',prev).forEach((p,j)=>p.classList.toggle('on',j===i));$('.pvt h3',prev).textContent=S(PAGES[i][1]);$('.pvt p',prev).textContent=S(PAGES[i][3])};setPv(0);
$$('[data-pv]').forEach(a=>{a.addEventListener('mouseenter',()=>setPv(+a.dataset.pv));a.addEventListener('focus',()=>setPv(+a.dataset.pv))});
const INERT=['header.nav','#main','footer','.tools'];
const setOv=o=>{const was=ov.classList.contains('open');if(o===was)return;ov.classList.toggle('open',o);ov.setAttribute('aria-hidden',!o);mb.setAttribute('aria-expanded',o);document.body.style.overflow=o?'hidden':'';
  if(o){ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-label','Site menu')}else{ov.removeAttribute('role');ov.removeAttribute('aria-modal');ov.removeAttribute('aria-label')}
  INERT.forEach(q=>$$(q).forEach(el=>o?el.setAttribute('inert',''):el.removeAttribute('inert')));
  if(o)setTimeout(()=>$('#ovClose').focus(),50);else mb.focus({preventScroll:true})};
ov.addEventListener('keydown',ev=>{if(ev.key!=='Tab')return;const f=$$('a[href],button',ov).filter(x=>x.offsetParent);if(!f.length)return;const a=f[0],z=f[f.length-1];if(ev.shiftKey&&document.activeElement===a){ev.preventDefault();z.focus()}else if(!ev.shiftKey&&document.activeElement===z){ev.preventDefault();a.focus()}});
mb.onclick=()=>setOv(true);$('#ovClose').onclick=()=>setOv(false);

/* ---------- hero slideshow ---------- */
const hero=$('#hero'),slides=$$('.slide',hero),bars=$$('#bars button');let cur=0,timer=null,paused=reduce;const DUR=7000;
function go(i){cur=(i+slides.length)%slides.length;slides.forEach((s,j)=>s.classList.toggle('on',j===cur));bars.forEach((b,j)=>{b.classList.toggle('fin',j<cur);b.setAttribute('aria-current',j===cur);const sp=$('span',b);sp.style.animation='none';sp.offsetHeight;sp.style.animation=''});sched()}
function sched(){clearTimeout(timer);if(!paused&&slides.length>1)timer=setTimeout(()=>go(cur+1),DUR)}
bars.forEach((b,i)=>b.onclick=()=>go(i));
const pp=$('#pp');const setP=p=>{paused=p;hero.classList.toggle('paused',p);pp.setAttribute('aria-label',p?'Play slideshow':'Pause slideshow');pp.innerHTML=p?'<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M0 0l10 6-10 6z"/></svg>':'<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><rect width="3" height="12"/><rect x="7" width="3" height="12"/></svg>';if(p)clearTimeout(timer);else{bars[cur].querySelector('span').style.animation='none';bars[cur].querySelector('span').offsetHeight;bars[cur].querySelector('span').style.animation='';sched()}};
pp.onclick=()=>setP(!paused);if(reduce)setP(true);
let tx=0;hero.addEventListener('touchstart',ev=>tx=ev.touches[0].clientX,{passive:true});hero.addEventListener('touchend',ev=>{const d=ev.changedTouches[0].clientX-tx;if(Math.abs(d)>50)go(cur+(d<0?1:-1))});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(timer);else if(!paused)sched()});

/* ---------- router ---------- */
const VIEWS=$$('.view').map(v=>v.dataset.view);
const pathFor=v=>v==='home'?'/':'/'+v;
function viewFromPath(){const p=location.pathname.replace(/\/index\.html$/,'/').replace(/\/+$/,'')||'/';if(p==='/')return 'home';const v=decodeURIComponent(p.slice(1));return VIEWS.includes(v)&&v!=='404'?v:'404'}
function nav(v,hash){const url=pathFor(v)+PQ+(hash?'#'+hash:'');if(location.pathname+(draft?location.search:'')+location.hash!==url)history.pushState({},'',url);route(hash)}
let firstRoute=true;
function route(hash){
  // support old #page links
  const lh=location.hash.slice(1);if(lh&&VIEWS.includes(lh)&&lh!=='404'&&!document.getElementById(lh)){history.replaceState({},'',pathFor(lh)+PQ);}
  let h=viewFromPath();$$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===h));document.body.classList.toggle('inner',h!=='home');$$('.navlinks a').forEach(a=>a.dataset.go===h?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));document.title=TITLES[h]||TITLES.home||document.title;setMeta(h);setOv(false);closeDrawer();if(h==='home')go(0);else clearTimeout(timer);observe();$$('[data-rail]').forEach(r=>r._upd&&r._upd());exitHref();
  const target=typeof hash==='string'?hash:(location.hash.slice(1)||'');const el=target&&document.getElementById(target);
  if(el)requestAnimationFrame(()=>el.scrollIntoView({behavior:reduce?'auto':'smooth'}));else scrollTo(0,0);
  if(!firstRoute)$('#main').focus({preventScroll:true});firstRoute=false;
}
function setMeta(h){const d=DESC[h]||DESC.home;const m=(sel,attr,val)=>{if(!val)return;let el=$(sel);if(!el){el=document.createElement(sel.startsWith('link')?'link':'meta');const [k,v]=sel.match(/\[(\w+(?::\w+)?)="([^"]+)"\]/).slice(1);el.setAttribute(k,v);document.head.appendChild(el)}el.setAttribute(attr,val)};
  m('meta[name="description"]','content',d);m('meta[property="og:description"]','content',d);m('meta[property="og:title"]','content',TITLES[h]||TITLES.home);
  if(h==='404'){$$('link[rel="canonical"],meta[property="og:url"]').forEach(el=>el.remove())}else if(SITE.url){m('link[rel="canonical"]','href',SITE.url+pathFor(h));m('meta[property="og:url"]','content',SITE.url+pathFor(h))}
  let rb=$('meta[name="robots"]');if(h==='404'||draft){if(!rb){rb=document.createElement('meta');rb.name='robots';document.head.appendChild(rb)}rb.content='noindex'}else if(rb)rb.remove()}
document.addEventListener('click',ev=>{
  if(ev.defaultPrevented||ev.button>0||ev.metaKey||ev.ctrlKey||ev.shiftKey||ev.altKey){if(ev.target.closest('[data-go]'))return}
  const g=ev.target.closest('[data-go]');if(g){ev.preventDefault();nav(g.dataset.go);return}
  const s=ev.target.closest('[data-scroll]');if(s){ev.preventDefault();if(document.body.classList.contains('inner')){nav('home',s.dataset.scroll)}else{const el=document.getElementById(s.dataset.scroll);el&&el.scrollIntoView({behavior:reduce?'auto':'smooth'})}}
  const sn=ev.target.closest('[data-sec]');if(sn){ev.preventDefault();history.replaceState({},'','/'+PQ+'#'+sn.dataset.sec);document.getElementById(sn.dataset.sec).scrollIntoView({behavior:reduce?'auto':'smooth'})}
  const q=ev.target.closest('[data-enquire]');if(q){ev.preventDefault();openDrawer(q.dataset.enquire,q.dataset.msg)}
});
document.addEventListener('click',ev=>{const l=ev.target.closest('a[data-brandlink]');if(!l||ev.defaultPrevented||ev.button!==0||ev.metaKey||ev.ctrlKey||ev.shiftKey||ev.altKey)return;ev.preventDefault();history.replaceState({},'','/'+PQ);location.assign(l.href)});
addEventListener('popstate',()=>route());
if('scrollRestoration' in history)history.scrollRestoration='manual';
addEventListener('pageshow',ev=>{if(ev.persisted){route();scrollTo(0,0)}});
addEventListener('keydown',ev=>{if(ev.key==='Escape'){setOv(false);closeDrawer()}});

/* ---------- preview banner (draft content only) ---------- */
let exitLink=null;
function exitHref(){if(!exitLink)return;const x=new URL(location.href);x.searchParams.delete('preview');exitLink.href=x.pathname+x.search+x.hash}
if(draft){const bar=document.createElement('div');bar.className='preview-bar';bar.setAttribute('role','region');bar.setAttribute('aria-label','Preview mode');
  const t=document.createElement('span');t.textContent='Preview — draft content (not live)';exitLink=document.createElement('a');exitLink.textContent='Exit preview';
  exitLink.addEventListener('click',ev=>{ev.preventDefault();exitHref();location.assign(exitLink.href)});
  bar.append(t,exitLink);document.body.prepend(bar);document.body.classList.add('previewing')}

/* ---------- scroll ---------- */
const sub=$$('#subnav a');
function onScroll(){document.body.classList.toggle('scrolled',scrollY>200);
  if(!document.body.classList.contains('inner')){let act=null;$$('[data-sec-target]').forEach(s=>{if(s.getBoundingClientRect().top<innerHeight*.4)act=s.id});sub.forEach(a=>a.classList.toggle('on',a.dataset.sec===act));const on=$('#subnav a.on'),ul=$('#subnav');if(on&&ul._last!==act){ul._last=act;const l=on.offsetLeft-ul.offsetLeft;if(l<ul.scrollLeft||l+on.offsetWidth>ul.scrollLeft+ul.clientWidth)ul.scrollTo({left:l-20,behavior:'smooth'})}}
  if(!reduce)$$('.view.active [data-par]').forEach(b=>{const r=b.parentElement.getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight)b.style.transform=`translateY(${(r.top-innerHeight/2)*-.08}px)`});
}
addEventListener('scroll',onScroll,{passive:true});
$('#topBtn').onclick=()=>scrollTo({top:0,behavior:reduce?'auto':'smooth'});

/* ---------- theme ---------- */
$('#themeBtn').onclick=()=>{const dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;root.dataset.theme=dark?'light':'dark';store.set('vfi-theme',root.dataset.theme);toast(dark?'Light sections':'Dark sections')};

/* ---------- reveal & count ---------- */
let io;function observe(){if(io)io.disconnect();io=new IntersectionObserver(es=>es.forEach(en=>{if(!en.isIntersecting)return;const t=en.target;t.classList.add('in');const c=$('[data-count]',t);if(c)count(c);io.unobserve(t)}),{threshold:.15});$$('.view.active .rv:not(.in)').forEach(el=>io.observe(el))}
function count(el){if(el._d)return;el._d=1;const end=+el.dataset.count,f=n=>el.hasAttribute('data-fmt')?n.toLocaleString('en-IN'):n;if(reduce){el.textContent=f(end);return}const t0=performance.now();const tk=t=>{const p=Math.min(1,(t-t0)/1800),ez=1-Math.pow(1-p,4);el.textContent=f(Math.round(end*ez));if(p<1)requestAnimationFrame(tk)};requestAnimationFrame(tk)}

const drawer=$('#drawer');let lf=null;
function openDrawer(t,msg){if(dF.isSent())dF.reset();dF.resetClock();lf=document.activeElement;setOv(false);if(t)dF.setType(t);if(msg)dF.setMsg(msg);drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';setTimeout(()=>{const i=$('input[name=name]',drawer);i&&i.focus({preventScroll:true})},450)}
function closeDrawer(){if(!drawer.classList.contains('open'))return;drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');document.body.style.overflow='';lf&&lf.focus&&lf.focus()}
$$('[data-close]',drawer).forEach(b=>b.onclick=closeDrawer);
drawer.addEventListener('keydown',ev=>{if(ev.key!=='Tab')return;const f=$$('button,input,select,textarea',drawer).filter(x=>x.offsetParent);const a=f[0],z=f[f.length-1];if(ev.shiftKey&&document.activeElement===a){ev.preventDefault();z.focus()}else if(!ev.shiftKey&&document.activeElement===z){ev.preventDefault();a.focus()}});

route();onScroll();
}
})();
