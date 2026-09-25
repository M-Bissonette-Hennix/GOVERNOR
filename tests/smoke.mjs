import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {domainCondition,buildContract,countBand,elapsedBlockMs,rollingDateKeys} from '../js/controller.js';
import {localDateKey} from '../js/db.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const NOW=new Date(2026,8,25,12,0,0,0).getTime();
function ok(cond,msg){if(!cond)throw new Error(msg)}
function keyAgo(n){const d=new Date(NOW);d.setDate(d.getDate()-n);return localDateKey(d.getTime())}
function block(domainId,daysAgo,dose='contact'){
  const t=new Date(NOW);t.setDate(t.getDate()-daysAgo);t.setHours(12,0,0,0);
  return {id:`${domainId}-${daysAgo}-${dose}`,domainId,status:'completed',dose,dateKey:keyAgo(daysAgo),startedAt:t.getTime()-1800000,endedAt:t.getTime(),minutes:30};
}
function domain(id,{mode='build',cont=3,depth=0,ignition='medium'}={}){
  return {id,name:id,mode,ignition,active:true,continuityTarget7:cont,depthTarget28:depth,bridge:['bridge']};
}

// 1. Band semantics are count-based, not legacy max-gap semantics.
ok(countBand(6,6)==='green','6/6 must be GREEN');
ok(countBand(5,6)==='watch','5/6 must be WATCH');
ok(countBand(3,6)==='pressure','3/6 must be PRESSURE');
ok(countBand(1,6)==='breach','1/6 must be BREACH');

// 2. Six-days/week means six distinct contact days in the rolling seven.
let chinese=domainCondition(domain('chinese',{cont:6}),[block('chinese',1)],NOW);
ok(chinese.contactCount7===1,'yesterday-only Chinese should be 1/6');
ok(chinese.continuity==='breach','1/6 Chinese should be BREACH');
ok(chinese.continuityActionable===true,'yesterday-only Chinese must be actionable today');

// 3. Once today already contains contact, another same-day block cannot improve distinct-day cadence.
chinese=domainCondition(domain('chinese',{cont:6}),[block('chinese',1),block('chinese',0)],NOW);
ok(chinese.contactToday===true,'today contact must be detected');
ok(chinese.continuityActionable===false,'same-day cadence must not be prescribed twice');
ok(chinese.todaySatisfied===true,'rolling deficit with today contact should be TODAY SATISFIED');

// 4. Six distinct days satisfies a six-day target even if today is the permitted rest day.
const sixPrior=[1,2,3,4,5,6].map(d=>block('chinese',d));
chinese=domainCondition(domain('chinese',{cont:6}),sixPrior,NOW);
ok(chinese.contactCount7===6&&chinese.onTarget,'six prior contact days should be on target');

// 5. WATCH is never falsely called protected when it cannot fit the context ceiling.
const cyber={domain:domain('cyber',{cont:4,depth:4,ignition:'high'}),cond:domainCondition(domain('cyber',{cont:4,depth:4,ignition:'high'}),[block('cyber',2),block('cyber',3,'advance')],NOW)};
const chineseWatch={domain:domain('chinese',{cont:4}),cond:domainCondition(domain('chinese',{cont:4}),[block('chinese',1),block('chinese',2),block('chinese',3)],NOW)};
const work={domain:domain('work',{mode:'anchor',cont:0,depth:0}),cond:domainCondition(domain('work',{mode:'anchor',cont:0,depth:0}),[],NOW)};
let contract=buildContract([work,cyber,chineseWatch],{envelope:{fixedWork:true,minutes:60,cognition:'normal'}},{contextSwitchLimit:2,maxContinuityItems:2,defaultWorkDays:[1,2,3,4,5]});
ok(contract.unresolvedIds.includes('chinese'),'omitted WATCH must be unresolved');
ok(!contract.protectedIds.includes('chinese'),'omitted WATCH must never be protected');

// 6. A below-target domain already contacted today moves to TODAY SATISFIED, not back into the contract.
const chineseDone={domain:domain('chinese',{cont:6}),cond:domainCondition(domain('chinese',{cont:6}),[block('chinese',0),block('chinese',1)],NOW)};
contract=buildContract([chineseDone],{envelope:{fixedWork:false,minutes:30,cognition:'fragile'}},{contextSwitchLimit:3,maxContinuityItems:2,defaultWorkDays:[]});
ok(contract.todaySatisfiedIds.includes('chinese'),'same-day satisfied deficit should be explicit');
ok(contract.primaryId===null,'same-day cadence deficit must not generate a duplicate primary');

