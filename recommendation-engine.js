/* AstroPlanner v0.14 R&D — target metadata + deterministic recommendation scoring v3.
 * Geometry is separated from observing conditions. Moonlight uses the empirical
 * Krisciunas & Schaefer (1991) scattering model; light-pollution uses the modeled
 * zenith SQM already resolved by AstroBortle. Filter/material response is derived
 * from AstroPlanner equipment metadata when available and falls back conservatively
 * to broadband when the project does not define material.
 */
(()=>{
  'use strict';

  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)));
  const DEG=Math.PI/180;
  const NATURAL_SQM=21.70;
  const DEFAULT_EXTINCTION=0.20; // mag / airmass; clear-sky reference when site extinction is unknown
  const BROADBAND_REFERENCE_NM=250;

  const CLASS_LABELS={
    emission:'emisja',
    broadband:'szerokie pasmo',
    dust:'pyły / refleksy',
    mixed:'mieszany / niejednoznaczny'
  };

  const TYPE_CLASS={
    HII:'emission',EmN:'emission',SNR:'emission',PN:'emission',
    RfN:'dust',DrkN:'dust',
    G:'broadband',GPair:'broadband',GTrpl:'broadband',GGroup:'broadband',GCluster:'broadband',
    OCl:'broadband',GCl:'broadband','*':'broadband','**':'broadband',
    Neb:'mixed','Cl+N':'mixed',Other:'mixed'
  };

  // Only objects whose generic catalog type is known to hide the photographic nature
  // need a curated override. Every other catalog record still receives metadata from
  // typeCode/type/groups below.
  const CURATED_CLASS={
    'm1':'emission','m8':'emission','m16':'emission','m17':'emission','m20':'mixed',
    'm42':'emission','m43':'emission','m45':'dust','m78':'dust',
    'ngc1952':'emission','ngc6523':'emission','ngc6611':'emission','ngc6618':'emission',
    'ngc6514':'mixed','ngc1976':'emission','ngc1982':'emission','ngc2068':'dust',
    'ngc6960':'emission','ngc6974':'emission','ngc6979':'emission','ngc6992':'emission','ngc6995':'emission',
    'ngc7000':'emission','ngc6888':'emission','ngc7023':'dust',
    'ic1805':'emission','ic1848':'emission','ic434':'emission','ic5067':'emission','ic5070':'emission',
    'b33':'dust','ctb1':'emission'
  };

  function stripText(value){
    return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').replace(/Ł/g,'L').toLowerCase();
  }
  function compact(value){return stripText(value).replace(/[^a-z0-9]+/g,'');}

  function identityTokens(objOrText){
    const texts=[];
    if(typeof objOrText==='string')texts.push(objOrText);
    else if(objOrText){
      texts.push(objOrText.name,objOrText.displayName,objOrText.catalogId,objOrText.id);
      if(Array.isArray(objOrText.aliases))texts.push(...objOrText.aliases);
    }
    const out=new Set();
    for(const raw of texts){
      const s=stripText(raw);
      if(!s)continue;
      const patterns=[
        [/\bm\s*0*(\d{1,3})\b/g,'m'],[/\bngc\s*0*(\d+)\b/g,'ngc'],[/\bic\s*0*(\d+)\b/g,'ic'],
        [/\bsh\s*2[-\s]*0*(\d+)\b/g,'sh2'],[/\bldn\s*0*(\d+)\b/g,'ldn'],[/\blbn\s*0*(\d+)\b/g,'lbn'],
        [/\bvdb\s*0*(\d+)\b/g,'vdb'],[/\brcw\s*0*(\d+)\b/g,'rcw'],[/\bctb\s*0*(\d+)\b/g,'ctb'],
        [/\bbarnard\s*0*(\d+)\b/g,'b'],[/\bb\s*0*(\d+)\b/g,'b']
      ];
      for(const [re,prefix] of patterns){let m;while((m=re.exec(s)))out.add(prefix+String(Number(m[1])));}
      const c=compact(s);if(c)out.add(c);
    }
    return [...out];
  }

  function curatedClass(obj){
    for(const token of identityTokens(obj)){
      if(CURATED_CLASS[token])return CURATED_CLASS[token];
      // Long descriptive tokens can contain a canonical catalog identity.
      for(const [key,value] of Object.entries(CURATED_CLASS)){
        if(key.length>=4&&token.startsWith(key))return value;
      }
    }
    return null;
  }

  function classifyFromGroups(groups,catalog){
    const g=[...(Array.isArray(groups)?groups:[]),catalog].map(compact).filter(Boolean);
    if(g.some(x=>x==='ldn'||x==='barnard'||x.includes('darknebula')))return'dust';
    if(g.some(x=>x==='vdb'||x.includes('reflection')))return'dust';
    if(g.some(x=>x==='sh2'||x==='rcw'||x==='abellpn'||x.includes('planetarynebula')))return'emission';
    if(g.some(x=>x==='abell'||x.includes('galaxycluster')))return'broadband';
    if(g.some(x=>x==='lbn'))return'mixed';
    return null;
  }

  function classifyFromText(typeText){
    const t=compact(typeText);
    if(!t)return null;
    if(t.includes('pozostaloscposupernowej')||t.includes('supernovaremnant')||t.includes('regionhii')||t.includes('mgławicaemisyjna'.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,''))||t.includes('emissionnebula')||t.includes('planetarna')||t.includes('planetarynebula'))return'emission';
    if(t.includes('refleksyjna')||t.includes('reflectionnebula')||t.includes('ciemna')||t.includes('darknebula')||t.includes('pyl')||t.includes('dust'))return'dust';
    if(t.includes('galakty')||t.includes('galaxy')||t.includes('gromada')||t.includes('cluster')||t.includes('gwiazda')||t.includes('star'))return'broadband';
    if(t==='mglawica'||t==='nebula'||t.includes('mglawica'))return'mixed';
    return null;
  }

  function metadataForObject(obj={}){
    const override=curatedClass(obj);
    const code=String(obj.typeCode||obj.objectType||'').trim();
    const codeClass=TYPE_CLASS[code]||null;
    const groupClass=classifyFromGroups(obj.groups,obj.catalog);
    const textClass=classifyFromText(obj.type||obj.typeName||obj.typeLabel);
    const photoClass=override||codeClass||groupClass||textClass||'mixed';
    const source=override?'curated-override':codeClass?'catalog-type':groupClass?'catalog-group':textClass?'catalog-text':'fallback-mixed';
    const confidence=override||codeClass?'high':groupClass||textClass?'medium':'low';
    const signalKind=photoClass==='emission'?'line':photoClass==='dust'||photoClass==='broadband'?'continuum':'mixed';
    return{
      photoClass,signalKind,confidence,source,
      rawTypeCode:code||null,rawType:String(obj.type||obj.typeName||obj.typeLabel||'')||null,
      catalog:String(obj.catalog||''),groups:Array.isArray(obj.groups)?[...obj.groups]:[],
      identities:identityTokens(obj)
    };
  }

  function allCatalogMetadata(){
    let pool=[];try{pool=typeof window.catalogObjectPool==='function'?window.catalogObjectPool():[];}catch(_){pool=[];}
    return pool.map(obj=>({object:obj,meta:obj.photoMeta||metadataForObject(obj)}));
  }

  function parseRA(value){
    const t=String(value??'').trim();if(!t)return NaN;
    const p=t.split(/[:\s]+/).map(Number);if(!p.length||p.some(Number.isNaN))return NaN;
    return 15*(p[0]+(p[1]||0)/60+(p[2]||0)/3600);
  }
  function parseDec(value){
    const t=String(value??'').trim();if(!t)return NaN;
    const neg=t.startsWith('-'),p=t.replace(/^[+-]/,'').split(/[:\s]+/).map(Number);if(!p.length||p.some(Number.isNaN))return NaN;
    const v=p[0]+(p[1]||0)/60+(p[2]||0)/3600;return neg?-v:v;
  }
  function validCoords(ra,dec){return Number.isFinite(ra)&&ra>=0&&ra<360&&Number.isFinite(dec)&&dec>=-90&&dec<=90;}

  function projectMetadata(project){
    const target=project?.target||{};
    const pseudo={name:target.name||project?.name||'',type:target.type||'',catalog:target.catalog||'',aliases:[target.name||'']};
    const direct=metadataForObject(pseudo);
    const targetTokens=new Set(identityTokens(pseudo));
    const ra=parseRA(target.ra),dec=parseDec(target.dec);
    let best=null,bestDist=Infinity;
    try{
      const pool=typeof window.catalogObjectPool==='function'?window.catalogObjectPool():[];
      for(const obj of pool){
        const tokens=identityTokens(obj);
        if(tokens.some(t=>targetTokens.has(t))){best=obj;bestDist=0;break;}
        if(validCoords(ra,dec)&&Number.isFinite(Number(obj.raDeg))&&Number.isFinite(Number(obj.decDeg))){
          const dra=Math.abs(Number(obj.raDeg)-ra)*Math.cos(dec*DEG),ddec=Math.abs(Number(obj.decDeg)-dec),dist=Math.hypot(dra,ddec);
          if(dist<0.10&&dist<bestDist){best=obj;bestDist=dist;}
        }
      }
    }catch(_){ }
    if(best){
      const meta=best.photoMeta||metadataForObject(best);
      // A curated project/name override wins over a generic external catalog record.
      if(direct.source==='curated-override')return direct;
      return meta;
    }
    return direct;
  }

  function bandwidthFraction(totalNm){return clamp(Number(totalNm||0)/BROADBAND_REFERENCE_NM,0,1);}
  function filterResponse(filter){
    const type=String(filter?.type||'').toLowerCase(),bw=Number(filter?.bandwidth);
    if(type==='narrowband'){
      const frac=bandwidthFraction(Number.isFinite(bw)&&bw>0?bw:7);
      return{kind:'narrowband',label:`narrowband${Number.isFinite(bw)&&bw>0?` ${bw} nm`:''}`,moonResponse:0.06+0.94*frac,lpResponse:0.08+0.92*frac,signalMode:'line'};
    }
    if(type==='dualband'){
      const total=(Number.isFinite(bw)&&bw>0?2*bw:12),frac=bandwidthFraction(total);
      return{kind:'dualband',label:`dual-band${Number.isFinite(bw)&&bw>0?` ${bw} nm/pasmo`:''}`,moonResponse:0.10+0.90*frac,lpResponse:0.14+0.86*frac,signalMode:'line'};
    }
    if(type==='ir')return{kind:'ir',label:'IR-pass',moonResponse:0.70,lpResponse:0.70,signalMode:'continuum'};
    if(type==='broadband'||type==='none')return{kind:'broadband',label:type==='none'?'bez filtra':'broadband / LP',moonResponse:1,lpResponse:1,signalMode:'continuum'};
    return{kind:'unknown',label:filter?.name||'filtr nieokreślony',moonResponse:1,lpResponse:1,signalMode:'unknown'};
  }

  function inferredPlanResponse(name){
    const n=compact(name);
    if(!n)return null;
    if(/(^|[^a-z])(ha|halpha|oiii|sii|hoo|sho)([^a-z]|$)/.test(stripText(name))||n.includes('halpha')||n.includes('oiii')||n.includes('sii'))return{kind:'narrowband',label:'narrowband (z nazwy planu)',moonResponse:0.10,lpResponse:0.12,signalMode:'line',inferred:true};
    if(n.includes('rgb')||n.includes('lrgb')||n==='l'||n.includes('luminanc'))return{kind:'broadband',label:'broadband (z nazwy planu)',moonResponse:1,lpResponse:1,signalMode:'continuum',inferred:true};
    return null;
  }

  function projectMaterialProfile(project){
    let eq={filters:[],profiles:[]};try{eq=typeof window.getEquipment==='function'?window.getEquipment():eq;}catch(_){ }
    const filters=new Map((eq.filters||[]).map(f=>[String(f.id),f])),profiles=new Map((eq.profiles||[]).map(p=>[String(p.id),p]));
    const parts=[];
    const plan=Array.isArray(project?.materialPlan)?project.materialPlan.filter(x=>Number(x?.goal)>0):[];
    if(plan.length){
      for(const item of plan){
        const weight=Number(item.goal)||0,filter=filters.get(String(item.filterId||''));
        const response=filter?filterResponse(filter):inferredPlanResponse(item.name);
        parts.push({weight,response:response||{kind:'unknown',label:'materiał nieokreślony',moonResponse:1,lpResponse:1,signalMode:'unknown'},resolved:!!response});
      }
    }else{
      let filterId=String(project?.setupDefaults?.filterId||'');
      if(!filterId&&project?.profileId){const p=profiles.get(String(project.profileId));if(p)filterId=String(p.filterId||'');}
      const filter=filters.get(filterId);
      if(filter)parts.push({weight:1,response:filterResponse(filter),resolved:true});
    }
    if(!parts.length)parts.push({weight:1,response:{kind:'unknown',label:'materiał nieokreślony',moonResponse:1,lpResponse:1,signalMode:'unknown'},resolved:false});
    const total=parts.reduce((a,p)=>a+p.weight,0)||1;
    const moonResponse=parts.reduce((a,p)=>a+p.weight*p.response.moonResponse,0)/total;
    const lpResponse=parts.reduce((a,p)=>a+p.weight*p.response.lpResponse,0)/total;
    const kinds=[...new Set(parts.map(p=>p.response.kind))];
    const resolvedFraction=parts.reduce((a,p)=>a+(p.resolved?p.weight:0),0)/total;
    const kind=kinds.length===1?kinds[0]:'mixed';
    const label=kinds.length===1?parts[0].response.label:'mieszany plan materiału';
    return{kind,label,moonResponse,lpResponse,resolvedFraction,assumed:resolvedFraction<0.999,parts};
  }

  function materialCompatibility(meta,material){
    const cls=meta?.photoClass||'mixed',kind=material?.kind||'unknown';
    if(kind==='unknown'||kind==='mixed'||kind==='broadband')return 1;
    if(kind==='narrowband'){
      if(cls==='emission')return 1;
      if(cls==='mixed')return 0.72;
      return 0.35;
    }
    if(kind==='dualband'){
      if(cls==='emission')return 0.96;
      if(cls==='mixed')return 0.78;
      return 0.48;
    }
    if(kind==='ir')return cls==='broadband'?0.82:0.60;
    return 1;
  }

  function darknessWeight(sunAlt){
    // Astrophotographic darkness: no credit above nautical twilight; full credit at astronomical night.
    return clamp((-Number(sunAlt)-12)/6,0,1);
  }
  function validAstro(astro){return !!astro&&['altitude','sunPos','moonPos','sep'].every(k=>typeof astro[k]==='function');}

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

  function airmassFromAltitude(alt){
    alt=Number(alt);if(!(alt>0))return Infinity;
    const z=(90-alt)*DEG;return 1/Math.sqrt(Math.max(0.04,1-0.96*Math.sin(z)**2));
  }
  function atmosphericTransmission(alt,k=DEFAULT_EXTINCTION){
    const x=airmassFromAltitude(alt);if(!Number.isFinite(x))return 0;
    return Math.pow(10,-0.4*k*Math.max(0,x-1));
  }
  function sqmToNanoLambert(sqm){return 34.08*Math.exp(20.7233-0.92104*Number(sqm));}

  // Krisciunas & Schaefer 1991: empirical V-band scattered moonlight contribution.
  function moonlightNanoLambert({illumination,moonAlt,targetAlt,separation,k=DEFAULT_EXTINCTION}){
    illumination=clamp(illumination,0,1);moonAlt=Number(moonAlt);targetAlt=Number(targetAlt);separation=Number(separation);
    if(!(illumination>0.001)||!(moonAlt>0)||!(targetAlt>0)||!Number.isFinite(separation))return 0;
    const phaseAngle=Math.acos(clamp(2*illumination-1,-1,1))/DEG;
    const iStar=Math.pow(10,-0.4*(3.84+0.026*Math.abs(phaseAngle)+4e-9*Math.pow(phaseAngle,4)));
    const rho=clamp(Math.abs(separation),1,180),cos=Math.cos(rho*DEG);
    const rayleigh=Math.pow(10,5.36)*(1.06+cos*cos);
    const mie=rho<10?6.2e7/(rho*rho):Math.pow(10,6.15-rho/40);
    const xm=airmassFromAltitude(moonAlt),x=airmassFromAltitude(targetAlt);
    if(!Number.isFinite(xm)||!Number.isFinite(x))return 0;
    return (rayleigh+mie)*iStar*Math.pow(10,-0.4*k*xm)*(1-Math.pow(10,-0.4*k*x));
  }

  function longestWindowHours(flags,stepMinutes){let best=0,run=0;for(const flag of flags){if(flag){run++;best=Math.max(best,run);}else run=0;}return best*stepMinutes/60;}
  function scoreLabel(score){if(score>=85)return'bardzo dobre';if(score>=70)return'dobre';if(score>=55)return'umiarkowane';if(score>=35)return'słabe';return'bardzo słabe';}
  function windowPhrase(hours){if(hours>=6)return'długie okno';if(hours>=3.5)return'średnie okno';if(hours>=1.5)return'krótkie okno';if(hours>0)return'bardzo krótkie okno';return'brak sensownego okna';}
  function coveragePhrase(c){if(c>=.75)return'przez większość nocy';if(c>=.45)return'przez sporą część nocy';if(c>=.20)return'tylko przez część nocy';if(c>0)return'tylko krótko w nocy';return'poza użyteczną częścią nocy';}
  function moonImpactPhrase(f){if(f<1.08)return'mały wpływ Księżyca';if(f<1.35)return'umiarkowany wpływ Księżyca';if(f<2)return'duży wpływ Księżyca';return'bardzo duży wpływ Księżyca';}

  function scoreTarget({raDeg,decDeg,classKey='mixed',metadata=null,materialProfile=null,context,astro,sky=null}){
    raDeg=Number(raDeg);decDeg=Number(decDeg);
    if(!validCoords(raDeg,decDeg))throw new Error('Nieprawidłowe współrzędne celu');
    if(!context?.samples?.length||!validAstro(astro))throw new Error('Brak kontekstu rekomendacji');
    metadata=metadata||{photoClass:classKey||'mixed'};
    materialProfile=materialProfile||{kind:'unknown',label:'materiał nieokreślony',moonResponse:1,lpResponse:1,assumed:true};

    const stepHours=context.stepMinutes/60,deepFlags=[];
    let totalDarkHours=0,usableHours=0,altitudeQualityBest=0,bestImagingAltitude=-90,conditionLogSum=0,conditionWeight=0,moonLogSum=0;
    const naturalNL=sqmToNanoLambert(NATURAL_SQM),siteSQM=Number(sky?.sqm),siteRatio=Number.isFinite(siteSQM)?Math.max(1,sqmToNanoLambert(siteSQM)/naturalNL):1,lpExcess=Math.max(0,siteRatio-1);
    const siteMaterialRatio=1+lpExcess*clamp(materialProfile.lpResponse,0,1);

    for(const s of context.samples){
      const alt=astro.altitude(raDeg,decDeg,s.t,context.lat,context.lon),dark=s.darkness;
      totalDarkHours+=stepHours*dark;
      const above=alt>=30,trans=above?atmosphericTransmission(alt):0;
      if(above)usableHours+=stepHours*dark;
      const altQuality=dark*trans;
      if(above&&altQuality>altitudeQualityBest){altitudeQualityBest=altQuality;bestImagingAltitude=alt;}
      deepFlags.push(above&&dark>=0.95);
      if(above&&dark>0){
        const separation=astro.sep(raDeg,decDeg,s.moonRa,s.moonDec),moonNL=moonlightNanoLambert({illumination:s.illumination,moonAlt:s.moonAlt,targetAlt:alt,separation});
        const moonRatio=moonNL/naturalNL,fullRatio=Math.max(1,siteMaterialRatio+moonRatio*clamp(materialProfile.moonResponse,0,1));
        const weight=dark*trans;
        conditionLogSum+=weight*Math.log(fullRatio);conditionWeight+=weight;
        const moonOnlyFactor=Math.max(1,fullRatio/siteMaterialRatio);moonLogSum+=weight*Math.log(moonOnlyFactor);
      }
    }

    const coverage=totalDarkHours>0?clamp(usableHours/totalDarkHours,0,1):0,longestWindow=longestWindowHours(deepFlags,context.stepMinutes);
    const geometryScore=30*altitudeQualityBest+35*clamp(usableHours/6,0,1)+25*coverage+10*clamp(longestWindow/5,0,1);
    const timeMultiplier=conditionWeight>0?Math.exp(conditionLogSum/conditionWeight):siteMaterialRatio;
    const moonTimeFactor=conditionWeight>0?Math.exp(moonLogSum/conditionWeight):1;
    // Background-limited imaging needs approximately proportional integration time as background rises.
    // Score mapping: each doubling of required integration time costs 6 points; this keeps 0–100 readable
    // while preserving the physically meaningful time-multiplier underneath.
    const backgroundPenalty=clamp(6*Math.log2(Math.max(1,timeMultiplier)),0,42);
    const compatibility=materialCompatibility(metadata,materialProfile),compatibilityPenalty=30*(1-compatibility);
    const score=Math.round(clamp(geometryScore-backgroundPenalty-compatibilityPenalty,0,100));
    const materialNote=materialProfile.assumed?'materiał nieokreślony — zachowawczo broadband':materialProfile.label;
    const reason=`${score}/100 — ${scoreLabel(score)}; ${windowPhrase(usableHours)} (${usableHours.toFixed(1)} h), ${coveragePhrase(coverage)}, ${moonImpactPhrase(moonTimeFactor)}.`;
    return{
      score,label:scoreLabel(score),classKey:metadata.photoClass||classKey||'mixed',reason,materialNote,
      metrics:{geometryScore,usableHours,totalDarkHours,coverage,longestWindow,bestImagingAltitude,altitudeQuality:altitudeQualityBest,siteRatio,siteMaterialRatio,timeMultiplier,moonTimeFactor,backgroundPenalty,compatibility,compatibilityPenalty}
    };
  }

  function classLabel(key){return CLASS_LABELS[key]||CLASS_LABELS.mixed;}
  function htmlEsc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function decorateCatalogPool(){
    if(typeof window.catalogObjectPool!=='function'||window.catalogObjectPool.__photoMetaWrapped)return;
    const original=window.catalogObjectPool;
    const wrapped=function(){return original().map(obj=>obj?.photoMeta?obj:{...obj,photoMeta:metadataForObject(obj)});};
    wrapped.__photoMetaWrapped=true;wrapped.__original=original;window.catalogObjectPool=wrapped;
  }

  let integrationSeq=0;
  function installRecommendationIntegration(){
    if(typeof window.refreshRecommendations!=='function'||typeof window.recommendationDateObject!=='function'||typeof window.recommendationLocation!=='function')return false;
    decorateCatalogPool();
    window.recommendationClassLabel=classLabel;
    window.recommendationProjectClass=project=>projectMetadata(project).photoClass;

    window.renderRecommendationProjects=function(rows,sky,skipped=0){
      const list=document.getElementById('recommendProjectList'),count=document.getElementById('recommendProjectCount');if(!list)return;
      if(count){const n=rows.length,m10=n%10,m100=n%100,word=n===1?'projekt':(m10>=2&&m10<=4&&!(m100>=12&&m100<=14))?'projekty':'projektów';count.textContent=`${n} ${word}`;}
      if(!rows.length){list.innerHTML='<div class="recommendationEmpty">Brak projektów „Do realizacji” lub „Aktywnych” z poprawnymi współrzędnymi.</div>';return;}
      list.innerHTML=rows.map(row=>{
        const r=row.result,m=r.metrics||{},material=r.material||{},meta=row.metadata||{};
        const assumption=material.assumed?'<br><span class="small warn">Brak przypisanego filtra/materiału — wpływ tła liczony zachowawczo jak dla broadband.</span>':'';
        const skyLine=sky?`<br><span class="small">Niebo: Bortle ≈ ${Number(sky.bortle).toFixed(0)}${Number.isFinite(Number(sky.sqm))?` · SQM ≈ ${Number(sky.sqm).toFixed(2)}`:''}. Warunki tła: ~${Number(m.timeMultiplier||1).toFixed(1)}× czasu względem ciemnego, bezksiężycowego nieba.</span>`:'';
        return `<details class="recommendationItem"><summary><div class="recommendationScore">${r.score}</div><div class="recommendationMain"><b>${htmlEsc(row.project.name)}</b><span>${row.project.status==='planned'?'Do realizacji':'Aktywny'} · ${htmlEsc(classLabel(meta.photoClass||row.classKey))}</span></div><span class="recommendationChevron">›</span></summary><div class="recommendationBody"><div class="recommendationReason"><b>${htmlEsc(r.reason)}</b><br><span class="small">Materiał: ${htmlEsc(r.materialNote||material.label||'—')}.</span>${assumption}${skyLine}</div><button class="secondary recommendationOpenBtn" type="button" data-project-id="${htmlEsc(row.project.id)}">Otwórz w Plannerze</button></div></details>`;
      }).join('');
      list.querySelectorAll('.recommendationOpenBtn').forEach(btn=>btn.addEventListener('click',()=>window.recommendationOpenProject?.(btn.dataset.projectId)));
      if(skipped&&document.getElementById('recommendStatus'))document.getElementById('recommendStatus').textContent+=` • Pominięto: ${skipped} (brak poprawnych współrzędnych).`;
    };

    window.refreshRecommendations=async function(){
      const seq=++integrationSeq,date=window.recommendationDateObject(),loc=window.recommendationLocation(),status=document.getElementById('recommendStatus'),metaEl=document.getElementById('recommendLocationMeta'),list=document.getElementById('recommendProjectList');
      if(!date||!loc){if(status)status.textContent='Wybierz datę i lokalizację. Rekomendacje nie korzystają z terminu zapisanego w projekcie.';if(metaEl)metaEl.textContent=loc?`${loc.name} · ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}`:'Brak współrzędnych. Wybierz lokalizację albo użyj GPS.';if(list)list.innerHTML='';return;}
      if(metaEl)metaEl.textContent=`${loc.name} · ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} · ustalanie jasności nieba…`;if(status)status.textContent='Liczenie rekomendacji…';if(list)list.innerHTML='';
      let sky=null;try{if(window.AstroBortle?.estimateAt)sky=await window.AstroBortle.estimateAt(loc.lat,loc.lon);}catch(_){sky=null;}if(seq!==integrationSeq)return;
      if(metaEl)metaEl.textContent=`${loc.name} · ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}${sky?` · Bortle ≈ ${Number(sky.bortle).toFixed(0)}`:' · jasność nieba niedostępna'}`;
      let context;try{context=buildContext({date,lat:loc.lat,lon:loc.lon,astro:{altitude:window.altitude,sunPos:window.sunPos,moonPos:window.moonPos,sep:window.sep},stepMinutes:5});}catch(e){console.error(e);if(status)status.textContent='Nie udało się przygotować obliczeń dla tej nocy.';return;}
      const projects=(window.getProjects?.()||[]).filter(pr=>['planned','active'].includes(pr.status||'active')),rows=[];let skipped=0;
      for(const project of projects){
        const coords=window.recommendationProjectCoords?.(project);if(!coords){skipped++;continue;}
        const metadata=projectMetadata(project),material=projectMaterialProfile(project);
        try{const result=scoreTarget({...coords,classKey:metadata.photoClass,metadata,materialProfile:material,context,astro:{altitude:window.altitude,sunPos:window.sunPos,moonPos:window.moonPos,sep:window.sep},sky});rows.push({project,classKey:metadata.photoClass,metadata,material,result});}catch(e){console.warn('Recommendation project skipped',project?.name,e);skipped++;}
      }
      rows.sort((a,b)=>b.result.score-a.result.score||String(a.project.name||'').localeCompare(String(b.project.name||''),'pl'));
      if(status)status.textContent=sky?'Wynik: geometria nocy + model Księżyca + jasność nieba + rzeczywisty materiał/filtr projektu.':'Wynik: geometria nocy + model Księżyca + materiał projektu; jasność nieba chwilowo niedostępna.';
      window.renderRecommendationProjects(rows,sky,skipped);
    };
    return true;
  }

  window.AstroTargetMetadata={
    metadataForObject,projectMetadata,buildAll:allCatalogMetadata,
    audit(){const rows=allCatalogMetadata(),counts={emission:0,broadband:0,dust:0,mixed:0};for(const r of rows)counts[r.meta.photoClass]=(counts[r.meta.photoClass]||0)+1;return{total:rows.length,counts,lowConfidence:rows.filter(r=>r.meta.confidence==='low').length};}
  };
  window.AstroRecommend={buildContext,scoreTarget,darknessWeight,moonlightNanoLambert,projectMaterialProfile,materialCompatibility};

  // Core functions are declared later in index.html. Install only after the whole page has executed.
  if(document.readyState==='complete')setTimeout(()=>{if(!installRecommendationIntegration())setTimeout(installRecommendationIntegration,400);},0);
  else window.addEventListener('load',()=>setTimeout(()=>{if(!installRecommendationIntegration())setTimeout(installRecommendationIntegration,400);},0),{once:true});
})();
