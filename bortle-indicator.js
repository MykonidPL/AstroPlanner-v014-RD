/* AstroPlanner — automatic Bortle estimate for the current Planner location. */
(()=>{
  'use strict';

  const API='https://nordapi.ee/api/v1/lightpollution';
  const CACHE_KEY='aprd014:bortle_cache_v1';
  const CACHE_TTL=30*24*60*60*1000;
  const MAX_CACHE_ROWS=32;
  const REQUEST_TIMEOUT=8000;
  let requestSeq=0;
  let current=null;

  const $=id=>document.getElementById(id);
  const validCoords=(lat,lon)=>Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lon)&&Math.abs(lon)<=180;
  const coordKey=(lat,lon)=>`${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;

  function readCache(){
    try{
      const value=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');
      return value&&typeof value==='object'?value:{};
    }catch(_){return {};}
  }

  function writeCache(key,row){
    try{
      const cache=readCache();
      cache[key]=row;
      const trimmed=Object.entries(cache)
        .sort((a,b)=>Number(b[1]?.savedAt||0)-Number(a[1]?.savedAt||0))
        .slice(0,MAX_CACHE_ROWS);
      localStorage.setItem(CACHE_KEY,JSON.stringify(Object.fromEntries(trimmed)));
    }catch(e){console.warn('AstroPlanner Bortle cache',e);}
  }

  function cachedEstimate(lat,lon){
    const row=readCache()[coordKey(lat,lon)];
    if(!row||Date.now()-Number(row.savedAt||0)>CACHE_TTL)return null;
    const bortle=Number(row.bortle);
    if(!(bortle>=1&&bortle<=9))return null;
    return {...row,bortle};
  }

  function findEstimateObject(value,depth=0){
    if(!value||typeof value!=='object'||depth>4)return null;
    const b=Number(value.bortle_class??value.bortleClass??value.bortle);
    if(b>=1&&b<=9)return value;
    for(const key of ['light_pollution','lightPollution','data','result','estimate']){
      const hit=findEstimateObject(value[key],depth+1);
      if(hit)return hit;
    }
    return null;
  }

  function parseEstimate(payload,lat,lon){
    const row=findEstimateObject(payload);
    if(!row)throw new Error('Brak klasy Bortle w odpowiedzi');
    const bortle=Math.max(1,Math.min(9,Number(row.bortle_class??row.bortleClass??row.bortle)));
    const sqmRaw=Number(row.sqm_estimate??row.sqmEstimate??row.sqm);
    return{
      bortle,
      sqm:Number.isFinite(sqmRaw)?sqmRaw:null,
      lat:Number(lat),
      lon:Number(lon),
      source:'nordapi-population-estimate',
      savedAt:Date.now()
    };
  }

  function ensureIndicator(){
    let el=$('bortleIndicator');
    if(el)return el;
    const select=$('locationSelect');
    if(!select?.parentElement)return null;
    el=document.createElement('div');
    el.id='bortleIndicator';
    el.className='bortleIndicator';
    el.setAttribute('aria-live','polite');
    el.title='Szacunkowa klasa Bortle dla wybranych współrzędnych; nie jest pomiarem SQM na miejscu.';
    el.innerHTML='<span>Niebo</span><b>Bortle ≈ —</b>';
    select.insertAdjacentElement('afterend',el);
    return el;
  }

  function ensureStyle(){
    if($('astroBortleStyle'))return;
    const style=document.createElement('style');
    style.id='astroBortleStyle';
    style.textContent=`
      .bortleIndicator{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px;padding:6px 9px;border:1px solid rgba(157,181,225,.14);border-radius:9px;background:rgba(11,19,33,.55);font-size:10px;line-height:1.2;color:var(--ui-muted,var(--muted,#9faecc))}
      .bortleIndicator b{font-size:11px;color:#dce8ff;font-variant-numeric:tabular-nums;white-space:nowrap}
      .bortleIndicator[data-state="loading"] b{color:#9fb3d8}
      .bortleIndicator[data-state="error"] b{color:#c4cede}
    `;
    document.head.appendChild(style);
  }

  function render(state,estimate=null){
    const el=ensureIndicator();
    if(!el)return;
    el.dataset.state=state;
    const value=el.querySelector('b');
    if(!value)return;
    if(state==='ready'&&estimate){
      value.textContent=`Bortle ≈ ${Number(estimate.bortle).toFixed(0)}`;
      el.title='Szacunkowa klasa Bortle dla wybranych współrzędnych; nie jest pomiarem SQM na miejscu.';
    }else if(state==='loading'){
      value.textContent='Bortle ≈ …';
      el.title='Ustalanie przybliżonej klasy Bortle dla wybranej lokalizacji…';
    }else if(state==='error'){
      value.textContent='Bortle ≈ —';
      el.title='Nie udało się pobrać przybliżonej klasy Bortle. Planner działa normalnie bez tego wskaźnika.';
    }else{
      value.textContent='Bortle ≈ —';
      el.title='Podaj lub wybierz lokalizację, aby ustalić przybliżoną klasę Bortle.';
    }
  }

  async function refresh(options={}){
    const lat=Number($('latInput')?.value),lon=Number($('lonInput')?.value);
    if(!validCoords(lat,lon)){current=null;render('empty');return null;}
    const cached=!options.force?cachedEstimate(lat,lon):null;
    if(cached){current=cached;render('ready',cached);return cached;}

    const seq=++requestSeq;
    render('loading');
    const ctrl=typeof AbortController!=='undefined'?new AbortController():null;
    const timer=ctrl?setTimeout(()=>ctrl.abort(),REQUEST_TIMEOUT):null;
    try{
      const url=`${API}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
      const response=await fetch(url,{cache:'no-store',mode:'cors',...(ctrl?{signal:ctrl.signal}:{})});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const payload=await response.json();
      const estimate=parseEstimate(payload,lat,lon);
      if(seq!==requestSeq)return current;
      current=estimate;
      writeCache(coordKey(lat,lon),estimate);
      render('ready',estimate);
      return estimate;
    }catch(e){
      if(seq===requestSeq){current=null;render('error');}
      console.warn('AstroPlanner Bortle estimate',e);
      return null;
    }finally{if(timer)clearTimeout(timer);}
  }

  function hookRememberCoords(){
    if(typeof window.rememberCoords!=='function'||window.rememberCoords.__astroBortleWrapped)return;
    const original=window.rememberCoords;
    const wrapped=function(...args){
      const result=original.apply(this,args);
      if(result)setTimeout(()=>refresh(),0);
      return result;
    };
    wrapped.__astroBortleWrapped=true;
    window.rememberCoords=wrapped;
  }

  function init(){
    ensureStyle();
    ensureIndicator();
    hookRememberCoords();
    $('latInput')?.addEventListener('input',()=>{current=null;render('empty');});
    $('lonInput')?.addEventListener('input',()=>{current=null;render('empty');});
    $('latInput')?.addEventListener('change',()=>refresh());
    $('lonInput')?.addEventListener('change',()=>refresh());
    $('locationSelect')?.addEventListener('change',()=>setTimeout(()=>refresh(),0));
    refresh();
  }

  window.AstroBortle={
    refresh,
    getCurrent:()=>current?{...current}:null
  };

  init();
})();
