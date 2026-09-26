const CACHE='astroplanner-v014-rd-signal-foundation10';
const IFN_CACHE='astroplanner-ifn-sfd-v1-a8a4c69f';
const IFN_ASSETS=['./ifn-sfd-field-v1.json','./ifn-sfd-field-v1.bin'];
const IFN_ASSET_URLS=IFN_ASSETS.map(path=>new URL(path,self.location.href).href);
const CATALOG_CACHE='astroplanner-catalog-v06';
const CATALOG_COMMIT='ef52c7ea920191d45fe0da4711dd3b1cc9220c18';
const CATALOG_ASSETS=[
  `https://raw.githubusercontent.com/acocalypso/celestia_atlas/${CATALOG_COMMIT}/data/openngc-viewer-catalog.json`,
  `https://raw.githubusercontent.com/acocalypso/celestia_atlas/${CATALOG_COMMIT}/data/stellarium-dso-supplement.json`,
  `https://raw.githubusercontent.com/acocalypso/celestia_atlas/${CATALOG_COMMIT}/data/abell-pn-catalog.json`
];
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./zwo-cameras.json','./framing-engine.js','./star-layer.js','./dso-layer.js','./framing-renderer.js','./raster-layer.js','./target-metadata.js','./effective-project-signal.js','./target-signal-data.json','./filter-profiles.js','./recommendation-engine.js','./ifn-field.js','./ifn-footprint.js','./ui-shell.css','./ui-state.js','./bortle-indicator.js','./snapshot-store.js'];

async function warmCatalogCache(){
  const cache=await caches.open(CATALOG_CACHE);
  const legacy=await caches.open('astroplanner-catalog-v05');
  await Promise.allSettled(CATALOG_ASSETS.map(async url=>{
    if(await cache.match(url))return;
    const old=await legacy.match(url);
    if(old){await cache.put(url,old.clone());return;}
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
    try{const r=await fetch(url,{cache:'no-cache',mode:'cors',signal:ctrl.signal});if(r.ok)await cache.put(url,r.clone());}catch(e){}finally{clearTimeout(timer);}
  }));
  const ready=(await Promise.all(CATALOG_ASSETS.map(url=>cache.match(url)))).every(Boolean);if(ready)await caches.delete('astroplanner-catalog-v05');
}
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('install',e=>e.waitUntil(Promise.all([caches.open(CACHE).then(c=>c.addAll(ASSETS)),warmCatalogCache()]).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('astroplanner-v014-rd-')&&k!==CACHE)||(k.startsWith('astroplanner-ifn-sfd-')&&k!==IFN_CACHE)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;const u=new URL(e.request.url);
  if(CATALOG_ASSETS.includes(e.request.url)){e.respondWith(caches.open(CATALOG_CACHE).then(async c=>{const cached=await c.match(e.request);if(cached)return cached;try{const r=await fetch(e.request);if(r&&r.ok)await c.put(e.request,r.clone());return r;}catch(e){return Response.error();}}));return;}
  if(IFN_ASSET_URLS.includes(e.request.url)){e.respondWith(caches.open(IFN_CACHE).then(async c=>{const cached=await c.match(e.request);if(cached)return cached;try{const r=await fetch(e.request);if(r&&r.ok)await c.put(e.request,r.clone());return r;}catch(e){return Response.error();}}));return;}
  const nav=e.request.mode==='navigate'||u.pathname.endsWith('/index.html')||u.pathname.endsWith('/');
  if(nav){e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put('./index.html',cp));return r;}).catch(()=>caches.match('./index.html')));return;}
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{if(r&&r.ok&&u.origin===location.origin){const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));}return r;})));
});
