import {ANCHOR_ACTIONS, DOSES} from './model.js';
import {getAll, put, get, getSettings, localDateKey, dateKeyToLocalNoon} from './db.js';

const modeRank={surge:4,build:3,maintain:2,anchor:1,restorative:0,dormant:-9};
const bandRank={breach:4,pressure:3,watch:2,green:1};
const cognitionFit={fragile:{low:3,medium:2,high:1},normal:{low:2,medium:3,high:2},strong:{low:1,medium:2,high:3}};
const doseFloorMinutes={contact:15,maintenance:30,advance:60,surge:150};

function clampInt(value,min,max,fallback=0){
  const n=Number(value);
  if(!Number.isFinite(n)) return fallback;
  return Math.max(min,Math.min(max,Math.round(n)));
}
function clamp(value,min,max,fallback=0){
  const n=Number(value);
  if(!Number.isFinite(n)) return fallback;
  return Math.max(min,Math.min(max,n));
}
function lastOf(blocks,domainId,predicate){
  return blocks.filter(b=>b.domainId===domainId&&b.status==='completed'&&predicate(b)).sort((a,b)=>(b.endedAt||0)-(a.endedAt||0))[0]||null;
}
export function rollingDateKeys(days,now=Date.now()){
  const out=[];
  const d=new Date(now); d.setHours(12,0,0,0);
  for(let i=0;i<days;i++){
    const x=new Date(d); x.setDate(d.getDate()-i); out.push(localDateKey(x.getTime()));
  }
  return out;
}
function rollingDateKeySet(days,now=Date.now()){return new Set(rollingDateKeys(days,now))}
function distinctDoseDays(blocks,domainId,days,predicate,now=Date.now()){
  const keys=rollingDateKeySet(days,now);
  return new Set(blocks.filter(b=>b.domainId===domainId&&b.status==='completed'&&predicate(b)&&keys.has(b.dateKey||localDateKey(b.endedAt))).map(b=>b.dateKey||localDateKey(b.endedAt))).size;
}
function calendarDayDiff(ts,now=Date.now()){
  if(ts==null) return Infinity;
  const a=new Date(ts); a.setHours(12,0,0,0);
  const b=new Date(now); b.setHours(12,0,0,0);
  return Math.max(0,Math.round((b-a)/86400000));
}

export function getContinuityTarget(domain){return clampInt(domain.continuityTarget7 ?? domain.continuityDays,0,7,0)}
export function getDepthTarget(domain){
  if(domain.depthTarget28!=null) return clampInt(domain.depthTarget28,0,28,0);
  const legacy=Number(domain.depthDays);
  if(!Number.isFinite(legacy)||legacy<=0) return 0;
  return clampInt(Math.round(28/legacy),0,28,0);
}
export function countBand(count,target){
  if(target<=0 || count>=target) return 'green';
  if(count===target-1) return 'watch';
  if(count>=Math.max(1,Math.ceil(target*.5))) return 'pressure';
  return 'breach';
}
function worstBand(a,b){return bandRank[a]>=bandRank[b]?a:b}

