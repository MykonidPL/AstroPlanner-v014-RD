/* AstroPlanner v0.14 R&D — deterministic recommendation scoring v5.
 * Inputs are deliberately separated:
 *   1) exact Planner night window (Sun limit + minimum target altitude),
 *   2) target altitude / atmospheric transmission across the WHOLE useful window,
 *   3) Moon contribution (Krisciunas & Schaefer 1991 V-band scattering model),
 *   4) modeled site sky brightness (SQM from AstroBortle),
 *   5) twilight background for non-astronomical Planner modes (Patat et al. 2006 V-band fit),
 *   6) target photographic metadata and the project's actual filter/material profile.
 * The final 0–100 number is a utility ranking, not a physical observable; physically
 * meaningful intermediate values remain available in metrics.
 */
(function(global){
  'use strict';
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)));
  const DEG=Math.PI/180;
  const NATURAL_SQM=21.70;
  const DEFAULT_EXTINCTION=0.20;

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

  // Krisciunas & Schaefer (1991) airmass approximation.
  function airmassFromAltitude(alt){alt=Number(alt);if(!(alt>0))return Infinity;const z=(90-alt)*DEG;return 1/Math.sqrt(Math.max(.04,1-.96*Math.sin(z)**2));}
  function atmosphericTransmission(alt,k=DEFAULT_EXTINCTION){const x=airmassFromAltitude(alt);if(!Number.isFinite(x))return 0;return Math.pow(10,-.4*k*Math.max(0,x-1));}
  // Dark sky increases with airmass (same family of approximation used in the KS model).
  function darkSkyAirmassFactor(alt,k=DEFAULT_EXTINCTION){const x=airmassFromAltitude(alt);if(!Number.isFinite(x))return Infinity;return Math.max(1,Math.pow(10,-.4*k*Math.max(0,x-1))*x);}
  function sqmToNanoLambert(sqm){return 34.08*Math.exp(20.7233-.92104*Number(sqm));}

  // Patat et al. (2006), V-band zenith twilight fit for solar zenith distance 95–105 deg.
  // We only use it as an ADDITIONAL solar-scattered background term. At <= -18 deg it is zero.
  function twilightZenithSQM(sunAlt){
    sunAlt=Number(sunAlt);if(!Number.isFinite(sunAlt)||sunAlt<=-18)return Infinity;
    // Published polynomial is constrained over -5..-15 deg. Extrapolation is limited.
    const h=clamp(sunAlt,-15,-5),zeta=90-h,u=zeta-95;
    const v=11.84+1.518*u-.057*u*u;
    if(sunAlt>=-15)return v;
    // Smoothly merge the fitted -15 deg value into astronomical darkness at -18 deg.
    const v15=11.84+1.518*10-.057*100,t=clamp((-sunAlt-15)/3,0,1);
    return v15+(NATURAL_SQM-v15)*t;
  }
  function twilightExcessRatio(sunAlt){
    const sqm=twilightZenithSQM(sunAlt);if(!Number.isFinite(sqm))return 0;
    const natural=sqmToNanoLambert(NATURAL_SQM),tw=sqmToNanoLambert(sqm);
    return Math.max(0,(tw-natural)/natural);
  }

  // Krisciunas & Schaefer (1991), empirical V-band moonlight scattering model.
  function moonlightNanoLambert({illumination,moonAlt,targetAlt,separation,k=DEFAULT_EXTINCTION}){
    illumination=clamp(illumination,0,1);moonAlt=Number(moonAlt);targetAlt=Number(targetAlt);separation=Number(separation);
    if(!(illumination>.001)||!(moonAlt>0)||!(targetAlt>0)||!Number.isFinite(separation))return 0;
    const phaseAngle=Math.acos(clamp(2*illumination-1,-1,1))/DEG;
    const iStar=Math.pow(10,-.4*(3.84+.026*Math.abs(phaseAngle)+4e-9*Math.pow(phaseAngle,4)));
    const rho=clamp(Math.abs(separation),1,180),c=Math.cos(rho*DEG);
    const rayleigh=Math.pow(10,5.36)*(1.06+c*c),mie=rho<10?6.2e7/(rho*rho):Math.pow(10,6.15-rho/40);
    const xm=airmassFromAltitude(moonAlt),x=airmassFromAltitude(targetAlt);if(!Number.isFinite(xm)||!Number.isFinite(x))return 0;
    return(rayleigh+mie)*iStar*Math.pow(10,-.4*k*xm)*(1-Math.pow(10,-.4*k*x));
  }

  function longestWindow(flags,samples,stepMinutes){
    let bestStart=-1,bestEnd=-1,runStart=-1;
    for(let i=0;i<=flags.length;i++){
      const on=i<flags.length&&flags[i];
      if(on&&runStart<0)runStart=i;
      if(!on&&runStart>=0){const end=i-1;if(bestStart<0||end-runStart>bestEnd-bestStart){bestStart=runStart;bestEnd=end;}runStart=-1;}
    }
    if(bestStart<0)return{hours:0,start:null,end:null};
    const start=samples[bestStart].t,end=new Date(samples[bestEnd].t.getTime()+stepMinutes*60000);
    return{hours:(end-start)/3600000,start,end,startIndex:bestStart,endIndex:bestEnd};
  }
  function scoreLabel(score){if(score>=85)return'bardzo dobre';if(score>=70)return'dobre';if(score>=55)return'umiarkowane';if(score>=35)return'słabe';return'bardzo słabe';}
  function windowPhrase(hours){if(hours>=6)return'długie okno';if(hours>=3.5)return'średnie okno';if(hours>=1.5)return'krótkie okno';if(hours>0)return'bardzo krótkie okno';return'brak sensownego okna';}
  function coveragePhrase(c){if(c>=.75)return'przez większość nocy';if(c>=.45)return'przez sporą część nocy';if(c>=.20)return'tylko przez część nocy';if(c>0)return'tylko krótko w nocy';return'poza użyteczną częścią nocy';}
  function moonImpactPhrase(f){if(f<1.08)return'mały wpływ Księżyca';if(f<1.35)return'umiarkowany wpływ Księżyca';if(f<2)return'duży wpływ Księżyca';return'bardzo duży wpływ Księżyca';}

  function defaultMaterial(){return{kind:'unknown',label:'materiał nieokreślony',moonResponse:1,lpResponse:1,assumed:true,quantitativeFraction:0};}
  function materialCompatibility(metadata,material){return global.AstroFilterProfiles?.compatibility?.(metadata,material)??1;}

  function scoreTarget({raDeg,decDeg,classKey='mixed',metadata=null,materialProfile=null,context,astro,sky=null,minAltitudeDeg=30,sunLimitDeg=-18}){
    raDeg=Number(raDeg);decDeg=Number(decDeg);if(!validCoords(raDeg,decDeg))throw new Error('Nieprawidłowe współrzędne celu');
    if(!context?.samples?.length||!validAstro(astro))throw new Error('Brak kontekstu rekomendacji');
    minAltitudeDeg=clamp(Number(minAltitudeDeg),0,89.9);sunLimitDeg=clamp(Number(sunLimitDeg),-18,-6);
    metadata=metadata||{photoClass:classKey||'mixed'};materialProfile=materialProfile||defaultMaterial();

    const stepHours=context.stepMinutes/60,usableFlags=[],rows=[];
    let totalNightHours=0;
    const naturalNL=sqmToNanoLambert(NATURAL_SQM),siteSQM=Number(sky?.sqm),siteRatio=Number.isFinite(siteSQM)?Math.max(1,sqmToNanoLambert(siteSQM)/naturalNL):1,lpExcess=Math.max(0,siteRatio-1);
    const compatibility=materialCompatibility(metadata,materialProfile),rawLpResponse=clamp(materialProfile.lpResponse??1,0,1),rawMoonResponse=clamp(materialProfile.moonResponse??1,0,1);
    // A filter only earns background-suppression credit to the extent that it preserves
    // the target's intended photographic signal. This prevents a 3 nm line filter from
    // making a continuum target (e.g. M31) look artificially better than broadband.
    const lpResponse=1-compatibility*(1-rawLpResponse),moonResponse=1-compatibility*(1-rawMoonResponse),siteMaterialZenithRatio=1+lpExcess*lpResponse;

    for(const s of context.samples){
      const alt=astro.altitude(raDeg,decDeg,s.t,context.lat,context.lon),night=s.sunAlt<=sunLimitDeg,above=alt>=minAltitudeDeg,usable=night&&above;
      if(night)totalNightHours+=stepHours;
      usableFlags.push(usable);rows.push({sample:s,alt,usable});
    }

    // Planner defines the session window as the LONGEST contiguous block satisfying
    // the selected Sun limit and minimum altitude. Score exactly that same block; do
    // not add separated fragments together.
    const window=longestWindow(usableFlags,context.samples,context.stepMinutes),usableHours=window.hours;
    let transmissionSum=0,transmissionHours=0,bestImagingAltitude=-90,conditionLogSum=0,conditionWeight=0,moonLogSum=0,twilightLogSum=0;
    if(window.startIndex!=null&&window.startIndex>=0){
      for(let i=window.startIndex;i<=window.endIndex;i++){
        const row=rows[i],s=row.sample,alt=row.alt;if(!row.usable)continue;
        bestImagingAltitude=Math.max(bestImagingAltitude,alt);
        const trans=atmosphericTransmission(alt);transmissionSum+=trans*stepHours;transmissionHours+=stepHours;
        const separation=astro.sep(raDeg,decDeg,s.moonRa,s.moonDec),moonNL=moonlightNanoLambert({illumination:s.illumination,moonAlt:s.moonAlt,targetAlt:alt,separation}),moonRatio=moonNL/naturalNL;
        const airmassSky=darkSkyAirmassFactor(alt),siteAtAltitude=siteMaterialZenithRatio*airmassSky,twilightRatio=twilightExcessRatio(s.sunAlt)*moonResponse;
        const fullRatio=Math.max(1,siteAtAltitude+moonRatio*moonResponse+twilightRatio),weight=Math.max(.05,trans);
        conditionLogSum+=weight*Math.log(fullRatio);conditionWeight+=weight;
        moonLogSum+=weight*Math.log(Math.max(1,(siteAtAltitude+moonRatio*moonResponse)/siteAtAltitude));
        twilightLogSum+=weight*Math.log(Math.max(1,(siteAtAltitude+twilightRatio)/siteAtAltitude));
      }
    }

    const coverage=totalNightHours>0?clamp(usableHours/totalNightHours,0,1):0,meanTransmission=transmissionHours>0?transmissionSum/transmissionHours:0;
    // Geometry has four distinct meanings: average atmospheric transmission, exact
    // Planner session-window duration, fraction of the selected night covered, and
    // continuity. The same contiguous window drives both the UI and the score.
    const geometryScore=30*meanTransmission+35*clamp(usableHours/6,0,1)+25*coverage+10*clamp(window.hours/5,0,1);
    const timeMultiplier=conditionWeight>0?Math.exp(conditionLogSum/conditionWeight):siteMaterialZenithRatio,moonTimeFactor=conditionWeight>0?Math.exp(moonLogSum/conditionWeight):1,twilightTimeFactor=conditionWeight>0?Math.exp(twilightLogSum/conditionWeight):1;
    // Utility mapping only: every doubling of background-limited integration demand costs 6 points.
    // The physically meaningful multiplicative factor is retained in metrics.
    const backgroundPenalty=clamp(6*Math.log2(Math.max(1,timeMultiplier)),0,42);
    const compatibilityPenalty=30*(1-compatibility);
    const score=Math.round(clamp(geometryScore-backgroundPenalty-compatibilityPenalty,0,100));
    const materialNote=materialProfile.label||'materiał nieokreślony';
    const reason=`${score}/100 — ${scoreLabel(score)}; ${windowPhrase(usableHours)} (${usableHours.toFixed(1)} h), ${coveragePhrase(coverage)}, ${moonImpactPhrase(moonTimeFactor)}.`;
    return{score,label:scoreLabel(score),classKey:metadata.photoClass||classKey||'mixed',reason,materialNote,metrics:{geometryScore,usableHours,totalNightHours,coverage,longestWindow:window.hours,windowStart:window.start,windowEnd:window.end,bestImagingAltitude,meanTransmission,siteRatio,siteMaterialRatio:siteMaterialZenithRatio,timeMultiplier,moonTimeFactor,twilightTimeFactor,backgroundPenalty,compatibility,compatibilityPenalty,lpResponse,moonResponse,rawLpResponse,rawMoonResponse,minAltitudeDeg,sunLimitDeg}};
  }

  global.AstroRecommend={buildContext,scoreTarget,moonlightNanoLambert,airmassFromAltitude,atmosphericTransmission,darkSkyAirmassFactor,twilightZenithSQM,twilightExcessRatio};
})(window);
