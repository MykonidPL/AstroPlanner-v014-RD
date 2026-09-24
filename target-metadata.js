/* AstroPlanner v0.14 R&D — photographic metadata for every catalogue object.
 * The module does not duplicate the sky catalogues. It deterministically derives
 * metadata from the exact typeCode/type/catalogueGroups already present in the
 * loaded OpenNGC, Stellarium supplement and Abell-PN layers, with a small curated
 * override table only for compound or historically ambiguous photographic targets.
 */
(function(global){
  'use strict';

  const CLASS_LABELS={
    emission:'emisja',
    broadband:'szerokie pasmo',
    dust:'pyły / refleksy',
    mixed:'mieszany / niejednoznaczny'
  };

  const PHYSICAL_LABELS={
    galaxy:'galaktyka',
    'galaxy-pair':'para galaktyk',
    'galaxy-triplet':'tryplet galaktyk',
    'galaxy-group':'grupa galaktyk',
    'galaxy-cluster':'gromada galaktyk',
    'open-cluster':'gromada otwarta',
    'globular-cluster':'gromada kulista',
    'stellar-association':'asocjacja gwiazdowa',
    'cluster-nebulosity':'gromada z mgławicą',
    'planetary-nebula':'mgławica planetarna',
    'hii-region':'region H II',
    'emission-nebula':'mgławica emisyjna',
    'reflection-nebula':'mgławica refleksyjna',
    'dark-nebula':'mgławica ciemna / pyłowa',
    'supernova-remnant':'pozostałość po supernowej',
    'nebula-unspecified':'mgławica — typ nieokreślony',
    star:'gwiazda',
    'double-star':'gwiazda podwójna',
    nova:'nowa',
    'nonexistent':'obiekt nieistniejący / błędny wpis',
    duplicate:'duplikat katalogowy',
    other:'inny / nieokreślony'
  };

  // Complete OpenNGC type vocabulary used by AstroPlanner's pinned catalogue,
  // plus the star/double-star types used by built-in/custom records.
  const TYPE_META={
    G:{physicalType:'galaxy',photoClass:'broadband',signalKind:'continuum'},
    GPair:{physicalType:'galaxy-pair',photoClass:'broadband',signalKind:'continuum'},
    GTrpl:{physicalType:'galaxy-triplet',photoClass:'broadband',signalKind:'continuum'},
    GGroup:{physicalType:'galaxy-group',photoClass:'broadband',signalKind:'continuum'},
    GCluster:{physicalType:'galaxy-cluster',photoClass:'broadband',signalKind:'continuum'},
    OCl:{physicalType:'open-cluster',photoClass:'broadband',signalKind:'continuum'},
    GCl:{physicalType:'globular-cluster',photoClass:'broadband',signalKind:'continuum'},
    '*Ass':{physicalType:'stellar-association',photoClass:'broadband',signalKind:'continuum'},
    'Cl+N':{physicalType:'cluster-nebulosity',photoClass:'mixed',signalKind:'mixed'},
    PN:{physicalType:'planetary-nebula',photoClass:'emission',signalKind:'line'},
    HII:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    EmN:{physicalType:'emission-nebula',photoClass:'emission',signalKind:'line'},
    RfN:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},
    DrkN:{physicalType:'dark-nebula',photoClass:'dust',signalKind:'continuum'},
    SNR:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},
    Neb:{physicalType:'nebula-unspecified',photoClass:'mixed',signalKind:'mixed'},
    '*':{physicalType:'star',photoClass:'broadband',signalKind:'continuum'},
    '**':{physicalType:'double-star',photoClass:'broadband',signalKind:'continuum'},
    Nova:{physicalType:'nova',photoClass:'broadband',signalKind:'continuum'},
    NonEx:{physicalType:'nonexistent',photoClass:'mixed',signalKind:'mixed'},
    Dup:{physicalType:'duplicate',photoClass:'mixed',signalKind:'mixed'},
    Other:{physicalType:'other',photoClass:'mixed',signalKind:'mixed'}
  };

  // Curated exceptions are for photographic nature that a generic catalogue type
  // cannot express correctly (for example M45 = open cluster + reflection dust).
  // The table is identity-based and therefore applies regardless of source catalogue.
  const CURATED={
    m1:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},
    ngc1952:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},
    m8:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    ngc6523:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    m16:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    ngc6611:{physicalType:'cluster-nebulosity',photoClass:'mixed',signalKind:'mixed'},
    m17:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    ngc6618:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    m20:{physicalType:'cluster-nebulosity',photoClass:'mixed',signalKind:'mixed'},
    ngc6514:{physicalType:'cluster-nebulosity',photoClass:'mixed',signalKind:'mixed'},
    m42:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    ngc1976:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    m43:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    ngc1982:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    m45:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},
    ngc1432:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},
    ngc1435:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},
    m78:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},
    ngc2068:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},
    ngc6960:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},
    ngc6974:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},
    ngc6979:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},
    ngc6992:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},
    ngc6995:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'},
    ngc7000:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    ngc6888:{physicalType:'emission-nebula',photoClass:'emission',signalKind:'line'},
    ngc7023:{physicalType:'reflection-nebula',photoClass:'dust',signalKind:'continuum'},
    ic1805:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    ic1848:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    ic434:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    ic5067:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    ic5070:{physicalType:'hii-region',photoClass:'emission',signalKind:'line'},
    b33:{physicalType:'dark-nebula',photoClass:'dust',signalKind:'continuum'},
    ctb1:{physicalType:'supernova-remnant',photoClass:'emission',signalKind:'line'}
  };

  const strip=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').replace(/Ł/g,'L').toLowerCase();
  const compact=value=>strip(value).replace(/[^a-z0-9]+/g,'');

  function identityTokens(objOrText){
    const texts=[];
    if(typeof objOrText==='string')texts.push(objOrText);
    else if(objOrText){
      for(const k of ['name','displayName','catalogId','catalogUid','id','uid'])if(objOrText[k])texts.push(objOrText[k]);
      if(Array.isArray(objOrText.aliases))texts.push(...objOrText.aliases);
    }
    const out=new Set();
    for(const raw of texts){
      const s=strip(raw);if(!s)continue;
      const pats=[
        [/\bm\s*0*(\d{1,3})\b/g,'m'],[/\bngc\s*0*(\d+)\b/g,'ngc'],[/\bic\s*0*(\d+)\b/g,'ic'],
        [/\bsh\s*2[-\s]*0*(\d+)\b/g,'sh2'],[/\bldn\s*0*(\d+)\b/g,'ldn'],[/\blbn\s*0*(\d+)\b/g,'lbn'],
        [/\bvdb\s*0*(\d+)\b/g,'vdb'],[/\brcw\s*0*(\d+)\b/g,'rcw'],[/\bctb\s*0*(\d+)\b/g,'ctb'],
        [/\b(?:barnard|b)\s*0*(\d+)\b/g,'b'],[/\b(?:abell\s*pn|pn\s*a66|a66)[-\s]*0*(\d+)\b/g,'abellpn'],
        [/\b(?:abell|aco)\s*0*(\d+)\b/g,'abell']
      ];
      for(const [re,prefix] of pats){let m;while((m=re.exec(s)))out.add(prefix+String(Number(m[1])));}
      const c=compact(s);if(c)out.add(c);
    }
    return [...out];
  }

  function curatedFor(obj){
    for(const token of identityTokens(obj)){
      if(CURATED[token])return{...CURATED[token],identity:token};
      // Names can contain a canonical identifier followed by a common name.
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

  const metadataCache=new Map();
  function stableCacheKey(obj){
    const ids=identityTokens(obj).slice(0,4).join('|');
    return [ids,String(obj?.typeCode||obj?.objectType||''),String(obj?.type||obj?.typeName||''),String(obj?.catalog||''),(obj?.groups||[]).join(',')].join('::');
  }

  function metadataForObject(obj={}){
    const key=stableCacheKey(obj);if(metadataCache.has(key))return metadataCache.get(key);
    const override=curatedFor(obj);
    const typeCode=String(obj.typeCode||obj.objectType||'').trim();
    const codeMeta=TYPE_META[typeCode]||null;
    const groupMeta=metaFromGroups(obj.groups||obj.catalogueGroups,obj.catalog||obj.catalogSource);
    const textMeta=metaFromText(obj.type||obj.typeName||obj.typeLabel);
    let base=override||codeMeta||groupMeta||textMeta||TYPE_META.Other;
    let source=override?'curated':codeMeta?'catalog-type':groupMeta?'catalog-group':textMeta?'catalog-text':'fallback';
    let confidence=override||codeMeta?'high':groupMeta||textMeta?'medium':'low';
    if(typeCode==='Neb'||typeCode==='Other'||typeCode==='Cl+N')confidence=override?'high':'low';
    const meta=Object.freeze({
      physicalType:base.physicalType,
      physicalLabel:PHYSICAL_LABELS[base.physicalType]||PHYSICAL_LABELS.other,
      photoClass:base.photoClass,
      photoClassLabel:CLASS_LABELS[base.photoClass]||CLASS_LABELS.mixed,
      signalKind:base.signalKind,
      confidence,source,
      rawTypeCode:typeCode||null,
      rawType:String(obj.type||obj.typeName||obj.typeLabel||'')||null,
      catalog:String(obj.catalog||obj.catalogSource||''),
      groups:Array.isArray(obj.groups)?[...obj.groups]:Array.isArray(obj.catalogueGroups)?[...obj.catalogueGroups]:[],
      identities:identityTokens(obj),
      curatedIdentity:override?.identity||null
    });
    metadataCache.set(key,meta);return meta;
  }

  let indexedCount=-1,indexByToken=new Map(),indexRows=[];
  function indexPool(pool){
    const rows=Array.isArray(pool)?pool:[];
    // Rebuild when the loaded catalogue changes size; catalogObjectPool is deterministic.
    if(indexedCount===rows.length&&indexRows.length===rows.length)return;
    indexedCount=rows.length;indexByToken=new Map();indexRows=[];
    for(const object of rows){
      const meta=object?.photoMeta||metadataForObject(object),row={object,meta};indexRows.push(row);
      for(const token of meta.identities)if(!indexByToken.has(token))indexByToken.set(token,row);
    }
  }

  function attach(object){return object?.photoMeta?object:{...object,photoMeta:metadataForObject(object)};}
  function attachPool(pool){const rows=(Array.isArray(pool)?pool:[]).map(attach);indexPool(rows);return rows;}

  function parseRA(value){const t=String(value??'').trim(),p=t.split(/[:\s]+/).map(Number);return t&&p.length&&!p.some(Number.isNaN)?15*(p[0]+(p[1]||0)/60+(p[2]||0)/3600):NaN;}
  function parseDec(value){const t=String(value??'').trim();if(!t)return NaN;const neg=t.startsWith('-'),p=t.replace(/^[+-]/,'').split(/[:\s]+/).map(Number);if(!p.length||p.some(Number.isNaN))return NaN;const v=p[0]+(p[1]||0)/60+(p[2]||0)/3600;return neg?-v:v;}

  function projectMetadata(project,pool){
    const target=project?.target||{};
    const pseudo={name:target.name||project?.name||'',aliases:[target.name||''],type:target.type||'',typeCode:target.typeCode||'',catalog:target.catalog||'',groups:target.groups||[],catalogUid:target.catalogUid||''};
    const direct=metadataForObject(pseudo);
    // A curated identity must never be diluted by a generic catalog match.
    if(direct.source==='curated')return direct;
    const rows=Array.isArray(pool)?pool:(typeof global.catalogObjectPool==='function'?global.catalogObjectPool():[]);indexPool(rows);
    for(const token of identityTokens(pseudo)){const row=indexByToken.get(token);if(row)return row.meta;}
    const ra=parseRA(target.ra),dec=parseDec(target.dec);
    if(Number.isFinite(ra)&&Number.isFinite(dec)){
      let best=null,bestDist=.08;
      const c=Math.cos(dec*Math.PI/180);
      for(const row of indexRows){const o=row.object;if(!Number.isFinite(Number(o?.raDeg))||!Number.isFinite(Number(o?.decDeg)))continue;const dra=Math.abs(Number(o.raDeg)-ra)*c,ddec=Math.abs(Number(o.decDeg)-dec),dist=Math.hypot(dra,ddec);if(dist<bestDist){bestDist=dist;best=row;}}
      if(best)return best.meta;
    }
    return direct;
  }

  function audit(pool){
    const rows=attachPool(pool||[]),byClass={},byPhysical={},byTypeCode={},bySource={},unknownTypeCodes=new Set(),lowConfidence=[];
    for(const o of rows){const m=o.photoMeta;byClass[m.photoClass]=(byClass[m.photoClass]||0)+1;byPhysical[m.physicalType]=(byPhysical[m.physicalType]||0)+1;bySource[m.source]=(bySource[m.source]||0)+1;const tc=m.rawTypeCode||'(brak)';byTypeCode[tc]=(byTypeCode[tc]||0)+1;if(m.source==='fallback'&&m.rawTypeCode)unknownTypeCodes.add(m.rawTypeCode);if(m.confidence==='low')lowConfidence.push({name:o.name||o.label||o.id||'?',typeCode:m.rawTypeCode,type:m.rawType,photoClass:m.photoClass});}
    return{total:rows.length,byClass,byPhysical,byTypeCode,bySource,unknownTypeCodes:[...unknownTypeCodes].sort(),lowConfidenceCount:lowConfidence.length,lowConfidence:lowConfidence.slice(0,200)};
  }

  global.AstroTargetMetadata={
    TYPE_META,CLASS_LABELS,PHYSICAL_LABELS,metadataForObject,projectMetadata,attach,attachPool,indexPool,audit,
    photoClassLabel:key=>CLASS_LABELS[key]||CLASS_LABELS.mixed,
    physicalLabel:key=>PHYSICAL_LABELS[key]||PHYSICAL_LABELS.other
  };
})(window);