export function domainCondition(domain,blocks,now=Date.now()){
  const contact=lastOf(blocks,domain.id,b=>DOSES.includes(b.dose));
  const depth=lastOf(blocks,domain.id,b=>['advance','surge'].includes(b.dose));
  const continuityTarget=getContinuityTarget(domain);
  const depthTarget=getDepthTarget(domain);
  const contactCount7=distinctDoseDays(blocks,domain.id,7,b=>DOSES.includes(b.dose),now);
  const depthCount28=distinctDoseDays(blocks,domain.id,28,b=>['advance','surge'].includes(b.dose),now);
  const todayKey=localDateKey(now);
  const completedToday=blocks.filter(b=>b.domainId===domain.id&&b.status==='completed'&&(b.dateKey||localDateKey(b.endedAt))===todayKey);
  const contactToday=completedToday.some(b=>DOSES.includes(b.dose));
  const deepToday=completedToday.some(b=>['advance','surge'].includes(b.dose));
  const governed=domain.active!==false&&!['anchor','restorative','dormant'].includes(domain.mode);
  const continuity=countBand(contactCount7,continuityTarget);
  const depthBand=countBand(depthCount28,depthTarget);
  const continuityGap=Math.max(0,continuityTarget-contactCount7);
  const depthGap=Math.max(0,depthTarget-depthCount28);
  const continuityActionable=governed&&continuityTarget>0&&continuityGap>0&&!contactToday;
  const depthActionable=governed&&depthTarget>0&&depthGap>0&&!deepToday;
  const continuitySatisfiedToday=governed&&continuityGap>0&&contactToday;
  const depthSatisfiedToday=governed&&depthGap>0&&deepToday;
  const onTarget=continuityGap===0&&depthGap===0;
  const needsActionToday=continuityActionable||depthActionable;
  return {
    contact,depth,
    contactDays:calendarDayDiff(contact?.endedAt,now),
    depthDays:calendarDayDiff(depth?.endedAt,now),
    contactCount7,depthCount28,continuityTarget,depthTarget,
    continuity,depthBand,overallBand:worstBand(continuity,depthBand),
    continuityGap,depthGap,contactToday,deepToday,governed,onTarget,
    continuityActionable,depthActionable,continuitySatisfiedToday,depthSatisfiedToday,
    needsActionToday,
    todaySatisfied:governed&&!needsActionToday&&!onTarget&&(continuitySatisfiedToday||depthSatisfiedToday)
  };
}

function actionBand(cond,type){
  if(type==='continuity'&&!cond.continuityActionable) return 0;
  if(type==='depth'&&!cond.depthActionable) return 0;
  return bandRank[type==='continuity'?cond.continuity:cond.depthBand]||0;
}
function actionSeverity(cond){return Math.max(actionBand(cond,'continuity'),actionBand(cond,'depth'))}
function compareCandidate(a,b,envelope){
  const tuples=x=>[
    actionSeverity(x.cond),
    actionBand(x.cond,'continuity'),
    actionBand(x.cond,'depth'),
    modeRank[x.domain.mode]??0,
    cognitionFit[envelope.cognition]?.[x.domain.ignition]||1,
    (x.cond.continuityGap/Math.max(1,x.cond.continuityTarget))+(x.cond.depthGap/Math.max(1,x.cond.depthTarget)),
    x.cond.depthDays===Infinity?999:x.cond.depthDays
  ];
  const A=tuples(a),B=tuples(b);
  for(let i=0;i<A.length;i++) if(A[i]!==B[i]) return B[i]-A[i];
  return a.domain.name.localeCompare(b.domain.name);
}
function compareInvestment(a,b,envelope){
  const A=[modeRank[a.domain.mode]??0,cognitionFit[envelope.cognition]?.[a.domain.ignition]||1,a.cond.depthDays===Infinity?999:a.cond.depthDays];
  const B=[modeRank[b.domain.mode]??0,cognitionFit[envelope.cognition]?.[b.domain.ignition]||1,b.cond.depthDays===Infinity?999:b.cond.depthDays];
  for(let i=0;i<A.length;i++) if(A[i]!==B[i]) return B[i]-A[i];
  return a.domain.name.localeCompare(b.domain.name);
}
function canDeep(envelope){return envelope.cognition!=='fragile'&&Number(envelope.minutes||0)>=60}
function choosePrimaryDose(item,envelope,kind){
  if(kind==='repair'){
    if(item.cond.depthActionable&&canDeep(envelope)) return 'advance';
    if(item.cond.continuityActionable) return envelope.cognition==='fragile'||Number(envelope.minutes||0)<45?'contact':'maintenance';
  }
  if(kind==='investment'&&envelope.cognition==='strong'&&Number(envelope.minutes||0)>=240&&item.domain.mode==='surge') return 'surge';
  return 'advance';
}
function reasonFor(item,kind,dose){
  if(!item) return '';
  if(kind==='investment') return 'All actionable deficits are contained; capacity exists for deliberate advancement.';
  const repairs=[];
  if(item.cond.continuityActionable) repairs.push(`continuity ${item.cond.contactCount7}/${item.cond.continuityTarget} (${item.cond.continuity.toUpperCase()})`);
  const deepDose=['advance','surge'].includes(dose);
  if(item.cond.depthActionable&&deepDose) repairs.push(`depth ${item.cond.depthCount28}/${item.cond.depthTarget} (${item.cond.depthBand.toUpperCase()})`);
  let text=repairs.length?`Selected to repair ${repairs.join(' and ')}.`:'Selected by strategic mode and capacity fit.';
  if(item.cond.depthActionable&&!deepDose) text+=' Depth also remains below target; this shallow dose cannot repair depth.';
  return text;
}

