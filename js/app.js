import {APP_VERSION, ANCHOR_ACTIONS, DOSES, MODES} from './model.js';
import {initDB,getToday,getAll,get,put,del,getSettings,saveSettings,exportAll,importAll,wipeAll,localDateKey} from './db.js';
import {computePortfolio,generateContract,nextAnchor,anchorDone,anchorCant,setOperatingState,saveEnvelope,startWakeEpisode,endWakeEpisode,getActiveWake,isNightReentry,startBlock,getCurrentBlock,protectBlock,finishBlock,abandonBlock,closeDay,getContinuityTarget,getDepthTarget} from './controller.js';

const app=document.querySelector('#app');
let state={day:null,settings:null,view:'now',portfolio:[],activeWake:null,currentBlock:null,timer:null,modal:null};

const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtDate=()=>new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'}).format(new Date()).toUpperCase();
const fmtTime=ts=>new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(ts));
const humanAgo=days=>!Number.isFinite(days)?'no recorded dose':days<.8?'today':days<1.8?'yesterday':`${Math.floor(days)}d ago`;
const bandLabel=b=>({green:'GREEN',watch:'WATCH',pressure:'PRESSURE',breach:'BREACH'}[b]||b.toUpperCase());
const modeLabel=m=>m.toUpperCase();
const cadenceText=x=>`${x.cond.contactCount7}/${x.cond.continuityTarget} contact days · rolling 7d`;
const depthText=x=>x.cond.depthTarget?`${x.cond.depthCount28}/${x.cond.depthTarget} deep days · rolling 28d`:'no depth quota';

function topbar(){
  const ep=state.activeWake;
  const chip=state.day?.operatingState?state.day.operatingState.toUpperCase():'UNSET';
  return `<header class="topbar"><div><div class="brand">GOVERNOR · ${APP_VERSION}</div><div class="date">${fmtDate()}</div>${ep?`<div class="meta">WAKE ${String(ep.index).padStart(2,'0')} · ${fmtTime(ep.startedAt)}</div>`:''}</div><div class="state-chip">${esc(chip)}</div></header>`;
}
function nav(){return `<nav class="nav"><div class="nav-inner">${['now','portfolio','review','system'].map(v=>`<button data-view="${v}" class="${state.view===v?'active':''}">${v}</button>`).join('')}</div></nav>`}
function card(inner,cls=''){return `<section class="card ${cls}">${inner}</section>`}
function button(label,action,cls=''){return `<button class="btn ${cls}" data-action="${action}">${label}</button>`}
function badge(b){return `<span class="badge ${b}">${bandLabel(b)}</span>`}

async function hydrate(){
  await initDB(); state.settings=await getSettings(); state.day=await getToday();
  if(state.day.contract && state.day.contract.cadenceModel!==1){await generateContract(state.day);state.day=await getToday()}
  state.activeWake=await getActiveWake(state.day); state.currentBlock=await getCurrentBlock(state.day); state.portfolio=await computePortfolio();
  if(!state.activeWake && !state.day.closed){ state.activeWake=await startWakeEpisode(state.day); state.day=await getToday(); }
  if(state.settings?.lastView) state.view=state.settings.lastView;
}

async function refresh(){
  state.day=await getToday(); state.activeWake=await getActiveWake(state.day); state.currentBlock=await getCurrentBlock(state.day); state.portfolio=await computePortfolio(); await loadBlocks(); render();
}

