/* AstroPlanner v0.14 R&D — regenerable DSS2 project snapshot cache */
(()=>{
  'use strict';

  const DB_NAME='astroplanner-v014-rd-project-snapshots';
  const DB_VERSION=1;
  const STORE='snapshots';
  let dbPromise=null;

  function openDb(){
    if(!('indexedDB' in window))return Promise.reject(new Error('IndexedDB niedostępne'));
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'projectId'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('Nie udało się otworzyć cache snapshotów'));
      req.onblocked=()=>console.warn('AstroPlanner snapshots: IndexedDB blocked');
    });
    return dbPromise;
  }

  async function tx(mode,fn){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tr=db.transaction(STORE,mode),store=tr.objectStore(STORE);
      let result;
      try{result=fn(store);}catch(err){reject(err);return;}
      tr.oncomplete=()=>resolve(result?.result??result);
      tr.onerror=()=>reject(tr.error||new Error('Błąd cache snapshotów'));
      tr.onabort=()=>reject(tr.error||new Error('Przerwano zapis snapshotu'));
    });
  }

  async function put(projectId,blob,meta={}){
    if(!(blob instanceof Blob))throw new Error('Snapshot nie jest obrazem Blob');
    const row={projectId:String(projectId),blob,signature:String(meta.signature||''),width:Number(meta.width)||0,height:Number(meta.height)||0,capturedAt:Number(meta.capturedAt)||Date.now(),source:'DSS2 Color'};
    await tx('readwrite',store=>store.put(row));
    return row;
  }

  async function get(projectId){
    try{
      const db=await openDb();
      return await new Promise((resolve,reject)=>{
        const tr=db.transaction(STORE,'readonly'),req=tr.objectStore(STORE).get(String(projectId));
        req.onsuccess=()=>resolve(req.result||null);
        req.onerror=()=>reject(req.error||new Error('Błąd odczytu snapshotu'));
      });
    }catch(err){
      console.warn('AstroPlanner snapshots get',err);
      return null;
    }
  }

  async function remove(projectId){
    try{await tx('readwrite',store=>store.delete(String(projectId)));}catch(err){console.warn('AstroPlanner snapshots remove',err);}
  }

  window.AstroSnapshotStore={put,get,remove};
})();