export async function computePortfolio(now=Date.now()){
  const [domains,blocks]=await Promise.all([getAll('domains'),getAll('blocks')]);
  return domains.filter(d=>d.active!==false).map(domain=>({domain,cond:domainCondition(domain,blocks,now)}));
}

export function buildContract(portfolio,day,settings={}){
  const envelope=day.envelope||{};
  const active=portfolio.filter(x=>x.domain.active!==false&&x.domain.mode!=='dormant');
  const work=active.find(x=>x.domain.id==='work'||x.domain.mode==='anchor');
  const todayDow=new Date().getDay();
  const defaultWorkDays=Array.isArray(settings.defaultWorkDays)?settings.defaultWorkDays:[1,2,3,4,5];
  const fixedWork=!!work && (envelope.fixedWork ?? defaultWorkDays.includes(todayDow));
  const candidates=active.filter(x=>x.cond.governed&&x.domain.id!=='physical');
  const physical=active.find(x=>x.domain.id==='physical');
  const deepPossible=canDeep(envelope);
  const budget=Math.max(0,Number(envelope.minutes||0));
  let remaining=budget;

  // Required repair outranks discretionary investment. A depth-only deficit is a
  // primary candidate only when the current envelope can support a deep dose.
  const requiredCandidates=candidates
    .filter(x=>x.cond.continuityActionable||(x.cond.depthActionable&&deepPossible))
    .sort((a,b)=>compareCandidate(a,b,envelope));
  let primary=requiredCandidates[0]||null;
  let primaryKind=primary?'repair':null;
  let primaryDose=primary?choosePrimaryDose(primary,envelope,primaryKind):null;
  if(primaryDose){
    const cost=doseFloorMinutes[primaryDose]||0;
    if(cost>remaining){primary=null;primaryKind=null;primaryDose=null}
    else remaining-=cost;
  }

  // Physical work remains outside the serious-intellectual-context ceiling, but
  // it is not free: the recommendation must fit the same discretionary-time budget.
  let physicalDose=null;
  if(physical?.cond.governed&&physical.cond.needsActionToday){
    if(physical.cond.depthActionable&&deepPossible&&remaining>=doseFloorMinutes.advance) physicalDose='advance';
    else if(physical.cond.continuityActionable){
      const preferred=(envelope.cognition==='fragile'||remaining<doseFloorMinutes.maintenance)?'contact':'maintenance';
      if(remaining>=doseFloorMinutes[preferred]) physicalDose=preferred;
      else if(remaining>=doseFloorMinutes.contact) physicalDose='contact';
    }
    if(physicalDose) remaining-=doseFloorMinutes[physicalDose];
  }

  // Optional investment is allowed only when the whole governed portfolio has no
  // actionable deficit. It therefore never displaces Physical or another repair.
  const anyActionable=active.some(x=>x.cond.governed&&x.cond.needsActionToday);
  if(!primary&&!anyActionable&&remaining>=120&&envelope.cognition!=='fragile'){
    const investment=candidates
      .filter(x=>['surge','build'].includes(x.domain.mode)&&!x.cond.contactToday&&!x.cond.deepToday)
      .sort((a,b)=>compareInvestment(a,b,envelope))[0]||null;
    if(investment){
      const dose=choosePrimaryDose(investment,{...envelope,minutes:remaining},'investment');
      const cost=doseFloorMinutes[dose]||0;
      if(cost<=remaining){primary=investment;primaryKind='investment';primaryDose=dose;remaining-=cost}
    }
  }

  const contextLimit=clampInt(settings.contextSwitchLimit,1,5,3);
  const configuredContinuity=clampInt(settings.maxContinuityItems,0,4,2);
  const contextsBeforeContinuity=(fixedWork?1:0)+(primary?1:0);
  const contextSlots=Math.max(0,contextLimit-contextsBeforeContinuity);
  const continuity=[];
  const continuityPool=candidates
    .filter(x=>x.domain.id!==primary?.domain.id&&x.cond.continuityActionable)
    .sort((a,b)=>compareCandidate(a,b,envelope));
  for(const item of continuityPool){
    if(continuity.length>=configuredContinuity||continuity.length>=contextSlots) break;
    let dose=envelope.cognition==='fragile'?'contact':'maintenance';
    if(remaining<doseFloorMinutes[dose]) dose='contact';
    if(remaining<doseFloorMinutes[dose]) continue;
    continuity.push({item,dose});
    remaining-=doseFloorMinutes[dose];
  }

  const recommendedDoses={};
  if(primary) recommendedDoses[primary.domain.id]=primaryDose;
  for(const {item,dose} of continuity) recommendedDoses[item.domain.id]=dose;
  if(physicalDose) recommendedDoses[physical.domain.id]=physicalDose;

  // Compute what remains unresolved *after the proposed contract is executed*.
  // A shallow dose repairs continuity evidence but cannot silently repair depth.
  const unresolvedReasons={};
  const unresolvedIds=[];
  const todaySatisfiedIds=[];
  const protectedIds=[];
  for(const x of active.filter(x=>x.cond.governed)){
    const planned=recommendedDoses[x.domain.id]||null;
    const plannedContact=!!planned;
    const plannedDeep=['advance','surge'].includes(planned);
    const residual=[];
    if(x.cond.continuityActionable&&!plannedContact) residual.push('continuity');
    if(x.cond.depthActionable&&!plannedDeep) residual.push('depth');
    if(residual.length){
      unresolvedIds.push(x.domain.id);
      unresolvedReasons[x.domain.id]=residual;
    }else if(planned){
      // Already represented by a scheduled contract block.
    }else if(x.cond.todaySatisfied){
      todaySatisfiedIds.push(x.domain.id);
    }else if(x.cond.onTarget){
      protectedIds.push(x.domain.id);
    }
  }

  const plannedMinutesFloor=budget-remaining;
  return {
    cadenceModel:2,
    generatedAt:Date.now(),
    fixedWork:!!fixedWork,
    workId:fixedWork?(work?.domain.id||null):null,
    primaryId:primary?.domain.id||null,
    primaryKind,
    primaryDose,
    primaryReason:reasonFor(primary,primaryKind,primaryDose),
    continuityIds:continuity.map(x=>x.item.domain.id),
    physicalId:physicalDose?physical.domain.id:null,
    protectedIds,
    unresolvedIds,
    unresolvedReasons,
    todaySatisfiedIds,
    recommendedDoses,
    contextLimit,
    contextsUsed:contextsBeforeContinuity+continuity.length,
    timeBudgetMinutes:budget,
    plannedMinutesFloor,
    remainingMinutesFloor:remaining
  };
}
export async function generateContract(day){
  const [portfolio,settings]=await Promise.all([computePortfolio(),getSettings()]);
  const contract=buildContract(portfolio,day,settings||{});
  day.contract=contract;
  day.updatedAt=Date.now();
  await put('days',day);
  return contract;
}