function render(){
  clearInterval(state.timer); state.timer=null;
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
  if(state.day.closed) return card(`<div class="eyebrow">DAY CLOSED</div><h1 class="hero">No catch-up ledger.</h1><p class="sub">Today is reconciled. Open a new wake episode only if this is genuinely part of the same calendar day and you need the app; otherwise leave the system closed.</p>${button('REOPEN TODAY','reopen','ghost')}`);
  if(!state.activeWake) return card(`<div class="eyebrow">WAKE EPISODE</div><h1 class="hero">No wake episode is active.</h1><p class="sub">Start one when you are genuinely awake again. This prevents a sleep interval from silently inheriting the prior working state.</p>${button('START WAKE EPISODE','start-wake','primary')}`);
  if(state.currentBlock) return renderActiveBlock();
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
      <button class="choice" data-state="functional"><strong>I'm functional</strong><span>Set today's operating envelope and generate a contract.</span></button>
      <button class="choice" data-state="already"><strong>I'm already working</strong><span>Protect the useful state instead of interrupting it.</span></button>
    </div>`)}

function renderAnchor(){
  const a=nextAnchor(state.day);
  const done=(state.day.anchor?.completed||[]).length;
  if(!a) return card(`<div class="eyebrow">ANCHOR COMPLETE</div><h1 class="hero">Infrastructure restored enough to reassess.</h1><p class="sub">This is not an instruction to stop. Reclassify the state that actually exists now.</p>${button('RECHECK STATE','state-check','primary')}`);
  const pct=Math.min(100,Math.round((done/ANCHOR_ACTIONS.length)*100));
  return card(`<div class="eyebrow">ANCHOR · ${a.isDecomposition?'DECOMPOSED STEP':'NOW'}</div><h1 class="hero">${esc(a.title)}</h1><p class="sub">${esc(a.detail)}</p><div class="rule"></div><div class="progress"><div style="width:${pct}%"></div></div><div class="meta">${done} anchor transitions completed. The rest remain hidden.</div>
    ${button('DONE','anchor-done','primary')}${button('ALREADY DID IT','anchor-already','ghost')}${button("CAN'T / NOT NOW",'anchor-cant','ghost')}
    <div class="rule"></div><div class="callout">Anchor mode measures state transition, not virtue. Medication actions mean following the prescription directions; the app never alters dose or timing.</div>`);
}

function recommendedBridge(){
  const eligible=state.portfolio.filter(x=>x.domain.active && !['dormant','restorative','anchor'].includes(x.domain.mode));
  const rank={breach:4,pressure:3,watch:2,green:1}; const ignition={low:3,medium:2,high:1};
  eligible.sort((a,b)=> (rank[b.cond.continuity]-rank[a.cond.continuity]) || (ignition[b.domain.ignition]-ignition[a.domain.ignition]));
  return eligible[0]||state.portfolio.find(x=>x.domain.id==='reading');
}
function renderOnline(){
  const rec=recommendedBridge(); if(!rec) return renderContract();
  const bridge=rec.domain.bridge?.[0]||`Reopen ${rec.domain.name}.`;
  return card(`<div class="eyebrow">ONLINE · BRIDGE</div><h1 class="hero">${esc(rec.domain.name)}</h1><p class="sub">${esc(bridge)}</p><div class="rule"></div><div class="inline">${badge(rec.cond.continuity)}<span class="meta">Last contact: ${humanAgo(rec.cond.contactDays)} · ignition ${esc(rec.domain.ignition)}</span></div>
    ${button('BEGIN CONTACT','begin-bridge','primary')}${button('I AM FUNCTIONAL NOW','to-functional','ghost')}${button('RETURN TO ANCHOR','to-anchor','ghost')}`);
}

function renderNightReentry(){
  return card(`<div class="eyebrow">LATE / SECOND WAKE</div><h1 class="hero">Do not manufacture a replacement daytime.</h1><p class="sub">The governor is suppressing the normal catch-up contract for this wake episode. You may do one quiet, bounded useful block, or simply stabilize and close.</p>
    ${button('QUIET CONTACT / READING','night-quiet','primary')}${button('RECHECK BASIC STATE','state-check','ghost')}${button('OVERRIDE: PLAN NORMALLY','night-override','ghost')}${button('END WAKE EPISODE','end-wake','ghost')}
    <div class="rule"></div><div class="callout warn">This is a productivity rule, not sleep-treatment advice. Persistent or severe sleep disruption belongs with your clinician/prescriber.</div>`);
}

function renderEnvelope(){
  const e=state.day.envelope||{};
  return card(`<div class="eyebrow">OPERATING ENVELOPE</div><h1 class="hero">What capacity actually exists?</h1><p class="sub">Set only operational constraints. No mood score is required.</p>
    <label>Discretionary time today</label><div class="grid3">${[60,120,240].map(m=>`<button class="choice ${e.minutes===m?'selected':''}" data-minutes="${m}"><strong>${m===60?'~1 hour':m===120?'~2 hours':'~4 hours'}</strong><span>Usable, non-obligatory time</span></button>`).join('')}</div>
    ${button('6+ HOURS AVAILABLE','minutes-360',e.minutes===360?'primary':'ghost')}
    <label>Cognitive endurance</label><div class="grid3">${[['fragile','Fragile'],['normal','Normal'],['strong','Strong']].map(([v,l])=>`<button class="choice ${e.cognition===v?'selected':''}" data-cognition="${v}"><strong>${l}</strong><span>${v==='fragile'?'Keep ignition low':v==='normal'?'Ordinary working range':'Deep work plausible'}</span></button>`).join('')}</div>
    <label>Fixed paid-work obligation</label><div class="grid2"><button class="choice ${e.fixedWork===true?'selected':''}" data-work="true"><strong>YES</strong><span>Work is structurally fixed today.</span></button><button class="choice ${e.fixedWork===false?'selected':''}" data-work="false"><strong>NO</strong><span>No fixed work block today.</span></button></div>
    ${button('GENERATE DAILY CONTRACT','generate','primary')}${button('START ANY TRAJECTORY','manual-work','ghost')}`);
}

function renderContract(){
  if(!state.day.contract) return renderEnvelope();
  const c=state.day.contract; const byId=id=>state.portfolio.find(x=>x.domain.id===id);
  const primary=byId(c.primaryId); const cont=(c.continuityIds||[]).map(byId).filter(Boolean); const physical=byId(c.physicalId); const protectedD=(c.protectedIds||[]).map(byId).filter(Boolean); const unresolved=(c.unresolvedIds||[]).map(byId).filter(Boolean);
  const cadenceMeta=x=>`${cadenceText(x)} · ${depthText(x)}`;
  return `<div>${c.fixedWork?card(`<div class="eyebrow">FIXED</div><h2 class="hero" style="font-size:24px">Paid Work</h2><p class="sub">External obligation is treated as an anchor, not as proof that every mastery trajectory was trained.</p>${button('BEGIN WORK BLOCK','start-work','ghost')}`):''}
    ${primary?card(`<div class="eyebrow">PRIMARY ADVANCE</div><h1 class="hero">${esc(primary.domain.name)}</h1><p class="sub">${esc(primary.domain.frontier)}</p><div class="inline">${badge(primary.cond.continuity)}<span class="meta">${cadenceMeta(primary)}</span></div>${button('BEGIN PRIMARY BLOCK','start-primary','primary')}${button('OVERRIDE PRIMARY','override-primary','ghost')}`):card(`<div class="eyebrow">PRIMARY</div><h1 class="hero">No primary advance required.</h1><p class="sub">The current portfolio does not require a forced deep block.</p>`)}
    ${cont.length?card(`<div class="eyebrow">CONTINUITY</div>${cont.map(x=>`<div class="domain"><div class="domain-head"><div class="domain-name">${esc(x.domain.name)}</div>${badge(x.cond.continuity)}</div><div class="meta">${cadenceMeta(x)}</div><div class="meta">${esc(x.domain.bridge?.[0]||'Meaningful contact.')}</div><button class="btn small ghost" data-start-domain="${x.domain.id}" data-dose="maintenance">BEGIN</button></div>`).join('')}`):''}
    ${physical?card(`<div class="eyebrow">PHYSICAL</div><div class="domain-head"><div class="domain-name">FOUNDATION / 28</div>${badge(physical.cond.continuity)}</div><p class="sub">${cadenceText(physical)}. Governor schedules contact; the exercise app governs what is physically appropriate.</p><button class="btn ghost" data-start-domain="physical" data-dose="maintenance">LOG / BEGIN PHYSICAL CONTACT</button>`):''}
    ${unresolved.length?card(`<div class="eyebrow">UNRESOLVED PRESSURE</div><div class="callout warn">These trajectories are below their rolling cadence target, but adding all of them would violate the current context ceiling. They remain manually available; the app will not disguise overload as protection.</div>${unresolved.map(x=>`<div class="domain"><div class="domain-head"><div class="domain-name">${esc(x.domain.name)}</div>${badge(x.cond.continuity)}</div><div class="meta">${cadenceMeta(x)}</div><button class="btn small ghost" data-manual-domain="${x.domain.id}">START ANYWAY</button></div>`).join('')}`):''}
    ${card(`<div class="eyebrow">PROTECTED TODAY</div><div class="smallprint">Protected means “not required by today’s governor,” never “blocked.” You can start and time any trajectory whenever you choose.</div>${protectedD.length?protectedD.map(x=>`<div class="domain"><div class="domain-head"><div class="domain-name">${esc(x.domain.name)}</div>${badge(x.cond.continuity)}</div><div class="meta">${cadenceMeta(x)} · Last contact: ${humanAgo(x.cond.contactDays)}.</div><button class="btn small ghost" data-manual-domain="${x.domain.id}">START ANYWAY</button></div>`).join(''):'<div class="sub">No additional active domains are currently inside a protected omission band.</div>'}${button('START ANY TRAJECTORY','manual-work','ghost')}`)}
    ${card(`<div class="inline"><button class="btn small ghost" data-action="recalc">RECALCULATE</button><button class="btn small ghost" data-action="state-check">STATE CHANGED</button><button class="btn small ghost" data-action="close-day">CLOSE DAY</button></div>`,'flat')}</div>`;
}
function renderActiveBlock(){
  const p=state.portfolio.find(x=>x.domain.id===state.currentBlock.domainId); const name=p?.domain.name||state.currentBlock.domainId;
  return card(`<div class="eyebrow">${state.currentBlock.protected?'DEEP · PROTECTED':'ACTIVE BLOCK'}</div><h1 class="hero">${esc(name)}</h1><p class="sub">${esc(p?.domain.frontier||'')}</p><div id="timer" class="timer">00:00</div><div class="meta">Planned dose: ${esc(state.currentBlock.plannedDose)}</div>
    ${!state.currentBlock.protected?button('PROTECT THIS','protect','primary'):''}${button('FINISH BLOCK','finish','ghost')}${button('ABANDON / RECALCULATE','abandon','ghost')}`);
}

function renderPortfolio(){
  return `<div>${card(`<div class="eyebrow">PORTFOLIO</div><h1 class="hero">Active trajectories.</h1><p class="sub">Continuity is now a literal weekly cadence: distinct contact days in the rolling last 7 days. Depth is distinct ADVANCE/SURGE days in the rolling last 28 days.</p>${button('START ANY TRAJECTORY','manual-work','primary')}${button('ADD TRAJECTORY','add-domain','ghost')}`)}
  ${state.portfolio.map(x=>card(`<div class="domain-head"><div><div class="domain-name">${esc(x.domain.name)}</div><div class="meta">${modeLabel(x.domain.mode)} · ignition ${esc(x.domain.ignition)}</div></div>${badge(x.cond.continuity)}</div><div class="rule"></div><div class="sub">${esc(x.domain.frontier)}</div><div class="kv"><span>Continuity</span><strong>${x.cond.contactCount7} / ${x.cond.continuityTarget} days</strong></div><div class="kv"><span>Continuity window</span><strong>rolling 7 days</strong></div><div class="kv"><span>Depth</span><strong>${x.cond.depthCount28} / ${x.cond.depthTarget} days</strong></div><div class="kv"><span>Depth window</span><strong>rolling 28 days</strong></div><div class="kv"><span>Last contact</span><strong>${humanAgo(x.cond.contactDays)}</strong></div><div class="kv"><span>Last advance</span><strong>${humanAgo(x.cond.depthDays)}</strong></div><div class="inline"><button class="btn small primary" data-manual-domain="${x.domain.id}">START</button><button class="btn small ghost" data-edit-domain="${x.domain.id}">EDIT</button></div>`)).join('')}</div>`;
}
function summarize(days){
  const cutoff=Date.now()-days*86400000; const blocks=window.__blocks||[];
  return state.portfolio.map(x=>{
    const bs=blocks.filter(b=>b.domainId===x.domain.id&&b.status==='completed'&&b.endedAt>=cutoff);
    const contactDays=new Set(bs.map(b=>b.dateKey||localDateKey(b.endedAt))).size;
    const deepDays=new Set(bs.filter(b=>['advance','surge'].includes(b.dose)).map(b=>b.dateKey||localDateKey(b.endedAt))).size;
    return {name:x.domain.name,condition:x.cond.continuity,contactDays,deepDays,surge:bs.filter(b=>b.dose==='surge').length,minutes:bs.reduce((sum,b)=>sum+(b.minutes||0),0),continuityTarget:x.cond.continuityTarget,depthTarget:x.cond.depthTarget};
  });
}
function renderReview(){
  const rows7=summarize(7), rows28=summarize(28);
  const table7=rows=>`<div class="table-wrap"><table class="table"><thead><tr><th>Domain</th><th>Condition</th><th>Contact days</th><th>Weekly target</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${bandLabel(r.condition)}</td><td>${r.contactDays}</td><td>${r.continuityTarget}</td></tr>`).join('')}</tbody></table></div>`;
  const table28=rows=>`<div class="table-wrap"><table class="table"><thead><tr><th>Domain</th><th>Deep days</th><th>28d target</th><th>Minutes</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.deepDays}</td><td>${r.depthTarget}</td><td>${r.minutes}</td></tr>`).join('')}</tbody></table></div>`;
  return `${card(`<div class="eyebrow">7 DAYS</div><h1 class="hero">Cadence evidence.</h1><p class="sub">A contact day counts once regardless of how many blocks you do that day. The window rolls daily.</p>${table7(rows7)}`)}${card(`<div class="eyebrow">28 DAYS</div><h1 class="hero">Depth evidence.</h1><p class="sub">Only ADVANCE or SURGE marks a deep day. CONTACT and MAINTENANCE preserve continuity but do not satisfy depth.</p>${table28(rows28)}`)}`;
}
function renderSystem(){
  return `${card(`<div class="eyebrow">SYSTEM</div><h1 class="hero">Local-first instrument.</h1><div class="kv"><span>Version</span><strong>${APP_VERSION}</strong></div><div class="kv"><span>Storage</span><strong id="storage-status">checking…</strong></div>${button('REQUEST PERSISTENT STORAGE','persist','ghost')}`)}
  ${card(`<div class="eyebrow">WAKE EPISODE</div>${state.activeWake?`<div class="sub">Wake ${state.activeWake.index} began ${fmtTime(state.activeWake.startedAt)}.</div>${button('END CURRENT WAKE EPISODE','end-wake','ghost')}`:`<div class="sub">No wake episode is active.</div>${button('START WAKE EPISODE','start-wake','primary')}`}`)}
  ${card(`<div class="eyebrow">BACKUP</div><p class="sub">The GitHub repository contains only app code. Personal state remains on this device unless you export it.</p>${button('EXPORT JSON BACKUP','export','ghost')}${button('IMPORT JSON BACKUP','import','ghost')}<input type="file" id="import-file" accept="application/json" class="hidden" />`)}
  ${card(`<div class="eyebrow">IPHONE INSTALL</div><p class="sub">Open the deployed site in Safari → Share → Add to Home Screen → ensure “Open as Web App” is enabled → Add. Use the installed Home Screen copy as the authoritative instance.</p>`)}
  ${card(`<div class="eyebrow">CLINICAL BOUNDARY</div><div class="callout warn">This app is not medical treatment. Medication entries only track whether prescribed instructions were handled; the app does not recommend dose changes or missed-dose compensation. Persistent major sleep, appetite, mood, or functioning changes deserve discussion with a qualified clinician.</div><div class="rule"></div><div class="smallprint">If you become at risk of harming yourself or unable to keep yourself safe in the U.S., call or text 988 or use emergency services for immediate danger.</div>`)}
  ${card(`<div class="eyebrow">DESTRUCTIVE</div>${button('WIPE LOCAL DATABASE','wipe','danger')}`)}`;
}

function domainModal(domain=null){
  const d=domain||{id:'',name:'',mode:'build',frontier:'',continuityTarget7:3,depthTarget28:4,ignition:'medium',immersion:'high',bridge:[''],active:true,notes:''};
  const cont=getContinuityTarget(d);
  const depth=getDepthTarget(d);
  return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">${domain?'EDIT':'ADMISSION CONTROL'}</div><h2 class="hero" style="font-size:26px">${domain?'Trajectory settings':'Add a top-level trajectory'}</h2>${!domain?`<div class="callout warn">Before adding this, ask whether it is actually a project beneath an existing domain. A new trajectory consumes portfolio capacity.</div>`:''}
    <label>Name</label><input id="m-name" value="${esc(d.name)}" />
    <label>Current frontier</label><textarea id="m-frontier">${esc(d.frontier)}</textarea>
    <div class="form-row"><div><label>Strategic mode</label><select id="m-mode">${MODES.map(m=>`<option value="${m}" ${d.mode===m?'selected':''}>${m.toUpperCase()}</option>`).join('')}</select></div><div><label>Ignition cost</label><select id="m-ignition">${['low','medium','high'].map(v=>`<option ${d.ignition===v?'selected':''}>${v}</option>`).join('')}</select></div></div>
    <label>Continuity target — contact days per rolling 7 days</label><input id="m-cont" type="number" min="0" max="7" inputmode="numeric" value="${cont}" />
    <div class="field-help"><strong>What it means:</strong> the number of distinct calendar days in the last 7 on which any completed CONTACT, MAINTENANCE, ADVANCE, or SURGE block should exist. Example: <b>6</b> means six contact days per rolling week; once six are present, one day may be safely protected. Multiple blocks on one day still count as one contact day. Set 0 for no continuity quota.</div>
    <label>Depth target — ADVANCE/SURGE days per rolling 28 days</label><input id="m-depth" type="number" min="0" max="28" inputmode="numeric" value="${depth}" />
    <div class="field-help"><strong>What it means:</strong> the number of distinct days in the last 28 containing at least one completed ADVANCE or SURGE block. CONTACT and MAINTENANCE do not satisfy this target. Example: <b>4</b> means roughly four substantive developmental days per rolling 28 days. Set 0 for no depth quota.</div>
    <div class="callout">These are rolling targets, not fixed weekdays and not owed hours. Falling below target raises scheduling pressure; exceeding target never blocks voluntary work.</div>
    <label>Bridge actions — one per line</label><textarea id="m-bridge">${esc((d.bridge||[]).join('\n'))}</textarea>
    ${button('SAVE TRAJECTORY','save-domain','primary')} ${domain?button('DELETE TRAJECTORY','delete-domain','danger'):''} ${button('CANCEL','close-modal','ghost')}
    <input type="hidden" id="m-id" value="${esc(d.id)}" /></div></div>`;
}

