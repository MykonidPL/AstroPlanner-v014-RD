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
    if(hours>=4)return'długie okno';
    if(hours>=2)return'dobre okno';
    if(hours>=0.75)return'krótkie okno';
    if(hours>0)return'bardzo krótkie okno';
    return'brak sensownego okna';
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
    let peakAltitude=-90,effectiveHours=0,darknessQualitySum=0,darknessQualityN=0,moonWeighted=0,moonWeightSum=0;
    const windowFlags=[];
    for(const s of context.samples){
      const objAlt=astro.altitude(raDeg,decDeg,s.t,context.lat,context.lon),dark=s.darkness;
      if(dark>0.05&&objAlt>peakAltitude)peakAltitude=objAlt;
      if(objAlt>=30&&dark>0){
        effectiveHours+=stepHours*dark;
        darknessQualitySum+=dark;
        darknessQualityN++;
      }
      windowFlags.push(objAlt>=30&&dark>=0.35);
      const objectWeight=dark*clamp((objAlt-20)/35,0,1);
      if(objectWeight>0){
        const separation=astro.sep(raDeg,decDeg,s.moonRa,s.moonDec),moonAltWeight=clamp((s.moonAlt+5)/35,0,1),separationWeight=clamp((95-separation)/80,0,1),load=s.illumination*moonAltWeight*separationWeight;
        moonWeighted+=objectWeight*load;
        moonWeightSum+=objectWeight;
      }
    }
    const longestWindow=longestWindowHours(windowFlags,context.stepMinutes),darknessQuality=darknessQualityN?darknessQualitySum/darknessQualityN:0;
    const altitudeScore=35*clamp((peakAltitude-25)/45,0,1),windowScore=35*clamp(effectiveHours/5,0,1),darknessScore=20*clamp(darknessQuality,0,1),continuityScore=10*clamp(longestWindow/4,0,1),base=altitudeScore+windowScore+darknessScore+continuityScore;
    const moonLoad=moonWeightSum?moonWeighted/moonWeightSum:0,moonPenalty=cfg.moonMax*moonLoad,lpLoad=lightPollutionLoad(sky?.sqm),lightPollutionPenalty=cfg.lightPollutionMax*lpLoad,score=Math.round(clamp(base-moonPenalty-lightPollutionPenalty,0,100));
    return{
      score,
      label:scoreLabel(score),
      classKey:CLASS_CONFIG[classKey]?classKey:'broadband',
      reason:`${score}/100 — ${scoreLabel(score)}; ${windowPhrase(longestWindow)}, ${altitudePhrase(peakAltitude)}, ${moonPhrase(moonPenalty)}.`,
      metrics:{peakAltitude,effectiveHours,longestWindow,darknessQuality,moonLoad,moonPenalty,lightPollutionLoad:lpLoad,lightPollutionPenalty,base}
    };
  }

  window.AstroRecommend={buildContext,scoreTarget,darknessWeight};
})();
