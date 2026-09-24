/* AstroPlanner v0.14 R&D — deterministic recommendation scoring v4.
 * Inputs are deliberately separated:
 *   1) astronomical geometry (Sun, target altitude, useful dark window),
 *   2) Moon contribution (Krisciunas & Schaefer 1991 V-band scattering model),
 *   3) modeled site sky brightness (SQM from AstroBortle),
 *   4) target photographic metadata and the project's actual filter/material profile.
 * The final 0–100 number is a utility ranking, not a physical observable; the
 * physically meaningful intermediate values remain available in metrics.
 */
(function(global){
  'use strict';
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)));
  const DEG=Math.PI/180;
  const NATURAL_SQM=21.70;
  const DEFAULT_EXTINCTION=0.20;

  function darknessWeight(sunAlt){return clamp((-Number(sunAlt)-12)/6,0,1);}
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
      samples.push({t,sunAlt,moonAlt,moonRa:moon.ra,moonDec:moon.dec,illumination,darkness:darknessWeight(sunAlt)});
    }
    return{date:new Date(date),lat,lon,stepMinutes,samples};
  }

  function airmassFromAltitude(alt){alt=Number(alt);if(!(alt>0))return Infinity;const z=(90-alt)*DEG;return 1/Math.sqrt(Math.max(.04,1-.96*Math.sin(z)**2));}
  function atmosphericTransmission(alt,k=DEFAULT_EXTINCTION){const x=airmassFromAltitude(alt);if(!Number.isFinite(x))return 0;return Math.pow(10,-.4*k*Math.max(0,x-1));}
  function sqmToNanoLambert(sqm){return 34.08*Math.exp(20.7233-.92104*Number(sqm));}

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

  function longestWindowHours(flags,stepMinutes){let best=0,run=0;for(const flag of flags){if(flag){run++;best=Math.max(best,run);}else run=0;}return best*stepMinutes/60;}
  function scoreLabel(score){if(score>=85)return'bardzo dobre';if(score>=70)return'dobre';if(score>=55)return'umiarkowane';if(score>=35)return'słabe';return'bardzo słabe';}
  function windowPhrase(hours){if(hours>=6)return'długie okno';if(hours>=3.5)return'średnie okno';if(hours>=1.5)return'krótkie okno';if(hours>0)return'bardzo krótkie okno';return'brak sensownego okna';}
  function coveragePhrase(c){if(c>=.75)return'przez większość nocy';if(c>=.45)return'przez sporą część nocy';if(c>=.20)return'tylko przez część nocy';if(c>0)return'tylko krótko w nocy';return'poza użyteczną częścią nocy';}
  function moonImpactPhrase(f){if(f<1.08)return'mały wpływ Księżyca';if(f<1.35)return'umiarkowany wpływ Księżyca';if(f<2)return'duży wpływ Księżyca';return'bardzo duży wpływ Księżyca';}

  function defaultMaterial(){return{kind:'unknown',label:'materiał nieokreślony',moonResponse:1,lpResponse:1,assumed:true,quantitativeFraction:0};}
  function materialCompatibility(metadata,material){return global.AstroFilterProfiles?.compatibility?.(metadata,material)??1;}

  function scoreTarget({raDeg,decDeg,classKey='mixed',metadata=null,materialProfile=null,context,astro,sky=null}){
    raDeg=Number(raDeg);decDeg=Number(decDeg);if(!validCoords(raDeg,decDeg))throw new Error('Nieprawidłowe współrzędne celu');
    if(!context?.samples?.length||!validAstro(astro))throw new Error('Brak kontekstu rekomendacji');
    metadata=metadata||{photoClass:classKey||'mixed'};materialProfile=materialProfile||defaultMaterial();

    const stepHours=context.stepMinutes/60,deepFlags=[];
    let totalDarkHours=0,usableHours=0,altitudeQualityBest=0,bestImagingAltitude=-90,conditionLogSum=0,conditionWeight=0,moonLogSum=0;
    const naturalNL=sqmToNanoLambert(NATURAL_SQM),siteSQM=Number(sky?.sqm),siteRatio=Number.isFinite(siteSQM)?Math.max(1,sqmToNanoLambert(siteSQM)/naturalNL):1,lpExcess=Math.max(0,siteRatio-1);
    const lpResponse=clamp(materialProfile.lpResponse??1,0,1),moonResponse=clamp(materialProfile.moonResponse??1,0,1),siteMaterialRatio=1+lpExcess*lpResponse;

    for(const s of context.samples){
      const alt=astro.altitude(raDeg,decDeg,s.t,context.lat,context.lon),dark=s.darkness;
      totalDarkHours+=stepHours*dark;
      const above=alt>=30,trans=above?atmosphericTransmission(alt):0;
      if(above)usableHours+=stepHours*dark;
      const altQuality=dark*trans;if(above&&altQuality>altitudeQualityBest){altitudeQualityBest=altQuality;bestImagingAltitude=alt;}
      deepFlags.push(above&&dark>=.95);
      if(above&&dark>0){
        const separation=astro.sep(raDeg,decDeg,s.moonRa,s.moonDec),moonNL=moonlightNanoLambert({illumination:s.illumination,moonAlt:s.moonAlt,targetAlt:alt,separation}),moonRatio=moonNL/naturalNL;
        const fullRatio=Math.max(1,siteMaterialRatio+moonRatio*moonResponse),weight=dark*trans;
        conditionLogSum+=weight*Math.log(fullRatio);conditionWeight+=weight;moonLogSum+=weight*Math.log(Math.max(1,fullRatio/siteMaterialRatio));
      }
    }

    const coverage=totalDarkHours>0?clamp(usableHours/totalDarkHours,0,1):0,longestWindow=longestWindowHours(deepFlags,context.stepMinutes);
    // Geometry is intentionally independent of target class/filter: this is the actual
    // usable sky window. Conditions/material are applied afterwards.
    const geometryScore=30*altitudeQualityBest+35*clamp(usableHours/6,0,1)+25*coverage+10*clamp(longestWindow/5,0,1);
    const timeMultiplier=conditionWeight>0?Math.exp(conditionLogSum/conditionWeight):siteMaterialRatio,moonTimeFactor=conditionWeight>0?Math.exp(moonLogSum/conditionWeight):1;
    // Utility mapping only: the underlying multiplier is preserved. Every doubling of
    // estimated background-limited integration demand costs 6 ranking points.
    const backgroundPenalty=clamp(6*Math.log2(Math.max(1,timeMultiplier)),0,42);
    const compatibility=materialCompatibility(metadata,materialProfile),compatibilityPenalty=30*(1-compatibility);
    const score=Math.round(clamp(geometryScore-backgroundPenalty-compatibilityPenalty,0,100));
    const materialNote=materialProfile.label||'materiał nieokreślony';
    const reason=`${score}/100 — ${scoreLabel(score)}; ${windowPhrase(usableHours)} (${usableHours.toFixed(1)} h), ${coveragePhrase(coverage)}, ${moonImpactPhrase(moonTimeFactor)}.`;
    return{score,label:scoreLabel(score),classKey:metadata.photoClass||classKey||'mixed',reason,materialNote,metrics:{geometryScore,usableHours,totalDarkHours,coverage,longestWindow,bestImagingAltitude,altitudeQuality:altitudeQualityBest,siteRatio,siteMaterialRatio,timeMultiplier,moonTimeFactor,backgroundPenalty,compatibility,compatibilityPenalty,lpResponse,moonResponse}};
  }

  global.AstroRecommend={buildContext,scoreTarget,darknessWeight,moonlightNanoLambert,airmassFromAltitude,atmosphericTransmission};
})(window);
