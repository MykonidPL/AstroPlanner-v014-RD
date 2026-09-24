/* AstroPlanner v0.14 R&D — deterministic target recommendation scoring. */
(()=>{
  'use strict';

  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const CLASS_CONFIG={
    emission:{moonMax:15,lightPollutionMax:6},
    broadband:{moonMax:35,lightPollutionMax:16},
    dust:{moonMax:55,lightPollutionMax:26}
  };

  function darknessWeight(sunAlt){
    return clamp((-Number(sunAlt)-6)/12,0,1);
  }

  function validAstro(astro){
    return !!astro&&['altitude','sunPos','moonPos','sep'].every(k=>typeof astro[k]==='function');
  }

  function buildContext({date,lat,lon,astro,stepMinutes=5}){
    if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new Error('Nieprawidłowa data rekomendacji');
    lat=Number(lat);lon=Number(lon);stepMinutes=Math.max(1,Number(stepMinutes)||5);
    if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180)throw new Error('Nieprawidłowa lokalizacja rekomendacji');
    if(!validAstro(astro))throw new Error('Brak adaptera obliczeń astronomicznych');
    const start=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12,0,0,0),samples=[];
    for(let minute=0;minute<=1440;minute+=stepMinutes){
      const t=new Date(start.getTime()+minute*60000),sun=astro.sunPos(t),moon=astro.moonPos(t),sunAlt=astro.altitude(sun.ra,sun.dec,t,lat,lon),moonAlt=astro.altitude(moon.ra,moon.dec,t,lat,lon),elongation=astro.sep(sun.ra,sun.dec,moon.ra,moon.dec),illumination=(1-Math.cos(elongation*Math.PI/180))/2;
      samples.push({t,sunAlt,moonAlt,moonRa:moon.ra,moonDec:moon.dec,illumination,darkness:darknessWeight(sunAlt)});
    }
    return{date:new Date(date),lat,lon,stepMinutes,samples};
  }

  function longestWindowHours(flags,stepMinutes){
    let best=0,run=0;
    for(const flag of flags){if(flag){run++;if(run>best)best=run;}else run=0;}
    return best*stepMinutes/60;
  }

  function scoreLabel(score){
    if(score>=85)return'bardzo dobre';
    if(score>=70)return'dobre';
    if(score>=55)return'umiarkowane';
    if(score>=35)return'słabe';
    return'bardzo słabe';
  }

  function windowPhrase(hours){
    if(hours>=6)return'długie okno';
    if(hours>=3.5)return'średnie okno';
    if(hours>=1.5)return'krótkie okno';
    if(hours>0)return'bardzo krótkie okno';
    return'brak sensownego okna';
  }

  function coveragePhrase(coverage){
    if(coverage>=0.75)return'przez większość nocy';
    if(coverage>=0.45)return'przez sporą część nocy';
    if(coverage>=0.20)return'tylko przez część nocy';
    if(coverage>0)return'tylko krótko w nocy';
    return'poza użyteczną częścią nocy';
  }

  function altitudePhrase(peak){
    if(peak>=65)return'wysoko';
    if(peak>=45)return'dobra wysokość';
    if(peak>=30)return'nisko';
    return'bardzo nisko';
  }

  function moonPhrase(penalty){
    if(penalty<2.5)return'mały wpływ Księżyca';
    if(penalty<9)return'umiarkowany wpływ Księżyca';
    return'duży wpływ Księżyca';
  }

  function lightPollutionLoad(sqm){
    sqm=Number(sqm);
    if(!Number.isFinite(sqm))return 0;
    return clamp((21.7-sqm)/4.2,0,1);
  }

  function scoreTarget({raDeg,decDeg,classKey='broadband',context,astro,sky=null}){
    raDeg=Number(raDeg);decDeg=Number(decDeg);
    if(!Number.isFinite(raDeg)||raDeg<0||raDeg>=360||!Number.isFinite(decDeg)||decDeg<-90||decDeg>90)throw new Error('Nieprawidłowe współrzędne celu');
    if(!context?.samples?.length||!validAstro(astro))throw new Error('Brak kontekstu rekomendacji');

    const cfg=CLASS_CONFIG[classKey]||CLASS_CONFIG.broadband,stepHours=context.stepMinutes/60;
    let totalDarkHours=0,effectiveHours=0,bestAltitudeQuality=0,bestImagingAltitude=-90,moonWeighted=0,moonWeightSum=0;
    const continuityFlags=[];

    for(const s of context.samples){
      const objAlt=astro.altitude(raDeg,decDeg,s.t,context.lat,context.lon),dark=s.darkness;

      // Equivalent fully-dark hours for the whole night and for this target above 30°.
      // This makes a 4 h early-evening target score clearly below a target usable for most of a long winter night.
      totalDarkHours+=stepHours*dark;
      if(objAlt>=30)effectiveHours+=stepHours*dark;

      // Height is rewarded only together with actual darkness. A high culmination in twilight/daylight
      // must not receive a full altitude component.
      const altitudeFactor=clamp((objAlt-25)/45,0,1),altitudeQuality=dark*altitudeFactor;
      if(altitudeQuality>bestAltitudeQuality){bestAltitudeQuality=altitudeQuality;bestImagingAltitude=objAlt;}

      // Continuous window counts only genuinely dark conditions, not civil/early nautical twilight.
      continuityFlags.push(objAlt>=30&&dark>=0.85);

      const objectWeight=dark*clamp((objAlt-20)/35,0,1);
      if(objectWeight>0){
        const separation=astro.sep(raDeg,decDeg,s.moonRa,s.moonDec),moonAltWeight=clamp((s.moonAlt+5)/35,0,1),separationWeight=clamp((95-separation)/80,0,1),load=s.illumination*moonAltWeight*separationWeight;
        moonWeighted+=objectWeight*load;
        moonWeightSum+=objectWeight;
      }
    }

    const coverage=totalDarkHours>0?clamp(effectiveHours/totalDarkHours,0,1):0;
    const longestWindow=longestWindowHours(continuityFlags,context.stepMinutes);

    // v0.14 score v2:
    // 30% altitude during darkness
    // 35% useful dark hours (full credit at 6 h)
    // 25% fraction of the night's darkness actually covered by the target
    // 10% continuous deep-dark window (full credit at 5 h)
    // Moon and light pollution remain class-dependent penalties.
    const altitudeScore=30*bestAltitudeQuality,
          windowScore=35*clamp(effectiveHours/6,0,1),
          coverageScore=25*coverage,
          continuityScore=10*clamp(longestWindow/5,0,1),
          base=altitudeScore+windowScore+coverageScore+continuityScore;

    const moonLoad=moonWeightSum?moonWeighted/moonWeightSum:0,
          moonPenalty=cfg.moonMax*moonLoad,
          lpLoad=lightPollutionLoad(sky?.sqm),
          lightPollutionPenalty=cfg.lightPollutionMax*lpLoad,
          score=Math.round(clamp(base-moonPenalty-lightPollutionPenalty,0,100));

    return{
      score,
      label:scoreLabel(score),
      classKey:CLASS_CONFIG[classKey]?classKey:'broadband',
      reason:`${score}/100 — ${scoreLabel(score)}; ${windowPhrase(effectiveHours)} (${effectiveHours.toFixed(1)} h), ${coveragePhrase(coverage)}, ${altitudePhrase(bestImagingAltitude)}, ${moonPhrase(moonPenalty)}.`,
      metrics:{
        peakAltitude:bestImagingAltitude,
        effectiveHours,
        totalDarkHours,
        coverage,
        longestWindow,
        altitudeQuality:bestAltitudeQuality,
        moonLoad,
        moonPenalty,
        lightPollutionLoad:lpLoad,
        lightPollutionPenalty,
        altitudeScore,
        windowScore,
        coverageScore,
        continuityScore,
        base
      }
    };
  }

  window.AstroRecommend={buildContext,scoreTarget,darknessWeight};
})();
