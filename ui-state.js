/* AstroPlanner v0.14 R&D — persistent shell state; Planner workspace and Journal browsing state are intentionally transient */
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
  function transientUi(el){return inPlanner(el)||inJournal(el);}
  function persistable(el){
    if(!el?.id||transientUi(el))return false;
    if(el.type==='file'||el.type==='hidden'||el.type==='button'||el.type==='submit')return false;
    if(el.closest('#sessionModal'))return false; // session keeps its own dedicated draft
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
    writeJson(DRAFT_KEY,draft); // removes old Planner drafts and transient Journal search state
    try{
      const prefs=readJson('ap07_prefs',{});
      prefs.target=null;
      prefs.project='';
      writeJson('ap07_prefs',prefs);
    }catch(_){}
  }
  function restoreValues(){
    for(const [id,value] of Object.entries(draft.values||{}))setValue(document.getElementById(id),value);
  }
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

  document.addEventListener('DOMContentLoaded',()=>setTimeout(restoreAll,0));
  document.addEventListener('DOMContentLoaded',()=>setTimeout(loadBortleIndicator,0));
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
