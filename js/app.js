import {APP_VERSION, ANCHOR_ACTIONS, DOSES, MODES, DOSE_META} from './model.js';
import {initDB,getToday,getAll,get,put,del,getSettings,saveSettings,exportAll,importAll,wipeAll,localDateKey,dateKeyToLocalNoon} from './db.js';
import {
  computePortfolio,generateContract,nextAnchor,anchorCoreReached,continueOptionalAnchors,anchorDone,anchorCant,
  setOperatingState,saveEnvelope,startWakeEpisode,endWakeEpisode,getActiveWake,isNightReentry,
  startBlock,getCurrentBlock,pauseBlock,resumeBlock,elapsedBlockMs,protectBlock,finishBlock,abandonBlock,
  logCompletedBlock,closeDay,getContinuityTarget,getDepthTarget,rollingDateKeys
} from './controller.js';

const app=document.querySelector('#app');
let state={day:null,settings:null,view:'now',portfolio:[],activeWake:null,currentBlock:null,timer:null,modal:null,blocks:[]};

const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtDate=()=>new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'}).format(new Date()).toUpperCase();
const fmtTime=ts=>new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(ts));
const fmtDateKey=key=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(key||'');if(!m)return key;return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(new Date(+m[1],+m[2]-1,+m[3],12))};
const fmtWeekdayKey=key=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(key||'');if(!m)return key;return new Intl.DateTimeFormat(undefined,{weekday:'narrow'}).format(new Date(+m[1],+m[2]-1,+m[3],12))};
const humanAgo=days=>!Number.isFinite(days)?'no recorded dose':days===0?'today':days===1?'yesterday':`${days}d ago`;
const bandLabel=b=>({green:'GREEN',watch:'WATCH',pressure:'PRESSURE',breach:'BREACH'}[b]||String(b||'').toUpperCase());
const modeLabel=m=>String(m||'').toUpperCase();
const cadenceText=x=>x.cond.governed?`${x.cond.contactCount7}/${x.cond.continuityTarget} contact days · rolling 7d`:'unmetered';
const depthText=x=>x.cond.governed&&x.cond.depthTarget?`${x.cond.depthCount28}/${x.cond.depthTarget} deep days · rolling 28d`:x.cond.governed?'no depth quota':'unmetered';
const doseText=d=>DOSE_META[d]?.label||String(d||'').toUpperCase();
const doseRange=d=>DOSE_META[d]?.range||'';

function topbar(){
  const ep=state.activeWake;
  const chip=state.currentBlock?.pausedAt?'PAUSED':state.day?.operatingState?state.day.operatingState.toUpperCase():'UNSET';
  return `<header class="topbar"><div><div class="brand">GOVERNOR · ${APP_VERSION}</div><div class="date">${fmtDate()}</div>${ep?`<div class="meta">WAKE ${String(ep.index).padStart(2,'0')} · STARTED ${fmtTime(ep.startedAt)}${localDateKey(ep.startedAt)!==localDateKey()?` · ${fmtDateKey(localDateKey(ep.startedAt))}`:''}</div>`:''}</div><div class="state-chip">${esc(chip)}</div></header>`;
}
function nav(){return `<nav class="nav"><div class="nav-inner">${['now','portfolio','review','system'].map(v=>`<button data-view="${v}" class="${state.view===v?'active':''}">${v}</button>`).join('')}</div></nav>`}
function card(inner,cls=''){return `<section class="card ${cls}">${inner}</section>`}
function button(label,action,cls=''){return `<button class="btn ${cls}" data-action="${action}">${label}</button>`}
function badge(b,label=null){return `<span class="badge ${b}">${esc(label||bandLabel(b))}</span>`}
function conditionMeta(x){
  if(!x.cond.governed) return `<span class="meta">${x.domain.mode==='dormant'?'Dormant — never scheduled automatically.':'Unmetered — available manually, excluded from governor pressure.'}</span>`;
  const today=[];
  if(x.cond.contactToday) today.push('contact recorded today');
  if(x.cond.deepToday) today.push('depth recorded today');
  return `<span class="meta">${cadenceText(x)} · ${depthText(x)}${today.length?` · ${today.join(' · ')}`:''}</span>`;
}

async function hydrate(){
  await initDB();
  state.settings=await getSettings();
  state.day=await getToday();
  if(state.day.contract&&state.day.contract.cadenceModel!==2){await generateContract(state.day);state.day=await getToday()}
  state.activeWake=await getActiveWake(state.day);
  state.currentBlock=await getCurrentBlock(state.day);
  state.portfolio=await computePortfolio();
  state.blocks=await getAll('blocks');
  if(!state.activeWake&&!state.day.closed){state.activeWake=await startWakeEpisode(state.day);state.day=await getToday()}
  if(state.settings?.lastView) state.view=state.settings.lastView;
}
async function refresh(){
  state.settings=await getSettings();
  state.day=await getToday();
  state.activeWake=await getActiveWake(state.day);
  state.currentBlock=await getCurrentBlock(state.day);
  state.portfolio=await computePortfolio();
  state.blocks=await getAll('blocks');
  render();
}

function render(){
  clearInterval(state.timer);state.timer=null;
  let body='';
  if(state.view==='now') body=renderNow();
  if(state.view==='portfolio') body=renderPortfolio();
  if(state.view==='review') body=renderReview();
  if(state.view==='system') body=renderSystem();
  app.innerHTML=topbar()+body+nav()+(state.modal||'');
  bind();
  if(state.currentBlock) startTimerDisplay();
}

function renderNow(){
  if(state.currentBlock) return renderActiveBlock();
  if(state.day.closed) return card(`<div class="eyebrow">DAY CLOSED</div><h1 class="hero">No catch-up ledger.</h1><p class="sub">Today is reconciled. You can still log completed work, or start a new block; doing so will reopen today automatically.</p>${button('REOPEN TODAY','reopen','ghost')}${button('LOG COMPLETED WORK','log-work','ghost')}`);
  if(!state.activeWake) return card(`<div class="eyebrow">WAKE EPISODE</div><h1 class="hero">No wake episode is active.</h1><p class="sub">Start one when you are genuinely awake again. An open wake episode now survives midnight instead of being silently replaced.</p>${button('START WAKE EPISODE','start-wake','primary')}`);
  if(!state.day.operatingState) return renderStateCheck();
  if(nightReentry(state.activeWake)) return renderNightReentry();
  if(['down','anchoring'].includes(state.day.operatingState)) return renderAnchor();
  if(state.day.operatingState==='online') return renderOnline();
  if(['functional','engaged','deep'].includes(state.day.operatingState)) return renderContract();
  return renderStateCheck();
}

