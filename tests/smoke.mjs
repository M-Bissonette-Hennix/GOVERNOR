import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bandFor, domainCondition, buildContract} from '../js/controller.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const DAY=86400000;
function ok(cond,msg){if(!cond)throw new Error(msg)}

// 1. Pure condition logic.
ok(bandFor(.5,2)==='green','expected GREEN band');
ok(bandFor(2,2)==='watch','expected WATCH band at target');
ok(bandFor(2.5,2)==='pressure','expected PRESSURE band');
ok(bandFor(4,2)==='breach','expected BREACH band');
const now=Date.now();
const cond=domainCondition({id:'x',continuityDays:2,depthDays:5},[
  {domainId:'x',status:'completed',dose:'advance',endedAt:now-DAY},
  {domainId:'x',status:'completed',dose:'contact',endedAt:now-DAY/4}
]);
ok(cond.continuity==='green','recent contact should be GREEN');
ok(cond.depthBand==='green','recent advance should be GREEN');

// 2. Contract truthfulness + context ceiling.
const D=(id,mode,continuity,depthBand,ignition='high')=>({
  domain:{id,name:id,mode,ignition,active:true,continuityDays:2,depthDays:5,bridge:['bridge']},
  cond:{continuity,depthBand,contactDays:4,depthDays:6}
});
const portfolio=[
  D('work','anchor','green','green','medium'),
  D('cyber','build','breach','breach','high'),
  D('chess','surge','pressure','pressure','medium'),
  D('fiction','build','pressure','watch','high'),
  D('oom','build','green','green','high'),
  D('physical','build','pressure','watch','high'),
  D('reading','restorative','green','green','low')
];
const contract=buildContract(portfolio,{envelope:{fixedWork:true,minutes:120,cognition:'normal'}});
ok(contract.fixedWork===true,'fixed work should remain fixed');
ok(contract.primaryId==='cyber','BREACH should outrank PRESSURE for primary');
ok(contract.continuityIds.length<=1,'fixed work + primary must leave at most one intellectual continuity context');
ok(contract.unresolvedIds.includes('fiction'),'unscheduled PRESSURE must be unresolved, not falsely protected');
ok(!contract.protectedIds.includes('fiction'),'PRESSURE domain cannot be marked protected');
ok(contract.protectedIds.includes('oom'),'GREEN omitted domain should be protected');
ok(contract.physicalId==='physical','physical pressure should receive separate physical slot');

// 3. GitHub project-path/static integrity.
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
ok(manifest.start_url==='./','manifest start_url must be project-relative');
ok(manifest.scope==='./','manifest scope must be project-relative');
for(const icon of manifest.icons){ok(fs.existsSync(path.join(root,icon.src.replace(/^\.\//,''))),`missing icon ${icon.src}`)}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const rel of ['./manifest.webmanifest','./styles.css','./js/app.js']) ok(html.includes(rel),`index missing ${rel}`);
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
for(const rel of ['./index.html','./styles.css','./manifest.webmanifest','./js/app.js','./js/db.js','./js/model.js','./js/controller.js']) ok(sw.includes(`'${rel}'`),`service worker missing ${rel}`);

console.log('PASS — controller bands');
console.log('PASS — dose/depth separation');
console.log('PASS — contract context ceiling');
console.log('PASS — unresolved pressure truthfulness');
console.log('PASS — physical slot separation');
console.log('PASS — project-path relative assets');
console.log('PASS — service-worker core coverage');
