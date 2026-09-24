/* AstroPlanner v0.14 R&D — photographic + signal metadata v5.1.
 * Classification is deterministic from the loaded catalogues. Signal metadata is
 * deliberately type-aware: integrated magnitude / mean surface brightness for
 * extended continuum targets, Lynds opacity for dark nebulae, and explicit
 * "unknown" for classes where the current catalogues do not provide a physically
 * comparable line-flux measure.
 */
(function(global){
  'use strict';

  const CLASS_LABELS={emission:'emisja',broadband:'szerokie pasmo',dust:'pyły / refleksy',mixed:'mieszany / niejednoznaczny'};
  const PHYSICAL_LABELS={
    galaxy:'galaktyka','galaxy-pair':'para galaktyk','galaxy-triplet':'tryplet galaktyk','galaxy-group':'grupa galaktyk','galaxy-cluster':'gromada galaktyk',
    'open-cluster':'gromada otwarta','globular-cluster':'gromada kulista','stellar-association':'asocjacja gwiazdowa','cluster-nebulosity':'gromada z mgławicą',
    'planetary-nebula':'mgławica planetarna','hii-region':'region H II','emission-nebula':'mgławica emisyjna','reflection-nebula':'mgławica refleksyjna',
    'dark-nebula':'mgławica ciemna / pyłowa','supernova-remnant':'pozostałość po supernowej','nebula-unspecified':'mgławica — typ nieokreślony',
    star:'gwiazda','double-star':'gwiazda podwójna',nova:'nowa','nonexistent':'obiekt nieistniejący / błędny wpis',duplicate:'duplikat katalogowy',other:'inny / nieokreślony'
  };
  const TYPE_META={
    G:{physicalType:'galaxy',photoClass:'broadband',signalKind:'continuum'},GPair:{physicalType:'galaxy-pair',photoClass:'broadband',signalKind:'continuum'},
    GTrpl:{physicalType:'galaxy-triplet',photoClass:'broadband',signalKind:'continuum'},GGroup:{physicalType:'galaxy-group',photoClass:'broadband',signalKind:'continuum'},
    GCluster:{physicalType:'galaxy-cluster',photoClass:'broadband',signalKind:'continuum'},OCl:{physicalType:'open-cluster',photoClass:'broadband',signalKind:'continuum'},
    GCl:{physicalType:'globular-cluster',photoClass:'broadband',signalKind:'continuum'},'*Ass':{physicalType:'stellar-association',photoClass:'broadband',signalKind:'continuum'},
    'Cl+N':{physicalType:'cluster-nebulosity',photoClass:'mixed',signalKind:'mixed'},PN:{physicalType:'planetary-nebula',photoClass:'emission',signalKind:'line'},
    HII:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},EmN:{physicalType:'emission-nebula',photoClass:'emission',signalKind:'line'},
    RfN:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},DrkN:{physicalType:'dark-nebula',photoClass:'dust',signalKind:'absorption'},
    SNR:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},Neb:{physicalType:'nebula-unspecified',photoClass:'mixed',signalKind:'mixed'},
    '*':{physicalType:'star',photoClass:'broadband',signalKind:'continuum'},'**':{physicalType:'double-star',photoClass:'broadband',signalKind:'continuum'},
    Nova:{physicalType:'nova',photoClass:'broadband',signalKind:'continuum'},NonEx:{physicalType:'nonexistent',photoClass:'mixed',signalKind:'mixed'},
    Dup:{physicalType:'duplicate',photoClass:'mixed',signalKind:'mixed'},Other:{physicalType:'other',photoClass:'mixed',signalKind:'mixed'}
  };

  const CURATED={
    m1:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},ngc1952:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},
    m8:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},ngc6523:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    m16:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},ngc6611:{physicalType:'cluster-nebulosity',photoClass:'mixed',signalKind:'mixed'},
    m17:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},ngc6618:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    m20:{physicalType:'cluster-nebulosity',photoClass:'mixed',signalKind:'mixed'},ngc6514:{physicalType:'cluster-nebulosity',photoClass:'mixed',signalKind:'mixed'},
    m42:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},ngc1976:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    m43:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},ngc1982:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    m45:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},ngc1432:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},
    ngc1435:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},m78:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},
    ngc2068:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},ngc6960:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},
    ngc6974:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},ngc6979:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},
    ngc6992:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},ngc6995:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},
    ngc7000:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},ngc6888:{physicalType:'emission-nebula',photoClass:'emission',signalKind:'line'},
    ngc7023:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},ic1805:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    ic1848:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},ic434:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    ic5067:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},ic5070:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    b33:{physicalType:'dark-nebula',photoClass:'dust',signalKind:'absorption'},ctb1:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'}
  };

  const SIGNAL_SUPPLEMENT_URL='https://raw.githubusercontent.com/acocalypso/celestia_atlas/ef52c7ea920191d45fe0da4711dd3b1cc9220c18/data/stellarium-dso-supplement.json';
  const strip=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').replace(/Ł/g,'L').toLowerCase();
  const compact=value=>strip(value).replace(/[^a-z0-9]+/g,'');
  const finite=(...values)=>{for(const value of values){const n=Number(value);if(Number.isFinite(n))return n;}return null;};

  function identityTokens(objOrText){
    const texts=[];
    if(typeof objOrText==='string')texts.push(objOrText);
    else if(objOrText){
      for(const k of ['name','displayName','catalogId','catalogUid','id','uid'])if(objOrText[k])texts.push(objOrText[k]);
      if(Array.isArray(objOrText.aliases))texts.push(...objOrText.aliases);
      if(Array.isArray(objOrText.crossIdentifiers))texts.push(...objOrText.crossIdentifiers);
    }
    const out=new Set();
    for(const raw of texts){
      const s=strip(raw);if(!s)continue;
      const pats=[[/\bm\s*0*(\d{1,3})\b/g,'m'],[/\bngc\s*0*(\d+)\b/g,'ngc'],[/\bic\s*0*(\d+)\b/g,'ic'],[/\bsh\s*2[-\s]*0*(\d+)\b/g,'sh2'],[/\bldn\s*0*(\d+)\b/g,'ldn'],[/\blbn\s*0*(\d+)\b/g,'lbn'],[/\bvdb\s*0*(\d+)\b/g,'vdb'],[/\brcw\s*0*(\d+)\b/g,'rcw'],[/\bctb\s*0*(\d+)\b/g,'ctb'],[/\b(?:barnard|b)\s*0*(\d+)\b/g,'b'],[/\b(?:abell\s*pn|pn\s*a66|a66)[-\s]*0*(\d+)\b/g,'abellpn'],[/\b(?:abell|aco)\s*0*(\d+)\b/g,'abell']];
      for(const [re,prefix] of pats){let m;while((m=re.exec(s)))out.add(prefix+String(Number(m[1])));}
      const c=compact(s);if(c)out.add(c);
    }
    return [...out];
  }

  function curatedFor(obj){
    for(const token of identityTokens(obj)){
      if(CURATED[token])return{...CURATED[token],identity:token};
      for(const key of Object.keys(CURATED))if(key.length>=4&&token.startsWith(key))return{...CURATED[key],identity:key};
    }
    return null;
  }

  function metaFromText(typeText){
    const t=compact(typeText);if(!t)return null;
    if(t.includes('pozostaloscposupernowej')||t.includes('supernovaremnant'))return TYPE_META.SNR;
    if(t.includes('planetarn')||t.includes('planetarynebula'))return TYPE_META.PN;
    if(t.includes('regionhii')||t.includes('hiiregion'))return TYPE_META.HII;
    if(t.includes('emisyjn')||t.includes('emissionnebula'))return TYPE_META.EmN;
    if(t.includes('refleksyjn')||t.includes('reflectionnebula'))return TYPE_META.RfN;
    if(t.includes('ciemna')||t.includes('darknebula')||t.includes('pyl')||t.includes('dust'))return TYPE_META.DrkN;
    if(t.includes('gromadazmglaw')||t.includes('clusterwithnebul'))return TYPE_META['Cl+N'];
    if(t.includes('galakty')||t.includes('galaxy'))return TYPE_META.G;
    if(t.includes('gromadaotwarta')||t.includes('opencluster'))return TYPE_META.OCl;
    if(t.includes('gromadakulista')||t.includes('globularcluster'))return TYPE_META.GCl;
    if(t.includes('asocjac')||t.includes('stellarassociation'))return TYPE_META['*Ass'];
    if(t.includes('podwojn')||t.includes('doublestar'))return TYPE_META['**'];
    if(t.includes('gwiazda')||t==='star')return TYPE_META['*'];
    if(t.includes('mglawica')||t.includes('nebula'))return TYPE_META.Neb;
    return null;
  }
  function metaFromGroups(groups,catalog){
    const g=[...(Array.isArray(groups)?groups:[]),catalog].map(compact).filter(Boolean);
    if(g.some(x=>x==='abellpn'))return TYPE_META.PN;
    if(g.some(x=>x==='ldn'||x==='barnard'))return TYPE_META.DrkN;
    if(g.some(x=>x==='vdb'))return TYPE_META.RfN;
    if(g.some(x=>x==='sharpless'||x==='sh2'||x==='rcw'))return TYPE_META.HII;
    if(g.some(x=>x==='abell'||x.includes('galaxycluster')))return TYPE_META.GCluster;
    if(g.some(x=>x==='lbn'))return TYPE_META.Neb;
    return null;
  }

  function objectAxes(obj={}){
    const shape=obj.shape||{};
    const major=finite(obj.majorAxisArcmin,obj.major,obj.majAx,obj.MajAx,shape.majorArcmin,shape.majorAxisArcmin);
    const minor=finite(obj.minorAxisArcmin,obj.minor,obj.minAx,obj.MinAx,shape.minorArcmin,shape.minorAxisArcmin,major);
    return{majorArcmin:major&&major>0?major:null,minorArcmin:minor&&minor>0?minor:null};
  }
  function meanSurfaceBrightness(mag,majorArcmin,minorArcmin){
    if(!Number.isFinite(mag)||!(majorArcmin>0)||!(minorArcmin>0))return null;
    const areaArcsec2=Math.PI*(majorArcmin*60)*(minorArcmin*60)/4;
    return areaArcsec2>0?mag+2.5*Math.log10(areaArcsec2):null;
  }

  const STELLAR_PHYSICAL=new Set(['open-cluster','globular-cluster','stellar-association','star','double-star']);
  const NEBULAR_PHYSICAL=new Set(['reflection-nebula','emission-nebula','hii-region','planetary-nebula','supernova-remnant','dark-nebula','cluster-nebulosity','nebula-unspecified']);
  function photometryRole(base={},rawBase=null,override=null){
    if(override&&rawBase&&STELLAR_PHYSICAL.has(rawBase.physicalType)&&NEBULAR_PHYSICAL.has(base.physicalType))return'stellar-component';
    if(base.physicalType==='dark-nebula')return'absorption-component';
    if(base.signalKind==='line')return'line-emission';
    return'whole-object';
  }

  function signalFromObject(obj={},base={},options={}){
    const props=obj.properties||{},axes=objectAxes(obj),photometryAppliesTo=options.photometryAppliesTo||'whole-object';
    const catalogMagnitude=finite(obj.mag,obj.magnitude,obj.vMag,obj.vmag,props.magnitude,props.vMagnitude,props.bMagnitude,props.mag,props.vMag);
    const magnitudeBand=String(obj.magBand||obj.magnitudeBand||props.magnitudeBand||'').trim()||null;
    const catalogSurfaceRaw=finite(obj.surfaceBrightness,props.surfaceBrightness,props.surfaceBrightnessMagArcsec2);
    const componentMismatch=photometryAppliesTo==='stellar-component';
    // If the catalogue photometry describes a stellar component (e.g. M45 as an open cluster)
    // while the photographic target is curated as nebulosity/dust, it must never be used as
    // the brightness of that nebulosity. Keep the raw value only for auditability.
    const magnitude=componentMismatch?null:catalogMagnitude;
    const catalogSurface=componentMismatch?null:catalogSurfaceRaw;
    const derivedSurface=meanSurfaceBrightness(magnitude,axes.majorArcmin,axes.minorArcmin);
    const opacityRaw=finite(obj.opacityClass,props.opacityClass),opacityClass=opacityRaw!=null&&opacityRaw>=1&&opacityRaw<=6?Math.round(opacityRaw):null;
    // Feitzinger & Stüwe (1986): A_V = 0.724 * opacity class + 0.5 mag, approximately consistent with Lynds.
    const extinctionAv=opacityClass!=null?0.724*opacityClass+0.5:null;
    const absorptionContrast=extinctionAv!=null?1-Math.pow(10,-0.4*extinctionAv):null;
    const useSurface=['galaxy','galaxy-pair','galaxy-triplet','reflection-nebula'].includes(base.physicalType);
    let model='unknown',confidence='low';
    if(componentMismatch){model='component-mismatch';confidence='low';}
    else if(base.physicalType==='dark-nebula'&&opacityClass!=null){model='dark-opacity';confidence='medium';}
    else if(useSurface&&Number.isFinite(catalogSurface)){model='surface-brightness';confidence='high';}
    else if(useSurface&&Number.isFinite(derivedSurface)){model='surface-brightness';confidence='medium';}
    else if(base.signalKind==='line'){model='line-flux-missing';confidence='low';}
    else if(Number.isFinite(magnitude)){model='integrated-magnitude';confidence='medium';}
    return Object.freeze({
      model,confidence,photometryAppliesTo,
      integratedMagnitude:magnitude,catalogIntegratedMagnitude:catalogMagnitude,magnitudeBand,
      majorArcmin:axes.majorArcmin,minorArcmin:axes.minorArcmin,
      surfaceBrightnessMagArcsec2:Number.isFinite(catalogSurface)?catalogSurface:(Number.isFinite(derivedSurface)?derivedSurface:null),
      catalogSurfaceBrightnessMagArcsec2:catalogSurfaceRaw,
      surfaceBrightnessSource:Number.isFinite(catalogSurface)?'catalog':(Number.isFinite(derivedSurface)?'derived-from-magnitude-and-size':null),
      opacityClass,extinctionAv,absorptionContrast
    });
  }
  function signalRichness(signal={}){
    let n=0;if(Number.isFinite(signal.surfaceBrightnessMagArcsec2))n+=6;if(Number.isFinite(signal.opacityClass))n+=6;if(Number.isFinite(signal.integratedMagnitude))n+=2;if(signal.majorArcmin>0&&signal.minorArcmin>0)n+=2;if(signal.confidence==='high')n+=1;return n;
  }

  const metadataCache=new Map();
  function stableCacheKey(obj){const ids=identityTokens(obj).slice(0,6).join('|');return[ids,String(obj?.typeCode||obj?.objectType||''),String(obj?.type||obj?.typeName||''),String(obj?.catalog||obj?.catalogSource||''),(obj?.groups||obj?.catalogueGroups||[]).join(','),String(obj?.mag??''),String(obj?.majorAxisArcmin??obj?.major??''),String(obj?.minorAxisArcmin??obj?.minor??'')].join('::');}
  function metadataForObject(obj={}){
    const key=stableCacheKey(obj);if(metadataCache.has(key))return metadataCache.get(key);
    const override=curatedFor(obj),typeCode=String(obj.typeCode||obj.objectType||'').trim(),codeMeta=TYPE_META[typeCode]||null,groupMeta=metaFromGroups(obj.groups||obj.catalogueGroups,obj.catalog||obj.catalogSource),textMeta=metaFromText(obj.type||obj.typeName||obj.typeLabel);
    const rawBase=codeMeta||groupMeta||textMeta||null,base=override||rawBase||TYPE_META.Other;
    const source=override?'curated':codeMeta?'catalog-type':groupMeta?'catalog-group':textMeta?'catalog-text':'fallback';
    let confidence=override||codeMeta?'high':groupMeta||textMeta?'medium':'low';if(typeCode==='Neb'||typeCode==='Other'||typeCode==='Cl+N')confidence=override?'high':'low';
    const signal=signalFromObject(obj,base,{photometryAppliesTo:photometryRole(base,rawBase,override)});
    const meta=Object.freeze({physicalType:base.physicalType,physicalLabel:PHYSICAL_LABELS[base.physicalType]||PHYSICAL_LABELS.other,photoClass:base.photoClass,photoClassLabel:CLASS_LABELS[base.photoClass]||CLASS_LABELS.mixed,signalKind:base.signalKind,confidence,source,rawTypeCode:typeCode||null,rawType:String(obj.type||obj.typeName||obj.typeLabel||'')||null,catalog:String(obj.catalog||obj.catalogSource||''),groups:Array.isArray(obj.groups)?[...obj.groups]:Array.isArray(obj.catalogueGroups)?[...obj.catalogueGroups]:[],identities:identityTokens(obj),curatedIdentity:override?.identity||null,signal});
    metadataCache.set(key,meta);return meta;
  }

  let indexedCount=-1,indexByToken=new Map(),indexRows=[];
  function indexPool(pool){
    const rows=Array.isArray(pool)?pool:[];if(indexedCount===rows.length&&indexRows.length===rows.length)return;
    indexedCount=rows.length;indexByToken=new Map();indexRows=[];
    for(const object of rows){
      const meta=object?.photoMeta||metadataForObject(object),row={object,meta};indexRows.push(row);
      for(const token of meta.identities){const old=indexByToken.get(token);if(!old||signalRichness(meta.signal)>signalRichness(old.meta.signal))indexByToken.set(token,row);}
    }
  }
  function attach(object){return object?.photoMeta?object:{...object,photoMeta:metadataForObject(object)};}
  function attachPool(pool){const rows=(Array.isArray(pool)?pool:[]).map(attach);indexPool(rows);return rows;}

  const signalByToken=new Map();let signalLoadPromise=null,signalSupplementReady=false;
  function bestSignalForTokens(tokens){let best=null;for(const token of tokens||[]){const s=signalByToken.get(token);if(s&&(!best||signalRichness(s)>signalRichness(best)))best=s;}return best;}
  function mergeSignal(meta,extra){if(!extra||signalRichness(extra)<=signalRichness(meta.signal))return meta;return Object.freeze({...meta,signal:extra});}
  async function loadSignalSupplement(){
    if(signalSupplementReady)return true;if(signalLoadPromise)return signalLoadPromise;
    signalLoadPromise=(async()=>{try{
      const response=await fetch(SIGNAL_SUPPLEMENT_URL,{cache:'force-cache',mode:'cors'});if(!response.ok)throw new Error(`HTTP ${response.status}`);const payload=await response.json(),objects=Array.isArray(payload?.objects)?payload.objects:[];
      for(const obj of objects){const base=metadataForObject(obj),signal=signalFromObject(obj,base);if(signalRichness(signal)<1)continue;for(const token of identityTokens(obj)){const old=signalByToken.get(token);if(!old||signalRichness(signal)>signalRichness(old))signalByToken.set(token,signal);}}
      signalSupplementReady=true;return true;
    }catch(e){console.warn('AstroTargetMetadata signal supplement unavailable',e);return false;}finally{signalLoadPromise=null;}})();return signalLoadPromise;
  }

  function parseRA(value){const t=String(value??'').trim(),p=t.split(/[:\s]+/).map(Number);return t&&p.length&&!p.some(Number.isNaN)?15*(p[0]+(p[1]||0)/60+(p[2]||0)/3600):NaN;}
  function parseDec(value){const t=String(value??'').trim();if(!t)return NaN;const neg=t.startsWith('-'),p=t.replace(/^[+-]/,'').split(/[:\s]+/).map(Number);if(!p.length||p.some(Number.isNaN))return NaN;const v=p[0]+(p[1]||0)/60+(p[2]||0)/3600;return neg?-v:v;}
  function combineClassificationAndSignal(classMeta,signalMeta){return signalMeta&&signalRichness(signalMeta.signal)>signalRichness(classMeta.signal)?Object.freeze({...classMeta,signal:signalMeta.signal}):classMeta;}

  function projectMetadata(project,pool){
    const target=project?.target||{},pseudo={name:target.name||project?.name||'',aliases:[target.name||''],type:target.type||'',typeCode:target.typeCode||'',catalog:target.catalog||'',groups:target.groups||[],catalogUid:target.catalogUid||''};
    let direct=metadataForObject(pseudo),matched=null;
    const rows=Array.isArray(pool)?pool:(typeof global.catalogObjectPool==='function'?global.catalogObjectPool():[]);indexPool(rows);
    for(const token of identityTokens(pseudo)){const row=indexByToken.get(token);if(row){matched=row;break;}}
    if(!matched){const ra=parseRA(target.ra),dec=parseDec(target.dec);if(Number.isFinite(ra)&&Number.isFinite(dec)){let best=null,bestDist=.08,c=Math.cos(dec*Math.PI/180);for(const row of indexRows){const o=row.object;if(!Number.isFinite(Number(o?.raDeg))||!Number.isFinite(Number(o?.decDeg)))continue;const dra=Math.abs(Number(o.raDeg)-ra)*c,ddec=Math.abs(Number(o.decDeg)-dec),dist=Math.hypot(dra,ddec);if(dist<bestDist){bestDist=dist;best=row;}}matched=best;}}
    let result=matched?(direct.source==='curated'?combineClassificationAndSignal(direct,matched.meta):matched.meta):direct;
    const extra=bestSignalForTokens([...result.identities,...identityTokens(pseudo),...(matched?matched.meta.identities:[])]);result=mergeSignal(result,extra);return result;
  }

  async function prepareSignalData(projects,pool){
    const list=Array.isArray(projects)?projects:[],rows=Array.isArray(pool)?pool:[];indexPool(rows);
    let needSupplement=false;
    for(const project of list){const meta=projectMetadata(project,rows);if(meta.physicalType==='dark-nebula'&&!Number.isFinite(meta.signal?.opacityClass)){needSupplement=true;break;}}
    if(needSupplement)await loadSignalSupplement();
    return{supplementReady:signalSupplementReady};
  }

  function signalSummary(meta){
    const s=meta?.signal||{};
    if(s.model==='component-mismatch')return'fotometria katalogowa dotyczy składnika gwiazdowego, nie pyłu/refleksów';
    if(s.model==='surface-brightness'&&Number.isFinite(s.surfaceBrightnessMagArcsec2)){const src=s.surfaceBrightnessSource==='catalog'?'katalogowa':'wyliczona z magnitudo i rozmiaru';return`μ ≈ ${s.surfaceBrightnessMagArcsec2.toFixed(2)} mag/arcsec² (${src})`;}
    if(s.model==='dark-opacity'&&Number.isFinite(s.opacityClass))return`opacity ${s.opacityClass}/6 · Aᵥ ≈ ${s.extinctionAv.toFixed(1)} mag`;
    if(Number.isFinite(s.integratedMagnitude))return`m ≈ ${s.integratedMagnitude.toFixed(2)}${s.magnitudeBand?` ${s.magnitudeBand}`:''}`;
    if(s.model==='line-flux-missing')return'brak porównywalnego strumienia liniowego w obecnym katalogu';
    return'brak ilościowych danych o sygnale';
  }

  function audit(pool){
    const rows=attachPool(pool||[]),byClass={},byPhysical={},byTypeCode={},bySource={},bySignalModel={},unknownTypeCodes=new Set(),lowConfidence=[];
    for(const o of rows){const m=o.photoMeta;byClass[m.photoClass]=(byClass[m.photoClass]||0)+1;byPhysical[m.physicalType]=(byPhysical[m.physicalType]||0)+1;bySource[m.source]=(bySource[m.source]||0)+1;bySignalModel[m.signal?.model||'unknown']=(bySignalModel[m.signal?.model||'unknown']||0)+1;const tc=m.rawTypeCode||'(brak)';byTypeCode[tc]=(byTypeCode[tc]||0)+1;if(m.source==='fallback'&&m.rawTypeCode)unknownTypeCodes.add(m.rawTypeCode);if(m.confidence==='low')lowConfidence.push({name:o.name||o.label||o.id||'?',typeCode:m.rawTypeCode,type:m.rawType,photoClass:m.photoClass,signalModel:m.signal?.model});}
    return{total:rows.length,byClass,byPhysical,byTypeCode,bySource,bySignalModel,unknownTypeCodes:[...unknownTypeCodes].sort(),lowConfidenceCount:lowConfidence.length,lowConfidence:lowConfidence.slice(0,200)};
  }

  global.AstroTargetMetadata={TYPE_META,CLASS_LABELS,PHYSICAL_LABELS,metadataForObject,projectMetadata,prepareSignalData,attach,attachPool,indexPool,audit,signalSummary,meanSurfaceBrightness,photoClassLabel:key=>CLASS_LABELS[key]||CLASS_LABELS.mixed,physicalLabel:key=>PHYSICAL_LABELS[key]||PHYSICAL_LABELS.other};
})(window);
