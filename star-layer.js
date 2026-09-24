(function(global){
  'use strict';

  // AstroPlanner v0.11.2 — lightweight stellar layer.
  // Star data: HYG v4.1 (David Nash / Astronexus), CC BY-SA 4.0.
  // Compact x,y,z,B-V,mag binary prepared by bryancurran/celestial-cartography.
  const STAR_URL='https://raw.githubusercontent.com/bryancurran/celestial-cartography/main/stars.bin';
  const STAR_CACHE='astroplanner-stars-v01';
  const BIN_RA=5, BIN_DEC=5, RA_BINS=72, DEC_BINS=36;
  const D2R=Math.PI/180,R2D=180/Math.PI;
  let status='idle', loadPromise=null, data=new Float32Array(0), bins=null, count=0, errorText='';

  const finite=v=>Number.isFinite(Number(v));
  const normRa=v=>((Number(v)%360)+360)%360;
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const binIndex=(ra,dec)=>{
    const rb=Math.min(RA_BINS-1,Math.max(0,Math.floor(normRa(ra)/BIN_RA)));
    const db=Math.min(DEC_BINS-1,Math.max(0,Math.floor((clamp(Number(dec),-90,90)+90)/BIN_DEC)));
    return db*RA_BINS+rb;
  };
  function buildBins(arr,n){
    const out=Array.from({length:RA_BINS*DEC_BINS},()=>[]);
    for(let i=0;i<n;i++)out[binIndex(arr[i*3],arr[i*3+1])].push(i);
    return out;
  }
  function parseBuffer(buffer){
    if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<4)throw new Error('Nieprawidłowy plik katalogu gwiazd.');
    const dv=new DataView(buffer),declared=dv.getUint32(0,true),stride=20,available=Math.floor((buffer.byteLength-4)/stride);
    if(!declared||declared>available)throw new Error('Niepełny plik katalogu gwiazd.');
    const tmp=new Float32Array(declared*3);let n=0,off=4;
    for(let i=0;i<declared;i++,off+=stride){
      const x=dv.getFloat32(off,true),y=dv.getFloat32(off+4,true),z=dv.getFloat32(off+8,true),mag=dv.getFloat32(off+16,true);
      if(![x,y,z,mag].every(Number.isFinite))continue;
      const r=Math.hypot(x,y,z);if(!(r>0))continue;
      let ra=Math.atan2(y,x)*R2D;if(ra<0)ra+=360;
      const dec=Math.asin(clamp(z/r,-1,1))*R2D;
      tmp[n*3]=ra;tmp[n*3+1]=dec;tmp[n*3+2]=mag;n++;
    }
    return{data:tmp.slice(0,n*3),count:n};
  }
  function setCatalog(parsed){
    data=parsed?.data instanceof Float32Array?parsed.data:new Float32Array(0);
    count=Math.floor(data.length/3);
    bins=buildBins(data,count);
  }
  function dispatch(name,detail={}){try{global.dispatchEvent(new CustomEvent(name,{detail}));}catch(_){} }
  async function load(){
    if(status==='ready')return true;
    if(loadPromise)return loadPromise;
    status='loading';errorText='';dispatch('astro-stars-status',{status});
    loadPromise=(async()=>{
      try{
        let response=null,cache=null;
        try{if('caches'in global){cache=await caches.open(STAR_CACHE);response=await cache.match(STAR_URL);}}catch(_){}
        if(!response){
          response=await fetch(STAR_URL,{mode:'cors',cache:'no-cache'});
          if(!response.ok)throw new Error('HTTP '+response.status);
          try{if(cache)await cache.put(STAR_URL,response.clone());}catch(_){}
        }
        const parsed=parseBuffer(await response.arrayBuffer());
        if(parsed.count<1000)throw new Error('Katalog zawiera zbyt mało gwiazd.');
        setCatalog(parsed);status='ready';dispatch('astro-stars-ready',{status,count,source:'HYG v4.1'});dispatch('astro-stars-status',{status,count});return true;
      }catch(err){
        status='error';errorText=String(err?.message||err||'Błąd katalogu');dispatch('astro-stars-status',{status,error:errorText});return false;
      }finally{loadPromise=null;}
    })();
    return loadPromise;
  }
  function candidateRaBins(centerRa,centerDec,radius){
    const c=Math.max(.02,Math.cos(Number(centerDec)*D2R)),span=Math.min(180,Number(radius)/c+BIN_RA);
    if(span>=179)return Array.from({length:RA_BINS},(_,i)=>i);
    const a=normRa(centerRa-span),b=normRa(centerRa+span),out=[];
    for(let i=0;i<RA_BINS;i++){
      const mid=(i+.5)*BIN_RA;
      const inRange=a<=b?(mid>=a&&mid<=b):(mid>=a||mid<=b);
      if(inRange)out.push(i);
    }
    return out;
  }
  function query(centerRa,centerDec,radiusDeg,magLimit=11){
    if(status!=='ready'||!bins||!finite(centerRa)||!finite(centerDec)||!(Number(radiusDeg)>0))return[];
    const ra0=normRa(centerRa)*D2R,dec0=Number(centerDec)*D2R,radius=clamp(Number(radiusDeg),.02,45),cosLimit=Math.cos(radius*D2R),sin0=Math.sin(dec0),cos0=Math.cos(dec0);
    const db0=Math.max(0,Math.floor((clamp(Number(centerDec)-radius,-90,90)+90)/BIN_DEC));
    const db1=Math.min(DEC_BINS-1,Math.floor((clamp(Number(centerDec)+radius,-90,90)+90)/BIN_DEC));
    const rbs=candidateRaBins(centerRa,centerDec,radius),out=[];
    for(let db=db0;db<=db1;db++)for(const rb of rbs){
      const bucket=bins[db*RA_BINS+rb];
      for(const i of bucket){
        const ra=data[i*3],dec=data[i*3+1],mag=data[i*3+2];if(mag>magLimit)continue;
        let dra=ra*D2R-ra0;while(dra>Math.PI)dra-=2*Math.PI;while(dra<-Math.PI)dra+=2*Math.PI;
        const dr=dec*D2R,cosDist=sin0*Math.sin(dr)+cos0*Math.cos(dr)*Math.cos(dra);
        if(cosDist>=cosLimit)out.push({raDeg:ra,decDeg:dec,mag});
      }
    }
    out.sort((a,b)=>a.mag-b.mag);
    return out;
  }
  function getStatus(){return{status,count,error:errorText,source:'HYG v4.1',url:STAR_URL};}
  function magnitudeLimit(radiusDeg){
    // LOD based on the real angular radius of the visible map, not UI zoom %.
    // Wide fields deliberately keep only the stars that define the constellation/field pattern.
    const r=Number(radiusDeg)||3;
    if(r>15)return 5.8;
    if(r>10)return 6.3;
    if(r>7)return 6.8;
    if(r>5)return 7.3;
    if(r>3)return 8.0;
    if(r>1.5)return 9.0;
    if(r>.7)return 10.0;
    return 11.0;
  }

  global.AstroStarLayer={load,query,getStatus,magnitudeLimit,parseBuffer,sourceUrl:STAR_URL,cacheName:STAR_CACHE};
  // Load opportunistically; failures never block the rest of AstroPlanner.
  setTimeout(()=>load(),0);
})(window);
