/* AstroPlanner v0.14 R&D — Stage 4B.7z standalone IFN field lookup.
 *
 * Scope of this microstage:
 * - load and validate the frozen IFN SFD field manifest + binary asset;
 * - map ICRS RA/Dec -> HEALPix NSIDE=256 RING pixel;
 * - read interleaved little-endian Float32 meanI100/stdI100;
 * - compute the frozen IFN signal-time factor;
 * - fail closed to the neutral contract on missing/corrupt data.
 *
 * Intentionally NOT integrated with index.html, service worker, Score,
 * recommendations, or target-metadata.js in this stage.
 */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(root)root.AstroIfnField=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const VERSION='4B.7z-standalone-1';
  const MODEL='ifn-sfd-i100';
  const MANIFEST_URL='./ifn-sfd-field-v1.json';
  const BINARY_URL='./ifn-sfd-field-v1.bin';
  const NSIDE=256;
  const NPIX=12*NSIDE*NSIDE;
  const ORDERING='RING';
  const FRAME='ICRS';
  const BYTES_PER_RECORD=8;
  const EXPECTED_BYTE_LENGTH=NPIX*BYTES_PER_RECORD;
  const REF_I100=3.0;
  const TAU_PER_I100=0.07;
  const MIN_FACTOR=0.25;
  const MAX_FACTOR=4.0;
  const REF_SIGNAL=-Math.expm1(-(TAU_PER_I100*REF_I100));

  const freeze=value=>Object.freeze(value);
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const finite=value=>Number.isFinite(Number(value));

  function neutral(reason='unavailable'){
    return freeze({
      model:MODEL,
      status:'missing',
      confidence:'low',
      pixel:null,
      meanI100:null,
      stdI100:null,
      signalTimeFactor:1.0,
      reason
    });
  }

  function normalizeRaDeg(value){
    const n=Number(value);
    if(!Number.isFinite(n))return NaN;
    return ((n%360)+360)%360;
  }

  function healpixAng2pixRing(nside,theta,phi){
    if(!Number.isInteger(nside)||nside<=0)throw new RangeError('nside must be a positive integer');
    if(!Number.isFinite(theta)||theta<0||theta>Math.PI)throw new RangeError('theta out of range');
    if(!Number.isFinite(phi))throw new RangeError('phi must be finite');

    const npix=12*nside*nside;
    const ncap=2*nside*(nside-1);
    const z=Math.cos(theta);
    const za=Math.abs(z);
    const twoPi=2*Math.PI;
    const wrappedPhi=((phi%twoPi)+twoPi)%twoPi;
    const tt=wrappedPhi/(Math.PI/2);

    if(za<=2/3){
      const temp1=nside*(0.5+tt);
      const temp2=nside*z*0.75;
      const jp=Math.floor(temp1-temp2);
      const jm=Math.floor(temp1+temp2);
      const ir=nside+1+jp-jm;
      const kshift=1-(ir&1);
      let ip=Math.floor((jp+jm-nside+kshift+1)/2);
      ip=((ip%(4*nside))+(4*nside))%(4*nside);
      return ncap+(ir-1)*4*nside+ip;
    }

    const tp=tt-Math.floor(tt);
    const tmp=nside*Math.sqrt(3*(1-za));
    const jp=Math.floor(tp*tmp);
    const jm=Math.floor((1-tp)*tmp);
    const ir=jp+jm+1;
    const ip=Math.floor(tt*ir)%(4*ir);
    if(z>0)return 2*ir*(ir-1)+ip;
    return npix-2*ir*(ir+1)+ip;
  }

  function healpixPixelForIcrs(raDeg,decDeg){
    const ra=normalizeRaDeg(raDeg);
    const dec=Number(decDeg);
    if(!Number.isFinite(ra)||!Number.isFinite(dec)||dec<-90||dec>90)return null;
    const theta=(90-dec)*Math.PI/180;
    const phi=ra*Math.PI/180;
    const pixel=healpixAng2pixRing(NSIDE,theta,phi);
    return Number.isInteger(pixel)&&pixel>=0&&pixel<NPIX?pixel:null;
  }

  function signalTimeFactorFromI100(i100){
    const value=Number(i100);
    if(!Number.isFinite(value)||value<=0)return 1.0;
    const signal=-Math.expm1(-(TAU_PER_I100*value));
    if(!Number.isFinite(signal)||signal<=0)return 1.0;
    const raw=Math.sqrt(REF_SIGNAL/signal);
    if(!Number.isFinite(raw))return 1.0;
    return clamp(raw,MIN_FACTOR,MAX_FACTOR);
  }

  function assertManifest(manifest){
    const fail=message=>{throw new Error(`IFN manifest invalid: ${message}`);};
    if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))fail('root object missing');
    if(manifest.schemaVersion!==1)fail('schemaVersion');
    if(manifest.model!==MODEL)fail('model');
    if(manifest.fullSky!==true)fail('fullSky');
    if(manifest.buildComplete!==true)fail('buildComplete');

    const grid=manifest.grid;
    if(!grid||grid.type!=='HEALPix'||grid.nside!==NSIDE||grid.npix!==NPIX||grid.ordering!==ORDERING||grid.frame!==FRAME)fail('grid contract');

    const binary=manifest.binary;
    if(!binary||binary.filename!=='ifn-sfd-field-v1.bin')fail('binary filename');
    if(binary.dtype!=='Float32'||binary.endianness!=='little')fail('binary dtype/endianness');
    if(binary.layout!=='interleaved meanI100,stdI100')fail('binary layout');
    if(!Array.isArray(binary.fields)||binary.fields.length!==2||binary.fields[0]!=='meanI100'||binary.fields[1]!=='stdI100')fail('binary fields');
    if(binary.bytesPerRecord!==BYTES_PER_RECORD||binary.recordCount!==NPIX||binary.byteLength!==EXPECTED_BYTE_LENGTH)fail('binary dimensions');
    if(typeof binary.sha256!=='string'||!/^[0-9a-f]{64}$/i.test(binary.sha256))fail('binary sha256');

    const validation=manifest.validation;
    if(!validation||validation.allFinite!==true||validation.recordCountExact!==true||validation.expectedRecordCount!==NPIX||validation.expectedByteLength!==EXPECTED_BYTE_LENGTH||validation.actualByteLength!==EXPECTED_BYTE_LENGTH||validation.sha256Verified!==true)fail('validation block');

    return manifest;
  }

  async function sha256Hex(arrayBuffer,cryptoObject){
    const subtle=cryptoObject&&cryptoObject.subtle;
    if(!subtle||typeof subtle.digest!=='function')throw new Error('Web Crypto SHA-256 unavailable');
    const digest=await subtle.digest('SHA-256',arrayBuffer);
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  }

  function createClient(defaults={}){
    const defaultFetch=defaults.fetchFn||root?.fetch?.bind(root)||null;
    const defaultCrypto=defaults.cryptoObject||root?.crypto||null;
    const defaultManifestUrl=defaults.manifestUrl||MANIFEST_URL;
    const defaultBinaryUrl=defaults.binaryUrl||BINARY_URL;
    const warn=defaults.warn!==false;

    let view=null;
    let manifestSummary=null;
    let loadPromise=null;
    let state=freeze({status:'unloaded',ready:false,error:null});

    function setFailed(error){
      view=null;
      manifestSummary=null;
      const message=error instanceof Error?error.message:String(error||'unknown error');
      state=freeze({status:'missing',ready:false,error:message});
      if(warn&&root?.console?.warn)root.console.warn('AstroIfnField unavailable:',message);
      return false;
    }

    function getState(){return state;}

    async function load(options={}){
      if(state.ready&&options.forceReload!==true)return true;
      if(loadPromise)return loadPromise;

      const fetchFn=options.fetchFn||defaultFetch;
      const cryptoObject=options.cryptoObject||defaultCrypto;
      const manifestUrl=options.manifestUrl||defaultManifestUrl;
      const binaryUrl=options.binaryUrl||defaultBinaryUrl;
      if(typeof fetchFn!=='function')return setFailed(new Error('fetch unavailable'));

      state=freeze({status:'loading',ready:false,error:null});
      loadPromise=(async()=>{
        try{
          const manifestResponse=await fetchFn(manifestUrl,{cache:'force-cache'});
          if(!manifestResponse||manifestResponse.ok!==true)throw new Error(`manifest HTTP ${manifestResponse?.status??'error'}`);
          const manifest=assertManifest(await manifestResponse.json());

          const binaryResponse=await fetchFn(binaryUrl,{cache:'force-cache'});
          if(!binaryResponse||binaryResponse.ok!==true)throw new Error(`binary HTTP ${binaryResponse?.status??'error'}`);
          const buffer=await binaryResponse.arrayBuffer();
          if(!(buffer instanceof ArrayBuffer))throw new Error('binary response is not ArrayBuffer');
          if(buffer.byteLength!==EXPECTED_BYTE_LENGTH)throw new Error(`binary byteLength ${buffer.byteLength} != ${EXPECTED_BYTE_LENGTH}`);

          const actualSha=await sha256Hex(buffer,cryptoObject);
          const expectedSha=String(manifest.binary.sha256).toLowerCase();
          if(actualSha!==expectedSha)throw new Error(`binary SHA-256 mismatch: ${actualSha}`);

          const candidateView=new DataView(buffer);
          // Deterministic edge probes catch byte-order/layout corruption before publish.
          const probePixels=[0,1,Math.floor(NPIX/2),NPIX-2,NPIX-1];
          for(const pixel of probePixels){
            const offset=pixel*BYTES_PER_RECORD;
            const mean=candidateView.getFloat32(offset,true);
            const std=candidateView.getFloat32(offset+4,true);
            if(!Number.isFinite(mean)||!Number.isFinite(std))throw new Error(`non-finite binary probe at pixel ${pixel}`);
          }

          view=candidateView;
          manifestSummary=freeze({
            schemaVersion:manifest.schemaVersion,
            model:manifest.model,
            nside:manifest.grid.nside,
            npix:manifest.grid.npix,
            ordering:manifest.grid.ordering,
            frame:manifest.grid.frame,
            sha256:expectedSha,
            byteLength:buffer.byteLength
          });
          state=freeze({status:'ready',ready:true,error:null,manifest:manifestSummary});
          return true;
        }catch(error){
          return setFailed(error);
        }finally{
          loadPromise=null;
        }
      })();
      return loadPromise;
    }

    function lookup(raDeg,decDeg){
      const pixel=healpixPixelForIcrs(raDeg,decDeg);
      if(pixel==null)return neutral('invalid-coordinate');
      if(!state.ready||!view)return neutral('not-ready');

      const offset=pixel*BYTES_PER_RECORD;
      if(offset<0||offset+BYTES_PER_RECORD>view.byteLength)return neutral('out-of-range');
      const mean=view.getFloat32(offset,true);
      const std=view.getFloat32(offset+4,true);
      if(!Number.isFinite(mean)||!Number.isFinite(std))return neutral('non-finite-record');

      return freeze({
        model:MODEL,
        status:'quantitative',
        confidence:'high',
        pixel,
        meanI100:mean,
        stdI100:std,
        signalTimeFactor:signalTimeFactorFromI100(mean),
        reason:null
      });
    }

    return freeze({load,lookup,getState});
  }

  const defaultClient=createClient();
  return freeze({
    VERSION,MODEL,MANIFEST_URL,BINARY_URL,NSIDE,NPIX,ORDERING,FRAME,BYTES_PER_RECORD,EXPECTED_BYTE_LENGTH,
    createClient,
    load:defaultClient.load,
    lookup:defaultClient.lookup,
    getState:defaultClient.getState,
    healpixPixelForIcrs,
    signalTimeFactorFromI100
  });
});
