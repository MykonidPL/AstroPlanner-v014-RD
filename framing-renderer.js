(function(global){
  'use strict';
  const E=global.AstroFraming;
  const D2R=Math.PI/180;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)));

  function viewCenter(layout,opts={}){
    const ra=Number.isFinite(Number(opts.viewRaDeg))?E.normRa(opts.viewRaDeg):layout.targetRaDeg;
    const dec=Number.isFinite(Number(opts.viewDecDeg))?clamp(opts.viewDecDeg,-90,90):layout.targetDecDeg;
    return{raDeg:ra,decDeg:dec};
  }
  function localPoints(layout,center){
    if(!layout)return[];
    const out=[];
    const tgt=E.projectToTangent(layout.targetRaDeg,layout.targetDecDeg,center.raDeg,center.decDeg);if(tgt)out.push(tgt);
    const ctr=E.projectToTangent(layout.centerRaDeg,layout.centerDecDeg,center.raDeg,center.decDeg);if(ctr)out.push(ctr);
    for(const p of layout.panels||[])for(const c of p.corners||[]){const q=E.projectToTangent(c.raDeg,c.decDeg,center.raDeg,center.decDeg);if(q)out.push(q);}
    return out;
  }
  function stableScale(layout,width=640,height=360,padding=30,coverage=.56){
    const center={raDeg:layout.centerRaDeg,decDeg:layout.centerDecDeg};
    const pts=localPoints(layout,center);let maxX=.08,maxY=.06;
    for(const p of pts){maxX=Math.max(maxX,Math.abs(p.x));maxY=Math.max(maxY,Math.abs(p.y));}
    const usableW=Math.max(40,width-padding*2),usableH=Math.max(40,height-padding*2),cov=Math.min(.82,Math.max(.28,Number(coverage)||.56));
    return Math.max(.0001,Math.min((usableW*cov)/(maxX*2),(usableH*cov)/(maxY*2)));
  }
  function viewport(layout,width=640,height=360,padding=30,fixedScale=null,opts={}){
    const center=viewCenter(layout,opts),pts=localPoints(layout,center);let maxX=.65,maxY=.45;
    for(const p of pts){maxX=Math.max(maxX,Math.abs(p.x));maxY=Math.max(maxY,Math.abs(p.y));}
    maxX*=1.18;maxY*=1.18;
    const usableW=Math.max(40,width-padding*2),usableH=Math.max(40,height-padding*2);
    const autoScale=Math.max(.0001,Math.min(usableW/(maxX*2),usableH/(maxY*2)));
    const scale=Number(fixedScale)>0?Number(fixedScale):autoScale;
    return{width,height,padding,scale,maxX,maxY,cx:width/2,cy:height/2,viewRaDeg:center.raDeg,viewDecDeg:center.decDeg};
  }
  function skyToScreen(q,v){return{x:v.cx-q.x*v.scale,y:v.cy-q.y*v.scale};}
  function projectScreen(raDeg,decDeg,v){const q=E.projectToTangent(raDeg,decDeg,v.viewRaDeg,v.viewDecDeg);return q?skyToScreen(q,v):null;}
  function panelPath(panel,v){
    const pts=(panel.corners||[]).map(c=>projectScreen(c.raDeg,c.decDeg,v)).filter(Boolean);
    return pts.length===4?pts.map((p,i)=>(i?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2)).join(' ')+' Z':'';
  }
  function starVisual(mag,preview){
    const m=Number(mag);let r;
    if(m<=0)r=4.8;else if(m<=1)r=4.2;else if(m<=2)r=3.55;else if(m<=3)r=2.9;else if(m<=4)r=2.3;else if(m<=5)r=1.8;else if(m<=6)r=1.38;else if(m<=7)r=1.02;else if(m<=8)r=.76;else if(m<=9)r=.58;else r=.44;
    if(preview)r=Math.max(.42,r*.82);
    const opacity=clamp(.98-Math.max(0,m-1)*.085,.26,.98);
    return{r,opacity,halo:m<=2.5};
  }
  function starLayer(layout,v,preview){
    const S=global.AstroStarLayer;if(!S||S.getStatus?.().status!=='ready')return{html:'',count:0,limit:null};
    const radius=Math.hypot(v.width/(2*v.scale),v.height/(2*v.scale))*1.08,limit=S.magnitudeLimit?S.magnitudeLimit(radius):10;
    const stars=S.query(v.viewRaDeg,v.viewDecDeg,radius,limit),parts=[];let visible=0;
    for(const st of stars){
      const sp=projectScreen(st.raDeg,st.decDeg,v);if(!sp)continue;
      if(sp.x<-6||sp.x>v.width+6||sp.y<-6||sp.y>v.height+6)continue;
      visible++;const vis=starVisual(st.mag,preview);
      if(vis.halo)parts.push(`<circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${(vis.r*2.15).toFixed(2)}" fill="rgba(190,215,255,${preview?.06:.10})"/>`);
      parts.push(`<circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${vis.r.toFixed(2)}" fill="rgba(232,240,255,${vis.opacity.toFixed(2)})"/>`);
    }
    return{html:`<g class="frStars" aria-hidden="true">${parts.join('')}</g>`,count:visible,limit};
  }

  function dsoStyle(kind){
    const m={
      'galaxy':{stroke:'#c9a8ff',fill:'rgba(201,168,255,.055)'},
      'galaxy-group':{stroke:'#b99be8',fill:'rgba(185,155,232,.035)'},
      'galaxy-cluster':{stroke:'#b99be8',fill:'rgba(185,155,232,.025)'},
      'open-cluster':{stroke:'#8fd8ff',fill:'rgba(143,216,255,.025)'},
      'globular-cluster':{stroke:'#ffd18a',fill:'rgba(255,209,138,.035)'},
      'planetary-nebula':{stroke:'#81e3c2',fill:'rgba(129,227,194,.035)'},
      'nebula':{stroke:'#eaa8c7',fill:'rgba(234,168,199,.025)'},
      'snr':{stroke:'#f0a7a7',fill:'rgba(240,167,167,.018)'},
      'double-star':{stroke:'#b9c8e2',fill:'none'},
      'other':{stroke:'#aebbd1',fill:'rgba(174,187,209,.02)'}
    };return m[kind]||m.other;
  }
  function localAxisEndpoint(o,angleDeg,halfDeg,v){
    const a=Number(angleDeg||0)*D2R,x=Math.sin(a)*halfDeg,y=Math.cos(a)*halfDeg,sky=E.tangentToSky(x,y,o.raDeg,o.decDeg);return sky?projectScreen(sky.raDeg,sky.decDeg,v):null;
  }
  function dsoFootprint(o,center,v){
    if(!(Number(o.majorAxisArcmin)>0))return null;
    const halfMaj=Number(o.majorAxisArcmin)/120,halfMin=Number(o.minorAxisArcmin||o.majorAxisArcmin)/120,pa=Number.isFinite(Number(o.positionAngleDeg))?Number(o.positionAngleDeg):0;
    const a=localAxisEndpoint(o,pa,halfMaj,v),b=localAxisEndpoint(o,pa+90,halfMin,v);if(!a||!b)return null;
    const rx=Math.hypot(a.x-center.x,a.y-center.y),ry=Math.hypot(b.x-center.x,b.y-center.y),angle=Math.atan2(a.y-center.y,a.x-center.x)*180/Math.PI;
    if(!(rx>0&&ry>0))return null;return{rx,ry,angle};
  }
  function dsoMarkerHtml(o,sp,v,preview){
    const st=dsoStyle(o.kind),fp=dsoFootprint(o,sp,v),sw=preview?1:1.35,ve='vector-effect="non-scaling-stroke" pointer-events="none"',parts=[];
    if(fp&&Math.max(fp.rx,fp.ry)>=3){
      const rx=Math.min(fp.rx,360),ry=Math.min(fp.ry,360),dash=(o.kind==='nebula'||o.kind==='snr'||o.kind==='open-cluster')?' stroke-dasharray="5 4"':'';
      parts.push(`<ellipse cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${fp.angle.toFixed(2)} ${sp.x.toFixed(1)} ${sp.y.toFixed(1)})" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${sw}"${dash} ${ve}/>`);
      if(o.kind==='globular-cluster')parts.push(`<line x1="${(sp.x-4).toFixed(1)}" y1="${sp.y.toFixed(1)}" x2="${(sp.x+4).toFixed(1)}" y2="${sp.y.toFixed(1)}" stroke="${st.stroke}" stroke-width="1" ${ve}/><line x1="${sp.x.toFixed(1)}" y1="${(sp.y-4).toFixed(1)}" x2="${sp.x.toFixed(1)}" y2="${(sp.y+4).toFixed(1)}" stroke="${st.stroke}" stroke-width="1" ${ve}/>`);
      return{html:parts.join(''),radius:Math.max(rx,ry),footprint:true};
    }
    const r=preview?4.0:5.2;
    if(o.kind==='galaxy')parts.push(`<ellipse cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" rx="${(r*1.35).toFixed(1)}" ry="${(r*.65).toFixed(1)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${sw}" ${ve}/>`);
    else if(o.kind==='open-cluster')parts.push(`<circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${st.stroke}" stroke-width="${sw}" stroke-dasharray="3 3" ${ve}/>`);
    else if(o.kind==='globular-cluster')parts.push(`<circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${sw}" ${ve}/><line x1="${(sp.x-r).toFixed(1)}" y1="${sp.y.toFixed(1)}" x2="${(sp.x+r).toFixed(1)}" y2="${sp.y.toFixed(1)}" stroke="${st.stroke}" stroke-width="1" ${ve}/><line x1="${sp.x.toFixed(1)}" y1="${(sp.y-r).toFixed(1)}" x2="${sp.x.toFixed(1)}" y2="${(sp.y+r).toFixed(1)}" stroke="${st.stroke}" stroke-width="1" ${ve}/>`);
    else if(o.kind==='planetary-nebula')parts.push(`<circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${(r*.72).toFixed(1)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${sw}" ${ve}/><path d="M ${(sp.x-r-2).toFixed(1)} ${sp.y.toFixed(1)} h 4 M ${(sp.x+r-2).toFixed(1)} ${sp.y.toFixed(1)} h 4 M ${sp.x.toFixed(1)} ${(sp.y-r-2).toFixed(1)} v 4 M ${sp.x.toFixed(1)} ${(sp.y+r-2).toFixed(1)} v 4" stroke="${st.stroke}" stroke-width="1" ${ve}/>`);
    else if(o.kind==='nebula'||o.kind==='snr')parts.push(`<path d="M ${sp.x.toFixed(1)} ${(sp.y-r).toFixed(1)} L ${(sp.x+r).toFixed(1)} ${sp.y.toFixed(1)} L ${sp.x.toFixed(1)} ${(sp.y+r).toFixed(1)} L ${(sp.x-r).toFixed(1)} ${sp.y.toFixed(1)} Z" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${sw}" stroke-dasharray="3 2" ${ve}/>`);
    else if(o.kind==='galaxy-group'||o.kind==='galaxy-cluster')parts.push(`<circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${st.stroke}" stroke-width="${sw}" stroke-dasharray="2 2" ${ve}/><circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="2" fill="${st.stroke}" pointer-events="none"/>`);
    else parts.push(`<circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="2.7" fill="none" stroke="${st.stroke}" stroke-width="${sw}" ${ve}/>`);
    return{html:parts.join(''),radius:r,footprint:false};
  }
  function rectsOverlap(a,b,pad=2){return!(a.x2+pad<b.x1||a.x1-pad>b.x2||a.y2+pad<b.y1||a.y1-pad>b.y2);}
  function dsoLayer(layout,v,preview){
    const D=global.AstroDsoLayer;if(!D||D.getStatus?.().status!=='ready')return{html:'',count:0,labelCount:0};
    const radius=Math.hypot(v.width/(2*v.scale),v.height/(2*v.scale))*1.10,objects=D.query(v.viewRaDeg,v.viewDecDeg,radius),symbols=[],labels=[],occupiedLabels=[],occupiedSymbols=[],profile=D.profile?D.profile(radius,v.width,v.height):{labelLimit:16,screenSymbolLimit:64,screenLabelLimit:16,symbolSpacing:22};let visible=0,labelCount=0;
    const symbolLimit=Math.max(1,Number(profile.screenSymbolLimit||profile.limit||64)),labelLimit=Math.max(1,Number(profile.screenLabelLimit||profile.labelLimit||16)),symbolSpacing=Math.max(8,Number(profile.symbolSpacing||22));
    for(const o of objects){
      const sp=projectScreen(o.raDeg,o.decDeg,v);if(!sp||sp.x<-20||sp.x>v.width+20||sp.y<-20||sp.y>v.height+20)continue;
      const isTarget=Math.abs(o.raDeg-layout.targetRaDeg)<1e-5&&Math.abs(o.decDeg-layout.targetDecDeg)<1e-5;
      const marker=dsoMarkerHtml(o,sp,v,preview);
      const isProtected=!!(isTarget||o.m||o.custom||marker.footprint||Number(o.majorAxisArcmin)>=Number(profile.largeArcmin||9999));
      const collisionRadius=marker.footprint?Math.min(7,Math.max(marker.radius||3,3)):Math.max(marker.radius||3,3),exclusion=collisionRadius+(isProtected?symbolSpacing*.35:symbolSpacing*.5);
      const symbolBox={x1:sp.x-exclusion,y1:sp.y-exclusion,x2:sp.x+exclusion,y2:sp.y+exclusion};
      if(!isProtected){
        if(visible>=symbolLimit)continue;
        if(occupiedSymbols.some(s=>rectsOverlap(symbolBox,s.box,0)))continue;
      }
      symbols.push(marker.html);visible++;occupiedSymbols.push({id:o.id,box:symbolBox});
      if(preview||labelCount>=labelLimit)continue;
      if(isTarget)continue;
      const labelAllowed=!!(o.m||o.custom||Number(o.detailTier||9)<=Number(profile.labelTier||0)||Number(o.majorAxisArcmin)>=Number(profile.largeArcmin||9999));
      if(!labelAllowed)continue;
      const txt=o.label;if(!txt)continue;const x=sp.x+Math.min(24,marker.radius+6),y=sp.y-5,w=Math.min(150,txt.length*7.0+8),box={x1:x-2,y1:y-12,x2:x+w,y2:y+4};
      if(box.x2>v.width-8||box.y1<8||box.y2>v.height-8||occupiedLabels.some(b=>rectsOverlap(box,b,3))||occupiedSymbols.some(s=>s.id!==o.id&&rectsOverlap(box,s.box,2)))continue;
      occupiedLabels.push(box);labelCount++;labels.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="#c9d5e9" font-size="11" font-weight="700" paint-order="stroke" stroke="#07101c" stroke-width="3.5" stroke-linejoin="round" pointer-events="none">${esc(txt)}</text>`);
    }
    return{html:`<g class="frDso" aria-hidden="true">${symbols.join('')}${labels.join('')}</g>`,count:visible,labelCount};
  }

  function niceGridStep(spanDeg){
    const steps=[0.05,0.1,0.2,0.5,1,2,5,10,15,30,45,60];
    const target=Math.max(0.04,Number(spanDeg)/5.2);
    return steps.find(s=>s>=target)||steps[steps.length-1];
  }
  function normDeltaDeg(v){let d=((Number(v)+540)%360)-180;return d;}
  function formatRaLabel(raDeg,stepDeg){
    const totalMin=Math.round(E.normRa(raDeg)/15*60),h=Math.floor(totalMin/60)%24,m=totalMin%60;
    return stepDeg>=15?`${String(h).padStart(2,'0')}h`:`${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m`;
  }
  function formatDecLabel(decDeg,stepDeg){
    const sign=decDeg>=0?'+':'−',abs=Math.abs(decDeg);
    if(stepDeg>=1)return`${sign}${Math.round(abs)}°`;
    return`${sign}${abs.toFixed(1)}°`;
  }
  function buildPath(points){
    let d='',open=false;
    for(const p of points){
      if(!p){open=false;continue;}
      d+=(open?' L ':'M ')+p.x.toFixed(2)+' '+p.y.toFixed(2);
      open=true;
    }
    return d.trim();
  }
  function gridLayer(v,preview){
    const widthSpan=v.width/v.scale,heightSpan=v.height/v.scale;
    const cosDec=Math.max(.16,Math.cos(v.viewDecDeg*D2R));
    const raSpan=Math.min(179,widthSpan/cosDec*.62),decSpan=Math.min(89,heightSpan*.62),
          raStep=niceGridStep(raSpan),decStep=niceGridStep(decSpan);
    const decMin=clamp(v.viewDecDeg-decSpan,-89.8,89.8),decMax=clamp(v.viewDecDeg+decSpan,-89.8,89.8);
    const raHalf=Math.max(raSpan,raStep*2.5);
    const raStart=Math.floor((v.viewRaDeg-raHalf)/raStep)*raStep,raEnd=Math.ceil((v.viewRaDeg+raHalf)/raStep)*raStep;
    const decStart=Math.floor(decMin/decStep)*decStep,decEnd=Math.ceil(decMax/decStep)*decStep;
    const lines=[],labels=[];
    const majorStroke=`rgba(150,180,225,${preview?.22:.36})`,minorStroke=`rgba(140,165,205,${preview?.12:.18})`;
    const minorWidth=preview?.75:.95,majorWidth=minorWidth;

    for(let ra=raStart;ra<=raEnd+1e-9;ra+=raStep){
      const pts=[];const segments=Math.max(16,Math.min(56,Math.round((decMax-decMin)/Math.max(decStep,.1))*8));
      for(let i=0;i<=segments;i++){
        const dec=decMin+(decMax-decMin)*(i/segments),sp=projectScreen(E.normRa(ra),dec,v);
        pts.push(sp&&sp.x>-50&&sp.x<v.width+50&&sp.y>-50&&sp.y<v.height+50?sp:null);
      }
      const isMajor=Math.abs(normDeltaDeg(ra-v.viewRaDeg))<raStep*.55;const d=buildPath(pts);if(d)lines.push(`<path d="${d}" fill="none" stroke="${isMajor?majorStroke:minorStroke}" stroke-width="${isMajor?majorWidth:minorWidth}" vector-effect="non-scaling-stroke"/>`);
      if(!preview){
        const labelPoint=projectScreen(E.normRa(ra),clamp(v.viewDecDeg,decMin,decMax),v);
        if(labelPoint&&labelPoint.x>28&&labelPoint.x<v.width-28)labels.push(`<text x="${labelPoint.x.toFixed(1)}" y="20" text-anchor="middle" fill="#c8d8f4" font-size="12" font-weight="800" paint-order="stroke" stroke="#07101c" stroke-width="4" stroke-linejoin="round">${esc(formatRaLabel(ra,raStep))}</text>`);
      }
    }
    for(let dec=decStart;dec<=decEnd+1e-9;dec+=decStep){
      if(dec<-89.8||dec>89.8)continue;
      const pts=[];const span=Math.min(179,raHalf*1.18/Math.max(.16,Math.cos(dec*D2R)));const segments=Math.max(18,Math.min(60,Math.round(span/Math.max(raStep,.1))*4));
      for(let i=0;i<=segments;i++){
        const ra=E.normRa(v.viewRaDeg-span+(2*span)*(i/segments)),sp=projectScreen(ra,dec,v);
        pts.push(sp&&sp.x>-50&&sp.x<v.width+50&&sp.y>-50&&sp.y<v.height+50?sp:null);
      }
      const isMajor=Math.abs(dec-v.viewDecDeg)<decStep*.55;const d=buildPath(pts);if(d)lines.push(`<path d="${d}" fill="none" stroke="${isMajor?majorStroke:minorStroke}" stroke-width="${isMajor?majorWidth:minorWidth}" vector-effect="non-scaling-stroke"/>`);
      if(!preview){
        const labelPoint=projectScreen(v.viewRaDeg,dec,v);
        if(labelPoint&&labelPoint.y>18&&labelPoint.y<v.height-12)labels.push(`<text x="12" y="${(labelPoint.y-2).toFixed(1)}" text-anchor="start" fill="#c8d8f4" font-size="12" font-weight="800" paint-order="stroke" stroke="#07101c" stroke-width="4" stroke-linejoin="round">${esc(formatDecLabel(dec,decStep))}</text>`);
      }
    }
    return{html:`<g class="frGrid" aria-hidden="true">${lines.join('')}${labels.join('')}</g>`,raStep,decStep};
  }

  function render(layout,opts={}){
    if(!layout)return'';
    const width=Number(opts.width)||640,height=Number(opts.height)||360,preview=!!opts.preview;
    const v=viewport(layout,width,height,Number(opts.padding)||28,opts.fixedScale,opts);
    const grid=gridLayer(v,preview),stars=starLayer(layout,v,preview),dsos=dsoLayer(layout,v,preview);
    const panels=(layout.panels||[]).map((p,i)=>{
      const path=panelPath(p,v),sp=projectScreen(p.centerRaDeg,p.centerDecDeg,v)||{x:v.cx,y:v.cy};
      const handle=preview?'':`<path class="frFrameHandle" d="${path}" fill="none" stroke="rgba(0,0,0,0.001)" stroke-width="32" pointer-events="stroke" vector-effect="non-scaling-stroke"/>`;
      return`<g class="frPanel">${handle}<path d="${path}" fill="rgba(106,167,255,${preview?.08:.10})" stroke="${i===0?'#8fc0ff':'#6aa7ff'}" stroke-width="${preview?1.5:2}" vector-effect="non-scaling-stroke" pointer-events="none"/><circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${preview?2:3}" fill="#9ec7ff" pointer-events="none"/><text x="${sp.x.toFixed(1)}" y="${(sp.y-(preview?7:10)).toFixed(1)}" text-anchor="middle" fill="#dce9ff" font-size="${preview?14:16}" font-weight="800" pointer-events="none">${esc(p.name)}</text></g>`;
    }).join('');
    const tgt=projectScreen(layout.targetRaDeg,layout.targetDecDeg,v),ctr=projectScreen(layout.centerRaDeg,layout.centerDecDeg,v);
    const target=tgt?`<g class="frTarget"><circle cx="${tgt.x.toFixed(1)}" cy="${tgt.y.toFixed(1)}" r="${preview?5:7}" fill="none" stroke="#68d391" stroke-width="2"/><line x1="${(tgt.x-10).toFixed(1)}" y1="${tgt.y.toFixed(1)}" x2="${(tgt.x+10).toFixed(1)}" y2="${tgt.y.toFixed(1)}" stroke="#68d391"/><line x1="${tgt.x.toFixed(1)}" y1="${(tgt.y-10).toFixed(1)}" x2="${tgt.x.toFixed(1)}" y2="${(tgt.y+10).toFixed(1)}" stroke="#68d391"/></g>`:'';
    const center=(layout.panels||[]).length&&ctr?`<g class="frCenter">${preview?'':`<circle class="frFrameHandle" cx="${ctr.x.toFixed(1)}" cy="${ctr.y.toFixed(1)}" r="24" fill="rgba(0,0,0,0.001)" pointer-events="all"/>`}<circle cx="${ctr.x.toFixed(1)}" cy="${ctr.y.toFixed(1)}" r="${preview?3:4}" fill="#f6c453" pointer-events="none"/></g>`:'';
    const orient=!preview?`<g class="frOrient" font-size="12" fill="#8ea3c8" font-weight="700"><text x="${width-28}" y="25" text-anchor="end">N ↑</text><text x="${width-28}" y="42" text-anchor="end">E ←</text></g>`:'';
    return`<svg class="framingSvg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Podgląd kadru" data-ppd="${v.scale}" data-view-ra="${v.viewRaDeg}" data-view-dec="${v.viewDecDeg}" data-star-count="${stars.count}" data-dso-count="${dsos.count}" data-dso-label-count="${dsos.labelCount}"${stars.limit!=null?` data-star-limit="${stars.limit}"`:''}>`+
      `<g class="frMapRoot">${stars.html}${grid.html}${dsos.html}${panels}${target}${center}</g>${orient}</svg>`;
  }
  global.AstroFramingRenderer={render,viewport,stableScale};
})(window);