function renderStateCheck(){return card(`<div class="eyebrow">OPERATING STATE</div><h1 class="hero">Where are you right now?</h1><p class="sub">Choose the observable condition, not a mood score. The interface will narrow or widen from here.</p>
  <div class="grid2">
    <button class="choice" data-state="down"><strong>I can't really get started</strong><span>Use Anchor mode; one executable action at a time.</span></button>
    <button class="choice" data-state="online"><strong>I'm up, but foggy / depleted</strong><span>Use a low-ignition bridge into meaningful work.</span></button>
    <button class="choice" data-state="functional"><strong>I'm functional</strong><span>Set the operating envelope and generate a contract.</span></button>
    <button class="choice" data-state="already"><strong>I'm already working</strong><span>Protect useful engagement instead of interrupting it.</span></button>
  </div>`)}

function renderAnchor(){
  if(anchorCoreReached(state.day)) return card(`<div class="eyebrow">ANCHOR · CORE FLOOR</div><h1 class="hero">The core recovery floor is complete.</h1><p class="sub">Medication check, food, hydration, getting upright, and basic state-change actions have been traversed. Reassess now rather than forcing optional scaffolding that may no longer be needed.</p>${button('REASSESS STATE NOW','anchor-reassess','primary')}${button('CONTINUE OPTIONAL ANCHORS','anchor-continue','ghost')}`);
  const a=nextAnchor(state.day);
  const done=(state.day.anchor?.completed||[]).length;
  if(!a) return card(`<div class="eyebrow">ANCHOR COMPLETE</div><h1 class="hero">Infrastructure restored enough to reassess.</h1><p class="sub">This is not an instruction to stop. Reclassify the state that actually exists now.</p>${button('RECHECK STATE','state-check','primary')}`);
  const pct=Math.min(100,Math.round((done/ANCHOR_ACTIONS.length)*100));
  return card(`<div class="eyebrow">ANCHOR · ${a.isDecomposition?'DECOMPOSED STEP':'NOW'}</div><h1 class="hero">${esc(a.title)}</h1><p class="sub">${esc(a.detail)}</p><div class="rule"></div><div class="progress"><div style="width:${pct}%"></div></div><div class="meta">${done} anchor transitions completed. The rest remain hidden.</div>
    ${button('DONE','anchor-done','primary')}${button('ALREADY DID IT','anchor-already','ghost')}${button("CAN'T / NOT NOW",'anchor-cant','ghost')}
    <div class="rule"></div><div class="callout">Anchor mode measures state transition, not virtue. Medication actions mean following the prescription directions; the app never alters dose or timing.</div>`);
}

function recommendedBridge(){
  const eligible=state.portfolio.filter(x=>x.cond.governed);
  const rank={breach:4,pressure:3,watch:2,green:1};const ignition={low:3,medium:2,high:1};
  eligible.sort((a,b)=>{
    const aAction=a.cond.continuityActionable?rank[a.cond.continuity]:0;
    const bAction=b.cond.continuityActionable?rank[b.cond.continuity]:0;
    return (bAction-aAction)||(ignition[b.domain.ignition]-ignition[a.domain.ignition])||a.domain.name.localeCompare(b.domain.name);
  });
  return eligible.find(x=>x.cond.continuityActionable)||eligible[0]||state.portfolio.find(x=>x.domain.mode==='restorative');
}
function renderOnline(){
  const rec=recommendedBridge();if(!rec)return renderContract();
  const bridge=rec.domain.bridge?.[0]||`Reopen ${rec.domain.name}.`;
  return card(`<div class="eyebrow">ONLINE · BRIDGE</div><h1 class="hero">${esc(rec.domain.name)}</h1><p class="sub">${esc(bridge)}</p><div class="rule"></div><div class="inline">${rec.cond.governed?badge(rec.cond.continuity):badge('green','UNMETERED')}${conditionMeta(rec)}</div>
    ${button('BEGIN CONTACT','begin-bridge','primary')}${button('I AM FUNCTIONAL NOW','to-functional','ghost')}${button('START SOMETHING ELSE','manual-work','ghost')}${button('RETURN TO ANCHOR','to-anchor','ghost')}`);
}
function renderNightReentry(){return card(`<div class="eyebrow">LATE / SECOND WAKE</div><h1 class="hero">Do not manufacture a replacement daytime.</h1><p class="sub">The normal catch-up contract is suppressed for this wake episode. Quiet, bounded work remains available, and you can override deliberately if circumstances genuinely require it.</p>
  ${button('QUIET CONTACT / READING','night-quiet','primary')}${button('START ANY TRAJECTORY','manual-work','ghost')}${button('RECHECK BASIC STATE','state-check','ghost')}${button('OVERRIDE: PLAN NORMALLY','night-override','ghost')}${button('END WAKE EPISODE','end-wake','ghost')}
  <div class="rule"></div><div class="callout warn">This is a productivity rule, not sleep-treatment advice. Persistent or severe sleep disruption belongs with your clinician/prescriber.</div>`)}

function renderEnvelope(){
  const e=state.day.envelope||{};
  const caps=[30,60,120,240,360];
  return card(`<div class="eyebrow">OPERATING ENVELOPE</div><h1 class="hero">What capacity actually exists?</h1><p class="sub">The envelope changes recommendation geometry; it does not create obligations.</p>
    <label>Discretionary time today</label><div class="capacity-grid">${caps.map(m=>`<button class="choice ${e.minutes===m?'selected':''}" data-minutes="${m}"><strong>${m===30?'~30m':m===60?'~1h':m===120?'~2h':m===240?'~4h':'6h+'}</strong><span>Usable non-obligatory time</span></button>`).join('')}</div>
    <label>Cognitive endurance</label><div class="grid3">${[['fragile','Fragile'],['normal','Normal'],['strong','Strong']].map(([v,l])=>`<button class="choice ${e.cognition===v?'selected':''}" data-cognition="${v}"><strong>${l}</strong><span>${v==='fragile'?'Favor low ignition':v==='normal'?'Ordinary working range':'Deep work plausible'}</span></button>`).join('')}</div>
    <label>Fixed paid-work obligation</label><div class="grid3"><button class="choice ${e.fixedWork===null?'selected':''}" data-work="auto"><strong>AUTO</strong><span>Use configured work-day default.</span></button><button class="choice ${e.fixedWork===true?'selected':''}" data-work="true"><strong>YES</strong><span>Work is structurally fixed.</span></button><button class="choice ${e.fixedWork===false?'selected':''}" data-work="false"><strong>NO</strong><span>No fixed work block.</span></button></div>
    ${button('GENERATE DAILY CONTRACT','generate','primary')}${button('START ANY TRAJECTORY','manual-work','ghost')}${button('LOG COMPLETED WORK','log-work','ghost')}`);
}

