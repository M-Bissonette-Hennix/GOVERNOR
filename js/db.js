import {APP_VERSION, DB_VERSION, DEFAULT_SETTINGS, SEEDED_DOMAINS, freshDailyState} from './model.js';

const DB_NAME='personal-state-governor';
const STORES=['kv','domains','days','wakeEpisodes','blocks','events'];
let dbPromise;

function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      for(const name of STORES){
        if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'id'});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}

async function tx(store,mode='readonly'){
  const db=await openDB();
  return db.transaction(store,mode).objectStore(store);
}
function promisify(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}

export async function get(store,id){return promisify((await tx(store)).get(id))}
export async function getAll(store){return promisify((await tx(store)).getAll())}
export async function put(store,obj){return promisify((await tx(store,'readwrite')).put(obj))}
export async function del(store,id){return promisify((await tx(store,'readwrite')).delete(id))}
export async function clear(store){return promisify((await tx(store,'readwrite')).clear())}

function clampInt(value,min,max,fallback=0){
  const n=Number(value);
  if(!Number.isFinite(n)) return fallback;
  return Math.max(min,Math.min(max,Math.round(n)));
}
function legacyDepthTarget(domain){
  if(domain.depthTarget28!=null) return clampInt(domain.depthTarget28,0,28,0);
  const legacy=Number(domain.depthDays);
  if(!Number.isFinite(legacy)||legacy<=0) return 0;
  return clampInt(Math.round(28/legacy),0,28,0);
}
function normalizeDomain(domain){
  const continuityTarget7=clampInt(domain.continuityTarget7 ?? domain.continuityDays,0,7,0);
  const depthTarget28=legacyDepthTarget(domain);
  return {
    ...domain,
    active:domain.active!==false,
    bridge:Array.isArray(domain.bridge)?domain.bridge:[],
    continuityTarget7,
    depthTarget28,
    cadenceSemantics:2,
    updatedAt:domain.updatedAt||Date.now()
  };
}

export async function initDB(){
  const settings=await get('kv','settings');
  const mergedSettings={id:'settings',...DEFAULT_SETTINGS,...(settings||{}),schemaVersion:2,version:APP_VERSION};
  if(!settings || JSON.stringify(settings)!==JSON.stringify(mergedSettings)) await put('kv',mergedSettings);

  const domains=await getAll('domains');
  if(!domains.length){
    const now=Date.now();
    for(const d of SEEDED_DOMAINS) await put('domains',{...d,continuityDays:d.continuityTarget7,createdAt:now,updatedAt:now,cadenceSemantics:2});
  }else{
    for(const d of domains){
      const normalized=normalizeDomain(d);
      if(JSON.stringify(d)!==JSON.stringify(normalized)) await put('domains',normalized);
    }
  }
  return true;
}

export async function getSettings(){return get('kv','settings')}
export async function saveSettings(settings){return put('kv',{id:'settings',...DEFAULT_SETTINGS,...settings,schemaVersion:2,version:APP_VERSION})}

export function localDateKey(ts=Date.now()){
  const d=new Date(ts);
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

export function dateKeyToLocalNoon(dateKey){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey||''));
  if(!m) return null;
  const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12,0,0,0);
  return Number.isNaN(d.getTime())?null:d.getTime();
}

export async function getToday(){
  const id=localDateKey();
  let day=await get('days',id);
  if(!day){day={id,...freshDailyState(id)}; await put('days',day)}
  else{
    day.anchor={index:0,decompositionIndex:null,completed:[],skipped:[],optionalConfirmed:false,...(day.anchor||{})};
    day.envelope={minutes:120,cognition:'normal',fixedWork:null,...(day.envelope||{})};
  }
  return day;
}

export async function exportAll(){
  const payload={exportedAt:new Date().toISOString(),appVersion:APP_VERSION,schemaVersion:2,stores:{}};
  for(const s of STORES) payload.stores[s]=await getAll(s);
  return payload;
}

export async function importAll(payload){
  if(!payload || ![1,2].includes(payload.schemaVersion) || !payload.stores) throw new Error('Unsupported or malformed backup.');
  for(const s of STORES){
    if(!Array.isArray(payload.stores[s])) throw new Error(`Backup missing store: ${s}`);
    for(const row of payload.stores[s]){
      if(!row || typeof row!=='object' || typeof row.id!=='string' || !row.id) throw new Error(`Malformed row in store: ${s}`);
    }
  }
  const db=await openDB();
  await new Promise((resolve,reject)=>{
    const transaction=db.transaction(STORES,'readwrite');
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error||new Error('Import transaction failed.'));
    transaction.onabort=()=>reject(transaction.error||new Error('Import transaction aborted.'));
    for(const s of STORES){
      const store=transaction.objectStore(s);
      store.clear();
      for(const row of payload.stores[s]) store.put(row);
    }
  });
}

export async function wipeAll(){
  for(const s of STORES) await clear(s);
  await initDB();
}
