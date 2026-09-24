(function(global){
  'use strict';

  // AstroPlanner v0.14 R&D — DSS2 Color full-sky raster layer with bounded recovery + snapshot export
  // One consistent full-sky raster. No declination cutoffs, survey switching or fallbacks.

  const ALADIN_URL='https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js';
  const DSS2_SURVEY='P/DSS2/color';
  const D2R=Math.PI/180,R2D=180/Math.PI;
  const BG=[7,16,28];
  const MAX_RETRIES=3;

  let shell=null,stage=null,host=null;
  let aladin=null,initPromise=null,stageObserver=null,resizeObserver=null;
  let syncFrame=0,resizeKick=0,probeTimer=0,retryTimer=0,retryCount=0,last={ra:NaN,dec:NaN,fov:NaN},failed=false,tileState='…',lastError='';

  function injectStyle(){
    if(document.getElementById('astroRasterStyle'))return;
    const st=document.createElement('style');
    st.id='astroRasterStyle';
    st.textContent=`
      .astroRasterShell{
        position:relative;
        width:100%;
        border-radius:14px;
        overflow:hidden;
        background:#07101c;
      }
      .astroRasterShell > #plannerMapStage{
        position:relative!important;
        z-index:2!important;
        background:transparent!important;
        background-image:none!important;
      }
      .astroRasterShell > #plannerMapStage > svg{
        position:relative!important;
        z-index:2!important;
        background:transparent!important;
      }
      /* DSS2 Color already contains the real star field and DSO structure.
         Hide duplicate synthetic map symbols only after the raster is ready.
         If Aladin/DSS2 is unavailable, the original v0.11.5.6 technical map
         remains visible as a functional fallback. */
      .astroRasterShell.astroRasterReady #plannerMapStage .frStars{
        display:none!important;
      }
      .astroRasterShell.astroRasterReady #plannerMapStage .frDso > :not(text){
        display:none!important;
      }
      .astroRasterShell.astroRasterReady ~ .framingLegend .stars,
      .astroRasterShell.astroRasterReady ~ .framingLegend .dso,
      .astroRasterShell.astroRasterReady ~ .plannerMapDsoNote{
        display:none!important;
      }
      .astroRasterHost{
        position:absolute!important;
        left:0!important;
        top:0!important;
        z-index:1!important;
        overflow:hidden!important;
        pointer-events:none!important;
        background:#07101c!important;
        opacity:0;
        transition:opacity .12s linear;
      }
      .astroRasterHost *{pointer-events:none!important}
      /* AstroPlanner production has a global canvas{} rule for its old charts.
         Aladin Lite also uses canvases internally, so reset that rule only here. */
      .astroRasterHost canvas{
        position:absolute!important;
        inset:0!important;
        display:block!important;
        width:100%!important;
        height:100%!important;
        max-width:none!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        box-shadow:none!important;
      }
      /* We want only the raster from Aladin, not its own coordinate grid/labels,
         because AstroPlanner already renders RA/Dec grid and labels in the foreground. */
      .astroRasterHost svg,
      .astroRasterHost text,
      .astroRasterHost .aladin-svgCanvas,
      .astroRasterHost .aladin-gridCanvas,
      .astroRasterHost .aladin-coordinateGrid,
      .astroRasterHost .aladin-coordinate-grid,
      .astroRasterHost .aladin-grid-labels,
      .astroRasterHost .aladin-catalogCanvas{
        display:none!important;
        opacity:0!important;
        visibility:hidden!important;
      }
      .astroRasterHost .aladin-location,
      .astroRasterHost .aladin-cooFrame,
      .astroRasterHost .aladin-fov,
      .astroRasterHost .aladin-status-bar,
      .astroRasterHost .aladin-projection-control,
      .astroRasterHost .aladin-zoomControl,
      .astroRasterHost .aladin-gotoControl,
      .astroRasterHost .aladin-layersControl,
      .astroRasterHost .aladin-fullscreenControl,
      .astroRasterHost .aladin-fullscreen-control,
      .astroRasterHost .aladin-share-control,
      .astroRasterHost .aladin-logo-container,
      .astroRasterHost .aladin-logo{display:none!important;opacity:0!important;visibility:hidden!important}
    `;
    document.head.appendChild(st);
  }

  function suppressAladinOverlays(){
    if(!host)return;
    host.querySelectorAll('svg, text, .aladin-logo-container, .aladin-logo').forEach(el=>{
      el.style.display='none';
      el.style.opacity='0';
      el.style.visibility='hidden';
    });
  }

  function disableAladinGrid(){
    if(!aladin || typeof aladin.setCooGrid!=='function')return;
    try{
      // Keep the grid both logically disabled and visually transparent.
      // This survives Aladin's post-pan/post-zoom redraw even if it restores
      // its internal enabled state.
      aladin.setCooGrid({
        enabled:false,
        opacity:0,
        showLabels:false,
        color:'#000000',
        thickness:1,
        labelSize:1
      });
    }catch(err){
      console.warn('AstroPlanner raster: nie udało się wyłączyć siatki Aladin',err);
    }
  }

  function sizeHost(){
    if(!stage||!host)return null;
    const r=stage.getBoundingClientRect();
    const w=Math.max(0,Math.round(r.width));
    const h=Math.max(0,Math.round(r.height));
    if(w>=40&&h>=40){
      host.style.width=w+'px';
      host.style.height=h+'px';
      shell.style.minHeight=h+'px';
      return{w,h};
    }
    return null;
  }

  function ensureShell(){
    const s=document.getElementById('plannerMapStage');
    if(!s)return false;
    stage=s;

    if(stage.parentElement?.classList?.contains('astroRasterShell')){
      shell=stage.parentElement;
    }else{
      shell=document.createElement('div');
      shell.className='astroRasterShell';
      stage.parentNode.insertBefore(shell,stage);
      shell.appendChild(stage);
    }

    host=shell.querySelector(':scope > .astroRasterHost');
    if(!host){
      host=document.createElement('div');
      host.className='astroRasterHost';
      host.id='astroRasterHost';
      shell.insertBefore(host,stage);
    }

    sizeHost();

    if(!stageObserver){
      stageObserver=new MutationObserver(scheduleSync);
      stageObserver.observe(stage,{childList:true,subtree:true});
    }
    if(!resizeObserver&&'ResizeObserver'in global){
      resizeObserver=new ResizeObserver(()=>{
        sizeHost();
        if(aladin){
          clearTimeout(resizeKick);
          resizeKick=setTimeout(()=>{
            disableAladinGrid();
            suppressAladinOverlays();
            try{global.dispatchEvent(new Event('resize'));}catch(_){}
            scheduleSync();
          },80);
        }
      });
      resizeObserver.observe(stage);
    }
    return true;
  }

  function plannerActive(){
    const page=stage?.closest?.('.page');
    return !page||page.classList.contains('active');
  }

  function resetRasterForRetry(){
    clearTimeout(probeTimer);
    try{aladin?.destroy?.();}catch(_){}
    try{aladin?.dispose?.();}catch(_){}
    aladin=null;
    initPromise=null;
    if(!global.A?.aladin){document.querySelector(`script[src="${ALADIN_URL}"]`)?.remove();}
    failed=false;
    last={ra:NaN,dec:NaN,fov:NaN};
    tileState='…';
    shell?.classList?.remove('astroRasterReady');
    if(host){host.style.opacity='0';host.replaceChildren();}
  }

  function scheduleRetry(delay=null){
    if(retryTimer||retryCount>=MAX_RETRIES)return;
    const wait=delay==null?[1200,2500,5000][retryCount]||5000:delay;
    retryTimer=setTimeout(()=>{
      retryTimer=0;
      if(!plannerActive())return;
      retryCount++;
      resetRasterForRetry();
      scheduleSync();
    },wait);
  }

  function loadAladin(){
    if(global.A?.aladin)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      let existing=document.querySelector(`script[src="${ALADIN_URL}"]`);
      if(existing?.dataset?.astroLoadFailed==='1'){existing.remove();existing=null;}
      if(existing){
        const started=Date.now();
        const wait=()=>{
          if(global.A?.aladin)return resolve();
          if(Date.now()-started>12000)return reject(new Error('timeout Aladin Lite'));
          setTimeout(wait,50);
        };
        wait();
        return;
      }
      const s=document.createElement('script');
      s.src=ALADIN_URL;
      s.charset='utf-8';
      s.async=true;
      s.onload=()=>{s.dataset.astroLoaded='1';resolve();};
      s.onerror=()=>{s.dataset.astroLoadFailed='1';reject(new Error('nie udało się pobrać Aladin Lite'));};
      document.head.appendChild(s);
    });
  }

  function plannerView(){
    if(!stage)return null;
    const svg=stage.querySelector('svg.framingSvg, svg[data-ppd]');
    if(!svg)return null;
    const ra=Number(svg.dataset.viewRa),dec=Number(svg.dataset.viewDec),ppd=Number(svg.dataset.ppd);
    if(!Number.isFinite(ra)||!Number.isFinite(dec)||!(ppd>0))return null;
    const vbWidth=Number(svg.viewBox?.baseVal?.width)||stage.getBoundingClientRect().width;
    if(!(vbWidth>0))return null;
    const tangentHalfDeg=vbWidth/(2*ppd);
    const fov=2*Math.atan(tangentHalfDeg*D2R)*R2D;
    return{ra,dec,fov:Math.max(.05,Math.min(60,fov))};
  }

  async function initAladin(){
    if(aladin)return aladin;
    if(initPromise)return initPromise;
    initPromise=(async()=>{
      try{
        if(!ensureShell())throw new Error('brak kontenera mapy');
        const sz=sizeHost();
        const initial=plannerView();
        if(!sz||!initial)throw new Error('mapa nie jest jeszcze widoczna');

        await loadAladin();
        if(global.A?.init)await global.A.init;
        sizeHost();

        // DSS2 Color is the single all-sky raster used by AstroPlanner.
        aladin=global.A.aladin('#astroRasterHost',{
          target:initial.ra+' '+initial.dec,
          fov:initial.fov,
          projection:'TAN',
          cooFrame:'ICRSd',
          survey:DSS2_SURVEY,
          backgroundColor:'rgb(7,16,28)',
          showReticle:false,
          showZoomControl:false,
          showFullscreenControl:false,
          showLayersControl:false,
          showGotoControl:false,
          showProjectionControl:false,
          showShareControl:false,
          showSimbadPointerControl:false,
          showCooGridControl:false,
          showCooGrid:false,
          gridColor:'#000000',
          gridOpacity:0,
          gridOptions:{
            enabled:false,
            opacity:0,
            showLabels:false,
            color:'#000000',
            thickness:1,
            labelSize:1
          },
          showStatusBar:false,
          showFrame:false,
          showFov:false,
          showCooLocation:false,
          showCatalog:false,
          showContextMenu:false,
          lockNorthUp:true
        });

        if(typeof aladin.setFovRange==='function')aladin.setFovRange(.05,60);
        disableAladinGrid();

        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        disableAladinGrid();
        suppressAladinOverlays();
        try{global.dispatchEvent(new Event('resize'));}catch(_){}

        const actual=aladin.getSize?.();
        if(!actual||Number(actual[0])<40||Number(actual[1])<40)throw new Error('Aladin ma nieprawidłowy viewport');
        shell?.classList?.add('astroRasterReady');

        if(typeof aladin.on==='function'){
          aladin.on('positionChanged',enforceGridOffAfterRedraw);
          aladin.on('zoomChanged',enforceGridOffAfterRedraw);
          aladin.on('resizeChanged',enforceGridOffAfterRedraw);
        }

        failed=false;
        retryCount=0;
        clearTimeout(retryTimer);
        retryTimer=0;
        lastError='';
        tileState='…';
        enforceGridOffAfterRedraw();
        scheduleProbe(900);
        return aladin;
      }catch(err){
        if(String(err?.message||'').includes('nie jest jeszcze widoczna')){
          initPromise=null;
          throw err;
        }
        failed=true;
        lastError=String(err?.message||err||'błąd rastra');
        shell?.classList?.remove('astroRasterReady');
        if(host)host.style.opacity='0';
        console.warn('AstroPlanner raster:',err);
        scheduleRetry();
        throw err;
      }finally{
        if(!aladin)initPromise=null;
      }
    })();
    return initPromise;
  }

  function pixelRgb(x,y){
    try{
      const p=aladin?.readCanvas?.({x,y});
      const d=p?.data||p;
      if(d&&d.length>=3)return [Number(d[0]),Number(d[1]),Number(d[2])];
    }catch(_){}
    return null;
  }

  function probeTiles(){
    if(!aladin)return;
    const sz=aladin.getSize?.()||[];
    const w=Number(sz[0])||0,h=Number(sz[1])||0;
    if(w<40||h<40)return;
    const pts=[
      [w*.5,h*.5],[w*.35,h*.4],[w*.65,h*.4],[w*.4,h*.65],[w*.6,h*.65]
    ];
    let maxDelta=0,valid=0;
    for(const [x,y] of pts){
      const rgb=pixelRgb(x,y);
      if(!rgb)continue;
      valid++;
      const delta=Math.abs(rgb[0]-BG[0])+Math.abs(rgb[1]-BG[1])+Math.abs(rgb[2]-BG[2]);
      maxDelta=Math.max(maxDelta,delta);
    }
    tileState=valid===0?'probe?':(maxDelta>30?'tile✓':'tile?');
  }

  function scheduleProbe(delay=500){
    clearTimeout(probeTimer);
    probeTimer=setTimeout(probeTiles,delay);
  }

  function enforceGridOffAfterRedraw(){
    disableAladinGrid();
    requestAnimationFrame(disableAladinGrid);
    setTimeout(disableAladinGrid,120);
    setTimeout(disableAladinGrid,320);
  }

  function roundPx(v){
    const n=Number(v);
    return Number.isFinite(n)?Math.round(n):null;
  }

  function diagnostics(view=plannerView()){
    const stageRect=stage?.getBoundingClientRect?.();
    const hostRect=host?.getBoundingClientRect?.();
    const sz=aladin?.getSize?.()||[];
    const av=aladin?.view;
    const canvas=av?.imageCanvas||host?.querySelector?.('.aladin-imageCanvas')||null;
    const canvasRect=canvas?.getBoundingClientRect?.();
    const gl=av?.imageCtx||null;
    let wasmNorder=null;
    try{
      const n=Number(av?.wasm?.getNOrder?.());
      if(Number.isFinite(n))wasmNorder=n;
    }catch(_){}
    return{
      dpr:Number(global.devicePixelRatio)||1,
      fov:Number(view?.fov),
      stageCss:[roundPx(stageRect?.width),roundPx(stageRect?.height)],
      hostCss:[roundPx(hostRect?.width),roundPx(hostRect?.height)],
      aladinSize:[roundPx(sz[0]),roundPx(sz[1])],
      viewSize:[roundPx(av?.width),roundPx(av?.height)],
      canvasCss:[roundPx(canvasRect?.width??canvas?.clientWidth),roundPx(canvasRect?.height??canvas?.clientHeight)],
      canvasBacking:[roundPx(canvas?.width),roundPx(canvas?.height)],
      drawingBuffer:[roundPx(gl?.drawingBufferWidth),roundPx(gl?.drawingBufferHeight)],
      wasmNorder,
      curNorder:Number.isFinite(Number(av?.curNorder))?Number(av.curNorder):null,
      realNorder:Number.isFinite(Number(av?.realNorder))?Number(av.realNorder):null
    };
  }

  async function sync(){
    syncFrame=0;
    if(!ensureShell())return;
    const view=plannerView();
    if(!view)return;
    if(failed){if(plannerActive())scheduleRetry(450);return;}

    try{await initAladin();}catch(_){return;}
    if(!aladin||failed)return;

    sizeHost();
    const moved=!Number.isFinite(last.ra)||Math.abs(view.ra-last.ra)>1e-5||Math.abs(view.dec-last.dec)>1e-5;
    const zoomed=!Number.isFinite(last.fov)||Math.abs(view.fov-last.fov)>1e-4;

    try{
      if(moved)aladin.gotoRaDec(view.ra,view.dec);
      if(zoomed)aladin.setFov(view.fov);
      enforceGridOffAfterRedraw();
      last=view;
      shell?.classList?.add('astroRasterReady');
      host.style.opacity='1';
      suppressAladinOverlays();
      if(moved||zoomed){
        tileState='…';
        scheduleProbe(700);
      }
    }catch(err){
      failed=true;
      lastError=String(err?.message||err||'błąd synchronizacji rastra');
      shell?.classList?.remove('astroRasterReady');
      host.style.opacity='0';
      console.warn('AstroPlanner raster sync:',err);
      scheduleRetry(900);
    }
  }

  async function captureView(format='image/jpeg'){
    if(!plannerActive()||failed||!aladin||typeof aladin.getViewDataURL!=='function')return null;
    const view=plannerView(),sz=aladin.getSize?.()||[];
    if(!view||Number(sz[0])<40||Number(sz[1])<40)return null;
    try{
      disableAladinGrid();
      suppressAladinOverlays();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const raw=aladin.getViewDataURL(format),dataUrl=raw&&typeof raw.then==='function'?await raw:raw;
      if(typeof dataUrl!=='string'||!dataUrl.startsWith('data:image/'))return null;
      return{dataUrl,width:Number(sz[0])||0,height:Number(sz[1])||0,view:{...view},tileState};
    }catch(err){
      console.warn('AstroPlanner raster snapshot:',err);
      return null;
    }
  }

  function scheduleSync(){
    cancelAnimationFrame(syncFrame);
    syncFrame=requestAnimationFrame(sync);
  }

  function start(){
    injectStyle();
    if(!ensureShell())return;
    scheduleSync();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();

  global.AstroRasterLayer={
    sync:scheduleSync,
    captureView,
    getStatus:()=>({
      ready:!!aladin&&!failed,
      recovering:!!retryTimer,
      retryCount,
      maxRetries:MAX_RETRIES,
      lastError,
      source:DSS2_SURVEY,
      activeSurvey:'dss2-color',
      fullSky:true,
      aladinSize:aladin?.getSize?.()||null,
      tileState,
      diagnostics:diagnostics(),
      lastView:{...last}
    })
  };
})(window);