function renderContract(){
  if(!state.day.contract)return renderEnvelope();
  const c=state.day.contract;const byId=id=>state.portfolio.find(x=>x.domain.id===id);
  const primary=byId(c.primaryId);
  const cont=(c.continuityIds||[]).map(byId).filter(Boolean);
  const physical=byId(c.physicalId);
  const protectedD=(c.protectedIds||[]).map(byId).filter(Boolean);
  const unresolved=(c.unresolvedIds||[]).map(byId).filter(Boolean);
  const satisfied=(c.todaySatisfiedIds||[]).map(byId).filter(Boolean);
  const metrics=x=>`${cadenceText(x)} · ${depthText(x)}`;
  const primaryLabel=c.primaryKind==='repair'?'PRIMARY REPAIR':'PRIMARY INVESTMENT';
  const primaryDose=c.primaryDose||'advance';
  return `<div>
    ${c.fixedWork?(()=>{const w=byId(c.workId||'work');const wid=w?.domain.id||c.workId||'work';const wname=w?.domain.name||'Paid Work';return card(`<div class="eyebrow">FIXED</div><h2 class="hero" style="font-size:24px">${esc(wname)}</h2><p class="sub">External obligation is treated as an anchor, not as proof that every mastery trajectory was trained.</p><button class="btn ghost" data-start-domain="${wid}" data-dose="advance">BEGIN WORK BLOCK</button>` )})():''}
    ${primary?card(`<div class="eyebrow">${primaryLabel}</div><h1 class="hero">${esc(primary.domain.name)}</h1><p class="sub">${esc(primary.domain.frontier)}</p><div class="metric-stack"><div>${badge(primary.cond.continuity)}<span>${cadenceText(primary)}</span></div><div>${badge(primary.cond.depthBand,'DEPTH '+bandLabel(primary.cond.depthBand))}<span>${depthText(primary)}</span></div></div><div class="callout">${esc(c.primaryReason||'Selected by the governor.')}</div><div class="dose-callout"><strong>${doseText(primaryDose)}</strong><span>${doseRange(primaryDose)} · recommendation, not a timer cap</span></div><button class="btn primary" data-start-domain="${primary.domain.id}" data-dose="${primaryDose}">BEGIN ${doseText(primaryDose)}</button>${button('OVERRIDE PRIMARY','override-primary','ghost')}`):card(`<div class="eyebrow">PRIMARY</div><h1 class="hero">No primary block is warranted.</h1><p class="sub">No actionable deficit fits the current envelope, and the envelope does not justify a discretionary advancement block.</p>`)}
    ${cont.length?card(`<div class="eyebrow">CONTINUITY</div>${cont.map(x=>{const d=c.recommendedDoses?.[x.domain.id]||'maintenance';return `<div class="domain"><div class="domain-head"><div class="domain-name">${esc(x.domain.name)}</div>${badge(x.cond.continuity)}</div><div class="meta">${metrics(x)}</div><div class="meta">${esc(x.domain.bridge?.[0]||'Meaningful contact.')}</div><button class="btn small ghost" data-start-domain="${x.domain.id}" data-dose="${d}">BEGIN ${doseText(d)}</button></div>`}).join('')}`):''}
    ${physical?card(`<div class="eyebrow">PHYSICAL</div><div class="domain-head"><div class="domain-name">FOUNDATION / 28</div>${badge(physical.cond.overallBand)}</div><p class="sub">${metrics(physical)}. GOVERNOR schedules the need for contact/depth; FOUNDATION / 28 determines what is physically appropriate.</p><button class="btn ghost" data-start-domain="physical" data-dose="${c.recommendedDoses?.physical||'maintenance'}">LOG / BEGIN PHYSICAL ${doseText(c.recommendedDoses?.physical||'maintenance')}</button>`):''}
    ${satisfied.length?card(`<div class="eyebrow">TODAY SATISFIED</div><div class="callout">These trajectories remain below a rolling target, but today already contains the relevant distinct contact/depth day. Another same-day block cannot repair that count, so GOVERNOR will not repeatedly prescribe them.</div>${satisfied.map(x=>`<div class="domain"><div class="domain-head"><div class="domain-name">${esc(x.domain.name)}</div>${badge('green','TODAY DONE')}</div><div class="meta">${metrics(x)}</div><button class="btn small ghost" data-manual-domain="${x.domain.id}">WORK ANYWAY</button></div>`).join('')}`):''}
    ${unresolved.length?card(`<div class="eyebrow">UNRESOLVED AFTER CONTRACT</div><div class="callout warn">These deficits are not repaired by the recommended blocks inside the current time/context envelope. A trajectory may appear here even when it also has a shallow scheduled block if depth still cannot be repaired.</div>${unresolved.map(x=>{const r=c.unresolvedReasons?.[x.domain.id]||[];return `<div class="domain"><div class="domain-head"><div class="domain-name">${esc(x.domain.name)}</div>${badge(x.cond.overallBand)}</div><div class="meta">${metrics(x)}</div><div class="meta">Remaining: ${r.map(v=>v.toUpperCase()).join(' + ')||'unspecified constraint'}</div><button class="btn small ghost" data-manual-domain="${x.domain.id}">START ANYWAY</button></div>`}).join('')}`):''}
    ${card(`<div class="eyebrow">PROTECTED TODAY</div><div class="smallprint">Protected now means exactly: all governed rolling targets are currently on target. It never disables voluntary work.</div>${protectedD.length?protectedD.map(x=>`<div class="domain"><div class="domain-head"><div class="domain-name">${esc(x.domain.name)}</div>${badge('green')}</div><div class="meta">${metrics(x)} · Last contact: ${humanAgo(x.cond.contactDays)}.</div><button class="btn small ghost" data-manual-domain="${x.domain.id}">START ANYWAY</button></div>`).join(''):'<div class="sub">No additional governed trajectories are fully protected right now.</div>'}${button('START ANY TRAJECTORY','manual-work','ghost')}${button('LOG COMPLETED WORK','log-work','ghost')}`)}
    ${card(`<div class="inline"><button class="btn small ghost" data-action="recalc">RECALCULATE</button><button class="btn small ghost" data-action="state-check">STATE CHANGED</button><button class="btn small ghost" data-action="close-day">CLOSE DAY</button></div><div class="smallprint" style="margin-top:9px">Serious contexts: ${c.contextsUsed}/${c.contextLimit}. Recommended dose floors: ${c.plannedMinutesFloor||0}/${c.timeBudgetMinutes||0} discretionary minutes. ${Math.max(0,c.remainingMinutesFloor||0)}m remains unallocated.</div>`,'flat')}
  </div>`;
}

