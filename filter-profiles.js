/* AstroPlanner v0.14 R&D — spectral/material profiles used by recommendations.
 * Quantitative credit is given only when passband width is known from the filter
 * record or from a small manufacturer-spec registry. Unknown broadband/LP filters
 * remain conservative rather than receiving invented suppression values.
 */
(function(global){
  'use strict';
  const REF_NM=250; // practical broad optical reference for relative continuum background
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)));
  const strip=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const compact=v=>strip(v).replace(/[^a-z0-9]+/g,'');

  const KNOWN=[
    {id:'antlia-alpt-haoiii-3',match:n=>n.includes('antlia')&&n.includes('alpt')&&n.includes('3nm')&&n.includes('oiii')&&(n.includes('ha')||n.includes('halpha')),kind:'dualband',label:'Antlia ALP-T Ha/OIII 3 nm',bands:[['Ha',656.3,3],['OIII',500.7,3]],source:'Antlia manufacturer specification'},
    {id:'antlia-alpt-siioiii-3',match:n=>n.includes('antlia')&&n.includes('alpt')&&n.includes('3nm')&&n.includes('sii')&&n.includes('oiii'),kind:'dualband',label:'Antlia ALP-T SII/OIII 3 nm',bands:[['SII',672.4,3],['OIII',500.7,3]],source:'Antlia manufacturer specification'},
    {id:'antlia-alpt-haoiii-5',match:n=>n.includes('antlia')&&n.includes('alpt')&&n.includes('5nm')&&n.includes('oiii')&&(n.includes('ha')||n.includes('halpha')),kind:'dualband',label:'Antlia ALP-T Ha/OIII 5 nm',bands:[['Ha',656.3,5],['OIII',500.7,5]],source:'Antlia manufacturer specification'},
    {id:'optolong-lenhance',match:n=>n.includes('lenhance'),kind:'multiband',label:'Optolong L-eNhance',bands:[['Hb+OIII',493,23],['Ha',653,10]],source:'Optolong published/measured bandpass'},
    {id:'optolong-lextreme',match:n=>n.includes('lextreme'),kind:'dualband',label:'Optolong L-eXtreme',bands:[['OIII',500.7,7],['Ha',656.3,7]],source:'Optolong manufacturer specification'},
    {id:'optolong-lultimate',match:n=>n.includes('lultimate'),kind:'dualband',label:'Optolong L-Ultimate',bands:[['OIII',500.7,3],['Ha',656.3,3]],source:'Optolong manufacturer specification'},
    // The RGB Ultra II manufacturer publishes a multi/triband spectral design but the
    // product text does not expose one simple FWHM suitable for this scalar model.
    // Recognise it, but do not invent a numeric background reduction.
    {id:'antlia-rgb-ultra-ii',match:n=>n.includes('antlia')&&(n.includes('rgbultraii')||n.includes('rgbultra2')||n.includes('tribandrgbultraii')||n.includes('tribandrgbultra2')),kind:'broadband-lp',label:'Antlia Triband RGB Ultra II',bands:null,source:'Antlia manufacturer specification',quantitative:false}
  ];

  function namedProfile(name){const n=compact(name);return KNOWN.find(p=>p.match(n))||null;}
  function bandsWidth(bands){return Array.isArray(bands)?bands.reduce((a,b)=>a+Math.max(0,Number(b[2])||0),0):NaN;}
  function lineNamesFromText(name){const n=compact(name),out=[];if(n.includes('halpha')||/(^|[^a-z])ha([^a-z]|$)/i.test(strip(name)))out.push('Ha');if(n.includes('oiii')||n.includes('o3'))out.push('OIII');if(n.includes('sii')||n.includes('s2'))out.push('SII');if(n.includes('hbeta')||n.includes('hb'))out.push('Hb');return [...new Set(out)];}

  function buildQuantitative(kind,label,bands,source='user bandwidth',id=null){
    const eq=bandsWidth(bands),response=Number.isFinite(eq)?clamp(eq/REF_NM,.004,1):1;
    return{kind,label,bands,effectiveWidthNm:eq,moonResponse:response,lpResponse:response,signalMode:'line',quantitative:true,assumed:false,source,id};
  }

  function profileForFilter(filter={}){
    const name=String(filter.name||''),known=namedProfile(name);
    if(known){
      if(known.quantitative===false)return{kind:known.kind,label:known.label,bands:null,effectiveWidthNm:null,moonResponse:1,lpResponse:1,signalMode:'continuum',quantitative:false,assumed:true,source:known.source,id:known.id,note:'znany filtr; brak pojedynczej szerokości efektywnej w modelu — bez sztucznego bonusu'};
      return buildQuantitative(known.kind,known.label,known.bands,known.source,known.id);
    }
    const type=String(filter.type||'other').toLowerCase(),bw=Number(filter.bandwidth),lines=lineNamesFromText(name);
    if(type==='narrowband'){
      if(Number.isFinite(bw)&&bw>0){const line=lines[0]||'NB';return buildQuantitative('narrowband',`${name||'Narrowband'} · ${bw} nm`,[[line,null,bw]],'user filter bandwidth');}
      return{kind:'narrowband',label:name||'Narrowband',bands:null,effectiveWidthNm:null,moonResponse:1,lpResponse:1,signalMode:'line',quantitative:false,assumed:true,source:'user filter',note:'brak szerokości pasma — brak liczbowego bonusu'};
    }
    if(type==='dualband'){
      if(Number.isFinite(bw)&&bw>0){const ls=lines.length>=2?lines.slice(0,2):['band 1','band 2'];return buildQuantitative('dualband',`${name||'Dual-band'} · ${bw} nm/pasmo`,[[ls[0],null,bw],[ls[1],null,bw]],'user filter bandwidth');}
      return{kind:'dualband',label:name||'Dual-band',bands:null,effectiveWidthNm:null,moonResponse:1,lpResponse:1,signalMode:'line',quantitative:false,assumed:true,source:'user filter',note:'brak szerokości pasm — brak liczbowego bonusu'};
    }
    if(type==='broadband')return{kind:'broadband',label:name||'Broadband / LP',bands:null,effectiveWidthNm:null,moonResponse:1,lpResponse:1,signalMode:'continuum',quantitative:false,assumed:false,source:'user filter'};
    if(type==='none')return{kind:'broadband',label:'bez filtra',bands:null,effectiveWidthNm:REF_NM,moonResponse:1,lpResponse:1,signalMode:'continuum',quantitative:true,assumed:false,source:'no filter'};
    if(type==='ir')return{kind:'ir',label:name||'IR-pass',bands:null,effectiveWidthNm:null,moonResponse:1,lpResponse:1,signalMode:'continuum',quantitative:false,assumed:true,source:'user filter',note:'IR-pass nie ma jeszcze ilościowego modelu DSO'};
    return{kind:'unknown',label:name||'filtr nieokreślony',bands:null,effectiveWidthNm:null,moonResponse:1,lpResponse:1,signalMode:'unknown',quantitative:false,assumed:true,source:'unknown'};
  }

  function inferFromPlanName(name){
    const n=compact(name);if(!n)return null;
    const lines=lineNamesFromText(name);
    const width=(strip(name).match(/(\d+(?:[.,]\d+)?)\s*nm/)||[])[1];
    if(lines.length){const bw=width?Number(String(width).replace(',','.')):NaN;if(Number.isFinite(bw)&&bw>0)return buildQuantitative(lines.length>=2?'dualband':'narrowband',`${name} · z nazwy planu`,lines.slice(0,2).map(x=>[x,null,bw]),'plan name');return{kind:lines.length>=2?'dualband':'narrowband',label:`${name} · z nazwy planu`,bands:null,effectiveWidthNm:null,moonResponse:1,lpResponse:1,signalMode:'line',quantitative:false,assumed:true,source:'plan name'};}
    if(n.includes('rgb')||n.includes('lrgb')||n==='l'||n.includes('luminanc'))return{kind:'broadband',label:`${name} · broadband`,bands:null,effectiveWidthNm:null,moonResponse:1,lpResponse:1,signalMode:'continuum',quantitative:false,assumed:false,source:'plan name'};
    return null;
  }

  function projectProfile(project,equipment){
    const eq=equipment||{filters:[],profiles:[]},filters=new Map((eq.filters||[]).map(f=>[String(f.id),f])),profiles=new Map((eq.profiles||[]).map(p=>[String(p.id),p]));
    const parts=[];
    const plan=Array.isArray(project?.materialPlan)?project.materialPlan.filter(x=>Number(x?.goal)>0):[];
    if(plan.length){
      for(const item of plan){const weight=Number(item.goal)||0,filter=filters.get(String(item.filterId||'')),profile=filter?profileForFilter(filter):inferFromPlanName(item.name);parts.push({weight,profile:profile||{kind:'unknown',label:'materiał nieokreślony',moonResponse:1,lpResponse:1,signalMode:'unknown',quantitative:false,assumed:true,source:'missing'},resolved:!!profile});}
    }else{
      let filterId=String(project?.setupDefaults?.filterId||'');if(!filterId&&project?.profileId){const p=profiles.get(String(project.profileId));if(p)filterId=String(p.filterId||'');}
      const f=filters.get(filterId);if(f){const p=profileForFilter(f);parts.push({weight:1,profile:p,resolved:true});}
    }
    if(!parts.length)parts.push({weight:1,profile:{kind:'unknown',label:'materiał nieokreślony',moonResponse:1,lpResponse:1,signalMode:'unknown',quantitative:false,assumed:true,source:'missing'},resolved:false});
    const total=parts.reduce((a,p)=>a+p.weight,0)||1;
    const moonResponse=parts.reduce((a,p)=>a+p.weight*p.profile.moonResponse,0)/total,lpResponse=parts.reduce((a,p)=>a+p.weight*p.profile.lpResponse,0)/total;
    const resolvedFraction=parts.reduce((a,p)=>a+(p.resolved?p.weight:0),0)/total,quantitativeFraction=parts.reduce((a,p)=>a+(p.profile.quantitative?p.weight:0),0)/total;
    const kinds=[...new Set(parts.map(p=>p.profile.kind))],kind=kinds.length===1?kinds[0]:'mixed',label=parts.length===1?parts[0].profile.label:'mieszany plan materiału';
    return{kind,label,moonResponse,lpResponse,resolvedFraction,quantitativeFraction,assumed:resolvedFraction<.999||quantitativeFraction<.999,parts};
  }

  function compatibility(targetMeta,profile){
    const cls=targetMeta?.photoClass||'mixed',kind=profile?.kind||'unknown';
    if(kind==='unknown'||kind==='broadband'||kind==='broadband-lp')return 1;
    if(kind==='mixed')return cls==='emission'||cls==='mixed'?0.9:0.72;
    if(kind==='narrowband'||kind==='dualband'||kind==='multiband'){
      if(cls==='emission')return 1;
      if(cls==='mixed')return .75;
      return .30;
    }
    if(kind==='ir')return cls==='broadband'?.75:.55;
    return 1;
  }

  global.AstroFilterProfiles={REFERENCE_NM:REF_NM,KNOWN,profileForFilter,projectProfile,compatibility};
})(window);
