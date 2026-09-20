import {DB_VERSION, DEFAULT_SETTINGS, SEEDED_DOMAINS, freshDailyState} from './model.js';

const DB_NAME='personal-state-governor';
let dbPromise;

function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      for(const name of ['kv','domains','days','wakeEpisodes','blocks','events']){
        if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'id'});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}

async function tx(store,mode='readonly'){const db=await openDB();return db.transaction(store,mode).objectStore(store)}
function promisify(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}

export async function get(store,id){return promisify((await tx(store)).get(id))}
export async function getAll(store){return promisify((await tx(store)).getAll())}
export async function put(store,obj){return promisify((await tx(store,'readwrite')).put(obj))}
export async function del(store,id){return promisify((await tx(store,'readwrite')).delete(id))}
export async function clear(store){return promisify((await tx(store,'readwrite')).clear())}

export async function initDB(){
  const settings=await get('kv','settings');
  if(!settings) await put('kv',{id:'settings',...DEFAULT_SETTINGS});
  const domains=await getAll('domains');
  if(!domains.length) for(const d of SEEDED_DOMAINS) await put('domains',{...d,createdAt:Date.now(),updatedAt:Date.now()});
  return true;
}

export async function getSettings(){return get('kv','settings')}
export async function saveSettings(settings){return put('kv',{id:'settings',...settings})}

export function localDateKey(ts=Date.now()){
  const d=new Date(ts); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

export async function getToday(){
  const id=localDateKey(); let day=await get('days',id);
  if(!day){day={id,...freshDailyState(id)}; await put('days',day)}
  return day;
}

export async function exportAll(){
  const payload={exportedAt:new Date().toISOString(),schemaVersion:1,stores:{}};
  for(const s of ['kv','domains','days','wakeEpisodes','blocks','events']) payload.stores[s]=await getAll(s);
  return payload;
}

export async function importAll(payload){
  if(!payload || payload.schemaVersion!==1 || !payload.stores) throw new Error('Unsupported or malformed backup.');
  const stores=['kv','domains','days','wakeEpisodes','blocks','events'];
  for(const s of stores){
    if(!Array.isArray(payload.stores[s])) throw new Error(`Backup missing store: ${s}`);
    for(const row of payload.stores[s]){
      if(!row || typeof row!=='object' || typeof row.id!=='string' || !row.id) throw new Error(`Malformed row in store: ${s}`);
    }
  }
  const db=await openDB();
  await new Promise((resolve,reject)=>{
    const transaction=db.transaction(stores,'readwrite');
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error||new Error('Import transaction failed.'));
    transaction.onabort=()=>reject(transaction.error||new Error('Import transaction aborted.'));
    for(const s of stores){
      const store=transaction.objectStore(s);
      store.clear();
      for(const row of payload.stores[s]) store.put(row);
    }
  });
}

export async function wipeAll(){
  for(const s of ['kv','domains','days','wakeEpisodes','blocks','events']) await clear(s);
  await initDB();
}