function renderActiveBlock(){
  const p=state.portfolio.find(x=>x.domain.id===state.currentBlock.domainId);const name=p?.domain.name||state.currentBlock.domainId;
  const paused=!!state.currentBlock.pausedAt;
  return card(`<div class="eyebrow">${paused?'PAUSED':state.currentBlock.protected?'DEEP · PROTECTED':'ACTIVE BLOCK'}</div><h1 class="hero">${esc(name)}</h1><p class="sub">${esc(p?.domain.frontier||'')}</p><div id="timer" class="timer ${paused?'paused':''}">00:00</div><div class="meta">Planned dose: ${doseText(state.currentBlock.plannedDose)} · ${doseRange(state.currentBlock.plannedDose)}</div>
    ${paused?button('RESUME','resume','primary'):button('PAUSE','pause','ghost')}${!state.currentBlock.protected?button('PROTECT THIS','protect','primary'):''}${button('FINISH BLOCK','finish','ghost')}${button('ABANDON / RECALCULATE','abandon','ghost')}`);
}

function renderPortfolio(){
  return `<div>${card(`<div class="eyebrow">PORTFOLIO</div><h1 class="hero">Trajectory control.</h1><p class="sub">Weekly cadence and 28-day depth are distinct-day targets. Restorative, anchor and dormant modes remain manually usable but do not create governor pressure.</p>${button('START ANY TRAJECTORY','manual-work','primary')}${button('LOG COMPLETED WORK','log-work','ghost')}${button('ADD TRAJECTORY','add-domain','ghost')}`)}
    ${state.portfolio.map(x=>{
      const c=x.cond;
      const gov=c.governed;
      return card(`<div class="domain-head"><div><div class="domain-name">${esc(x.domain.name)}</div><div class="meta">${modeLabel(x.domain.mode)} · ignition ${esc(x.domain.ignition)}</div></div>${gov?badge(c.overallBand):badge('green',x.domain.mode==='dormant'?'DORMANT':'UNMETERED')}</div><div class="rule"></div><div class="sub">${esc(x.domain.frontier)}</div>
        ${gov?`<div class="metric-row"><span>Continuity</span><strong>${c.contactCount7}/${c.continuityTarget}</strong>${badge(c.continuity)}</div><div class="metric-row"><span>Depth</span><strong>${c.depthCount28}/${c.depthTarget}</strong>${badge(c.depthBand)}</div><div class="kv"><span>Today</span><strong>${c.deepToday?'DEEP RECORDED':c.contactToday?'CONTACT RECORDED':'NO DOSE YET'}</strong></div><div class="kv"><span>Last contact</span><strong>${humanAgo(c.contactDays)}</strong></div><div class="kv"><span>Last advance</span><strong>${humanAgo(c.depthDays)}</strong></div>`:`<div class="callout">This mode is not scheduled automatically. Any work you log still appears in activity history.</div>`}
        <div class="inline"><button class="btn small primary" data-manual-domain="${x.domain.id}">START</button><button class="btn small ghost" data-log-domain="${x.domain.id}">LOG DONE</button><button class="btn small ghost" data-edit-domain="${x.domain.id}">EDIT</button></div>`)
    }).join('')}</div>`;
}