// 7. Depth-only pressure is actionable and cannot disappear behind protection.
const depthDomain=domain('fiction',{cont:0,depth:4,ignition:'high'});
const fiction={domain:depthDomain,cond:domainCondition(depthDomain,[block('fiction',10,'advance')],NOW)};
contract=buildContract([fiction],{envelope:{fixedWork:false,minutes:120,cognition:'normal'}},{contextSwitchLimit:3,maxContinuityItems:2,defaultWorkDays:[]});
ok(contract.primaryId==='fiction','depth-only deficit should be eligible for primary repair');
ok(contract.primaryDose==='advance','depth repair should recommend ADVANCE when capacity supports it');

// 8. Context ceiling is actually enforced after fixed work and primary.
const chessDomain=domain('chess',{mode:'surge',cont:5,depth:4});
const oomDomain=domain('oom',{cont:3,depth:2});
const chess={domain:chessDomain,cond:domainCondition(chessDomain,[block('chess',2)],NOW)};
const oom={domain:oomDomain,cond:domainCondition(oomDomain,[block('oom',3)],NOW)};
contract=buildContract([work,cyber,chess,oom],{envelope:{fixedWork:true,minutes:240,cognition:'normal'}},{contextSwitchLimit:3,maxContinuityItems:3,defaultWorkDays:[1,2,3,4,5]});
ok(contract.contextsUsed<=3,'automatic serious contexts must respect the configured ceiling');
ok(contract.continuityIds.length<=1,'work + primary under a three-context ceiling leaves at most one continuity context');

// 9. When everything is on target, adequate capacity can still create a clearly labeled investment—not a fake repair.
const healthyDomain=domain('chess',{mode:'surge',cont:1,depth:1});
const healthy={domain:healthyDomain,cond:domainCondition(healthyDomain,[block('chess',1,'advance')],NOW)};
contract=buildContract([healthy],{envelope:{fixedWork:false,minutes:120,cognition:'normal'}},{contextSwitchLimit:3,maxContinuityItems:2,defaultWorkDays:[]});
ok(contract.primaryId==='chess'&&contract.primaryKind==='investment','healthy portfolio may receive optional investment with adequate capacity');
contract=buildContract([healthy],{envelope:{fixedWork:false,minutes:30,cognition:'fragile'}},{contextSwitchLimit:3,maxContinuityItems:2,defaultWorkDays:[]});
ok(contract.primaryId===null,'fragile 30-minute envelope should not manufacture an investment block');
const healthyToday={domain:healthyDomain,cond:domainCondition(healthyDomain,[block('chess',0,'maintenance'),block('chess',1,'advance')],NOW)};
contract=buildContract([healthyToday],{envelope:{fixedWork:false,minutes:120,cognition:'normal'}},{contextSwitchLimit:3,maxContinuityItems:2,defaultWorkDays:[]});
ok(contract.primaryId===null,'an optional investment must not immediately re-prescribe a trajectory already contacted today');

// 10. Restorative/anchor/dormant modes remain manually usable but do not create governor pressure.
for(const mode of ['restorative','anchor','dormant']){
  const d=domainCondition(domain(`x-${mode}`,{mode,cont:7,depth:28}),[],NOW);
  ok(d.governed===false,`${mode} must be unmetered`);
  ok(d.needsActionToday===false,`${mode} must not create automatic pressure`);
}


// 11. Shallow repair never makes a separate depth deficit disappear.
const mixedDomain=domain('mixed',{cont:4,depth:4,ignition:'high'});
const mixed={domain:mixedDomain,cond:domainCondition(mixedDomain,[block('mixed',3,'advance')],NOW)};
contract=buildContract([mixed],{envelope:{fixedWork:false,minutes:30,cognition:'fragile'}},{contextSwitchLimit:3,maxContinuityItems:2,defaultWorkDays:[]});
ok(contract.primaryId==='mixed'&&contract.primaryDose==='contact','fragile mixed deficit should receive a shallow continuity repair');
ok(contract.unresolvedIds.includes('mixed'),'depth must remain unresolved after a shallow planned dose');
ok(contract.unresolvedReasons.mixed?.includes('depth'),'residual unresolved reason must identify depth');

