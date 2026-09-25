import {ANCHOR_ACTIONS, DOSES} from './model.js';
import {getAll, put, get, localDateKey} from './db.js';

const DAY=86400000;
const modeRank={surge:4,build:3,maintain:2,anchor:1,restorative:0,dormant:-9};
const bandRank={breach:4,pressure:3,watch:2,green:1};
const cognitionFit={fragile:{low:3,medium:2,high:1},normal:{low:2,medium:3,high:2},strong:{low:1,medium:2,high:3}};

function dayDiff(ts){return ts==null?Infinity:Math.max(0,(Date.now()-ts)/DAY)}
function lastOf(blocks,domainId,predicate){
  return blocks.filter(b=>b.domainId===domainId && b.status==='completed' && predicate(b)).sort((a,b)=>b.endedAt-a.endedAt)[0]||null;
}
function clampInt(value,min,max,fallback=0){
  const n=Number(value); if(!Number.isFinite(n)) return fallback;
  return Math.max(min,Math.min(max,Math.round(n)));
}
function rollingDateKeys(days,now=Date.now()){
  const keys=new Set(); const d=new Date(now); d.setHours(12,0,0,0);
  for(let i=0;i<days;i++){const x=new Date(d);x.setDate(d.getDate()-i);keys.add(localDateKey(x.getTime()))}
  return keys;
}
function distinctDoseDays(blocks,domainId,days,predicate){
  const keys=rollingDateKeys(days);
  return new Set(blocks.filter(b=>b.domainId===domainId&&b.status==='completed'&&predicate(b)&&keys.has(b.dateKey||localDateKey(b.endedAt))).map(b=>b.dateKey||localDateKey(b.endedAt))).size;
}

// v0.1.2 semantics: a continuity value is literal contact days in a rolling 7-day window.
// Existing domains keep their numeric value so a user-entered "6" now means the expected 6 days/week.
export function getContinuityTarget(domain){return clampInt(domain.continuityTarget7 ?? domain.continuityDays,0,7,0)}
// New explicit depth target is distinct ADVANCE/SURGE days in a rolling 28-day window.
// Legacy depthDays is converted to an approximately equivalent monthly frequency until the trajectory is next edited.
export function getDepthTarget(domain){
  if(domain.depthTarget28!=null) return clampInt(domain.depthTarget28,0,28,0);
  const legacy=Number(domain.depthDays);
  if(!Number.isFinite(legacy)||legacy<=0) return 0;
  return clampInt(Math.round(28/legacy),0,28,0);
}

export function countBand(count,target){
  if(target<=0) return 'green';
  if(count>=target) return 'green';
  if(count===target-1) return 'watch';
  if(count>=Math.max(1,Math.ceil(target*.5))) return 'pressure';
  return 'breach';
}

export function domainCondition(domain,blocks){
  const contact=lastOf(blocks,domain.id,b=>DOSES.includes(b.dose));
  const depth=lastOf(blocks,domain.id,b=>['advance','surge'].includes(b.dose));
  const contactDays=dayDiff(contact?.endedAt);
  const depthDays=dayDiff(depth?.endedAt);
  const continuityTarget=getContinuityTarget(domain);
  const depthTarget=getDepthTarget(domain);
  const contactCount7=distinctDoseDays(blocks,domain.id,7,b=>DOSES.includes(b.dose));
  const depthCount28=distinctDoseDays(blocks,domain.id,28,b=>['advance','surge'].includes(b.dose));
  return {
    contact,depth,contactDays,depthDays,contactCount7,depthCount28,continuityTarget,depthTarget,
    continuity:countBand(contactCount7,continuityTarget),
    depthBand:countBand(depthCount28,depthTarget)
  };
}

function compareCandidate(a,b,envelope){
  const tuples=x=>[
    bandRank[x.cond.continuity], bandRank[x.cond.depthBand], modeRank[x.domain.mode]||0,
    cognitionFit[envelope.cognition]?.[x.domain.ignition]||1,
    x.cond.continuityTarget-x.cond.contactCount7,
    x.cond.depthTarget-x.cond.depthCount28,
    x.cond.depthDays===Infinity?999:x.cond.depthDays
  ];
  const A=tuples(a),B=tuples(b);
  for(let i=0;i<A.length;i++){if(A[i]!==B[i]) return B[i]-A[i]}
  return a.domain.name.localeCompare(b.domain.name);
}

export async function computePortfolio(){
  const [domains,blocks]=await Promise.all([getAll('domains'),getAll('blocks')]);
  return domains.filter(d=>d.active).map(domain=>({domain,cond:domainCondition(domain,blocks)}));
}

export function buildContract(portfolio,day){
  const active=portfolio.filter(x=>x.domain.mode!=='dormant');
  const work=active.find(x=>x.domain.id==='work');
  const fixedWork=day.envelope.fixedWork ?? ([1,2,3,4,5].includes(new Date().getDay()) && !!work);
  const candidates=active.filter(x=>!['work','reading','physical'].includes(x.domain.id) && x.domain.mode!=='restorative');
  candidates.sort((a,b)=>compareCandidate(a,b,day.envelope));
  const primary=candidates[0]||null;
  const maxContinuity=fixedWork?1:(day.envelope.minutes<=60?1:2);
  const continuity=candidates.filter(x=>x.domain.id!==primary?.domain.id)
    .filter(x=>['watch','pressure','breach'].includes(x.cond.continuity))
    .sort((a,b)=>compareCandidate(a,b,day.envelope)).slice(0,maxContinuity);
  const physical=active.find(x=>x.domain.id==='physical');
  const physicalNeeded=!!physical && ['watch','pressure','breach'].includes(physical.cond.continuity);
  const scheduled=new Set([primary?.domain.id,...continuity.map(c=>c.domain.id),physicalNeeded?'physical':null,'work','reading'].filter(Boolean));
  const omitted=active.filter(x=>!scheduled.has(x.domain.id));
  const unresolvedIds=omitted.filter(x=>['pressure','breach'].includes(x.cond.continuity)).map(x=>x.domain.id);
  const protectedIds=omitted.filter(x=>!unresolvedIds.includes(x.domain.id)).map(x=>x.domain.id);
  return {cadenceModel:1,generatedAt:Date.now(),fixedWork:!!fixedWork,primaryId:primary?.domain.id||null,continuityIds:continuity.map(x=>x.domain.id),physicalId:physicalNeeded?physical.domain.id:null,protectedIds,unresolvedIds};
}