export function nextAnchor(day){
  const a=day.anchor||{index:0,decompositionIndex:null,completed:[],skipped:[],optionalConfirmed:false};
  const item=ANCHOR_ACTIONS[a.index];
  if(!item) return null;
  if(a.decompositionIndex!=null) return {...item,title:item.decompositions[a.decompositionIndex],isDecomposition:true};
  return {...item,isDecomposition:false};
}
export function anchorCoreReached(day){
  const a=day.anchor||{};
  const item=ANCHOR_ACTIONS[a.index];
  return !!item&&!item.core&&!a.optionalConfirmed;
}
export async function continueOptionalAnchors(day){day.anchor.optionalConfirmed=true;day.updatedAt=Date.now();await put('days',day);return day}
export async function anchorDone(day,kind='done'){
  const a=day.anchor; const item=ANCHOR_ACTIONS[a.index]; if(!item) return day;
  if(a.decompositionIndex!=null&&a.decompositionIndex<item.decompositions.length-1) a.decompositionIndex++;
  else{a.completed.push({id:item.id,at:Date.now(),kind});a.index++;a.decompositionIndex=null}
  day.operatingState='anchoring';day.updatedAt=Date.now();await put('days',day);return day;
}
export async function anchorCant(day){
  const a=day.anchor;const item=ANCHOR_ACTIONS[a.index];if(!item)return day;
  if(a.decompositionIndex==null)a.decompositionIndex=0;
  else if(a.decompositionIndex<item.decompositions.length-1)a.decompositionIndex++;
  else{a.skipped.push({id:item.id,at:Date.now(),reason:'not-now'});a.index++;a.decompositionIndex=null}
  day.updatedAt=Date.now();await put('days',day);return day;
}

