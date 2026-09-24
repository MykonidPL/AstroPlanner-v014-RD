(function(global){
  'use strict';
  const D2R=Math.PI/180;
  const BIN_RA=5,BIN_DEC=5,RA_BINS=72,DEC_BINS=36;
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)));
  const finite=v=>Number.isFinite(Number(v));
  const normRa=v=>((Number(v)%360)+360)%360;
  let records=[],bins=Array.from({length:RA_BINS*DEC_BINS},()=>[]),version=0;

  function binIndex(ra,dec){
    const rb=Math.min(RA_BINS-1,Math.max(0,Math.floor(normRa(ra)/BIN_RA)));
    const db=Math.min(DEC_BINS-1,Math.max(0,Math.floor((clamp(dec,-90,90)+90)/BIN_DEC)));
    return db*RA_BINS+rb;
  }
  function cleanLabel(o){
    if(Number.isFinite(Number(o?.m))&&Number(o.m)>0)return`M${Number(o.m)}`;
    const vals=[o?.mapLabel,o?.name,...(Array.isArray(o?.aliases)?o.aliases:[])].filter(Boolean).map(x=>String(x).trim());
    const pats=[/^NGC\s*0*\d+/i,/^IC\s*0*\d+/i,/^LDN\s*0*\d+/i,/^LBN\s*0*\d+/i,/^Sh\s*2[-\s]?0*\d+/i,/^vdB\s*0*\d+/i,/^RCW\s*0*\d+/i,/^(?:Barnard|B)\s*0*\d+/i,/^(?:Abell|ACO)\s*0*\d+/i];
    for(const re of pats){const v=vals.find(x=>re.test(x));if(v)return v.replace(/\s+/g,' ').replace(/^Sh\s*2[-\s]*/i,'Sh2-');}
    const first=vals[0]||'DSO';
    return first.length>28?first.slice(0,27)+'…':first;
  }
  function classify(o){
    const code=String(o?.typeCode||'').trim(),t=String(o?.type||'').toLowerCase();
    if(['G','GPair','GTrpl','GGroup','GCluster'].includes(code))return code==='GCluster'?'galaxy-cluster':code==='G'?'galaxy':'galaxy-group';
    if(t.includes('gromada galakty'))return'galaxy-cluster';if(t.includes('galakty'))return'galaxy';
    if(code==='OCl'||t.includes('gromada otwarta'))return'open-cluster';
    if(code==='GCl'||t.includes('gromada kulista'))return'globular-cluster';
    if(code==='PN'||t.includes('planetarna'))return'planetary-nebula';
    if(code==='SNR'||t.includes('supernow'))return'snr';
    if(['HII','Neb','EmN','RfN','DrkN','Cl+N'].includes(code)||t.includes('mgław')||t.includes('mglaw'))return'nebula';
    if(code==='**'||t.includes('podwójn'))return'double-star';
    return'other';
  }
  function catalogTier(o,label,kind,majorAxisArcmin){
    if(Number.isFinite(Number(o?.m))&&Number(o.m)>0)return 0;
    if(o?.custom)return 0;
    const txt=String(label||'').trim(),groups=Array.isArray(o?.groups)?o.groups.map(x=>String(x).toLowerCase()):[];
    if(/^M\s*\d+/i.test(txt))return 0;
    if(/^(?:NGC|IC)\s*\d+/i.test(txt)||groups.includes('openngc'))return 1;
    if(/^(?:Sh2-|Sh\s*2|vdB|RCW)\s*\d+/i.test(txt))return 2;
    if(/^(?:Abell|ACO)\s*\d+/i.test(txt))return 2;
    if(/^(?:LDN|LBN|Barnard|B)\s*\d+/i.test(txt))return 3;
    if(kind==='galaxy'&&Number(majorAxisArcmin)>=8)return 1;
    return 2;
  }
  function normalizeObject(o,i){
    const ra=Number(o?.raDeg),dec=Number(o?.decDeg);if(!finite(ra)||!finite(dec)||dec<-90||dec>90)return null;
    const maj=finite(o?.majorAxisArcmin)&&Number(o.majorAxisArcmin)>0?Number(o.majorAxisArcmin):null;
    const min=finite(o?.minorAxisArcmin)&&Number(o.minorAxisArcmin)>0?Number(o.minorAxisArcmin):(maj||null);
    const pa=finite(o?.positionAngleDeg)?((Number(o.positionAngleDeg)%180)+180)%180:null;
    const mag=finite(o?.mag)?Number(o.mag):null;
    const groups=Array.isArray(o?.groups)?o.groups.map(x=>String(x).toLowerCase()):[];
    const kind=classify(o),label=cleanLabel(o),detailTier=catalogTier(o,label,kind,maj);
    const priority=(Number.isFinite(Number(o?.m))? -100:0)+(o?.custom?-70:0)+(detailTier*15)+(maj? -Math.min(30,maj/8):0)+(mag!=null?mag:18);
    return{id:String(o?.uid||o?.id||`${label}:${ra.toFixed(6)}:${dec.toFixed(6)}:${i}`),raDeg:normRa(ra),decDeg:dec,label,name:String(o?.name||label),type:String(o?.type||''),typeCode:String(o?.typeCode||''),kind,mag,majorAxisArcmin:maj,minorAxisArcmin:min,positionAngleDeg:pa,groups,custom:!!o?.custom,m:Number.isFinite(Number(o?.m))?Number(o.m):null,detailTier,priority};
  }
  function setObjects(objects){
    const next=[],seen=new Set();
    for(let i=0;i<(Array.isArray(objects)?objects.length:0);i++){
      const r=normalizeObject(objects[i],i);if(!r)continue;
      const key=`${r.label.toLowerCase()}|${r.raDeg.toFixed(4)}|${r.decDeg.toFixed(4)}`;if(seen.has(key))continue;seen.add(key);next.push(r);
    }
    records=next;bins=Array.from({length:RA_BINS*DEC_BINS},()=>[]);
    for(let i=0;i<records.length;i++)bins[binIndex(records[i].raDeg,records[i].decDeg)].push(i);
    version++;
    try{global.dispatchEvent(new CustomEvent('astro-dso-ready',{detail:{count:records.length,version}}));}catch(_){}
    return records.length;
  }
  function candidateRaBins(centerRa,centerDec,radius){
    const c=Math.max(.03,Math.cos(Number(centerDec)*D2R)),span=Math.min(180,Number(radius)/c+BIN_RA);
    if(span>=179)return Array.from({length:RA_BINS},(_,i)=>i);
    const a=normRa(centerRa-span),b=normRa(centerRa+span),out=[];
    for(let i=0;i<RA_BINS;i++){const mid=(i+.5)*BIN_RA;if(a<=b?(mid>=a&&mid<=b):(mid>=a||mid<=b))out.push(i);}
    return out;
  }
  function profile(radiusDeg,viewportWidth,viewportHeight){
    // DSO level-of-detail is based on the real angular radius of the map.
    // symbolTier and labelTier are intentionally different: seeing a marker does not
    // automatically mean its label deserves screen space. 0=Messier/custom, 1=NGC/IC,
    // 2=Sh2/vdB/RCW/Abell/other, 3=LDN/LBN/Barnard and similarly dense catalogues.
    const r=Number(radiusDeg)||4;
    let base;
    if(r>15)base={limit:45,magLimit:8.5,symbolTier:0,labelTier:0,labelLimit:5,largeArcmin:45,brightMag:6.5,unknownMinArcmin:40};
    else if(r>9)base={limit:70,magLimit:10,symbolTier:1,labelTier:0,labelLimit:6,largeArcmin:35,brightMag:7.5,unknownMinArcmin:25};
    else if(r>6)base={limit:100,magLimit:11.5,symbolTier:1,labelTier:0,labelLimit:8,largeArcmin:25,brightMag:8.5,unknownMinArcmin:16};
    else if(r>4)base={limit:150,magLimit:13,symbolTier:2,labelTier:1,labelLimit:11,largeArcmin:18,brightMag:9.5,unknownMinArcmin:10};
    else if(r>2.2)base={limit:230,magLimit:15.5,symbolTier:2,labelTier:2,labelLimit:15,largeArcmin:10,brightMag:11,unknownMinArcmin:5};
    else if(r>1.1)base={limit:340,magLimit:18,symbolTier:3,labelTier:2,labelLimit:20,largeArcmin:5,brightMag:13,unknownMinArcmin:2};
    else base={limit:520,magLimit:20,symbolTier:3,labelTier:3,labelLimit:28,largeArcmin:0,brightMag:20,unknownMinArcmin:0};
    const vw=Number(viewportWidth)||0,vh=Number(viewportHeight)||0;
    if(!(vw>0&&vh>0))return base;
    const areaFactor=clamp((vw*vh)/(330*390),.75,2.4);
    let symbolBase=24,labelBase=6,spacing=24;
    if(r>15){symbolBase=12;labelBase=3;spacing=30;}
    else if(r>9){symbolBase=18;labelBase=4;spacing=28;}
    else if(r>6){symbolBase=24;labelBase=5;spacing=26;}
    else if(r>4){symbolBase=34;labelBase=7;spacing=24;}
    else if(r>2.2){symbolBase=52;labelBase=10;spacing=20;}
    else if(r>1.1){symbolBase=74;labelBase=14;spacing=16;}
    else{symbolBase=110;labelBase=20;spacing=12;}
    return{...base,screenSymbolLimit:Math.max(8,Math.min(base.limit,Math.round(symbolBase*areaFactor))),screenLabelLimit:Math.max(2,Math.min(base.labelLimit,Math.round(labelBase*Math.pow(areaFactor,.72)))),symbolSpacing:spacing};
  }
  function query(centerRa,centerDec,radiusDeg){
    if(!records.length||!finite(centerRa)||!finite(centerDec)||!(Number(radiusDeg)>0))return[];
    const radius=clamp(radiusDeg,.02,45),p=profile(radius),ra0=normRa(centerRa)*D2R,dec0=Number(centerDec)*D2R,cosLimit=Math.cos(radius*D2R),sin0=Math.sin(dec0),cos0=Math.cos(dec0);
    const db0=Math.max(0,Math.floor((clamp(Number(centerDec)-radius,-90,90)+90)/BIN_DEC)),db1=Math.min(DEC_BINS-1,Math.floor((clamp(Number(centerDec)+radius,-90,90)+90)/BIN_DEC)),rbs=candidateRaBins(centerRa,centerDec,radius),out=[];
    for(let db=db0;db<=db1;db++)for(const rb of rbs)for(const idx of bins[db*RA_BINS+rb]){
      const o=records[idx];
      let dra=o.raDeg*D2R-ra0;while(dra>Math.PI)dra-=2*Math.PI;while(dra<-Math.PI)dra+=2*Math.PI;
      const dr=o.decDeg*D2R,cosDist=sin0*Math.sin(dr)+cos0*Math.cos(dr)*Math.cos(dra);if(cosDist<cosLimit)continue;
      const isPrimary=!!(o.m||o.custom),large=Number(o.majorAxisArcmin)>=Number(p.largeArcmin||0),bright=o.mag!=null&&Number(o.mag)<=Number(p.brightMag||-99),tierAllowed=Number(o.detailTier||0)<=Number(p.symbolTier||0);
      if(!isPrimary&&!tierAllowed&&!large&&!bright)continue;
      if(o.mag!=null&&o.mag>p.magLimit&&!isPrimary&&!large)continue;
      if(o.mag==null&&o.majorAxisArcmin==null&&!isPrimary&&Number(o.detailTier||9)>Number(p.symbolTier||0))continue;
      if(o.mag==null&&o.majorAxisArcmin!=null&&o.majorAxisArcmin<p.unknownMinArcmin&&!isPrimary&&!tierAllowed)continue;
      const dist=Math.acos(clamp(cosDist,-1,1))/D2R;out.push({...o,distanceDeg:dist});
    }
    out.sort((a,b)=>a.priority-b.priority||a.distanceDeg-b.distanceDeg||a.label.localeCompare(b.label));
    return out.slice(0,p.limit);
  }
  function getStatus(){return{status:records.length?'ready':'empty',count:records.length,version};}
  global.AstroDsoLayer={setObjects,query,getStatus,profile,classify};
})(window);
