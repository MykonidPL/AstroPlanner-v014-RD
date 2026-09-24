/* AstroPlanner v0.14 R&D — automatic approximate Bortle indicator from modeled zenith sky brightness. */
(()=>{
  'use strict';

  const ATLAS_YEAR=2025;
  const ATLAS_COMMIT='afb94a2627325fc0915b66240050d67b95d12a74';
  const TILE_BASE=`https://raw.githubusercontent.com/djlorenz/djlorenz.github.io/${ATLAS_COMMIT}/astronomy/binary_tiles/${ATLAS_YEAR}`;
  const CACHE_KEY='aprd014:sky_brightness_cache_v2';
  const CACHE_TTL=30*24*60*60*1000;
  const MAX_CACHE_ROWS=32;
  const REQUEST_TIMEOUT=12000;
  const TILE_SIZE=600;
  const POINTS_PER_DEGREE=120;
  const LAT_MIN=-65;
  const LAT_MAX=75;

  let requestSeq=0;
  let current=null;
  let inputTimer=null;
  let activeRequest=null;
  let activeKey='';
  const tileMemory=new Map();

  const $=id=>document.getElementById(id);
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const mod=(n,m)=>((n%m)+m)%m;
  const parseCoord=v=>Number(String(v??'').trim().replace(',','.'));
  const validCoords=(lat,lon)=>Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lon)&&Math.abs(lon)<=180;
  const coordKey=(lat,lon)=>`${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;

  function readCoords(){
    return{lat:parseCoord($('latInput')?.value),lon:parseCoord($('lonInput')?.value)};
  }

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
    }catch(e){console.warn('AstroPlanner sky-brightness cache',e);}
  }

  function cachedEstimate(lat,lon){
    const row=readCache()[coordKey(lat,lon)];
    if(!row||Date.now()-Number(row.savedAt||0)>CACHE_TTL)return null;
    const bortle=Number(row.bortle),sqm=Number(row.sqm),lpi=Number(row.lightPollutionIndex);
    if(!(bortle>=1&&bortle<=9)||!Number.isFinite(sqm)||!Number.isFinite(lpi))return null;
    return{...row,bortle,sqm,lightPollutionIndex:lpi};
  }

  function tileForCoords(lat,lon){
    if(lat<LAT_MIN||lat>LAT_MAX)throw new Error(`Atlas ${ATLAS_YEAR} obejmuje szerokości ${LAT_MIN}°…${LAT_MAX}°`);
    const lonFromDateLine=mod(lon+180,360);
    const latFromStart=lat-LAT_MIN;
    const tilex=Math.floor(lonFromDateLine/5)+1;
    const tiley=Math.floor(latFromStart/5)+1;
    if(tiley<1||tiley>28)throw new Error('Lokalizacja poza zakresem atlasu');
    const ix=clamp(Math.round(POINTS_PER_DEGREE*(lonFromDateLine-5*(tilex-1)+1/240)),1,TILE_SIZE);
    const iy=clamp(Math.round(POINTS_PER_DEGREE*(latFromStart-5*(tiley-1)+1/240)),1,TILE_SIZE);
    return{tilex,tiley,ix,iy};
  }

  async function maybeGunzip(buffer){
    const bytes=new Uint8Array(buffer);
    if(!(bytes[0]===0x1f&&bytes[1]===0x8b))return buffer;
    if(typeof DecompressionStream!=='function')throw new Error('Przeglądarka nie obsługuje dekompresji gzip');
    const stream=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).arrayBuffer();
  }

  async function loadTile(tilex,tiley,signal){
    const key=`${tilex}_${tiley}`;
    if(tileMemory.has(key))return tileMemory.get(key);
    const url=`${TILE_BASE}/binary_tile_${tilex}_${tiley}.dat.gz`;
    const response=await fetch(url,{mode:'cors',cache:'force-cache',signal});
    if(!response.ok)throw new Error(`Atlas HTTP ${response.status}`);
    const decoded=await maybeGunzip(await response.arrayBuffer());
    const data=new Int8Array(decoded);
    if(data.length<TILE_SIZE*TILE_SIZE+1)throw new Error('Niepełny kafel atlasu');
    tileMemory.set(key,data);
    return data;
  }

  function compressedAt(data,ix,iy){
    // Decoder matches the public David Lorenz atlas viewer. The lower-left value uses two bytes;
    // subsequent bytes store signed deltas along latitude and then longitude.
    let compressed=128*Number(data[0])+Number(data[1]);
    for(let i=1;i<iy;i++)compressed+=Number(data[TILE_SIZE*i+1]);
    for(let i=1;i<ix;i++)compressed+=Number(data[TILE_SIZE*(iy-1)+1+i]);
    return compressed;
  }

  function compressedToLpi(value){
    return(5/195)*(Math.exp(0.0195*value)-1);
  }

  function lpiToSqm(lpi){
    return 22-5*Math.log(1+lpi)/Math.log(100);
  }

  function lpZone(lpi){
    if(lpi<0.01)return'0';
    if(lpi<0.06)return'1a';
    if(lpi<0.11)return'1b';
    if(lpi<0.19)return'2a';
    if(lpi<0.33)return'2b';
    if(lpi<0.58)return'3a';
    if(lpi<1.00)return'3b';
    if(lpi<1.73)return'4a';
    if(lpi<3.00)return'4b';
    if(lpi<5.20)return'5a';
    if(lpi<9.00)return'5b';
    if(lpi<15.59)return'6a';
    if(lpi<27.00)return'6b';
    if(lpi<46.77)return'7a';
    return'7b';
  }

  // Deliberately approximate: Bortle is a visual whole-sky classification, while the atlas models zenith brightness.
  function approximateBortle(sqm){
    if(sqm>=21.99)return 1;
    if(sqm>=21.89)return 2;
    if(sqm>=21.69)return 3;
    if(sqm>=20.49)return 4;
    if(sqm>=19.50)return 5;
    if(sqm>=18.94)return 6;
    if(sqm>=18.38)return 7;
    if(sqm>=17.00)return 8;
    return 9;
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
      el.title=`Orientacyjna klasa Bortle wyprowadzona z modelowanej jasności zenitu ${ATLAS_YEAR} (SQM ≈ ${Number(estimate.sqm).toFixed(2)} mag/arcsec², LP ${estimate.lpZone}). Nie jest terenową oceną Bortle ani pomiarem SQM.`;
    }else if(state==='loading'){
      value.textContent='Bortle ≈ …';
      el.title=`Pobieranie modelowanej jasności nieba z atlasu ${ATLAS_YEAR}…`;
    }else if(state==='error'){
      value.textContent='Bortle ≈ —';
      el.title='Nie udało się ustalić przybliżonej jasności nieba. Planner działa normalnie bez tego wskaźnika.';
    }else{
      value.textContent='Bortle ≈ —';
      el.title='Podaj lub wybierz lokalizację, aby ustalić przybliżoną jasność nieba.';
    }
  }

  async function resolveEstimate(lat,lon,signal){
    const tile=tileForCoords(lat,lon);
    const data=await loadTile(tile.tilex,tile.tiley,signal);
    const compressed=compressedAt(data,tile.ix,tile.iy);
    const lightPollutionIndex=compressedToLpi(compressed);
    if(!Number.isFinite(lightPollutionIndex)||lightPollutionIndex<0)throw new Error('Nieprawidłowa wartość atlasu');
    const sqm=lpiToSqm(lightPollutionIndex);
    return{
      bortle:approximateBortle(sqm),
      sqm,
      lightPollutionIndex,
      lpZone:lpZone(lightPollutionIndex),
      lat:Number(lat),
      lon:Number(lon),
      source:'david-lorenz-light-pollution-atlas',
      year:ATLAS_YEAR,
      savedAt:Date.now()
    };
  }

  async function refresh(options={}){
    const{lat,lon}=readCoords();
    if(!validCoords(lat,lon)){current=null;render('empty');return null;}
    const key=coordKey(lat,lon);
    const cached=!options.force?cachedEstimate(lat,lon):null;
    if(cached){current=cached;render('ready',cached);return cached;}
    if(!options.force&&activeRequest&&activeKey===key)return activeRequest;

    const seq=++requestSeq;
    render('loading');
    const ctrl=typeof AbortController!=='undefined'?new AbortController():null;
    const timer=ctrl?setTimeout(()=>ctrl.abort(),REQUEST_TIMEOUT):null;
    activeKey=key;
    activeRequest=(async()=>{
      try{
        const estimate=await resolveEstimate(lat,lon,ctrl?.signal);
        if(seq!==requestSeq)return current;
        current=estimate;
        writeCache(key,estimate);
        render('ready',estimate);
        return estimate;
      }catch(e){
        if(seq===requestSeq){current=null;render('error');}
        console.warn('AstroPlanner sky-brightness estimate',e);
        return null;
      }finally{
        if(timer)clearTimeout(timer);
        if(activeKey===key){activeKey='';activeRequest=null;}
      }
    })();
    return activeRequest;
  }

  async function estimateAt(lat,lon,options={}){
    lat=parseCoord(lat);lon=parseCoord(lon);
    if(!validCoords(lat,lon))return null;
    const cached=!options.force?cachedEstimate(lat,lon):null;
    if(cached)return cached;
    const ctrl=typeof AbortController!=='undefined'?new AbortController():null;
    const timer=ctrl?setTimeout(()=>ctrl.abort(),REQUEST_TIMEOUT):null;
    try{
      const estimate=await resolveEstimate(lat,lon,ctrl?.signal);
      writeCache(coordKey(lat,lon),estimate);
      return estimate;
    }catch(e){
      console.warn('AstroPlanner sky-brightness estimateAt',e);
      return null;
    }finally{if(timer)clearTimeout(timer);}
  }

  function scheduleInputRefresh(){
    current=null;
    render('empty');
    if(inputTimer)clearTimeout(inputTimer);
    inputTimer=setTimeout(()=>refresh(),500);
  }

  function hookRememberCoords(){
    if(typeof window.rememberCoords!=='function'||window.rememberCoords.__astroBortleWrapped)return false;
    const original=window.rememberCoords;
    const wrapped=function(...args){
      const result=original.apply(this,args);
      setTimeout(()=>refresh(),0);
      return result;
    };
    wrapped.__astroBortleWrapped=true;
    window.rememberCoords=wrapped;
    return true;
  }

  function init(){
    ensureStyle();
    ensureIndicator();
    hookRememberCoords();
    $('latInput')?.addEventListener('input',scheduleInputRefresh);
    $('lonInput')?.addEventListener('input',scheduleInputRefresh);
    $('latInput')?.addEventListener('change',()=>refresh());
    $('lonInput')?.addEventListener('change',()=>refresh());
    $('locationSelect')?.addEventListener('change',()=>setTimeout(()=>refresh(),30));

    // Runtime restores some Planner fields programmatically; retry after that restore and retry wrapping rememberCoords.
    setTimeout(()=>{hookRememberCoords();refresh();},0);
    setTimeout(()=>{hookRememberCoords();if(!current)refresh();},300);
    setTimeout(()=>{hookRememberCoords();if(!current)refresh();},1200);
  }

  window.AstroBortle={
    refresh,
    estimateAt,
    getCurrent:()=>current?{...current}:null
  };

  init();
})();