function blocksInWindow(days){
  const keys=new Set(rollingDateKeys(days));
  return state.blocks.filter(b=>b.status==='completed'&&keys.has(b.dateKey||localDateKey(b.endedAt)));
}
function summarize(days){
  const blocks=blocksInWindow(days);
  return state.portfolio.map(x=>{
    const bs=blocks.filter(b=>b.domainId===x.domain.id);
    const contactDays=new Set(bs.map(b=>b.dateKey||localDateKey(b.endedAt))).size;
    const deepDays=new Set(bs.filter(b=>['advance','surge'].includes(b.dose)).map(b=>b.dateKey||localDateKey(b.endedAt))).size;
    return {name:x.domain.name,governed:x.cond.governed,condition:x.cond.overallBand,contactDays,deepDays,minutes:bs.reduce((sum,b)=>sum+(b.minutes||0),0),continuityTarget:x.cond.continuityTarget,depthTarget:x.cond.depthTarget};
  });
}
function cadenceMatrix(){
  const keys=rollingDateKeys(7).reverse();
  const byDomain=new Map(state.portfolio.map(x=>[x.domain.id,x]));
  const rows=[...byDomain.values()].map(x=>{
    const cells=keys.map(k=>{
      const bs=state.blocks.filter(b=>b.domainId===x.domain.id&&b.status==='completed'&&(b.dateKey||localDateKey(b.endedAt))===k);
      const deep=bs.some(b=>['advance','surge'].includes(b.dose));
      const contact=bs.length>0;
      return `<td class="cad-cell ${deep?'deep':contact?'contact':'empty'}" title="${esc(x.domain.name)} · ${k}">${deep?'D':contact?'C':'·'}</td>`;
    }).join('');
    return `<tr><td class="cad-name">${esc(x.domain.name)}</td>${cells}</tr>`;
  }).join('');
  return `<div class="matrix-wrap"><table class="matrix"><thead><tr><th></th>${keys.map(k=>`<th><span>${fmtWeekdayKey(k)}</span><small>${fmtDateKey(k)}</small></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div><div class="matrix-legend"><span><b class="dot contact"></b>C = contact/maintenance</span><span><b class="dot deep"></b>D = advance/surge</span></div>`;
}
function recentActivity(){
  const rows=[...state.blocks].filter(b=>['completed','abandoned'].includes(b.status)).sort((a,b)=>(b.endedAt||0)-(a.endedAt||0)).slice(0,30);
  if(!rows.length)return '<div class="empty">No recorded blocks yet.</div>';
  return rows.map(b=>{
    const p=state.portfolio.find(x=>x.domain.id===b.domainId);const name=p?.domain.name||b.domainId;
    return `<div class="activity"><div><div class="activity-title">${esc(name)} ${b.status==='abandoned'?badge('watch','ABANDONED'):badge('green',doseText(b.dose))}</div><div class="meta">${fmtDateKey(b.dateKey||localDateKey(b.endedAt))} · ${b.minutes||0}m · ${esc(b.source||'recorded')}${b.note?` · ${esc(b.note)}`:''}</div></div><div class="inline">${b.status==='completed'?`<button class="btn small ghost" data-edit-block="${b.id}">EDIT</button>`:''}<button class="btn small danger" data-delete-block="${b.id}">DELETE</button></div></div>`;
  }).join('');
}
function renderReview(){
  const rows7=summarize(7),rows28=summarize(28);
  const table7=`<div class="table-wrap"><table class="table"><thead><tr><th>Domain</th><th>Status</th><th>Contact</th><th>Target</th></tr></thead><tbody>${rows7.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.governed?bandLabel(r.condition):'UNMETERED'}</td><td>${r.contactDays}</td><td>${r.governed?r.continuityTarget:'—'}</td></tr>`).join('')}</tbody></table></div>`;
  const table28=`<div class="table-wrap"><table class="table"><thead><tr><th>Domain</th><th>Deep days</th><th>Target</th><th>Minutes</th></tr></thead><tbody>${rows28.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.deepDays}</td><td>${r.governed?r.depthTarget:'—'}</td><td>${r.minutes}</td></tr>`).join('')}</tbody></table></div>`;
  return `${card(`<div class="eyebrow">7-DAY EVIDENCE</div><h1 class="hero">What actually happened.</h1><p class="sub">Each cell represents one calendar day. Multiple same-day blocks still create only one cadence day.</p>${cadenceMatrix()}${table7}`)}${card(`<div class="eyebrow">28-DAY DEPTH</div><h1 class="hero">Substantive exposure.</h1><p class="sub">Only ADVANCE or SURGE creates a deep day.</p>${table28}`)}${card(`<div class="eyebrow">ACTIVITY LEDGER</div><h1 class="hero" style="font-size:26px">Correctable evidence.</h1><p class="sub">Mistakes are not permanent. Edit a completed record or delete a bad entry; trajectory conditions recalculate immediately.</p>${button('LOG COMPLETED WORK','log-work','ghost')}${recentActivity()}`)}`;
}

function renderSystem(){
  const ctx=state.settings.contextSwitchLimit??3;const maxC=state.settings.maxContinuityItems??2;
  return `${card(`<div class="eyebrow">SYSTEM</div><h1 class="hero">Local-first instrument.</h1><div class="kv"><span>Version</span><strong>${APP_VERSION}</strong></div><div class="kv"><span>Storage</span><strong id="storage-status">checking…</strong></div>${button('REQUEST PERSISTENT STORAGE','persist','ghost')}`)}
    ${card(`<div class="eyebrow">GOVERNOR LIMITS</div><p class="sub">These constrain automatic contracts, not voluntary work.</p><label>Serious contexts per day</label><div class="grid3">${[2,3,4].map(n=>`<button class="choice ${ctx===n?'selected':''}" data-setting-context="${n}"><strong>${n}</strong><span>Paid work and primary blocks consume this ceiling.</span></button>`).join('')}</div><label>Maximum continuity slots</label><div class="grid3">${[1,2,3].map(n=>`<button class="choice ${maxC===n?'selected':''}" data-setting-continuity="${n}"><strong>${n}</strong><span>Upper bound after context/time limits.</span></button>`).join('')}</div><div class="callout">Default paid-work days remain Monday–Friday when the daily envelope is set to AUTO. YES/NO always overrides the default for the current day.</div>`)}
    ${card(`<div class="eyebrow">WAKE EPISODE</div>${state.activeWake?`<div class="sub">Wake ${state.activeWake.index} began ${fmtTime(state.activeWake.startedAt)}${localDateKey(state.activeWake.startedAt)!==localDateKey()?` on ${fmtDateKey(localDateKey(state.activeWake.startedAt))}`:''}. Open wake episodes now persist across midnight.</div>${button('END CURRENT WAKE EPISODE','end-wake','ghost')}`:`<div class="sub">No wake episode is active.</div>${button('START WAKE EPISODE','start-wake','primary')}`}`)}
    ${card(`<div class="eyebrow">BACKUP</div><p class="sub">GitHub contains application code only. Personal state remains on this device unless exported.</p>${button('EXPORT JSON BACKUP','export','ghost')}${button('IMPORT JSON BACKUP','import','ghost')}<input type="file" id="import-file" accept="application/json" class="hidden" />`)}
    ${card(`<div class="eyebrow">CLINICAL BOUNDARY</div><div class="callout warn">This app is not medical treatment. Medication entries only track whether prescribed instructions were handled; GOVERNOR does not recommend dose changes or missed-dose compensation. Persistent major sleep, appetite, mood, or functioning changes deserve discussion with a qualified clinician.</div><div class="rule"></div><div class="smallprint">If you become at risk of harming yourself or unable to keep yourself safe in the U.S., call or text 988 or use emergency services for immediate danger.</div>`)}
    ${card(`<div class="eyebrow">DESTRUCTIVE</div>${button('WIPE LOCAL DATABASE','wipe','danger')}`)}`;
}

function domainModal(domain=null){
  const d=domain||{id:'',name:'',mode:'build',frontier:'',continuityTarget7:3,depthTarget28:4,ignition:'medium',immersion:'high',bridge:[''],active:true,notes:''};
  const cont=getContinuityTarget(d),depth=getDepthTarget(d);
  return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">${domain?'EDIT':'ADMISSION CONTROL'}</div><h2 class="hero modal-title">${domain?'Trajectory settings':'Add a top-level trajectory'}</h2>${!domain?`<div class="callout warn">Before adding this, ask whether it is actually a project beneath an existing domain. A new trajectory consumes portfolio capacity.</div>`:''}
    <label>Name</label><input id="m-name" value="${esc(d.name)}" />
    <label>Current frontier</label><textarea id="m-frontier">${esc(d.frontier)}</textarea>
    <div class="form-row"><div><label>Strategic mode</label><select id="m-mode">${MODES.map(m=>`<option value="${m}" ${d.mode===m?'selected':''}>${m.toUpperCase()}</option>`).join('')}</select></div><div><label>Ignition cost</label><select id="m-ignition">${['low','medium','high'].map(v=>`<option value="${v}" ${d.ignition===v?'selected':''}>${v.toUpperCase()}</option>`).join('')}</select></div></div>
    <div class="field-help"><strong>Mode:</strong> SURGE temporarily elevates investment; BUILD develops normally; MAINTAIN preserves; ANCHOR is an external obligation; RESTORATIVE stays available but unmetered; DORMANT is intentionally unscheduled. <strong>Ignition:</strong> how hard the activity is to start from a depleted state—not how important it is.</div>
    <label>Continuity target — contact days per rolling 7 days</label><input id="m-cont" type="number" min="0" max="7" inputmode="numeric" value="${cont}" />
    <div class="field-help"><strong>Meaning:</strong> distinct calendar days containing any completed CONTACT, MAINTENANCE, ADVANCE, or SURGE. Multiple blocks on one day still count once. Example: 6 means six contact days in every rolling seven-day window. Set 0 for no quota.</div>
    <label>Depth target — ADVANCE/SURGE days per rolling 28 days</label><input id="m-depth" type="number" min="0" max="28" inputmode="numeric" value="${depth}" />
    <div class="field-help"><strong>Meaning:</strong> distinct days containing ADVANCE or SURGE. CONTACT and MAINTENANCE do not satisfy depth. Example: 4 means four substantive developmental days per rolling 28 days.</div>
    <div class="callout">Targets are rolling evidence thresholds, not owed hours. After a contact/depth day has already been recorded today, GOVERNOR will not keep prescribing the same trajectory merely because the longer rolling window remains below target.</div>
    <label>Bridge actions — one per line</label><textarea id="m-bridge">${esc((d.bridge||[]).join('\n'))}</textarea>
    ${button('SAVE TRAJECTORY','save-domain','primary')}${domain?button('DELETE TRAJECTORY','delete-domain','danger'):''}${button('CANCEL','close-modal','ghost')}<input type="hidden" id="m-id" value="${esc(d.id)}" /></div></div>`;
}
function manualWorkModal(){
  const opts=state.portfolio.filter(x=>x.domain.active!==false);
  return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">MANUAL WORK</div><h2 class="hero modal-title">Start any trajectory.</h2><p class="sub">Governor status is advisory. Protected and unmetered trajectories remain available.</p>${opts.map(x=>`<button class="btn" data-manual-domain="${x.domain.id}"><span class="manual-row"><strong>${esc(x.domain.name)}</strong><span>${x.cond.governed?`${x.cond.contactCount7}/${x.cond.continuityTarget} · ${bandLabel(x.cond.overallBand)}`:'UNMETERED'}</span></span></button>`).join('')}${button('LOG COMPLETED INSTEAD','log-work','ghost')}${button('CANCEL','close-modal','ghost')}</div></div>`;
}
function manualDoseModal(domainId){
  const x=state.portfolio.find(p=>p.domain.id===domainId);if(!x)return '';
  return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">${esc(x.domain.name)}</div><h2 class="hero modal-title">What are you starting?</h2><p class="sub">Choose intended dose. Reclassify the actual dose when you finish.</p><div class="grid2">${DOSES.map(d=>`<button class="choice" data-manual-dose="${d}" data-manual-dose-domain="${domainId}"><strong>${doseText(d)}</strong><span>${esc(DOSE_META[d].hint)} ${doseRange(d)}</span></button>`).join('')}</div>${button('BACK','manual-work','ghost')}${button('CANCEL','close-modal','ghost')}</div></div>`;
}
function manualLogDomainModal(){
  const opts=state.portfolio.filter(x=>x.domain.active!==false);
  return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">BACKFILL</div><h2 class="hero modal-title">Log work already completed.</h2><p class="sub">Use this when you worked without starting the timer. Backfilled entries affect cadence/depth exactly like timed completed blocks.</p>${opts.map(x=>`<button class="btn" data-log-domain="${x.domain.id}">${esc(x.domain.name)}</button>`).join('')}${button('CANCEL','close-modal','ghost')}</div></div>`;
}
function manualLogEntryModal(domainId){
  const x=state.portfolio.find(p=>p.domain.id===domainId);if(!x)return '';
  return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">BACKFILL · ${esc(x.domain.name)}</div><h2 class="hero modal-title">Record completed work.</h2><label>Dose</label><select id="log-dose">${DOSES.map(d=>`<option value="${d}">${doseText(d)}</option>`).join('')}</select><label>Date</label><input id="log-date" type="date" max="${localDateKey()}" value="${localDateKey()}" /><label>Actual minutes</label><input id="log-minutes" type="number" min="1" max="1440" inputmode="numeric" value="30" /><label>Optional note</label><textarea id="log-note"></textarea><input type="hidden" id="log-domain" value="${esc(domainId)}" />${button('SAVE COMPLETED BLOCK','save-log','primary')}${button('BACK','log-work','ghost')}${button('CANCEL','close-modal','ghost')}</div></div>`;
}
function finishModal(){return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">FINISH BLOCK</div><h2 class="hero modal-title">What did this become?</h2><p class="sub">Classify actual dose. Paused time is excluded automatically.</p><div class="grid2">${DOSES.map(d=>`<button class="choice" data-finish-dose="${d}"><strong>${doseText(d)}</strong><span>${esc(DOSE_META[d].hint)}</span></button>`).join('')}</div><label>Optional note</label><textarea id="finish-note" placeholder="Only if context matters."></textarea>${button('CANCEL','close-modal','ghost')}</div></div>`}
function overrideModal(){return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">OVERRIDE</div><h2 class="hero modal-title">Choose the better reality.</h2><p class="sub">Manual judgment is legitimate. Pick another active trajectory; no justification is required.</p>${state.portfolio.filter(x=>x.domain.active!==false&&x.domain.mode!=='dormant').map(x=>`<button class="btn" data-override-domain="${x.domain.id}">${esc(x.domain.name)} <span class="meta">· ${x.cond.governed?bandLabel(x.cond.overallBand):'UNMETERED'}</span></button>`).join('')}${button('CANCEL','close-modal','ghost')}</div></div>`}
function closeDayModal(){return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">CLOSE DAY</div><h2 class="hero modal-title">Reconcile; do not repay.</h2><p class="sub">No missed hours are carried forward. Tomorrow inherits trajectory condition, not guilt debt.</p><label>Optional one-line context</label><textarea id="close-note"></textarea>${button('CLOSE TODAY','confirm-close','primary')}${button('CANCEL','close-modal','ghost')}</div></div>`}
function editBlockModal(blockId){
  const b=state.blocks.find(x=>x.id===blockId);if(!b)return '';
  const options=state.portfolio.map(x=>`<option value="${x.domain.id}" ${x.domain.id===b.domainId?'selected':''}>${esc(x.domain.name)}</option>`).join('');
  return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">CORRECT RECORD</div><h2 class="hero modal-title">Edit completed evidence.</h2><label>Trajectory</label><select id="edit-block-domain">${options}</select><label>Dose</label><select id="edit-block-dose">${DOSES.map(d=>`<option value="${d}" ${d===b.dose?'selected':''}>${doseText(d)}</option>`).join('')}</select><label>Date</label><input id="edit-block-date" type="date" max="${localDateKey()}" value="${esc(b.dateKey||localDateKey(b.endedAt))}" /><label>Actual minutes</label><input id="edit-block-minutes" type="number" min="1" max="1440" value="${Math.max(1,b.minutes||1)}" /><label>Note</label><textarea id="edit-block-note">${esc(b.note||'')}</textarea><input type="hidden" id="edit-block-id" value="${esc(b.id)}" />${button('SAVE CORRECTION','save-block-edit','primary')}${button('DELETE RECORD','delete-block-modal','danger')}${button('CANCEL','close-modal','ghost')}</div></div>`;
}

function startTimerDisplay(){
  const el=document.querySelector('#timer');if(!el||!state.currentBlock)return;
  const tick=()=>{const s=Math.floor(elapsedBlockMs(state.currentBlock)/1000);const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;el.textContent=h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`};
  tick();if(!state.currentBlock.pausedAt)state.timer=setInterval(tick,1000);
}

async function setView(v){state.view=v;state.settings.lastView=v;await saveSettings(state.settings);render()}
async function chooseState(v){
  if(v==='already'){
    const opts=state.portfolio.filter(x=>x.domain.active!==false&&x.domain.mode!=='dormant');
    state.modal=`<div class="modal-backdrop"><div class="modal"><div class="eyebrow">ALREADY WORKING</div><h2 class="hero modal-title">Protect the useful state.</h2>${opts.map(x=>`<button class="btn" data-already-domain="${x.domain.id}">${esc(x.domain.name)}</button>`).join('')}${button('CANCEL','close-modal','ghost')}</div></div>`;render();return;
  }
  if(v==='down'&&(state.day.anchor?.index||0)>=ANCHOR_ACTIONS.length){state.day.anchor={index:0,decompositionIndex:null,completed:[],skipped:[],optionalConfirmed:false};await put('days',state.day)}
  await setOperatingState(state.day,v);await refresh();
}

async function bindDataButtons(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
  document.querySelectorAll('[data-state]').forEach(b=>b.onclick=()=>chooseState(b.dataset.state));
  document.querySelectorAll('[data-minutes]').forEach(b=>b.onclick=async()=>{await saveEnvelope(state.day,{minutes:+b.dataset.minutes});await refresh()});
  document.querySelectorAll('[data-cognition]').forEach(b=>b.onclick=async()=>{await saveEnvelope(state.day,{cognition:b.dataset.cognition});await refresh()});
  document.querySelectorAll('[data-work]').forEach(b=>b.onclick=async()=>{const v=b.dataset.work==='auto'?null:b.dataset.work==='true';await saveEnvelope(state.day,{fixedWork:v});await refresh()});
  document.querySelectorAll('[data-start-domain]').forEach(b=>b.onclick=async()=>{await startBlock(state.day,b.dataset.startDomain,b.dataset.dose||'maintenance','contract');await refresh()});
  document.querySelectorAll('[data-edit-domain]').forEach(b=>b.onclick=async()=>{const d=await get('domains',b.dataset.editDomain);state.modal=domainModal(d);render()});
  document.querySelectorAll('[data-manual-domain]').forEach(b=>b.onclick=()=>{state.modal=manualDoseModal(b.dataset.manualDomain);render()});
  document.querySelectorAll('[data-manual-dose]').forEach(b=>b.onclick=async()=>{const domainId=b.dataset.manualDoseDomain,dose=b.dataset.manualDose;state.modal=null;await startBlock(state.day,domainId,dose,'manual');await refresh()});
  document.querySelectorAll('[data-finish-dose]').forEach(b=>b.onclick=async()=>{const note=document.querySelector('#finish-note')?.value||'';state.modal=null;await finishBlock(state.day,state.currentBlock,b.dataset.finishDose,note);await refresh()});
  document.querySelectorAll('[data-override-domain]').forEach(b=>b.onclick=async()=>{state.modal=null;await startBlock(state.day,b.dataset.overrideDomain,'advance','override');await refresh()});
  document.querySelectorAll('[data-already-domain]').forEach(b=>b.onclick=async()=>{state.modal=null;await startBlock(state.day,b.dataset.alreadyDomain,'advance','already-working');state.currentBlock=await getCurrentBlock(state.day);await protectBlock(state.day,state.currentBlock);await refresh()});
  document.querySelectorAll('[data-log-domain]').forEach(b=>b.onclick=()=>{state.modal=manualLogEntryModal(b.dataset.logDomain);render()});
  document.querySelectorAll('[data-edit-block]').forEach(b=>b.onclick=()=>{state.modal=editBlockModal(b.dataset.editBlock);render()});
  document.querySelectorAll('[data-delete-block]').forEach(b=>b.onclick=()=>deleteBlockRecord(b.dataset.deleteBlock));
  document.querySelectorAll('[data-setting-context]').forEach(b=>b.onclick=async()=>{state.settings.contextSwitchLimit=+b.dataset.settingContext;await saveSettings(state.settings);await refresh()});
  document.querySelectorAll('[data-setting-continuity]').forEach(b=>b.onclick=async()=>{state.settings.maxContinuityItems=+b.dataset.settingContinuity;await saveSettings(state.settings);await refresh()});
}
function bind(){bindDataButtons();document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>handleAction(b.dataset.action));storageStatus()}

async function handleAction(a){
  if(a==='anchor-done'||a==='anchor-already'){await anchorDone(state.day,a==='anchor-already'?'already':'done');return refresh()}
  if(a==='anchor-cant'){await anchorCant(state.day);return refresh()}
  if(a==='anchor-reassess'){await setOperatingState(state.day,null);return refresh()}
  if(a==='anchor-continue'){await continueOptionalAnchors(state.day);return refresh()}
  if(a==='state-check'){await setOperatingState(state.day,null);return refresh()}
  if(a==='to-functional'){await setOperatingState(state.day,'functional');return refresh()}
  if(a==='to-anchor'){await setOperatingState(state.day,'anchoring');return refresh()}
  if(a==='begin-bridge'){const r=recommendedBridge();if(r)await startBlock(state.day,r.domain.id,'contact','bridge');return refresh()}
  if(a==='generate'){await generateContract(state.day);return refresh()}
  if(a==='recalc'){state.day.contract=null;await put('days',state.day);await generateContract(state.day);return refresh()}
  if(a==='protect'){await protectBlock(state.day,state.currentBlock);return refresh()}
  if(a==='pause'){await pauseBlock(state.day,state.currentBlock);return refresh()}
  if(a==='resume'){await resumeBlock(state.day,state.currentBlock);return refresh()}
  if(a==='finish'){state.modal=finishModal();return render()}
  if(a==='abandon'){await abandonBlock(state.day,state.currentBlock);return refresh()}
  if(a==='override-primary'){state.modal=overrideModal();return render()}
  if(a==='manual-work'){state.modal=manualWorkModal();return render()}
  if(a==='log-work'){state.modal=manualLogDomainModal();return render()}
  if(a==='save-log')return saveManualLog();
  if(a==='save-block-edit')return saveBlockEdit();
  if(a==='delete-block-modal'){const id=document.querySelector('#edit-block-id')?.value;return deleteBlockRecord(id)}
  if(a==='close-modal'){state.modal=null;return render()}
  if(a==='close-day'){state.modal=closeDayModal();return render()}
  if(a==='confirm-close'){const note=document.querySelector('#close-note')?.value||'';state.modal=null;await closeDay(state.day,note);return refresh()}
  if(a==='reopen'){state.day.closed=false;state.day.operatingState=null;await put('days',state.day);return refresh()}
  if(a==='end-wake'){if(state.currentBlock){alert('Finish or abandon the active block before ending the wake episode.');return}await endWakeEpisode(state.day);return refresh()}
  if(a==='start-wake'){await startWakeEpisode(state.day);return refresh()}
  if(a==='night-quiet'){const r=state.portfolio.find(x=>x.domain.mode==='restorative')||recommendedBridge();if(r)await startBlock(state.day,r.domain.id,'contact','night-quiet');return refresh()}
  if(a==='night-override'){state.activeWake.overrideNight=true;await put('wakeEpisodes',state.activeWake);state.day.operatingState='functional';await put('days',state.day);return refresh()}
  if(a==='add-domain'){state.modal=domainModal();return render()}
  if(a==='save-domain')return saveDomainFromModal();
  if(a==='delete-domain')return deleteDomainFromModal();
  if(a==='persist')return requestPersist();
  if(a==='export')return exportBackup();
  if(a==='import'){document.querySelector('#import-file')?.click();return}
  if(a==='wipe')return wipePrompt();
}
function nightReentry(ep){return isNightReentry(ep)&&!ep?.overrideNight}

async function saveDomainFromModal(){
  const id=document.querySelector('#m-id').value.trim()||`domain-${Date.now()}`;const existing=await get('domains',id);
  const continuityTarget7=Math.max(0,Math.min(7,Math.round(+document.querySelector('#m-cont').value||0)));
  const depthTarget28=Math.max(0,Math.min(28,Math.round(+document.querySelector('#m-depth').value||0)));
  const d={...(existing||{}),id,name:document.querySelector('#m-name').value.trim()||'Untitled',frontier:document.querySelector('#m-frontier').value.trim(),mode:document.querySelector('#m-mode').value,ignition:document.querySelector('#m-ignition').value,immersion:existing?.immersion||'high',continuityTarget7,depthTarget28,continuityDays:continuityTarget7,cadenceSemantics:2,bridge:document.querySelector('#m-bridge').value.split('\n').map(x=>x.trim()).filter(Boolean),active:true,notes:existing?.notes||'',createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};
  await put('domains',d);state.modal=null;await refresh();
}
async function deleteDomainFromModal(){
  const id=document.querySelector('#m-id').value;if(!id)return;
  if(state.currentBlock?.domainId===id){alert('Finish or abandon the active block before deleting its trajectory.');return}
  if(confirm('Delete this trajectory configuration? Historical blocks remain in the activity database.')){await del('domains',id);state.modal=null;await refresh()}
}
async function saveManualLog(){
  try{
    const domainId=document.querySelector('#log-domain')?.value,dose=document.querySelector('#log-dose')?.value,dateKey=document.querySelector('#log-date')?.value,minutes=+document.querySelector('#log-minutes')?.value,note=document.querySelector('#log-note')?.value||'';
    await logCompletedBlock({domainId,dose,dateKey,minutes,note});state.modal=null;state.day.contract=null;await put('days',state.day);await refresh();
  }catch(e){alert(`Could not save record: ${e.message}`)}
}
async function saveBlockEdit(){
  const id=document.querySelector('#edit-block-id')?.value;const block=await get('blocks',id);if(!block)return;
  const dateKey=document.querySelector('#edit-block-date')?.value;const mins=Math.max(1,Math.min(1440,Math.round(+document.querySelector('#edit-block-minutes')?.value||1)));
  if(!dateKey||dateKey>localDateKey()){alert('Record date must be today or earlier.');return}
  const parsed=dateKeyToLocalNoon(dateKey);if(parsed==null){alert('Invalid record date.');return}
  const base=dateKey===localDateKey()&&localDateKey(block.endedAt)===dateKey?block.endedAt:parsed;
  block.domainId=document.querySelector('#edit-block-domain')?.value||block.domainId;block.dose=document.querySelector('#edit-block-dose')?.value||block.dose;block.plannedDose=block.plannedDose||block.dose;block.dateKey=dateKey;block.completionDateKey=dateKey;block.minutes=mins;block.endedAt=base;block.startedAt=base-mins*60000;block.pausedAt=null;block.pausedMs=0;block.note=document.querySelector('#edit-block-note')?.value||'';
  await put('blocks',block);state.modal=null;state.day.contract=null;await put('days',state.day);await refresh();
}
async function deleteBlockRecord(id){
  if(!id)return;if(!confirm('Delete this recorded block? This immediately changes cadence/depth evidence.'))return;
  await del('blocks',id);if(state.day.currentBlockId===id){state.day.currentBlockId=null;await put('days',state.day)}state.modal=null;state.day.contract=null;await put('days',state.day);await refresh();
}

async function requestPersist(){if(!navigator.storage?.persist){alert('Persistent-storage API is not available in this browser. Backups remain recommended.');return}const ok=await navigator.storage.persist();alert(ok?'Persistent storage granted or already active.':'Persistent storage was not granted. The app still works; keep JSON backups.');storageStatus()}
async function storageStatus(){const el=document.querySelector('#storage-status');if(!el)return;if(!navigator.storage?.persisted){el.textContent='available · persistence unknown';return}el.textContent=(await navigator.storage.persisted())?'persistent':'best-effort'}
async function exportBackup(){const p=await exportAll();const blob=new Blob([JSON.stringify(p,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`governor-backup-${localDateKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function importBackupFile(file){try{const text=await file.text();const payload=JSON.parse(text);if(!confirm('Replace the entire local GOVERNOR database with this backup?'))return;await importAll(payload);alert('Backup imported.');location.reload()}catch(e){alert(`Import failed: ${e.message}`)}}
async function wipePrompt(){const phrase=prompt('Type WIPE GOVERNOR to permanently erase local app data on this browser.');if(phrase==='WIPE GOVERNOR'){await wipeAll();location.reload()}else if(phrase!==null)alert('Phrase did not match. Nothing was erased.')}
function attachFileImport(){document.addEventListener('change',e=>{if(e.target?.id==='import-file'&&e.target.files?.[0])importBackupFile(e.target.files[0])})}
async function registerSW(){if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('./sw.js')}catch(e){console.warn('Service worker registration failed',e)}}}

(async()=>{try{await hydrate();attachFileImport();render();await registerSW()}catch(e){console.error(e);app.innerHTML=`<main class="card"><div class="eyebrow">STARTUP FAILURE</div><h1 class="hero">GOVERNOR could not initialize.</h1><pre class="smallprint">${esc(e.stack||e.message)}</pre></main>`}})();
