/* AstroPlanner v0.14 R&D — Stage 4B.7bk canonical effective project-signal resolver.
 *
 * Scope:
 * - choose exactly one signal source from project.signalIntent;
 * - normalize Target Signal Foundation and IFN footprint results;
 * - remain synchronous, stateless and side-effect free;
 * - never load data, evaluate a footprint, or integrate with Score/recommendations.
 */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(root)root.AstroEffectiveProjectSignal=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const VERSION='4B.7bk-effective-signal-1';
  const VALID_STATUS=new Set(['quantitative','descriptive','missing']);
  const VALID_CONFIDENCE=new Set(['high','medium','low']);
  const freeze=value=>Object.freeze(value);
  const positiveFinite=value=>Number.isFinite(Number(value))&&Number(value)>0;
  const intentForProject=project=>project?.signalIntent==='ifn-field'?'ifn-field':'target';
  const projectId=project=>project?.id==null?null:String(project.id);
  const normalizeStatus=value=>VALID_STATUS.has(value)?value:'missing';
  const normalizeConfidence=value=>VALID_CONFIDENCE.has(value)?value:'low';

  function result({project,intent,source,model,status,confidence,signalTimeFactor,summary,reason}){
    const factor=positiveFinite(signalTimeFactor)?Number(signalTimeFactor):1.0;
    return freeze({
      version:1,
      projectId:projectId(project),
      intent,
      source,
      model:String(model||'unknown'),
      status:normalizeStatus(status),
      confidence:normalizeConfidence(confidence),
      signalTimeFactor:factor,
      summary:String(summary||''),
      reason:reason==null?null:String(reason)
    });
  }

  function resolveTarget(project,options){
    const metadata=options?.metadata||null;
    const targetMetadata=options?.targetMetadata||root?.AstroTargetMetadata||null;
    const signal=metadata?.signal||{};
    const hasApi=!!targetMetadata&&
      typeof targetMetadata.signalTimeFactor==='function'&&
      typeof targetMetadata.signalDataStatus==='function'&&
      typeof targetMetadata.signalSummary==='function';

    if(!hasApi){
      return result({
        project,intent:'target',source:'target',model:signal.model||'unknown',status:'missing',confidence:signal.confidence,
        signalTimeFactor:1.0,summary:'brak canonical Target Signal Foundation',reason:'target-dependency-missing'
      });
    }

    let factor=1.0,status='missing',summary='brak ilościowych danych o sygnale',reason=null,confidence=signal.confidence;
    try{
      factor=targetMetadata.signalTimeFactor(metadata);
      status=targetMetadata.signalDataStatus(metadata);
      summary=targetMetadata.signalSummary(metadata);
      if(!metadata)reason='target-metadata-missing';
      else if(!positiveFinite(factor)){factor=1.0;status='missing';confidence='low';reason='target-factor-invalid';}
    }catch(_){
      factor=1.0;status='missing';confidence='low';summary='brak canonical danych o sygnale';reason='target-resolution-error';
    }

    return result({
      project,intent:'target',source:'target',model:signal.model||'unknown',status,confidence,
      signalTimeFactor:factor,summary,reason
    });
  }

  function ifnSummary(footprint){
    const mean=Number(footprint?.footprintMeanI100);
    if(footprint?.status==='quantitative'&&Number.isFinite(mean))return`IFN footprint: I100 ≈ ${mean.toFixed(3)} MJy/sr`;
    return'brak ilościowego wyniku IFN footprint';
  }

  function resolveIfn(project,options){
    const footprint=options?.footprint||null;
    if(!footprint||typeof footprint!=='object'){
      return result({
        project,intent:'ifn-field',source:'ifn-footprint',model:'ifn-sfd-i100-footprint',status:'missing',confidence:'low',
        signalTimeFactor:1.0,summary:'brak ilościowego wyniku IFN footprint',reason:'footprint-missing'
      });
    }

    const validFactor=positiveFinite(footprint.signalTimeFactor);
    const factor=validFactor?Number(footprint.signalTimeFactor):1.0;
    let reason=footprint.reason==null?null:String(footprint.reason);
    if(!validFactor)reason=reason||'footprint-factor-invalid';

    return result({
      project,intent:'ifn-field',source:'ifn-footprint',model:footprint.model||'ifn-sfd-i100-footprint',status:validFactor?footprint.status:'missing',
      confidence:validFactor?footprint.confidence:'low',signalTimeFactor:factor,summary:ifnSummary(validFactor?footprint:null),reason
    });
  }

  function resolve(project,options={}){
    const intent=intentForProject(project);
    return intent==='ifn-field'?resolveIfn(project,options):resolveTarget(project,options);
  }

  return freeze({VERSION,resolve});
});