function manualWorkModal(){
  const opts=state.portfolio.filter(x=>x.domain.active);
  return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">MANUAL WORK</div><h2 class="hero" style="font-size:26px">Start any trajectory.</h2><p class="sub">Governor status is advisory. GREEN and PROTECTED never disable voluntary work or timing.</p>${opts.map(x=>`<button class="btn" data-manual-domain="${x.domain.id}"><span class="manual-row"><strong>${esc(x.domain.name)}</strong><span>${x.cond.contactCount7}/${x.cond.continuityTarget} · ${bandLabel(x.cond.continuity)}</span></span></button>`).join('')}${button('CANCEL','close-modal','ghost')}</div></div>`;
}

function manualDoseModal(domainId){
  const x=state.portfolio.find(p=>p.domain.id===domainId); if(!x)return '';
  const defs={contact:'Re-establish contact with the trajectory.',maintenance:'Enough real work to preserve continuity.',advance:'Material developmental progress; counts toward depth.',surge:'Sustained deep advancement; counts toward depth.'};
  return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">${esc(x.domain.name)}</div><h2 class="hero" style="font-size:26px">What are you starting?</h2><p class="sub">Choose the intended dose. You can classify the actual dose again when you finish.</p><div class="grid2">${DOSES.map(d=>`<button class="choice" data-manual-dose="${d}" data-manual-dose-domain="${domainId}"><strong>${d.toUpperCase()}</strong><span>${defs[d]}</span></button>`).join('')}</div>${button('BACK','manual-work','ghost')}${button('CANCEL','close-modal','ghost')}</div></div>`;
}
function finishModal(){return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">FINISH BLOCK</div><h2 class="hero" style="font-size:26px">What did this become?</h2><p class="sub">Classify the actual dose. Contact is not advancement.</p><div class="grid2">${DOSES.map(d=>`<button class="choice" data-finish-dose="${d}"><strong>${d.toUpperCase()}</strong><span>${d==='contact'?'Re-established the mental object':d==='maintenance'?'Preserved continuity':d==='advance'?'Material developmental progress':'Sustained deep advancement'}</span></button>`).join('')}</div><label>Optional note</label><textarea id="finish-note" placeholder="Only if context matters."></textarea>${button('CANCEL','close-modal','ghost')}</div></div>`}

function overrideModal(){return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">OVERRIDE</div><h2 class="hero" style="font-size:26px">Choose the better reality.</h2><p class="sub">Manual judgment is legitimate. Pick another active trajectory; no justification is required.</p>${state.portfolio.filter(x=>x.domain.active&&!['dormant','restorative'].includes(x.domain.mode)).map(x=>`<button class="btn" data-override-domain="${x.domain.id}">${esc(x.domain.name)} <span class="meta">· ${bandLabel(x.cond.continuity)}</span></button>`).join('')}${button('CANCEL','close-modal','ghost')}</div></div>`}

function closeDayModal(){return `<div class="modal-backdrop"><div class="modal"><div class="eyebrow">CLOSE DAY</div><h2 class="hero" style="font-size:26px">Reconcile; do not repay.</h2><p class="sub">No missed hours will be carried forward. Tomorrow inherits trajectory condition, not guilt debt.</p><label>Optional one-line context</label><textarea id="close-note"></textarea>${button('CLOSE TODAY','confirm-close','primary')}${button('CANCEL','close-modal','ghost')}</div></div>`}

function startTimerDisplay(){
  const el=document.querySelector('#timer'); if(!el||!state.currentBlock)return;
  const tick=()=>{const s=Math.floor((Date.now()-state.currentBlock.startedAt)/1000);const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;el.textContent=h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`};tick();state.timer=setInterval(tick,1000);
}

async function setView(v){state.view=v;state.settings.lastView=v;await saveSettings(state.settings);render()}
async function chooseState(v){
  if(v==='already'){
    const opts=state.portfolio.filter(x=>x.domain.active&&!['dormant','restorative'].includes(x.domain.mode));
    state.modal=`<div class="modal-backdrop"><div class="modal"><div class="eyebrow">ALREADY WORKING</div><h2 class="hero" style="font-size:26px">Protect the useful state.</h2>${opts.map(x=>`<button class="btn" data-already-domain="${x.domain.id}">${esc(x.domain.name)}</button>`).join('')}${button('CANCEL','close-modal','ghost')}</div></div>`;render();return;
  }
  if(v==='down' && (state.day.anchor?.index||0)>=ANCHOR_ACTIONS.length){
    state.day.anchor={index:0,decompositionIndex:null,completed:[],skipped:[]};
    await put('days',state.day);
  }
  await setOperatingState(state.day,v); if(v==='down') state.day=await getToday(); await refresh();
}

async function bindDataButtons(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
  document.querySelectorAll('[data-state]').forEach(b=>b.onclick=()=>chooseState(b.dataset.state));
  document.querySelectorAll('[data-minutes]').forEach(b=>b.onclick=async()=>{await saveEnvelope(state.day,{minutes:+b.dataset.minutes});await refresh()});
  document.querySelectorAll('[data-cognition]').forEach(b=>b.onclick=async()=>{await saveEnvelope(state.day,{cognition:b.dataset.cognition});await refresh()});
  document.querySelectorAll('[data-work]').forEach(b=>b.onclick=async()=>{await saveEnvelope(state.day,{fixedWork:b.dataset.work==='true'});await refresh()});
  document.querySelectorAll('[data-start-domain]').forEach(b=>b.onclick=async()=>{await startBlock(state.day,b.dataset.startDomain,b.dataset.dose||'maintenance','contract');await refresh()});
  document.querySelectorAll('[data-edit-domain]').forEach(b=>b.onclick=async()=>{const d=await get('domains',b.dataset.editDomain);state.modal=domainModal(d);render()});
  document.querySelectorAll('[data-manual-domain]').forEach(b=>b.onclick=()=>{state.modal=manualDoseModal(b.dataset.manualDomain);render()});
  document.querySelectorAll('[data-manual-dose]').forEach(b=>b.onclick=async()=>{const domainId=b.dataset.manualDoseDomain;const dose=b.dataset.manualDose;state.modal=null;await startBlock(state.day,domainId,dose,'manual');await refresh()});
  document.querySelectorAll('[data-finish-dose]').forEach(b=>b.onclick=async()=>{const note=document.querySelector('#finish-note')?.value||'';state.modal=null;await finishBlock(state.day,state.currentBlock,b.dataset.finishDose,note);await refresh()});
  document.querySelectorAll('[data-override-domain]').forEach(b=>b.onclick=async()=>{state.modal=null;await startBlock(state.day,b.dataset.overrideDomain,'advance','override');await refresh()});
  document.querySelectorAll('[data-already-domain]').forEach(b=>b.onclick=async()=>{state.modal=null;await startBlock(state.day,b.dataset.alreadyDomain,'advance','already-working');state.currentBlock=await getCurrentBlock(state.day);await protectBlock(state.day,state.currentBlock);await refresh()});
}

function bind(){
  bindDataButtons();
  document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>handleAction(b.dataset.action));
  storageStatus();
}

async function handleAction(a){
  if(a==='anchor-done'||a==='anchor-already'){await anchorDone(state.day,a==='anchor-already'?'already':'done');return refresh()}
  if(a==='anchor-cant'){await anchorCant(state.day);return refresh()}
  if(a==='state-check'){await setOperatingState(state.day,null);state.day=await getToday();return refresh()}
  if(a==='to-functional'){await setOperatingState(state.day,'functional');return refresh()}
  if(a==='to-anchor'){await setOperatingState(state.day,'anchoring');return refresh()}
  if(a==='begin-bridge'){const r=recommendedBridge();if(r)await startBlock(state.day,r.domain.id,'contact','bridge');return refresh()}
  if(a==='minutes-360'){await saveEnvelope(state.day,{minutes:360});return refresh()}
  if(a==='generate'){await generateContract(state.day);return refresh()}
  if(a==='recalc'){state.day.contract=null;await put('days',state.day);await generateContract(state.day);return refresh()}
  if(a==='start-primary'){await startBlock(state.day,state.day.contract.primaryId,'advance','contract');return refresh()}
  if(a==='start-work'){await startBlock(state.day,'work','advance','fixed');return refresh()}
  if(a==='protect'){await protectBlock(state.day,state.currentBlock);return refresh()}
  if(a==='finish'){state.modal=finishModal();return render()}
  if(a==='abandon'){await abandonBlock(state.day,state.currentBlock);return refresh()}
  if(a==='override-primary'){state.modal=overrideModal();return render()}
  if(a==='manual-work'){state.modal=manualWorkModal();return render()}
  if(a==='close-modal'){state.modal=null;return render()}
  if(a==='close-day'){state.modal=closeDayModal();return render()}
  if(a==='confirm-close'){const note=document.querySelector('#close-note')?.value||'';state.modal=null;await closeDay(state.day,note);return refresh()}
  if(a==='reopen'){state.day.closed=false;state.day.operatingState=null;await put('days',state.day);return refresh()}
  if(a==='end-wake'){
    if(state.currentBlock){alert('Finish or abandon the active block before ending the wake episode.');return}
    await endWakeEpisode(state.day);return refresh()
  }
  if(a==='start-wake'){await startWakeEpisode(state.day);return refresh()}
  if(a==='night-quiet'){const r=state.portfolio.find(x=>x.domain.id==='reading')||recommendedBridge();if(r)await startBlock(state.day,r.domain.id,'contact','night-quiet');return refresh()}
  if(a==='night-override'){state.activeWake.overrideNight=true;await put('wakeEpisodes',state.activeWake);state.day.operatingState='functional';await put('days',state.day);isNightReentryOverride=true;return refresh()}
  if(a==='add-domain'){state.modal=domainModal();return render()}
  if(a==='save-domain')return saveDomainFromModal();
  if(a==='delete-domain')return deleteDomainFromModal();
  if(a==='persist')return requestPersist();
  if(a==='export')return exportBackup();
  if(a==='import'){document.querySelector('#import-file')?.click();return}
  if(a==='wipe')return wipePrompt();
}

let isNightReentryOverride=false;
function nightReentry(ep){ return isNightReentry(ep) && !ep?.overrideNight && !isNightReentryOverride; }

async function saveDomainFromModal(){
  const id=document.querySelector('#m-id').value.trim()||`domain-${Date.now()}`; const existing=await get('domains',id);
  const continuityTarget7=Math.max(0,Math.min(7,Math.round(+document.querySelector('#m-cont').value||0)));
  const depthTarget28=Math.max(0,Math.min(28,Math.round(+document.querySelector('#m-depth').value||0)));
  const d={...(existing||{}),id,name:document.querySelector('#m-name').value.trim()||'Untitled',frontier:document.querySelector('#m-frontier').value.trim(),mode:document.querySelector('#m-mode').value,ignition:document.querySelector('#m-ignition').value,immersion:existing?.immersion||'high',continuityTarget7,depthTarget28,continuityDays:continuityTarget7,bridge:document.querySelector('#m-bridge').value.split('\n').map(x=>x.trim()).filter(Boolean),active:true,notes:existing?.notes||'',createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};
  await put('domains',d);state.modal=null;await refresh();
}
async function deleteDomainFromModal(){const id=document.querySelector('#m-id').value;if(!id)return;if(confirm('Delete this trajectory configuration? Historical blocks will remain in the local database.')){await del('domains',id);state.modal=null;await refresh()}}

async function requestPersist(){if(!navigator.storage?.persist){alert('Persistent-storage API is not available in this browser. Backups remain recommended.');return}const ok=await navigator.storage.persist();alert(ok?'Persistent storage granted or already active.':'Persistent storage was not granted. The app still works; keep JSON backups.');storageStatus()}
async function storageStatus(){const el=document.querySelector('#storage-status');if(!el)return;if(!navigator.storage?.persisted){el.textContent='available · persistence unknown';return}el.textContent=(await navigator.storage.persisted())?'persistent':'best-effort'}
async function exportBackup(){const p=await exportAll();const blob=new Blob([JSON.stringify(p,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`governor-backup-${localDateKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function importBackupFile(file){try{const text=await file.text();const payload=JSON.parse(text);if(!confirm('Replace the entire local Governor database with this backup?'))return;await importAll(payload);alert('Backup imported.');location.reload()}catch(e){alert(`Import failed: ${e.message}`)}}
async function wipePrompt(){const phrase=prompt('Type WIPE GOVERNOR to permanently erase local app data on this browser.');if(phrase==='WIPE GOVERNOR'){await wipeAll();location.reload()}else if(phrase!==null)alert('Phrase did not match. Nothing was erased.')}

function attachFileImport(){document.addEventListener('change',e=>{if(e.target?.id==='import-file'&&e.target.files?.[0])importBackupFile(e.target.files[0])})}

async function loadBlocks(){window.__blocks=await getAll('blocks')}
async function registerSW(){if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('./sw.js')}catch(e){console.warn('Service worker registration failed',e)}}}

(async()=>{try{await hydrate();await loadBlocks();attachFileImport();render();await registerSW()}catch(e){console.error(e);app.innerHTML=`<main class="card"><div class="eyebrow">STARTUP FAILURE</div><h1 class="hero">Governor could not initialize.</h1><pre class="smallprint">${esc(e.stack||e.message)}</pre></main>`}})();
