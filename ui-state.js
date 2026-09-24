/* AstroPlanner v0.14 R&D — persistent shell state; Planner workspace, Journal browsing and recommendations are intentionally transient */
(()=>{
  'use strict';
  const STORAGE_PREFIX='aprd014:';
  const storageKey=key=>STORAGE_PREFIX+String(key);
  const UI_KEY='ap0121_ui_state';
  const DRAFT_KEY='ap0121_form_draft';
  const SCHEMA=1;
  const APP_PAGES=['planner','projects','journal','equipment'];
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
      document.body.dataset.page='home';
    }finally{restoring=false;}
  }

  function detailOpen(key){return !!ui.details?.[String(key||'')];}
  function onPageChange(id){
    document.body.dataset.page=id||'home';
    if(APP_PAGES.includes(id)){ui.lastPage=id;writeJson(UI_KEY,{...ui,schema:SCHEMA});}
  }
  function openPlanner(){if(typeof switchPage==='function')switchPage('planner',true);}
  function continueWork(){const p=APP_PAGES.includes(ui.lastPage)?ui.lastPage:'planner';if(typeof switchPage==='function')switchPage(p,true);}

  window.AstroUI={onPageChange,openPlanner,continueWork,saveNow,scheduleSave,detailOpen};

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
      #plannerRecommendationsCard.plannerPanel{padding:0;overflow:hidden}
      #plannerRecommendationsCard .plannerRecommendationEntry{margin:0;padding:0;border-top:0}
      #plannerRecommendationsCard .plannerRecommendationEntry .secondary{width:100%;min-height:46px}
      #plannerRecommendationsCard .plannerRecommendationLead{line-height:1.55;margin:0 0 12px;color:var(--muted);font-size:12px}
      #plannerRecommendationsCard .plannerRecommendationsWrap{margin-top:12px}
      #plannerRecommendationsCard .recommendationContext{display:none!important}
      #plannerRecommendationsCard .recommendationStatus[data-ui-hidden="1"]{display:none!important}
      .currentScoreMetric{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;text-align:center}
      .currentScoreMetric .k{align-self:stretch;text-align:left}
      .currentScoreRing{--score:0;--ring:var(--accent);position:relative;width:64px;height:64px;margin:5px auto 2px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--ring) calc(var(--score)*1%),rgba(106,167,255,.13) 0)}
      .currentScoreRing::before{content:"";position:absolute;inset:5px;border-radius:50%;background:#0b1221}
      .currentScoreRingValue{position:relative;z-index:1;font-size:20px;font-weight:850;line-height:1;color:#eef3ff}
      .currentScoreRingValue small{display:block;margin-top:2px;font-size:9px;font-weight:700;color:var(--muted)}
      .currentScoreMetric .scoreCaption{font-size:10px;color:var(--muted);margin-top:2px;line-height:1.2}
      .currentScoreMetric.scoreBad .currentScoreRing{--ring:var(--bad)}
      .currentScoreMetric.scoreWarn .currentScoreRing{--ring:var(--warn)}
      .currentScoreMetric.scoreGood .currentScoreRing{--ring:var(--good)}
    `;
    document.head.appendChild(style);
  }

  function placeRecommendationsBetweenNightAndAnalysis(){
    const night=document.getElementById('plannerNightPanel');
    const analysis=document.getElementById('plannerAnalysisPanel');
    const button=document.getElementById('plannerRecommendationsBtn');
    const wrap=document.getElementById('plannerRecommendationsWrap');
    if(!night||!analysis||!button||!wrap)return;

    const oldCard=button.closest('.card');
    const oldLead=oldCard?.querySelector('.plannerRecommendationLead');
    let card=document.getElementById('plannerRecommendationsCard');
    if(card&&card.tagName!=='DETAILS')card=null;

    let entry=button.closest('.plannerRecommendationEntry');
    if(!entry){
      entry=document.createElement('div');
      entry.className='plannerRecommendationEntry';
      button.parentNode?.insertBefore(entry,button);
      entry.appendChild(button);
    }
    button.textContent='Pokaż rekomendacje';

    if(!card){
      card=document.createElement('details');
      card.id='plannerRecommendationsCard';
      card.className='card plannerPanel plannerRecommendationsCard';
      card.innerHTML='<summary><span>Co fotografować?</span><small>ranking nocy</small></summary><div class="plannerPanelBody"></div>';
      const body=card.querySelector('.plannerPanelBody');
      const lead=oldLead||document.createElement('div');
      if(!oldLead){lead.className='plannerRecommendationLead';lead.textContent='Nie wiesz, który projekt wybrać? Ranking porówna aktywne i planowane cele dla bieżącej daty, lokalizacji i ustawień nocy.';}
      body.appendChild(lead);
      body.appendChild(entry);
      body.appendChild(wrap);
      if(oldCard&&oldCard!==night&&oldCard!==analysis)oldCard.replaceWith(card);
      else analysis.parentNode.insertBefore(card,analysis);
      card.open=false;
    }else{
      const body=card.querySelector('.plannerPanelBody');
      if(body){if(!body.contains(entry))body.appendChild(entry);if(!body.contains(wrap))body.appendChild(wrap);}
    }

    night.querySelectorAll('.plannerRecommendationEntry').forEach(el=>{if(el!==entry&&!el.children.length)el.remove();});
    if(card.nextElementSibling!==analysis)analysis.parentNode.insertBefore(card,analysis);
    syncRecommendationStatusVisibility();
  }

  function syncRecommendationStatusVisibility(){
    const context=document.getElementById('recommendContext');
    if(context)context.style.display='none';
    const status=document.getElementById('recommendStatus');
    if(!status)return;
    const update=()=>{
      const text=String(status.textContent||'').trim();
      const technical=!text||text.startsWith('Score:')||text.startsWith('Otwórz ranking');
      status.dataset.uiHidden=technical?'1':'0';
    };
    update();
    if(!status.__uiObserver){status.__uiObserver=new MutationObserver(update);status.__uiObserver.observe(status,{childList:true,subtree:true,characterData:true});}
  }

  function cleanPlannerMapInfo(){
    const info=document.getElementById('plannerMapInfo');
    if(!info||!info.innerHTML.includes('Mapa działa już teraz.'))return;
    info.innerHTML=info.innerHTML.replace('Mapa działa już teraz. Wybierz setup kadru, aby dołożyć rzeczywisty FOV.','Wybierz setup, aby wyświetlić FOV.');
  }

  function patchPlannerMapInfo(){
    const base=window.renderPlannerMap;
    if(typeof base!=='function'||base.__uiMapInfoPatched)return;
    const wrapped=function(...args){const out=base.apply(this,args);cleanPlannerMapInfo();return out;};
    wrapped.__uiMapInfoPatched=true;
    window.renderPlannerMap=wrapped;
    cleanPlannerMapInfo();
  }

  let currentScoreSeq=0;
  function scoreClass(score){return score>=65?'scoreGood':score>=25&&score<45?'scoreWarn':score<25?'scoreBad':'';}
  function scoreCaption(score){return score>=85?'bardzo dobre':score>=65?'dobre':score>=45?'umiarkowane':score>=25?'słabe':'bardzo słabe';}

  function ensureCurrentScoreMetric(){
    const metrics=document.getElementById('metrics');
    if(!metrics||!metrics.children.length)return null;
    let slot=metrics.querySelector('.currentScoreMetric');
    if(slot)return slot;
    const projectSlot=[...metrics.children].find(el=>String(el.querySelector?.('.k')?.textContent||'').trim()==='Projekt');
    slot=projectSlot||document.createElement('div');
    slot.className='metric currentScoreMetric';
    if(!projectSlot)metrics.appendChild(slot);
    return slot;
  }

  function paintCurrentScore(slot,result){
    if(!slot)return;
    if(!result||!Number.isFinite(Number(result.score))){
      slot.className='metric currentScoreMetric';
      slot.innerHTML='<div class="k">Score</div><div class="currentScoreRing" style="--score:0"><div class="currentScoreRingValue">—<small>/100</small></div></div><div class="scoreCaption">brak danych</div>';
      return;
    }
    const score=Math.max(0,Math.min(100,Math.round(Number(result.score))));
    slot.className=`metric currentScoreMetric ${scoreClass(score)}`;
    slot.title=String(result.reason||'');
    slot.innerHTML=`<div class="k">Score</div><div class="currentScoreRing" style="--score:${score}"><div class="currentScoreRingValue">${score}<small>/100</small></div></div><div class="scoreCaption">${scoreCaption(score)}</div>`;
  }

  async function currentScoreSky(lat,lon){
    // AstroBortle already owns the persistent/browser cache. Do not keep a second
    // Score-only cache here: a transient null/error used to become permanent for
    // this lat/lon and could make Analysis score without SQM while the ranking
    // recomputed the same project with SQM a moment later.
    for(let i=0;i<12;i++){
      if(window.AstroBortle?.estimateAt){
        try{return await window.AstroBortle.estimateAt(Number(lat),Number(lon));}
        catch(_){return null;}
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return null;
  }

  function scoreSubject(){
    let project=null;
    try{if(typeof window.plannerProject==='function')project=window.plannerProject();}catch(_){project=null;}
    if(project)return project;
    const prefs=window.__prefs?.target||{};
    const name=String(prefs.name||document.getElementById('selectedObject')?.dataset?.name||'').trim();
    const ra=String(document.getElementById('raInput')?.value||prefs.ra||'').trim();
    const dec=String(document.getElementById('decInput')?.value||prefs.dec||'').trim();
    if(!name||!ra||!dec)return null;
    return{
      name,
      profileId:String(document.getElementById('newProjectProfile')?.value||''),
      target:{name,ra,dec,type:prefs.type||'',catalog:prefs.catalog||''}
    };
  }

  async function updateCurrentTargetScore(plan){
    const seq=++currentScoreSeq;
    const slot=ensureCurrentScoreMetric();
    if(!slot)return;
    paintCurrentScore(slot,null);
    const api=window.AstroRecommend,metaApi=window.AstroTargetMetadata,filterApi=window.AstroFilterProfiles;
    const raParser=window.parseRA,decParser=window.parseDec,dateFn=window.sessionDate;
    const astro={altitude:window.altitude,sunPos:window.sunPos,moonPos:window.moonPos,sep:window.sep};
    if(!api||!metaApi||!filterApi||typeof raParser!=='function'||typeof decParser!=='function'||typeof dateFn!=='function'||Object.values(astro).some(fn=>typeof fn!=='function'))return;

    const lat=Number(document.getElementById('latInput')?.value),lon=Number(document.getElementById('lonInput')?.value),minAltitudeDeg=Number(document.getElementById('minAltInput')?.value),sunLimitDeg=Number(document.getElementById('nightMode')?.value),date=dateFn();
    if(!date||![lat,lon,minAltitudeDeg,sunLimitDeg].every(Number.isFinite))return;
    const subject=scoreSubject();if(!subject)return;

    // For a loaded project use exactly the same sky coordinates as the ranking.
    // recommendationProjectCoords() intentionally prefers the saved framing centre
    // when the project has one; the previous Analysis path always used target RA/Dec.
    let coords=null;
    try{if(typeof window.recommendationProjectCoords==='function'&&typeof window.plannerProject==='function'&&window.plannerProject())coords=window.recommendationProjectCoords(subject);}catch(_){coords=null;}
    if(!coords){
      const raDeg=raParser(document.getElementById('raInput')?.value),decDeg=decParser(document.getElementById('decInput')?.value);
      if(![raDeg,decDeg].every(Number.isFinite))return;
      coords={raDeg,decDeg};
    }

    let context,metadata,material;
    try{
      context=api.buildContext({date,lat,lon,astro,stepMinutes:5});
      const pool=typeof window.catalogObjectPool==='function'?window.catalogObjectPool():[];
      // Ranking prepares signal metadata before scoring. Do the same in Analysis so
      // an object cannot be scored once with fallback metadata and once with the
      // indexed/supplemented catalogue metadata.
      if(typeof metaApi.prepareSignalData==='function')await metaApi.prepareSignalData([subject],pool);
      if(seq!==currentScoreSeq)return;
      metadata=metaApi.projectMetadata(subject,pool);
      const equipment=typeof window.getEquipment==='function'?window.getEquipment():undefined;
      material=filterApi.projectProfile(subject,equipment);
    }catch(e){console.warn('Current target score setup failed',e);return;}
    const sky=await currentScoreSky(lat,lon);if(seq!==currentScoreSeq)return;
    try{
      const result=api.scoreTarget({...coords,classKey:metadata.photoClass,metadata,materialProfile:material,context,astro,sky,minAltitudeDeg,sunLimitDeg});
      if(seq!==currentScoreSeq)return;
      paintCurrentScore(slot,result);
      window.__currentTargetScore=result;
    }catch(e){console.warn('Current target score failed',e);}
  }

  function installCurrentTargetScore(){
    const base=window.calculate;
    if(typeof base!=='function'||base.__uiScorePatched)return;
    const wrapped=function(...args){const plan=base.apply(this,args);setTimeout(()=>updateCurrentTargetScore(plan),0);return plan;};
    wrapped.__uiScorePatched=true;
    window.calculate=wrapped;
    if(window.__lastPlan)setTimeout(()=>updateCurrentTargetScore(window.__lastPlan),0);
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

  function applyV014Layout(){
    ensureLayoutStyle();
    placeRecommendationsBetweenNightAndAnalysis();
    syncRecommendationStatusVisibility();
    patchPlannerMapInfo();
    patchComponentPhotometry();
    installCurrentTargetScore();
  }

  document.addEventListener('DOMContentLoaded',()=>setTimeout(restoreAll,0));
  document.addEventListener('DOMContentLoaded',()=>setTimeout(loadBortleIndicator,0));
  document.addEventListener('DOMContentLoaded',()=>setTimeout(applyV014Layout,0));
  document.addEventListener('input',e=>{if(persistable(e.target))scheduleSave();},true);
  document.addEventListener('change',e=>{
    if(persistable(e.target)||e.target?.matches?.('main details')&&!transientUi(e.target))scheduleSave();
    if(['newProjectProfile','plannerMapProfileSelect'].includes(e.target?.id)&&window.__lastPlan)setTimeout(()=>updateCurrentTargetScore(window.__lastPlan),0);
  },true);
  document.addEventListener('toggle',e=>{if(e.target?.matches?.('main details')&&!transientUi(e.target))scheduleSave();},true);
  document.addEventListener('click',e=>{
    const id=e.target?.closest?.('button')?.id;
    if(['addProjectBtn','addTelBtn','addCorrBtn','addCamBtn','addFilterBtn','addProfileBtn','addDarkBtn','addMdfBtn','saveLocationBtn','addCustomObjectBtn'].includes(id))setTimeout(saveNow,120);
  },true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveNow();});
  window.addEventListener('pagehide',saveNow);
})();
