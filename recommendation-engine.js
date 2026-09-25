/* AstroPlanner v0.14 R&D — recommendation scoring v6.
 * The score is now driven by relative S/N efficiency rather than a shallow
 * logarithmic point deduction. Physical layers remain separate:
 *   - exact Planner night window,
 *   - atmospheric transmission,
 *   - Moon + site + twilight background,
 *   - filter/material signal preservation,
 *   - type-aware intrinsic target signal metadata.
 * 0–100 is still a utility index, but the central condition term is the square-root
 * S/N law: for background-limited imaging S/N rate scales as 1/sqrt(required time).
 */
(function(global){
  'use strict';
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)));
  const DEG=Math.PI/180;
  const NATURAL_SQM=21.70;
  const DEFAULT_EXTINCTION=0.20;
  const REFERENCE_SURFACE_BRIGHTNESS=23.0; // utility normalization for derived mean SB, mag/arcsec²
  const REFERENCE_DARK_CONTRAST=.95;

  function validAstro(astro){return !!astro&&['altitude','sunPos','moonPos','sep'].every(k=>typeof astro[k]==='function');}
  function validCoords(ra,dec){return Number.isFinite(ra)&&ra>=0&&ra<360&&Number.isFinite(dec)&&dec>=-90&&dec<=90;}

  function buildContext({date,lat,lon,astro,stepMinutes=5}){
    if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new Error('Nieprawidłowa data rekomendacji');
    lat=Number(lat);lon=Number(lon);stepMinutes=Math.max(1,Number(stepMinutes)||5);
    if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180)throw new Error('Nieprawidłowa lokalizacja rekomendacji');
    if(!validAstro(astro))throw new Error('Brak adaptera obliczeń astronomicznych');
    const start=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12,0,0,0),samples=[];
    for(let minute=0;minute<=1440;minute+=stepMinutes){
      const t=new Date(start.getTime()+minute*60000),sun=astro.sunPos(t),moon=astro.moonPos(t),sunAlt=astro.altitude(sun.ra,sun.dec,t,lat,lon),moonAlt=astro.altitude(moon.ra,moon.dec,t,lat,lon),elongation=astro.sep(sun.ra,sun.dec,moon.ra,moon.dec),illumination=(1-Math.cos(elongation*DEG))/2;
      samples.push({t,sunAlt,moonAlt,moonRa:moon.ra,moonDec:moon.dec,illumination});
    }
    return{date:new Date(date),lat,lon,stepMinutes,samples};
  }

  function airmassFromAltitude(alt){alt=Number(alt);if(!(alt>0))return Infinity;const z=(90-alt)*DEG;return 1/Math.sqrt(Math.max(.04,1-.96*Math.sin(z)**2));}
  function atmosphericTransmission(alt,k=DEFAULT_EXTINCTION){const x=airmassFromAltitude(alt);if(!Number.isFinite(x))return 0;return Math.pow(10,-.4*k*Math.max(0,x-1));}
  function darkSkyAirmassFactor(alt,k=DEFAULT_EXTINCTION){const x=airmassFromAltitude(alt);if(!Number.isFinite(x))return Infinity;return Math.max(1,Math.pow(10,-.4*k*Math.max(0,x-1))*x);}
  function sqmToNanoLambert(sqm){return 34.08*Math.exp(20.7233-.92104*Number(sqm));}

  function twilightZenithSQM(sunAlt){
    sunAlt=Number(sunAlt);if(!Number.isFinite(sunAlt)||sunAlt<=-18)return Infinity;
    const h=clamp(sunAlt,-15,-5),zeta=90-h,u=zeta-95,v=11.84+1.518*u-.057*u*u;
    if(sunAlt>=-15)return v;
    const v15=11.84+1.518*10-.057*100,t=clamp((-sunAlt-15)/3,0,1);return v15+(NATURAL_SQM-v15)*t;
  }
  function twilightExcessRatio(sunAlt){const sqm=twilightZenithSQM(sunAlt);if(!Number.isFinite(sqm))return 0;const natural=sqmToNanoLambert(NATURAL_SQM),tw=sqmToNanoLambert(sqm);return Math.max(0,(tw-natural)/natural);}

  function moonlightNanoLambert({illumination,moonAlt,targetAlt,separation,k=DEFAULT_EXTINCTION}){
    illumination=clamp(illumination,0,1);moonAlt=Number(moonAlt);targetAlt=Number(targetAlt);separation=Number(separation);
    if(!(illumination>.001)||!(moonAlt>0)||!(targetAlt>0)||!Number.isFinite(separation))return 0;
    const phaseAngle=Math.acos(clamp(2*illumination-1,-1,1))/DEG,iStar=Math.pow(10,-.4*(3.84+.026*Math.abs(phaseAngle)+4e-9*Math.pow(phaseAngle,4))),rho=clamp(Math.abs(separation),1,180),c=Math.cos(rho*DEG),rayleigh=Math.pow(10,5.36)*(1.06+c*c),mie=rho<10?6.2e7/(rho*rho):Math.pow(10,6.15-rho/40),xm=airmassFromAltitude(moonAlt),x=airmassFromAltitude(targetAlt);
    if(!Number.isFinite(xm)||!Number.isFinite(x))return 0;
    return(rayleigh+mie)*iStar*Math.pow(10,-.4*k*xm)*(1-Math.pow(10,-.4*k*x));
  }

  function longestWindow(flags,samples,stepMinutes){
    let bestStart=-1,bestEnd=-1,runStart=-1;
    for(let i=0;i<=flags.length;i++){const on=i<flags.length&&flags[i];if(on&&runStart<0)runStart=i;if(!on&&runStart>=0){const end=i-1;if(bestStart<0||end-runStart>bestEnd-bestStart){bestStart=runStart;bestEnd=end;}runStart=-1;}}
    if(bestStart<0)return{hours:0,start:null,end:null};
    const start=samples[bestStart].t,end=new Date(samples[bestEnd].t.getTime()+stepMinutes*60000);return{hours:(end-start)/3600000,start,end,startIndex:bestStart,endIndex:bestEnd};
  }
  function scoreLabel(score){if(score>=85)return'bardzo dobre';if(score>=65)return'dobre';if(score>=45)return'umiarkowane';if(score>=25)return'słabe';return'bardzo słabe';}
  function windowPhrase(hours){if(hours>=6)return'długie okno';if(hours>=3.5)return'średnie okno';if(hours>=1.5)return'krótkie okno';if(hours>0)return'bardzo krótkie okno';return'brak sensownego okna';}
  function coveragePhrase(c){if(c>=.75)return'przez większość nocy';if(c>=.45)return'przez sporą część nocy';if(c>=.20)return'tylko przez część nocy';if(c>0)return'tylko krótko w nocy';return'poza użyteczną częścią nocy';}
  function moonImpactPhrase(f){if(f<1.08)return'mały wpływ Księżyca';if(f<1.35)return'umiarkowany wpływ Księżyca';if(f<2)return'duży wpływ Księżyca';return'bardzo duży wpływ Księżyca';}

  function defaultMaterial(){return{kind:'unknown',label:'materiał nieokreślony',moonResponse:1,lpResponse:1,assumed:true,quantitativeFraction:0};}
  function materialCompatibility(metadata,material){return global.AstroFilterProfiles?.compatibility?.(metadata,material)??1;}

  function signalTimeDemand(metadata){
    const s=metadata?.signal||{},mu=Number(s.surfaceBrightnessMagArcsec2);
    if(s.model==='surface-brightness'&&Number.isFinite(mu)){
      const raw=Math.pow(10,.8*(mu-REFERENCE_SURFACE_BRIGHTNESS));
      return{factor:clamp(raw,.08,100),model:'surface-brightness',confidence:s.confidence||'medium',dataStatus:'quantitative',summary:global.AstroTargetMetadata?.signalSummary?.(metadata)||`μ ≈ ${mu.toFixed(2)} mag/arcsec²`};
    }
    const contrast=Number(s.absorptionContrast);
    if(s.model==='dark-opacity'&&Number.isFinite(contrast)&&contrast>0){
      const raw=Math.pow(REFERENCE_DARK_CONTRAST/contrast,2);
      return{factor:clamp(raw,.65,4),model:'dark-opacity',confidence:s.confidence||'medium',dataStatus:'quantitative',summary:global.AstroTargetMetadata?.signalSummary?.(metadata)||`opacity ${s.opacityClass}/6`};
    }
    const dataStatus=global.AstroTargetMetadata?.signalDataStatus?.(metadata)||(s.model==='integrated-magnitude'&&Number.isFinite(Number(s.integratedMagnitude))?'descriptive':'missing');
    return{factor:1,model:s.model||'unknown',confidence:s.confidence||'low',dataStatus,summary:global.AstroTargetMetadata?.signalSummary?.(metadata)||'brak ilościowych danych o sygnale'};
  }

  function scoreTarget({raDeg,decDeg,classKey='mixed',metadata=null,materialProfile=null,context,astro,sky=null,minAltitudeDeg=30,sunLimitDeg=-18}){
    raDeg=Number(raDeg);decDeg=Number(decDeg);if(!validCoords(raDeg,decDeg))throw new Error('Nieprawidłowe współrzędne celu');
    if(!context?.samples?.length||!validAstro(astro))throw new Error('Brak kontekstu rekomendacji');
    minAltitudeDeg=clamp(Number(minAltitudeDeg),0,89.9);sunLimitDeg=clamp(Number(sunLimitDeg),-18,-6);metadata=metadata||{photoClass:classKey||'mixed'};materialProfile=materialProfile||defaultMaterial();

    const stepHours=context.stepMinutes/60,usableFlags=[],rows=[];let totalNightHours=0;
    const naturalNL=sqmToNanoLambert(NATURAL_SQM),siteSQM=Number(sky?.sqm),siteRatio=Number.isFinite(siteSQM)?Math.max(1,sqmToNanoLambert(siteSQM)/naturalNL):1,lpExcess=Math.max(0,siteRatio-1);
    const compatibility=clamp(materialCompatibility(metadata,materialProfile),.05,1),rawLpResponse=clamp(materialProfile.lpResponse??1,0,1),rawMoonResponse=clamp(materialProfile.moonResponse??1,0,1);
    const lpResponse=1-compatibility*(1-rawLpResponse),moonResponse=1-compatibility*(1-rawMoonResponse),siteMaterialZenithRatio=1+lpExcess*lpResponse;

    for(const s of context.samples){const alt=astro.altitude(raDeg,decDeg,s.t,context.lat,context.lon),night=s.sunAlt<=sunLimitDeg,above=alt>=minAltitudeDeg,usable=night&&above;if(night)totalNightHours+=stepHours;usableFlags.push(usable);rows.push({sample:s,alt,usable});}
    const window=longestWindow(usableFlags,context.samples,context.stepMinutes),usableHours=window.hours;
    let transmissionSum=0,transmissionHours=0,bestImagingAltitude=-90,conditionLogSum=0,conditionWeight=0,moonLogSum=0,twilightLogSum=0;
    if(window.startIndex!=null&&window.startIndex>=0){
      for(let i=window.startIndex;i<=window.endIndex;i++){
        const row=rows[i],s=row.sample,alt=row.alt;if(!row.usable)continue;bestImagingAltitude=Math.max(bestImagingAltitude,alt);
        const trans=atmosphericTransmission(alt);transmissionSum+=trans*stepHours;transmissionHours+=stepHours;
        const separation=astro.sep(raDeg,decDeg,s.moonRa,s.moonDec),moonNL=moonlightNanoLambert({illumination:s.illumination,moonAlt:s.moonAlt,targetAlt:alt,separation}),moonRatio=moonNL/naturalNL,airmassSky=darkSkyAirmassFactor(alt),siteAtAltitude=siteMaterialZenithRatio*airmassSky,twilightRatio=twilightExcessRatio(s.sunAlt)*moonResponse,fullRatio=Math.max(1,siteAtAltitude+moonRatio*moonResponse+twilightRatio),weight=Math.max(.05,trans);
        conditionLogSum+=weight*Math.log(fullRatio);conditionWeight+=weight;moonLogSum+=weight*Math.log(Math.max(1,(siteAtAltitude+moonRatio*moonResponse)/siteAtAltitude));twilightLogSum+=weight*Math.log(Math.max(1,(siteAtAltitude+twilightRatio)/siteAtAltitude));
      }
    }

    const coverage=totalNightHours>0?clamp(usableHours/totalNightHours,0,1):0,meanTransmission=transmissionHours>0?transmissionSum/transmissionHours:0;
    const geometryScore=30*meanTransmission+35*clamp(usableHours/6,0,1)+25*coverage+10*clamp(window.hours/5,0,1);
    const timeMultiplier=conditionWeight>0?Math.exp(conditionLogSum/conditionWeight):siteMaterialZenithRatio,moonTimeFactor=conditionWeight>0?Math.exp(moonLogSum/conditionWeight):1,twilightTimeFactor=conditionWeight>0?Math.exp(twilightLogSum/conditionWeight):1;
    const signal=signalTimeDemand(metadata),signalTimeFactor=signal.factor,filterSignalTimeFactor=1/(compatibility*compatibility),effectiveTimeDemand=Math.max(.02,timeMultiplier*signalTimeFactor*filterSignalTimeFactor),snrEfficiency=clamp(1/Math.sqrt(effectiveTimeDemand),0,1);
    const score=Math.round(clamp(geometryScore*snrEfficiency,0,100));
    const backgroundPenalty=100*(1-clamp(1/Math.sqrt(Math.max(1,timeMultiplier)),0,1)),compatibilityPenalty=100*(1-compatibility),materialNote=materialProfile.label||'materiał nieokreślony';
    const signalNote=signal.dataStatus==='missing'?`${signal.summary} (wkład neutralny)`:signal.dataStatus==='descriptive'?`${signal.summary} (dane opisowe; wkład neutralny)`:signal.summary;
    const reason=`${score}/100 — ${scoreLabel(score)}; ${windowPhrase(usableHours)} (${usableHours.toFixed(1)} h), ${coveragePhrase(coverage)}, ${moonImpactPhrase(moonTimeFactor)}; sygnał: ${signalNote}.`;
    return{score,label:scoreLabel(score),classKey:metadata.photoClass||classKey||'mixed',reason,materialNote,metrics:{geometryScore,usableHours,totalNightHours,coverage,longestWindow:window.hours,windowStart:window.start,windowEnd:window.end,bestImagingAltitude,meanTransmission,siteRatio,siteMaterialRatio:siteMaterialZenithRatio,timeMultiplier,moonTimeFactor,twilightTimeFactor,backgroundPenalty,compatibility,compatibilityPenalty,lpResponse,moonResponse,rawLpResponse,rawMoonResponse,minAltitudeDeg,sunLimitDeg,signalTimeFactor,signalModel:signal.model,signalConfidence:signal.confidence,signalDataStatus:signal.dataStatus,signalSummary:signal.summary,filterSignalTimeFactor,effectiveTimeDemand,snrEfficiency,referenceSurfaceBrightness:REFERENCE_SURFACE_BRIGHTNESS}};
  }

  function installPlannerRecommendationHub(){
    const entry=document.querySelector('.plannerRecommendationEntry'),wrap=document.getElementById('plannerRecommendationsWrap'),anchor=document.getElementById('plannerMapEmpty'),planner=document.getElementById('planner');
    if(!entry||!wrap||!planner||document.getElementById('plannerRecommendationHub'))return;
    const hub=document.createElement('div');hub.id='plannerRecommendationHub';hub.className='card plannerRecommendationHub';
    hub.innerHTML='<div class="sectionTitleRow"><h2>Co fotografować?</h2><span class="small">ranking nocy</span></div><div class="small plannerRecommendationLead">Nie wiesz, który projekt wybrać? Ranking porówna aktywne i planowane cele dla bieżącej daty, lokalizacji i ustawień nocy.</div>';
    const btn=entry.querySelector('#plannerRecommendationsBtn');if(btn)btn.textContent='Pokaż rekomendacje';
    const hint=entry.querySelector('.small');if(hint)hint.textContent='Warunki pobierane są bezpośrednio z Planera — nie trzeba wpisywać ich ponownie.';
    hub.appendChild(entry);hub.appendChild(wrap);planner.insertBefore(hub,anchor||document.getElementById('plannerNightPanel')||planner.firstChild);
    const style=document.createElement('style');style.textContent='.plannerRecommendationHub{border-color:#334e78;background:linear-gradient(180deg,rgba(20,34,59,.98),rgba(13,23,40,.98))}.plannerRecommendationHub .plannerRecommendationEntry{margin-top:12px;padding-top:0;border-top:0}.plannerRecommendationHub .plannerRecommendationEntry .secondary{width:100%}.plannerRecommendationLead{line-height:1.55;margin-top:-4px}.plannerRecommendationHub .plannerRecommendationsWrap{margin-top:12px}';document.head.appendChild(style);
    btn?.addEventListener('click',()=>{setTimeout(async()=>{try{if(typeof global.getProjects!=='function'||typeof global.catalogObjectPool!=='function')return;const projects=global.getProjects().filter(pr=>['planned','active'].includes(pr.status||'active')),pool=global.catalogObjectPool();await global.AstroTargetMetadata?.prepareSignalData?.(projects,pool);if(document.getElementById('plannerRecommendationsWrap')?.hidden===false&&typeof global.refreshRecommendations==='function')global.refreshRecommendations();}catch(e){console.warn('Signal metadata preparation failed',e);}},0);});
  }

  global.AstroRecommend={buildContext,scoreTarget,signalTimeDemand,moonlightNanoLambert,airmassFromAltitude,atmosphericTransmission,darkSkyAirmassFactor,twilightZenithSQM,twilightExcessRatio,REFERENCE_SURFACE_BRIGHTNESS};
  installPlannerRecommendationHub();
})(window);