// 12. Physical recommendations consume the discretionary-time budget rather than being free.
const physicalDomain=domain('physical',{cont:4,depth:0,ignition:'high'});
const physical={domain:physicalDomain,cond:domainCondition(physicalDomain,[],NOW)};
contract=buildContract([mixed,physical],{envelope:{fixedWork:false,minutes:30,cognition:'normal'}},{contextSwitchLimit:3,maxContinuityItems:2,defaultWorkDays:[]});
ok(contract.plannedMinutesFloor<=30,'planned minimum minutes must never exceed the declared discretionary budget');
contract=buildContract([physical],{envelope:{fixedWork:false,minutes:10,cognition:'fragile'}},{contextSwitchLimit:3,maxContinuityItems:2,defaultWorkDays:[]});
ok(contract.physicalId===null&&contract.unresolvedIds.includes('physical'),'physical must remain unresolved when even CONTACT cannot fit the time budget');

// 13. Scheduled healthy investment is not duplicated under Protected Today.
contract=buildContract([healthy],{envelope:{fixedWork:false,minutes:120,cognition:'normal'}},{contextSwitchLimit:3,maxContinuityItems:2,defaultWorkDays:[]});
ok(contract.primaryId==='chess','healthy investment should still be selected');
ok(!contract.protectedIds.includes('chess'),'a scheduled investment must not also appear under Protected Today');

// 14. Fixed-work identity follows the actual anchor trajectory and cannot orphan a fake work block.
const customAnchorDomain=domain('employment',{mode:'anchor',cont:0,depth:0});
const customAnchor={domain:customAnchorDomain,cond:domainCondition(customAnchorDomain,[],NOW)};
contract=buildContract([customAnchor],{envelope:{fixedWork:true,minutes:60,cognition:'normal'}},{contextSwitchLimit:3,maxContinuityItems:2,defaultWorkDays:[]});
ok(contract.fixedWork===true&&contract.workId==='employment','fixed work must use the real anchor trajectory id');
contract=buildContract([],{envelope:{fixedWork:true,minutes:60,cognition:'normal'}},{contextSwitchLimit:3,maxContinuityItems:2,defaultWorkDays:[]});
ok(contract.fixedWork===false&&contract.workId===null,'YES cannot manufacture a nonexistent work trajectory');

// 15. Pause accounting excludes the live pause interval.
const paused={startedAt:100000,endedAt:null,pausedAt:150000,pausedMs:0};
ok(elapsedBlockMs(paused,200000)===50000,'live paused interval must be excluded');
const resumed={startedAt:100000,endedAt:null,pausedAt:null,pausedMs:50000};
ok(elapsedBlockMs(resumed,250000)===100000,'accumulated paused time must be excluded after resume');

// 16. Rolling calendar windows are exactly seven unique local date keys.
const keys=rollingDateKeys(7,NOW);ok(keys.length===7&&new Set(keys).size===7,'rolling seven-day key set must contain seven unique dates');

// 17. GitHub Pages/PWA static integrity.
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
ok(manifest.start_url==='./','manifest start_url must be project-relative');
ok(manifest.scope==='./','manifest scope must be project-relative');
for(const icon of manifest.icons) ok(fs.existsSync(path.join(root,icon.src.replace(/^\.\//,''))),`missing icon ${icon.src}`);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const rel of ['./manifest.webmanifest','./styles.css','./js/app.js']) ok(html.includes(rel),`index missing ${rel}`);
ok(!html.includes('aria-live="polite"'),'whole app must not be an aria-live region because the timer updates every second');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
ok(sw.includes("governor-v0.2.0"),'service worker cache version must match release');
for(const rel of ['./index.html','./styles.css','./manifest.webmanifest','./js/app.js','./js/db.js','./js/model.js','./js/controller.js']) ok(sw.includes(`'${rel}'`),`service worker missing ${rel}`);

console.log('PASS — weekly cadence semantics');
console.log('PASS — same-day non-duplication');
console.log('PASS — Protected/Unresolved truthfulness');
console.log('PASS — depth-only scheduling');
console.log('PASS — context ceiling enforcement');
console.log('PASS — optional investment distinction');
console.log('PASS — unmetered restorative/anchor/dormant modes');
console.log('PASS — residual depth truthfulness');
console.log('PASS — physical/time-budget accounting');
console.log('PASS — fixed-work identity');
console.log('PASS — pause accounting');
console.log('PASS — rolling calendar windows');
console.log('PASS — project-path / PWA static integrity');