export async function generateContract(day){
  const portfolio=await computePortfolio();
  const contract=buildContract(portfolio,day);
  day.contract=contract; day.updatedAt=Date.now(); await put('days',day); return contract;
}

export function nextAnchor(day){
  const a=day.anchor||{index:0,decompositionIndex:null,completed:[],skipped:[]};
  const item=ANCHOR_ACTIONS[a.index]; if(!item) return null;
  if(a.decompositionIndex!=null){
    return {...item,title:item.decompositions[a.decompositionIndex],isDecomposition:true};
  }
  return {...item,isDecomposition:false};
}

export async function anchorDone(day,kind='done'){
  const a=day.anchor; const item=ANCHOR_ACTIONS[a.index]; if(!item) return day;
  if(a.decompositionIndex!=null && a.decompositionIndex<item.decompositions.length-1){
    a.decompositionIndex++;
  }else{
    a.completed.push({id:item.id,at:Date.now(),kind}); a.index++; a.decompositionIndex=null;
  }
  day.operatingState='anchoring'; day.updatedAt=Date.now(); await put('days',day); return day;
}

export async function anchorCant(day){
  const a=day.anchor; const item=ANCHOR_ACTIONS[a.index]; if(!item) return day;
  if(a.decompositionIndex==null) a.decompositionIndex=0;
  else if(a.decompositionIndex<item.decompositions.length-1) a.decompositionIndex++;
  else {a.skipped.push({id:item.id,at:Date.now(),reason:'not-now'}); a.index++; a.decompositionIndex=null}
  day.updatedAt=Date.now(); await put('days',day); return day;
}

export async function setOperatingState(day,state){day.operatingState=state;day.updatedAt=Date.now();await put('days',day);return day}
export async function saveEnvelope(day,envelope){day.envelope={...day.envelope,...envelope};day.updatedAt=Date.now();await put('days',day);return day}

export async function startWakeEpisode(day){
  const all=await getAll('wakeEpisodes');
  const today=all.filter(w=>w.dateKey===day.dateKey).sort((a,b)=>a.startedAt-b.startedAt);
  const id=`wake-${Date.now()}`; const episode={id,dateKey:day.dateKey,index:today.length+1,startedAt:Date.now(),endedAt:null};
  await put('wakeEpisodes',episode); day.wakeEpisodeIds.push(id);day.activeWakeEpisodeId=id;day.updatedAt=Date.now();await put('days',day);return episode;
}
export async function endWakeEpisode(day){
  if(!day.activeWakeEpisodeId) return null; const ep=await get('wakeEpisodes',day.activeWakeEpisodeId); if(ep){ep.endedAt=Date.now();await put('wakeEpisodes',ep)}
  day.activeWakeEpisodeId=null;day.updatedAt=Date.now();await put('days',day);return ep;
}
export async function getActiveWake(day){return day.activeWakeEpisodeId?get('wakeEpisodes',day.activeWakeEpisodeId):null}
export function isNightReentry(ep){if(!ep) return false; const h=new Date(ep.startedAt).getHours(); return ep.index>1 && (h>=18 || h<5)}

export async function startBlock(day,domainId,plannedDose='advance',source='contract'){
  const id=`block-${Date.now()}`; const block={id,dateKey:localDateKey(),domainId,plannedDose,dose:null,source,status:'active',startedAt:Date.now(),endedAt:null,protected:false,note:''};
  await put('blocks',block); day.currentBlockId=id;day.operatingState='engaged';day.updatedAt=Date.now();await put('days',day);return block;
}
export async function getCurrentBlock(day){return day.currentBlockId?get('blocks',day.currentBlockId):null}
export async function protectBlock(day,block){block.protected=true;await put('blocks',block);day.operatingState='deep';day.updatedAt=Date.now();await put('days',day);return block}
export async function finishBlock(day,block,dose,note=''){
  block.status='completed';block.dose=dose;block.note=note;block.endedAt=Date.now();block.minutes=Math.max(1,Math.round((block.endedAt-block.startedAt)/60000));await put('blocks',block);
  day.currentBlockId=null;day.operatingState='functional';day.contract=null;day.updatedAt=Date.now();await put('days',day);return block;
}
export async function abandonBlock(day,block){block.status='abandoned';block.endedAt=Date.now();block.minutes=Math.max(1,Math.round((block.endedAt-block.startedAt)/60000));await put('blocks',block);day.currentBlockId=null;day.operatingState='online';day.updatedAt=Date.now();await put('days',day);return block}

export async function closeDay(day,note=''){day.closed=true;day.note=note;day.operatingState='close';day.updatedAt=Date.now();await put('days',day);return day}