export async function setOperatingState(day,state){day.operatingState=state;day.updatedAt=Date.now();await put('days',day);return day}
export async function saveEnvelope(day,envelope){day.envelope={...day.envelope,...envelope};day.updatedAt=Date.now();await put('days',day);return day}

async function findOpenWake(){
  const all=await getAll('wakeEpisodes');
  return all.filter(w=>!w.endedAt).sort((a,b)=>b.startedAt-a.startedAt)[0]||null;
}
export async function startWakeEpisode(day){
  const existing=await findOpenWake();
  if(existing){
    if(!day.wakeEpisodeIds.includes(existing.id)) day.wakeEpisodeIds.push(existing.id);
    day.activeWakeEpisodeId=existing.id;day.updatedAt=Date.now();await put('days',day);return existing;
  }
  const all=await getAll('wakeEpisodes');
  const today=all.filter(w=>w.dateKey===day.dateKey).sort((a,b)=>a.startedAt-b.startedAt);
  const id=`wake-${Date.now()}`;
  const episode={id,dateKey:day.dateKey,index:today.length+1,startedAt:Date.now(),endedAt:null,overrideNight:false};
  await put('wakeEpisodes',episode);
  if(!day.wakeEpisodeIds.includes(id)) day.wakeEpisodeIds.push(id);
  day.activeWakeEpisodeId=id;day.updatedAt=Date.now();await put('days',day);return episode;
}
export async function getActiveWake(day){
  if(day.activeWakeEpisodeId){
    const ep=await get('wakeEpisodes',day.activeWakeEpisodeId);
    if(ep&&!ep.endedAt) return ep;
  }
  const open=await findOpenWake();
  if(open){
    if(!day.wakeEpisodeIds.includes(open.id)) day.wakeEpisodeIds.push(open.id);
    day.activeWakeEpisodeId=open.id;day.updatedAt=Date.now();await put('days',day);
  }
  return open;
}
export async function endWakeEpisode(day){
  const ep=await getActiveWake(day);
  if(ep){ep.endedAt=Date.now();await put('wakeEpisodes',ep)}
  day.activeWakeEpisodeId=null;day.updatedAt=Date.now();await put('days',day);return ep;
}
export function isNightReentry(ep){if(!ep)return false;const h=new Date(ep.startedAt).getHours();return ep.index>1&&(h>=18||h<5)}

