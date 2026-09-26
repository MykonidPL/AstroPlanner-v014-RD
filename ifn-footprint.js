/* AstroPlanner v0.14 R&D — Stage 4B.7aw standalone IFN footprint evaluator.
 *
 * Scope of this microstage:
 * - consume an AstroFraming layout;
 * - deterministically sample the frozen AstroIfnField at <=0.5 deg spacing;
 * - aggregate aperture-smoothed I100 over the actual single/mosaic footprint;
 * - keep between-sample and within-aperture spatial variability separate;
 * - fail closed to a neutral footprint contract.
 *
 * Intentionally NOT integrated with index.html, service worker, Score,
 * recommendations, project persistence, or target applicability.
 */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(root)root.AstroIfnFootprint=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const VERSION='4B.7aw-footprint-1';
  const MODEL='ifn-sfd-i100-footprint';
  const SAMPLE_STEP_DEG=0.5;
  const D2R=Math.PI/180;

  const freeze=value=>Object.freeze(value);
  const finite=value=>Number.isFinite(Number(value));

  function missing(reason='invalid-layout'){
    return freeze({
      model:MODEL,
      status:'missing',
      confidence:'low',
      reason,
      samplingMode:null,
      sampleCount:0,
      sampleStepDeg:SAMPLE_STEP_DEG,
      footprintMeanI100:null,
      betweenSampleStdI100:null,
      localApertureStdRmsI100:null,
      signalTimeFactor:1.0
    });
  }

  function validLayoutBasics(layout){
    return !!layout&&typeof layout==='object'&&!Array.isArray(layout)&&
      (layout.type==='single'||layout.type==='mosaic')&&
      finite(layout.centerRaDeg)&&finite(layout.centerDecDeg)&&
      Number(layout.centerDecDeg)>=-90&&Number(layout.centerDecDeg)<=90&&
      finite(layout.fovW)&&Number(layout.fovW)>0&&
      finite(layout.fovH)&&Number(layout.fovH)>0&&
      finite(layout.rotationDeg);
  }

  function dependencies(options){
    return{
      framing:options?.framing||root?.AstroFraming||null,
      field:options?.field||root?.AstroIfnField||null
    };
  }

  function validDependencies(framing,field){
    return !!framing&&typeof framing.planeSizeFromFov==='function'&&
      typeof framing.rotate==='function'&&typeof framing.tangentToSky==='function'&&
      !!field&&typeof field.lookup==='function'&&
      typeof field.signalTimeFactorFromI100==='function';
  }

  function framePlaneSize(layout,framing){
    const width=Number(framing.planeSizeFromFov(Number(layout.fovW)));
    const height=Number(framing.planeSizeFromFov(Number(layout.fovH)));
    if(!(width>0)||!(height>0)||!Number.isFinite(width)||!Number.isFinite(height))return null;
    return{width,height};
  }

  function unionPlaneSize(layout,frameSize){
    if(layout.type!=='mosaic')return frameSize;
    const rows=Number(layout.rows),cols=Number(layout.cols),panelCount=Number(layout.panelCount);
    if(!Number.isInteger(rows)||rows<1||!Number.isInteger(cols)||cols<1)return null;
    const total=rows*cols;
    if(layout.gridMatches!==true||!Number.isInteger(panelCount)||panelCount!==total)return null;
    if(!Array.isArray(layout.panels)||layout.panels.length!==total)return null;
    const panelsValid=layout.panels.every(panel=>panel&&finite(panel.centerRaDeg)&&finite(panel.centerDecDeg)&&
      Number(panel.centerDecDeg)>=-90&&Number(panel.centerDecDeg)<=90&&Array.isArray(panel.corners)&&panel.corners.length===4&&
      panel.corners.every(corner=>corner&&finite(corner.raDeg)&&finite(corner.decDeg)&&Number(corner.decDeg)>=-90&&Number(corner.decDeg)<=90));
    if(!panelsValid)return null;
    const overlap=Number(layout.overlapPct);
    if(!Number.isFinite(overlap)||overlap<0||overlap>80)return null;
    const stepX=frameSize.width*(1-overlap/100);
    const stepY=frameSize.height*(1-overlap/100);
    const width=frameSize.width+(cols-1)*stepX;
    const height=frameSize.height+(rows-1)*stepY;
    return Number.isFinite(width)&&width>0&&Number.isFinite(height)&&height>0?{width,height}:null;
  }

  function areaWeight(xDeg,yDeg){
    const x=Number(xDeg)*D2R,y=Number(yDeg)*D2R;
    const q=1+x*x+y*y;
    return Number.isFinite(q)&&q>0?Math.pow(q,-1.5):NaN;
  }

  function skyPoint(framing,layout,xDeg,yDeg){
    const rotated=framing.rotate(Number(xDeg),Number(yDeg),Number(layout.rotationDeg));
    if(!rotated||!finite(rotated.x)||!finite(rotated.y))return null;
    const sky=framing.tangentToSky(Number(rotated.x),Number(rotated.y),Number(layout.centerRaDeg),Number(layout.centerDecDeg));
    if(!sky||!finite(sky.raDeg)||!finite(sky.decDeg)||Number(sky.decDeg)<-90||Number(sky.decDeg)>90)return null;
    return{raDeg:Number(sky.raDeg),decDeg:Number(sky.decDeg)};
  }

  function centerSample(layout,field){
    const result=field.lookup(Number(layout.centerRaDeg),Number(layout.centerDecDeg));
    return{result,xDeg:0,yDeg:0,weight:1};
  }

  function gridSamples(layout,framing,field,width,height){
    const nx=Math.ceil(width/SAMPLE_STEP_DEG),ny=Math.ceil(height/SAMPLE_STEP_DEG);
    if(!Number.isInteger(nx)||nx<1||!Number.isInteger(ny)||ny<1)return null;
    const dx=width/nx,dy=height/ny;
    if(!(dx>0)||!(dy>0)||dx>SAMPLE_STEP_DEG+1e-12||dy>SAMPLE_STEP_DEG+1e-12)return null;
    const samples=[];
    for(let j=0;j<ny;j++){
      const y=-height/2+(j+0.5)*dy;
      for(let i=0;i<nx;i++){
        const x=-width/2+(i+0.5)*dx;
        const sky=skyPoint(framing,layout,x,y);
        const weight=areaWeight(x,y);
        if(!sky||!Number.isFinite(weight)||!(weight>0))return null;
        samples.push({result:field.lookup(sky.raDeg,sky.decDeg),xDeg:x,yDeg:y,weight});
      }
    }
    return samples;
  }

  function aggregate(samples,field,samplingMode){
    if(!Array.isArray(samples)||samples.length<1)return missing('invalid-geometry');
    let sumW=0,sumMean=0,sumLocalVar=0;
    for(const sample of samples){
      const result=sample?.result;
      if(!result||result.status!=='quantitative')return missing('sample-missing');
      const mean=Number(result.meanI100),std=Number(result.stdI100),weight=Number(sample.weight);
      if(!Number.isFinite(mean)||!Number.isFinite(std)||!Number.isFinite(weight)||!(weight>0))return missing('invalid-sample');
      sumW+=weight;
      sumMean+=weight*mean;
      sumLocalVar+=weight*std*std;
    }
    if(!(sumW>0)||!Number.isFinite(sumW)||!Number.isFinite(sumMean)||!Number.isFinite(sumLocalVar))return missing('invalid-sample');
    const footprintMeanI100=sumMean/sumW;
    if(!Number.isFinite(footprintMeanI100))return missing('invalid-sample');

    let betweenSampleStdI100=null;
    if(samples.length>1){
      let betweenVar=0;
      for(const sample of samples){
        const delta=Number(sample.result.meanI100)-footprintMeanI100;
        betweenVar+=Number(sample.weight)*delta*delta;
      }
      betweenVar/=sumW;
      if(!Number.isFinite(betweenVar)||betweenVar<0)return missing('invalid-sample');
      betweenSampleStdI100=Math.sqrt(Math.max(0,betweenVar));
    }

    const localApertureStdRmsI100=Math.sqrt(Math.max(0,sumLocalVar/sumW));
    if(!Number.isFinite(localApertureStdRmsI100))return missing('invalid-sample');
    const signalTimeFactor=Number(field.signalTimeFactorFromI100(footprintMeanI100));
    if(!Number.isFinite(signalTimeFactor)||!(signalTimeFactor>0))return missing('invalid-sample');

    return freeze({
      model:MODEL,
      status:'quantitative',
      confidence:'high',
      reason:null,
      samplingMode,
      sampleCount:samples.length,
      sampleStepDeg:SAMPLE_STEP_DEG,
      footprintMeanI100,
      betweenSampleStdI100,
      localApertureStdRmsI100,
      signalTimeFactor
    });
  }

  function evaluate(layout,options={}){
    if(!validLayoutBasics(layout))return missing('invalid-layout');
    const{framing,field}=dependencies(options);
    if(!validDependencies(framing,field))return missing('dependency-missing');

    const frameSize=framePlaneSize(layout,framing);
    if(!frameSize)return missing('invalid-geometry');

    if(layout.type==='single'){
      const halfDiagonal=0.5*Math.hypot(frameSize.width,frameSize.height);
      if(!Number.isFinite(halfDiagonal))return missing('invalid-geometry');
      if(halfDiagonal<=SAMPLE_STEP_DEG){
        return aggregate([centerSample(layout,field)],field,'center');
      }
      const samples=gridSamples(layout,framing,field,frameSize.width,frameSize.height);
      return samples?aggregate(samples,field,'grid'):missing('invalid-geometry');
    }

    const unionSize=unionPlaneSize(layout,frameSize);
    if(!unionSize)return missing('grid-mismatch');
    const samples=gridSamples(layout,framing,field,unionSize.width,unionSize.height);
    return samples?aggregate(samples,field,'grid'):missing('invalid-geometry');
  }

  return freeze({VERSION,MODEL,SAMPLE_STEP_DEG,evaluate});
});
