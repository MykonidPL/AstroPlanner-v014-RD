(function(global){
  'use strict';
  const D2R=Math.PI/180,R2D=180/Math.PI;
  const finite=v=>Number.isFinite(Number(v));
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)));
  const normRa=v=>((Number(v)%360)+360)%360;
  const normRot=v=>{let n=((Number(v)%360)+360)%360;return n>=180?n-360:n;};
  function validCoord(ra,dec){return finite(ra)&&finite(dec)&&Number(dec)>=-90&&Number(dec)<=90;}
  function projectToTangent(raDeg,decDeg,centerRaDeg,centerDecDeg){
    if(!validCoord(raDeg,decDeg)||!validCoord(centerRaDeg,centerDecDeg))return null;
    const ra=normRa(raDeg)*D2R,dec=Number(decDeg)*D2R,ra0=normRa(centerRaDeg)*D2R,dec0=Number(centerDecDeg)*D2R;
    let dra=ra-ra0;while(dra>Math.PI)dra-=2*Math.PI;while(dra<-Math.PI)dra+=2*Math.PI;
    const sd=Math.sin(dec),cd=Math.cos(dec),s0=Math.sin(dec0),c0=Math.cos(dec0),cda=Math.cos(dra);
    const denom=s0*sd+c0*cd*cda;
    if(!(denom>1e-9))return null;
    return{x:(cd*Math.sin(dra)/denom)*R2D,y:((c0*sd-s0*cd*cda)/denom)*R2D};
  }
  function tangentToSky(xDeg,yDeg,centerRaDeg,centerDecDeg){
    if(!finite(xDeg)||!finite(yDeg)||!validCoord(centerRaDeg,centerDecDeg))return null;
    const x=Number(xDeg)*D2R,y=Number(yDeg)*D2R,ra0=normRa(centerRaDeg)*D2R,dec0=Number(centerDecDeg)*D2R;
    const rho=Math.hypot(x,y);
    if(rho<1e-14)return{raDeg:normRa(centerRaDeg),decDeg:Number(centerDecDeg)};
    const c=Math.atan(rho),sc=Math.sin(c),cc=Math.cos(c),s0=Math.sin(dec0),c0=Math.cos(dec0);
    const dec=Math.asin(clamp(cc*s0+(y*sc*c0/rho),-1,1));
    const ra=ra0+Math.atan2(x*sc,rho*c0*cc-y*s0*sc);
    return{raDeg:normRa(ra*R2D),decDeg:clamp(dec*R2D,-90,90)};
  }
  function rotate(x,y,deg){const a=Number(deg||0)*D2R,c=Math.cos(a),s=Math.sin(a);return{x:x*c-y*s,y:x*s+y*c};}
  function planeSizeFromFov(fovDeg){return 2*Math.tan(Number(fovDeg)*D2R/2)*R2D;}
  function defaultGridForCount(count){
    const n=Math.max(1,Math.round(Number(count)||1));
    let best={rows:1,cols:n,score:n-1};
    for(let r=1;r<=Math.floor(Math.sqrt(n));r++)if(n%r===0){const c=n/r,score=Math.abs(c-r);if(score<best.score)best={rows:r,cols:c,score};}
    return{rows:best.rows,cols:best.cols};
  }
  function normalizedConfig(cfg){
    const count=Math.max(1,Math.round(Number(cfg.panelCount)||1)),fallback=defaultGridForCount(count);
    return{
      targetRaDeg:normRa(cfg.targetRaDeg),targetDecDeg:Number(cfg.targetDecDeg),
      centerRaDeg:finite(cfg.centerRaDeg)?normRa(cfg.centerRaDeg):normRa(cfg.targetRaDeg),
      centerDecDeg:finite(cfg.centerDecDeg)?clamp(Number(cfg.centerDecDeg),-90,90):Number(cfg.targetDecDeg),
      rotationDeg:normRot(finite(cfg.rotationDeg)?Number(cfg.rotationDeg):0),
      fovW:Number(cfg.fovW),fovH:Number(cfg.fovH),
      type:cfg.type==='mosaic'?'mosaic':'single',
      panelCount:count,
      rows:Math.max(1,Math.round(Number(cfg.rows)||fallback.rows)),cols:Math.max(1,Math.round(Number(cfg.cols)||fallback.cols)),
      overlapPct:clamp(finite(cfg.overlapPct)?Number(cfg.overlapPct):15,0,80),
      panelNames:Array.isArray(cfg.panelNames)?cfg.panelNames.map(String):[]
    };
  }
  function frameCorners(centerRaDeg,centerDecDeg,fovW,fovH,rotationDeg){
    const pts=[[-fovW/2,-fovH/2],[fovW/2,-fovH/2],[fovW/2,fovH/2],[-fovW/2,fovH/2]];
    return pts.map(([x,y])=>{const r=rotate(x,y,rotationDeg);return tangentToSky(r.x,r.y,centerRaDeg,centerDecDeg);}).filter(Boolean);
  }
  function createLayout(raw){
    const c=normalizedConfig(raw||{});
    if(!validCoord(c.targetRaDeg,c.targetDecDeg)||!validCoord(c.centerRaDeg,c.centerDecDeg)||!(c.fovW>0)||!(c.fovH>0))return null;
    const rows=c.type==='mosaic'?c.rows:1,cols=c.type==='mosaic'?c.cols:1,total=rows*cols;
    const planeW=planeSizeFromFov(c.fovW),planeH=planeSizeFromFov(c.fovH),stepX=planeW*(1-c.overlapPct/100),stepY=planeH*(1-c.overlapPct/100),panels=[];
    for(let r=0;r<rows;r++)for(let col=0;col<cols;col++){
      const i=r*cols+col;
      const baseX=(col-(cols-1)/2)*stepX,baseY=((rows-1)/2-r)*stepY;
      const off=rotate(baseX,baseY,c.rotationDeg),sky=tangentToSky(off.x,off.y,c.centerRaDeg,c.centerDecDeg);
      if(!sky)continue;
      const localCorners=[[-planeW/2,-planeH/2],[planeW/2,-planeH/2],[planeW/2,planeH/2],[-planeW/2,planeH/2]];
      const corners=localCorners.map(([dx,dy])=>{const q=rotate(baseX+dx,baseY+dy,c.rotationDeg);return tangentToSky(q.x,q.y,c.centerRaDeg,c.centerDecDeg);}).filter(Boolean);
      panels.push({index:i,name:c.panelNames[i]||`P${i+1}`,centerRaDeg:sky.raDeg,centerDecDeg:sky.decDeg,rotationDeg:c.rotationDeg,fovW:c.fovW,fovH:c.fovH,corners});
    }
    const centerLocal=projectToTangent(c.centerRaDeg,c.centerDecDeg,c.targetRaDeg,c.targetDecDeg)||{x:0,y:0};
    return{...c,rows,cols,total,validPanelCount:c.type==='mosaic'?c.panelCount:1,gridMatches:c.type!=='mosaic'||total===c.panelCount,centerLocal,panels,target:{raDeg:c.targetRaDeg,decDeg:c.targetDecDeg}};
  }
  function shiftSkyFromScreenDrag(raDeg,decDeg,referenceRaDeg,referenceDecDeg,dxPx,dyPx,pixelsPerDegree){
    if(!(pixelsPerDegree>0)||!validCoord(raDeg,decDeg)||!validCoord(referenceRaDeg,referenceDecDeg))return null;
    const cur=projectToTangent(raDeg,decDeg,referenceRaDeg,referenceDecDeg)||{x:0,y:0};
    const nextX=cur.x-Number(dxPx)/pixelsPerDegree,nextY=cur.y-Number(dyPx)/pixelsPerDegree;
    return tangentToSky(nextX,nextY,referenceRaDeg,referenceDecDeg);
  }
  function shiftedViewFromScreenPan(raDeg,decDeg,dxPx,dyPx,pixelsPerDegree){
    if(!(pixelsPerDegree>0)||!validCoord(raDeg,decDeg))return null;
    // The sky layer follows the finger visually. To preserve that position after
    // release, the projection centre must move in the same tangent-plane direction.
    const nextX=Number(dxPx)/pixelsPerDegree,nextY=Number(dyPx)/pixelsPerDegree;
    return tangentToSky(nextX,nextY,raDeg,decDeg);
  }
  function shiftedCenterFromScreenDrag(layout,dxPx,dyPx,pixelsPerDegree,referenceRaDeg,referenceDecDeg){
    if(!layout)return null;
    const refRa=finite(referenceRaDeg)?referenceRaDeg:layout.targetRaDeg;
    const refDec=finite(referenceDecDeg)?referenceDecDeg:layout.targetDecDeg;
    return shiftSkyFromScreenDrag(layout.centerRaDeg,layout.centerDecDeg,refRa,refDec,dxPx,dyPx,pixelsPerDegree);
  }
  global.AstroFraming={validCoord,projectToTangent,tangentToSky,rotate,planeSizeFromFov,defaultGridForCount,frameCorners,createLayout,shiftSkyFromScreenDrag,shiftedViewFromScreenPan,shiftedCenterFromScreenDrag,normRa,normRot};
})(window);