async function findOpenBlock(){
  const blocks=await getAll('blocks');
  return blocks.filter(b=>b.status==='active').sort((a,b)=>b.startedAt-a.startedAt)[0]||null;
}
export async function startBlock(day,domainId,plannedDose='advance',source='contract'){
  const existing=await findOpenBlock();
  if(existing){
    day.currentBlockId=existing.id;day.closed=false;day.operatingState=existing.protected?'deep':'engaged';day.updatedAt=Date.now();await put('days',day);return existing;
  }
  const id=`block-${Date.now()}`;
  const block={id,dateKey:localDateKey(),domainId,plannedDose,dose:null,source,status:'active',startedAt:Date.now(),endedAt:null,pausedAt:null,pausedMs:0,protected:false,note:''};
  await put('blocks',block);
  day.currentBlockId=id;day.closed=false;day.operatingState='engaged';day.updatedAt=Date.now();await put('days',day);return block;
}
export async function getCurrentBlock(day){
  if(day.currentBlockId){
    const block=await get('blocks',day.currentBlockId);
    if(block?.status==='active') return block;
  }
  const open=await findOpenBlock();
  if(open){day.currentBlockId=open.id;day.closed=false;day.operatingState=open.protected?'deep':'engaged';day.updatedAt=Date.now();await put('days',day)}
  return open;
}
export function elapsedBlockMs(block,now=Date.now()){
  if(!block?.startedAt) return 0;
  const end=block.endedAt||now;
  const livePause=block.pausedAt?Math.max(0,end-block.pausedAt):0;
  return Math.max(0,end-block.startedAt-(block.pausedMs||0)-livePause);
}
export async function pauseBlock(day,block){
  if(!block.pausedAt){block.pausedAt=Date.now();await put('blocks',block)}
  day.updatedAt=Date.now();await put('days',day);return block;
}
export async function resumeBlock(day,block){
  if(block.pausedAt){block.pausedMs=(block.pausedMs||0)+Math.max(0,Date.now()-block.pausedAt);block.pausedAt=null;await put('blocks',block)}
  day.updatedAt=Date.now();await put('days',day);return block;
}
export async function protectBlock(day,block){block.protected=true;await put('blocks',block);day.operatingState='deep';day.updatedAt=Date.now();await put('days',day);return block}
export async function finishBlock(day,block,dose,note=''){
  block.status='completed';block.dose=dose;block.note=note;block.endedAt=Date.now();block.completionDateKey=localDateKey(block.endedAt);block.minutes=Math.max(1,Math.round(elapsedBlockMs(block,block.endedAt)/60000));block.pausedAt=null;await put('blocks',block);
  day.currentBlockId=null;day.closed=false;day.operatingState='functional';day.contract=null;day.updatedAt=Date.now();await put('days',day);return block;
}
export async function abandonBlock(day,block){
  block.status='abandoned';block.endedAt=Date.now();block.completionDateKey=localDateKey(block.endedAt);block.minutes=Math.max(1,Math.round(elapsedBlockMs(block,block.endedAt)/60000));block.pausedAt=null;await put('blocks',block);
  day.currentBlockId=null;day.closed=false;day.operatingState='online';day.contract=null;day.updatedAt=Date.now();await put('days',day);return block;
}
export async function logCompletedBlock({domainId,dose,dateKey,minutes,note=''}){
  if(!domainId||!DOSES.includes(dose)) throw new Error('Trajectory and dose are required.');
  const mins=clamp(minutes,1,1440,1);
  if(!dateKey||dateKey>localDateKey()) throw new Error('Date must be today or earlier.');
  const base=dateKey===localDateKey()?Date.now():dateKeyToLocalNoon(dateKey);
  if(base==null) throw new Error('Invalid date.');
  const id=`block-${Date.now()}-manual`;
  const endedAt=base;
  const block={id,dateKey,completionDateKey:dateKey,domainId,plannedDose:dose,dose,source:'manual-log',status:'completed',startedAt:endedAt-mins*60000,endedAt,pausedAt:null,pausedMs:0,minutes:Math.round(mins),protected:false,note};
  await put('blocks',block);return block;
}

export async function closeDay(day,note=''){day.closed=true;day.note=note;day.operatingState='close';day.contract=null;day.updatedAt=Date.now();await put('days',day);return day}
