(function(global){
  'use strict';

  // AstroPlanner v0.14 R&D — continuous DSS2 Color HiPS raster under the AstroPlanner SVG.
  // Initial reveal is guarded against a blank/white WebGL canvas. After the first
  // verified DSS2 frame, pan/zoom keeps the live Aladin HiPS canvas visible while
  // its tile pyramid refines in place; temporary tile fetches must not blank the map.

  const ALADIN_URL='https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js';
  const DSS2_SURVEY='P/DSS2/color';
  const D2R=Math.PI/180,R2D=180/Math.PI;
  const BG=[7,16,28];
  const MAX_RETRIES=3;
  const MAX_TILE_PROBES=12;

  let shell=null,stage=null,host=null;
  let aladin=null,initPromise=null,stageObserver=null,resizeObserver=null;
  let syncFrame=0,resizeKick=0,probeTimer=0,retryTimer=0,retryCount=0,tileProbeCount=0;
  let last={ra:NaN,dec:NaN,fov:NaN},failed=false,tileState='idle',lastError='',rasterTrusted=false;

  function injectStyle(){
    if(document.getElementById('astroRasterStyle'))return;
    const st=document.createElement('style');
    st.id='astroRasterStyle';
    st.textContent=`
      .astroRasterShell{position:relative;width:100%;border-radius:14px;overflow:hidden;background:#07101c}
      .astroRasterShell > #plannerMapStage{position:relative!important;z-index:2!important;background:transparent!important;background-image:none!important}
      .astroRasterShell > #plannerMapStage > svg{position:relative!important;z-index:2!important;background:transparent!important}
      .astroRasterShell.astroRasterReady #plannerMapStage .frStars{display:none!important}
      .astroRasterShell.astroRasterReady #plannerMapStage .frDso > :not(text){display:none!important}
      .astroRasterShell.astroRasterReady ~ .framingLegend .stars,
      .astroRasterShell.astroRasterReady ~ .framingLegend .dso,
      .astroRasterShell.astroRasterReady ~ .plannerMapDsoNote{display:none!important}
      .astroRasterHost{position:absolute!important;left:0!important;top:0!important;z-index:1!important;overflow:hidden!important;pointer-events:none!important;background:#07101c!important;opacity:0;transition:opacity .12s linear}
      .astroRasterHost *{pointer-events:none!important}
      .astroRasterHost canvas{position:absolute!important;inset:0!important;display:block!important;width:100%!important;height:100%!important;max-width:none!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
      .astroRasterHost svg,.astroRasterHost text,.astroRasterHost .aladin-svgCanvas,.astroRasterHost .aladin-gridCanvas,.astroRasterHost .aladin-coordinateGrid,.astroRasterHost .aladin-coordinate-grid,.astroRasterHost .aladin-grid-labels,.astroRasterHost .aladin-catalogCanvas{display:none!important;opacity:0!important;visibility:hidden!important}
      .astroRasterHost .aladin-location,.astroRasterHost .aladin-cooFrame,.astroRasterHost .aladin-fov,.astroRasterHost .aladin-status-bar,.astroRasterHost .aladin-projection-control,.astroRasterHost .aladin-zoomControl,.astroRasterHost .aladin-gotoControl,.astroRasterHost .aladin-layersControl,.astroRasterHost .aladin-fullscreenControl,.astroRasterHost .aladin-fullscreen-control,.astroRasterHost .aladin-share-control,.astroRasterHost .aladin-logo-container,.astroRasterHost .aladin-logo{display:none!important;opacity:0!important;visibility:hidden!important}
    `;
    document.head.appendChild(st);
  }

  function setRasterVisible(visible){
    if(visible){shell?.classList?.add('astroRasterReady');if(host)host.style.opacity='1';}
    else{shell?.classList?.remove('astroRasterReady');if(host)host.style.opacity='0';}
  }

  function suppressAladinOverlays(){
    if(!host)return;
    host.querySelectorAll('svg, text, .aladin-logo-container, .aladin-logo').forEach(el=>{
      el.style.display='none';el.style.opacity='0';el.style.visibility='hidden';
    });
  }

  function disableAladinGrid(){
    if(!aladin||typeof aladin.setCooGrid!=='function')return;
    try{aladin.setCooGrid({enabled:false,opacity:0,showLabels:false,color:'#000000',thickness:1,labelSize:1});}
    catch(err){console.warn('AstroPlanner raster: nie udało się wyłączyć siatki Aladin',err);}
  }

  function sizeHost(){
    if(!stage||!host)return null;
    const r=stage.getBoundingClientRect(),w=Math.max(0,Math.round(r.width)),h=Math.max(0,Math.round(r.height));
    if(w<40||h<40)return null;
    host.style.width=w+'px';host.style.height=h+'px';shell.style.minHeight=h+'px';return{w,h};
  }

  function ensureShell(){
    const s=document.getElementById('plannerMapStage');if(!s)return false;stage=s;
    if(stage.parentElement?.classList?.contains('astroRasterShell'))shell=stage.parentElement;
    else{shell=document.createElement('div');shell.className='astroRasterShell';stage.parentNode.insertBefore(shell,stage);shell.appendChild(stage);}
    host=shell.querySelector(':scope > .astroRasterHost');
    if(!host){host=document.createElement('div');host.className='astroRasterHost';host.id='astroRasterHost';shell.insertBefore(host,stage);}
    sizeHost();
    if(!stageObserver){stageObserver=new MutationObserver(scheduleSync);stageObserver.observe(stage,{childList:true,subtree:true});}
    if(!resizeObserver&&'ResizeObserver'in global){
      resizeObserver=new ResizeObserver(()=>{sizeHost();if(!aladin)return;clearTimeout(resizeKick);resizeKick=setTimeout(()=>{disableAladinGrid();suppressAladinOverlays();try{global.dispatchEvent(new Event('resize'));}catch(_){}scheduleSync();},90);});
      resizeObserver.observe(stage);
    }
    return true;
  }

  function plannerActive(){const page=stage?.closest?.('.page');return !page||page.classList.contains('active');}

  function resetRasterForRetry(){
    clearTimeout(probeTimer);tileProbeCount=0;
    try{aladin?.destroy?.();}catch(_){}try{aladin?.dispose?.();}catch(_){}
    aladin=null;initPromise=null;
    if(!global.A?.aladin)document.querySelector(`script[src="${ALADIN_URL}"]`)?.remove();
    failed=false;last={ra:NaN,dec:NaN,fov:NaN};tileState='idle';rasterTrusted=false;setRasterVisible(false);
    if(host)host.replaceChildren();
  }

  function scheduleRetry(delay=null){
    if(retryTimer||retryCount>=MAX_RETRIES)return;
    const wait=delay==null?[1200,2500,5000][retryCount]||5000:delay;
    retryTimer=setTimeout(()=>{retryTimer=0;if(!plannerActive())return;retryCount++;resetRasterForRetry();scheduleSync();},wait);
  }

  function loadAladin(){
    if(global.A?.aladin)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      let existing=document.querySelector(`script[src="${ALADIN_URL}"]`);
      if(existing?.dataset?.astroLoadFailed==='1'){existing.remove();existing=null;}
      if(existing){const started=Date.now(),wait=()=>{if(global.A?.aladin)return resolve();if(Date.now()-started>12000)return reject(new Error('timeout Aladin Lite'));setTimeout(wait,50);};wait();return;}
      const s=document.createElement('script');s.src=ALADIN_URL;s.charset='utf-8';s.async=true;
      s.onload=()=>{s.dataset.astroLoaded='1';resolve();};s.onerror=()=>{s.dataset.astroLoadFailed='1';reject(new Error('nie udało się pobrać Aladin Lite'));};document.head.appendChild(s);
    });
  }

  function plannerView(){
    if(!stage)return null;const svg=stage.querySelector('svg.framingSvg, svg[data-ppd]');if(!svg)return null;
    const ra=Number(svg.dataset.viewRa),dec=Number(svg.dataset.viewDec),ppd=Number(svg.dataset.ppd);if(!Number.isFinite(ra)||!Number.isFinite(dec)||!(ppd>0))return null;
    const vbWidth=Number(svg.viewBox?.baseVal?.width)||stage.getBoundingClientRect().width;if(!(vbWidth>0))return null;
    const tangentHalfDeg=vbWidth/(2*ppd),fov=2*Math.atan(tangentHalfDeg*D2R)*R2D;return{ra,dec,fov:Math.max(.05,Math.min(60,fov))};
  }

  function enforceGridOffAfterRedraw(){disableAladinGrid();requestAnimationFrame(disableAladinGrid);setTimeout(disableAladinGrid,120);setTimeout(disableAladinGrid,320);}

  async function initAladin(){
    if(aladin)return aladin;if(initPromise)return initPromise;
    initPromise=(async()=>{
      try{
        if(!ensureShell())throw new Error('brak kontenera mapy');
        const sz=sizeHost(),initial=plannerView();if(!sz||!initial)throw new Error('mapa nie jest jeszcze widoczna');
        setRasterVisible(false);tileState='loading';
        await loadAladin();if(global.A?.init)await global.A.init;sizeHost();
        aladin=global.A.aladin('#astroRasterHost',{
          target:initial.ra+' '+initial.dec,fov:initial.fov,projection:'TAN',cooFrame:'ICRSd',survey:DSS2_SURVEY,backgroundColor:'rgb(7,16,28)',
          showReticle:false,showZoomControl:false,showFullscreenControl:false,showLayersControl:false,showGotoControl:false,showProjectionControl:false,showShareControl:false,
          showSimbadPointerControl:false,showCooGridControl:false,showCooGrid:false,gridColor:'#000000',gridOpacity:0,
          gridOptions:{enabled:false,opacity:0,showLabels:false,color:'#000000',thickness:1,labelSize:1},
          showStatusBar:false,showFrame:false,showFov:false,showCooLocation:false,showCatalog:false,showContextMenu:false,lockNorthUp:true
        });
        if(typeof aladin.setFovRange==='function')aladin.setFovRange(.05,60);
        disableAladinGrid();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));disableAladinGrid();suppressAladinOverlays();
        try{global.dispatchEvent(new Event('resize'));}catch(_){}
        const actual=aladin.getSize?.();if(!actual||Number(actual[0])<40||Number(actual[1])<40)throw new Error('Aladin ma nieprawidłowy viewport');
        if(typeof aladin.on==='function'){aladin.on('positionChanged',enforceGridOffAfterRedraw);aladin.on('zoomChanged',enforceGridOffAfterRedraw);aladin.on('resizeChanged',enforceGridOffAfterRedraw);}
        failed=false;lastError='';tileProbeCount=0;tileState='loading';last={...initial};enforceGridOffAfterRedraw();scheduleProbe(650);return aladin;
      }catch(err){
        if(String(err?.message||'').includes('nie jest jeszcze widoczna')){initPromise=null;throw err;}
        failed=true;lastError=String(err?.message||err||'błąd rastra');setRasterVisible(false);console.warn('AstroPlanner raster:',err);scheduleRetry();throw err;
      }finally{if(!aladin)initPromise=null;}
    })();return initPromise;
  }

  function pixelRgb(x,y){
    try{const p=aladin?.readCanvas?.({x,y}),d=p?.data||p;if(d&&d.length>=3){const rgb=[Number(d[0]),Number(d[1]),Number(d[2])];if(rgb.every(Number.isFinite))return rgb;}}catch(_){}
    return null;
  }
  const luminance=rgb=>.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];

  function probeTiles(){
    probeTimer=0;if(!aladin||failed)return;
    const sz=aladin.getSize?.()||[],w=Number(sz[0])||0,h=Number(sz[1])||0;if(w<40||h<40){scheduleProbe(450);return;}
    const xs=[.14,.30,.50,.70,.86],ys=[.16,.37,.59,.82],pixels=[];
    for(const y of ys)for(const x of xs){const rgb=pixelRgb(w*x,h*y);if(rgb)pixels.push(rgb);}
    if(pixels.length<5){
      tileState=rasterTrusted?'refreshing':'waiting';
      if(!rasterTrusted)setRasterVisible(false);else setRasterVisible(true);
      if(++tileProbeCount<=MAX_TILE_PROBES)scheduleProbe(550);
      else failTileProbe('brak danych pikseli DSS2');
      return;
    }

    const ls=pixels.map(luminance),lMin=Math.min(...ls),lMax=Math.max(...ls),lMean=ls.reduce((a,b)=>a+b,0)/ls.length;
    const channelRange=[0,1,2].reduce((sum,c)=>sum+Math.max(...pixels.map(p=>p[c]))-Math.min(...pixels.map(p=>p[c])),0);
    const bgDistance=pixels.reduce((sum,p)=>sum+Math.abs(p[0]-BG[0])+Math.abs(p[1]-BG[1])+Math.abs(p[2]-BG[2]),0)/pixels.length;
    const nearWhite=lMean>244&&(lMax-lMin)<7&&channelRange<18;
    const nearBackground=bgDistance<24&&(lMax-lMin)<3&&channelRange<10;
    const hasStructure=(lMax-lMin)>4||channelRange>16||bgDistance>55;

    if(!nearWhite&&!nearBackground&&hasStructure){
      rasterTrusted=true;tileState='tile✓';tileProbeCount=0;failed=false;lastError='';retryCount=0;setRasterVisible(true);suppressAladinOverlays();return;
    }

    // Before the first valid DSS2 frame, keep the technical fallback visible. Once
    // the survey has been verified, a temporary blank/background sample normally
    // means Aladin is refining another HiPS order or fetching neighbouring tiles.
    // Keep the live raster visible exactly as the pre-regression implementation did.
    tileState=rasterTrusted?'refreshing':(nearWhite?'blank-white':'waiting');
    if(!rasterTrusted)setRasterVisible(false);else setRasterVisible(true);
    if(++tileProbeCount<=MAX_TILE_PROBES)scheduleProbe(550);
    else failTileProbe(nearWhite?'biały/pusty canvas DSS2':'DSS2 nie narysował potwierdzonej zawartości');
  }

  function failTileProbe(message){
    failed=true;lastError=message;tileState='fallback';setRasterVisible(false);console.warn('AstroPlanner raster:',message);scheduleRetry(900);
  }
  function scheduleProbe(delay=500){clearTimeout(probeTimer);probeTimer=setTimeout(probeTiles,delay);}

  async function sync(){
    syncFrame=0;if(!ensureShell())return;const view=plannerView();if(!view)return;if(failed){if(plannerActive())scheduleRetry(450);return;}
    try{await initAladin();}catch(_){return;}if(!aladin||failed)return;sizeHost();
    const moved=!Number.isFinite(last.ra)||Math.abs(view.ra-last.ra)>1e-5||Math.abs(view.dec-last.dec)>1e-5;
    const zoomed=!Number.isFinite(last.fov)||Math.abs(view.fov-last.fov)>1e-4;
    try{
      if(moved||zoomed){
        tileState=rasterTrusted?'refreshing':'loading';tileProbeCount=0;
        if(rasterTrusted)setRasterVisible(true);else setRasterVisible(false);
      }
      if(moved)aladin.gotoRaDec(view.ra,view.dec);
      if(zoomed)aladin.setFov(view.fov);
      enforceGridOffAfterRedraw();last=view;suppressAladinOverlays();
      if(moved||zoomed)scheduleProbe(650);
      else if(rasterTrusted)setRasterVisible(true);
      else if(!probeTimer)scheduleProbe(450);
    }catch(err){failed=true;lastError=String(err?.message||err||'błąd synchronizacji rastra');rasterTrusted=false;setRasterVisible(false);console.warn('AstroPlanner raster sync:',err);scheduleRetry(900);}
  }

  async function captureView(format='image/jpeg'){
    if(!plannerActive()||failed||tileState!=='tile✓'||!aladin||typeof aladin.getViewDataURL!=='function')return null;
    const view=plannerView(),sz=aladin.getSize?.()||[];if(!view||Number(sz[0])<40||Number(sz[1])<40)return null;
    try{disableAladinGrid();suppressAladinOverlays();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const raw=aladin.getViewDataURL(format),dataUrl=raw&&typeof raw.then==='function'?await raw:raw;if(typeof dataUrl!=='string'||!dataUrl.startsWith('data:image/'))return null;return{dataUrl,width:Number(sz[0])||0,height:Number(sz[1])||0,view:{...view},tileState};}
    catch(err){console.warn('AstroPlanner raster snapshot:',err);return null;}
  }

  function roundPx(v){const n=Number(v);return Number.isFinite(n)?Math.round(n):null;}
  function diagnostics(view=plannerView()){
    const stageRect=stage?.getBoundingClientRect?.(),hostRect=host?.getBoundingClientRect?.(),sz=aladin?.getSize?.()||[],av=aladin?.view,canvas=av?.imageCanvas||host?.querySelector?.('.aladin-imageCanvas')||null,canvasRect=canvas?.getBoundingClientRect?.(),gl=av?.imageCtx||null;
    let wasmNorder=null;try{const n=Number(av?.wasm?.getNOrder?.());if(Number.isFinite(n))wasmNorder=n;}catch(_){}
    return{dpr:Number(global.devicePixelRatio)||1,fov:Number(view?.fov),stageCss:[roundPx(stageRect?.width),roundPx(stageRect?.height)],hostCss:[roundPx(hostRect?.width),roundPx(hostRect?.height)],aladinSize:[roundPx(sz[0]),roundPx(sz[1])],viewSize:[roundPx(av?.width),roundPx(av?.height)],canvasCss:[roundPx(canvasRect?.width??canvas?.clientWidth),roundPx(canvasRect?.height??canvas?.clientHeight)],canvasBacking:[roundPx(canvas?.width),roundPx(canvas?.height)],drawingBuffer:[roundPx(gl?.drawingBufferWidth),roundPx(gl?.drawingBufferHeight)],wasmNorder,curNorder:Number.isFinite(Number(av?.curNorder))?Number(av.curNorder):null,realNorder:Number.isFinite(Number(av?.realNorder))?Number(av.realNorder):null};
  }

  function scheduleSync(){cancelAnimationFrame(syncFrame);syncFrame=requestAnimationFrame(sync);}
  function start(){injectStyle();if(!ensureShell())return;setRasterVisible(false);scheduleSync();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();

  global.AstroRasterLayer={
    sync:scheduleSync,captureView,
    getStatus:()=>({ready:rasterTrusted&&!failed,recovering:!!retryTimer,retryCount,maxRetries:MAX_RETRIES,lastError,source:DSS2_SURVEY,activeSurvey:'dss2-color',fullSky:true,aladinSize:aladin?.getSize?.()||null,tileState,diagnostics:diagnostics(),lastView:{...last}})
  };
})(window);
