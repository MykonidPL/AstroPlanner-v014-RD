/* AstroPlanner v0.14 R&D — persistent shell state; Planner workspace, Journal browsing and recommendations are intentionally transient */
(()=>{
  'use strict';
  const STORAGE_PREFIX='aprd014:';
  const storageKey=key=>STORAGE_PREFIX+String(key);
  const UI_KEY='ap0121_ui_state';
  const DRAFT_KEY='ap0121_form_draft';
  const SCHEMA=1;
  const APP_PAGES=['planner','projects','journal','equipment'];
  const PAGE_NAMES={planner:'Planer',projects:'Projekty',journal:'Dziennik',equipment:'Sprzęt'};
  const SAVE_DELAY=280;

  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(storageKey(key))||'')||fallback;}catch(_){return fallback;}};
  const writeJson=(key,value)=>{try{localStorage.setItem(storageKey(key),JSON.stringify(value));}catch(e){console.warn('AstroUI persistence',e);}};
  let ui=readJson(UI_KEY,{schema:SCHEMA,lastPage:'planner',projectView:'active',details:{}});
  let draft=readJson(DRAFT_KEY,{schema:SCHEMA,values:{}});
  if(ui.schema!==SCHEMA)ui={schema:SCHEMA,lastPage:'planner',projectView:'active',details:{}};
  if(draft.schema!==SCHEMA)draft={schema:SCHEMA,values:{}};
  let saveTimer=0;
  let restoring=false;

  function inPlanner(el){return !!el?.closest?.('#planner');}
  function inJournal(el){return !!el?.closest?.('#journal');}
  function inRecommendations(el){return !!el?.closest?.('#recommendations');}
  function transientUi(el){return inPlanner(el)||inJournal(el)||inRecommendations(el);}
  function persistable(el){
    if(!el?.id||transientUi(el))return false;
    if(el.type==='file'||el.type==='hidden'||el.type==='button'||el.type==='submit')return false;
    if(el.closest('#sessionModal'))return false;
    return !!el.closest('main');
  }
  function collectValues(){
    const values={};
    document.querySelectorAll('main input[id],main select[id],main textarea[id]').forEach(el=>{
      if(persistable(el))values[el.id]=el.type==='checkbox'?!!el.checked:el.value;
    });
    return values;
  }
  function detailKey(el,index){return el.id||el.dataset.uiStateKey||`${el.closest('.page')?.id||'app'}:${index}`;}
  function collectDetails(){
    const out={};
    [...document.querySelectorAll('main details')].forEach((el,i)=>{
      if(!transientUi(el))out[detailKey(el,i)]=!!el.open;
    });
    return out;
  }
  function saveNow(){
    if(restoring)return;
    clearTimeout(saveTimer);
    const page=document.querySelector('.page.active')?.id;
    if(APP_PAGES.includes(page))ui.lastPage=page;
    if(typeof window.__projectView==='string')ui.projectView=window.__projectView;
    ui.details={...(ui.details||{}),...collectDetails()};
    ui.schema=SCHEMA;
    draft={schema:SCHEMA,values:collectValues(),savedAt:Date.now()};
    writeJson(UI_KEY,ui);
    writeJson(DRAFT_KEY,draft);
    renderHome();
  }
  function scheduleSave(){if(restoring)return;clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,SAVE_DELAY);}

  function setValue(el,value){
    if(!el||transientUi(el)||value===undefined||value===null)return;
    if(el.type==='checkbox'){el.checked=!!value;return;}
    if(el.tagName==='SELECT'){
      if([...el.options].some(o=>String(o.value)===String(value)))el.value=String(value);
      return;
    }
    el.value=String(value);
  }
  function sanitizeTransientDraft(){
    const values={};
    for(const [id,value] of Object.entries(draft.values||{})){
      const el=document.getElementById(id);
      if(el&&!transientUi(el))values[id]=value;
    }
    draft={schema:SCHEMA,values,savedAt:Date.now()};
    writeJson(DRAFT_KEY,draft);
    try{
      const prefs=readJson('ap07_prefs',{});
      prefs.target=null;
      prefs.project='';
      writeJson('ap07_prefs',prefs);
    }catch(_){}
  }
  function restoreValues(){for(const [id,value] of Object.entries(draft.values||{}))setValue(document.getElementById(id),value);}
  function restoreDetails(){
    [...document.querySelectorAll('main details')].forEach((el,i)=>{
      if(transientUi(el))return;
      const key=detailKey(el,i);
      if(Object.prototype.hasOwnProperty.call(ui.details||{},key))el.open=!!ui.details[key];
    });
  }
  function renderHome(){
    try{
      const projects=typeof getProjects==='function'?getProjects():[];
      const sessions=typeof getSessions==='function'?getSessions():[];
      const active=projects.filter(p=>(p.status||'active')==='active').length;
      const planned=projects.filter(p=>p.status==='planned').length;
      const a=document.getElementById('homeActiveCount'),p=document.getElementById('homePlannedCount'),s=document.getElementById('homeSessionCount');
      if(a)a.textContent=String(active);if(p)p.textContent=String(planned);if(s)s.textContent=String(sessions.length);
      const cont=document.getElementById('homeContinueBtn');
      if(cont){const page=APP_PAGES.includes(ui.lastPage)?ui.lastPage:'planner';cont.textContent=`Kontynuuj: ${PAGE_NAMES[page]}`;cont.dataset.page=page;cont.style.display=page==='planner'?'none':'';}
    }catch(_){ }
  }
  function restoreAll(){
    restoring=true;
    try{
      window.__projectView=ui.projectView||'active';
      if(typeof renderProjects==='function')renderProjects();
      sanitizeTransientDraft();
      restoreValues();
      try{if(typeof updateCameraKindUI==='function')updateCameraKindUI();}catch(_){}
      try{if(typeof updateProfileMetricsPreview==='function')updateProfileMetricsPreview();}catch(_){}
      restoreDetails();
      renderHome();
      document.body.dataset.page='home';
    }finally{restoring=false;}
  }

  function detailOpen(key){return !!ui.details?.[String(key||'')];}
  function onPageChange(id){
    document.body.dataset.page=id||'home';
    if(APP_PAGES.includes(id)){ui.lastPage=id;writeJson(UI_KEY,{...ui,schema:SCHEMA});}
    if(id==='home')renderHome();
  }
  function openPlanner(){if(typeof switchPage==='function')switchPage('planner',true);}
  function continueWork(){const p=APP_PAGES.includes(ui.lastPage)?ui.lastPage:'planner';if(typeof switchPage==='function')switchPage(p,true);}

  window.AstroUI={onPageChange,openPlanner,continueWork,saveNow,scheduleSave,renderHome,detailOpen};

  function loadBortleIndicator(){
    if(document.querySelector('script[data-astro-bortle]'))return;
    const s=document.createElement('script');
    s.src='./bortle-indicator.js';
    s.dataset.astroBortle='1';
    s.addEventListener('error',()=>console.warn('AstroPlanner Bortle indicator failed to load'));
    document.head.appendChild(s);
  }

  /* v0.14 R&D — final Planner placement + intentionally minimal home screen. */
  function ensureLayoutStyle(){
    if(document.getElementById('astroV014LayoutStyle'))return;
    const style=document.createElement('style');
    style.id='astroV014LayoutStyle';
    style.textContent=`
      #home .homeHero{gap:0}
      #home .homeLogoWrap{width:156px;height:156px;border-radius:40px;padding:9px}
      #home .homeLogo{border-radius:32px}
      #home .homeAppName{margin-top:22px;font-size:22px;font-weight:800;letter-spacing:.01em;color:#f3f7ff}
      #home .homeVersion{margin-top:8px;font-size:10px;letter-spacing:.08em;color:#6f7d99}
      .plannerRecommendationsCard{padding:14px 14px 15px}
      .plannerRecommendationsCard .recommendationStandaloneHead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px}
      .plannerRecommendationsCard .recommendationStandaloneHead h2{margin:0}
      .plannerRecommendationsCard .plannerRecommendationEntry{margin:0;padding:0;border-top:0}
      .plannerRecommendationsCard .plannerRecommendationEntry .secondary{width:100%;min-height:46px}
      .plannerRecommendationsCard .plannerRecommendationsWrap{margin-top:12px}
    `;
    document.head.appendChild(style);
  }

  function simplifyHome(){
    const hero=document.querySelector('#home .homeHero');
    if(!hero||hero.dataset.minimalHome==='1')return;
    hero.dataset.minimalHome='1';
    hero.innerHTML=`
      <div class="homeLogoWrap"><img class="homeLogo" src="./icon-192.png" alt="AstroPlanner"></div>
      <div class="homeAppName">AstroPlanner</div>
      <div class="homeVersion">v0.14 R&amp;D</div>`;
  }

  function placeRecommendationsBetweenNightAndAnalysis(){
    const night=document.getElementById('plannerNightPanel');
    const analysis=document.getElementById('plannerAnalysisPanel');
    const button=document.getElementById('plannerRecommendationsBtn');
    const wrap=document.getElementById('plannerRecommendationsWrap');
    if(!night||!analysis||!button||!wrap)return;

    let card=document.getElementById('plannerRecommendationsCard');
    const existingCard=button.closest('.card');
    if(!card&&existingCard&&existingCard!==night&&existingCard!==analysis){
      card=existingCard;
      card.id='plannerRecommendationsCard';
      card.classList.add('plannerRecommendationsCard');
    }
    if(!card){
      card=document.createElement('section');
      card.id='plannerRecommendationsCard';
      card.className='card plannerRecommendationsCard';
      const head=document.createElement('div');
      head.className='recommendationStandaloneHead';
      head.innerHTML='<h2>Co fotografować?</h2><span class="small">ranking nocy</span>';
      card.appendChild(head);
    }

    let entry=button.closest('.plannerRecommendationEntry');
    if(!entry){
      entry=document.createElement('div');
      entry.className='plannerRecommendationEntry';
      button.parentNode?.insertBefore(entry,button);
      entry.appendChild(button);
    }
    if(!card.contains(entry))card.appendChild(entry);
    if(!card.contains(wrap))card.appendChild(wrap);

    /* Remove an obsolete empty recommendation container left in Warunki nocy. */
    night.querySelectorAll('.plannerRecommendationEntry').forEach(el=>{if(el!==entry&&!el.children.length)el.remove();});
    if(card.nextElementSibling!==analysis)analysis.parentNode.insertBefore(card,analysis);
  }

  /* Curated photographic identity can differ from the catalogue component carrying
     the integrated magnitude. Example: M45 is ranked as reflection dust, while its
     catalogue magnitude describes the stellar cluster. Never feed that stellar
     photometry into the dust S/N model. */
  function patchComponentPhotometry(){
    const api=window.AstroTargetMetadata;
    if(!api||api.__componentPhotometryPatched)return;
    const stellarCodes=new Set(['OCl','GCl','*Ass','*','**']);
    const fix=meta=>{
      if(!meta||meta.physicalType!=='reflection-nebula'||!stellarCodes.has(String(meta.rawTypeCode||'')))return meta;
      const s=meta.signal||{};
      if(s.model==='component-photometry-mismatch')return meta;
      return Object.freeze({...meta,signal:Object.freeze({
        ...s,
        model:'component-photometry-mismatch',
        confidence:'low',
        integratedMagnitude:null,
        magnitudeBand:null,
        surfaceBrightnessMagArcsec2:null,
        surfaceBrightnessSource:null,
        photometryAppliesTo:'stellar-component'
      })});
    };
    const metadataForObject=api.metadataForObject?.bind(api);
    const projectMetadata=api.projectMetadata?.bind(api);
    const signalSummary=api.signalSummary?.bind(api);
    if(metadataForObject)api.metadataForObject=(...args)=>fix(metadataForObject(...args));
    if(projectMetadata)api.projectMetadata=(...args)=>fix(projectMetadata(...args));
    if(signalSummary)api.signalSummary=meta=>meta?.signal?.model==='component-photometry-mismatch'
      ?'fotometria katalogowa dotyczy składnika gwiazdowego, nie pyłu refleksyjnego'
      :signalSummary(meta);
    api.__componentPhotometryPatched=true;
  }

  function applyV014Layout(){ensureLayoutStyle();simplifyHome();placeRecommendationsBetweenNightAndAnalysis();patchComponentPhotometry();}

  document.addEventListener('DOMContentLoaded',()=>setTimeout(restoreAll,0));
  document.addEventListener('DOMContentLoaded',()=>setTimeout(loadBortleIndicator,0));
  document.addEventListener('DOMContentLoaded',()=>setTimeout(applyV014Layout,0));
  document.addEventListener('input',e=>{if(persistable(e.target))scheduleSave();},true);
  document.addEventListener('change',e=>{if(persistable(e.target)||e.target?.matches?.('main details')&&!transientUi(e.target))scheduleSave();},true);
  document.addEventListener('toggle',e=>{if(e.target?.matches?.('main details')&&!transientUi(e.target))scheduleSave();},true);
  document.addEventListener('click',e=>{
    const id=e.target?.closest?.('button')?.id;
    if(['addProjectBtn','addTelBtn','addCorrBtn','addCamBtn','addFilterBtn','addProfileBtn','addDarkBtn','addMdfBtn','saveLocationBtn','addCustomObjectBtn'].includes(id))setTimeout(saveNow,120);
  },true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveNow();});
  window.addEventListener('pagehide',saveNow);
})();
