import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {workspaceViews} from '../public/workspace.js';
import {ownerSkip} from '../public/skip.js';
import {handleProjectState} from '../src/project-state.js';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const handler=app.slice(app.indexOf('let savingSkip'),app.indexOf("$('historyKind').onchange="));
test('skip model binds the exact planned item and retains siblings and history',()=>{

function check(ok,label){if(!ok)throw Error(label);}
const q={tag:'test-sector-010',task:'Review the sample',input:'sample input',acceptanceTest:'Compare two fixtures',status:'queued'};
const sector={id:'test-sector',name:'Example',sourceType:'sector',nextTask:q.task,queuedFollowup:q,assignmentStatus:'verified',assignmentId:'test-sector-009',workEvidence:{tag:'test-sector-009'}};
const base={updatedAt:'2024-01-01T00:00:00.000Z',agents:[sector],commandCenter:{execution:{workerEvents:[],workRuns:[]}},events:[],reports:[]};
const now=Date.parse(base.updatedAt)+1000;
check(workspaceViews(base,{allowSkip:true}).roadmap.includes('data-skip-tag="test-sector-010"'),'eligible');
check(!workspaceViews(base).roadmap.includes('data-skip-tag'),'read-only');
const skipped=ownerSkip(base,sector.id,q,now);
check(skipped.agents[0].queuedFollowup.status==='owner-skipped','persist status');
check(skipped.commandCenter.execution.ownerSkips.length===1 && skipped.events.length===1,'one receipt');
check(base.agents[0].queuedFollowup.status==='queued' && skipped.agents[0].workEvidence===sector.workEvidence, 'retain prior work');
check(ownerSkip(skipped,sector.id,q,now+1)===skipped,'idempotent retry');
for(const patch of [{tag:'test-sector-011'},{status:'running'},{status:'waiting'},{partialEvidenceUrl:'sample'},{task:'Revised brief'},{input:'updated'},{claimId:'already claimed'},{status:'owner-skipped'}]){
  const changed={...base,agents:[{...sector,queuedFollowup:{...q,...patch}}]};
  let blocked=false;try{ownerSkip(changed,sector.id,q,now);}catch{blocked=true;}check(blocked,'stale/closed '+JSON.stringify(patch));
}
for(const k of ['workerEvents','workRuns']){
 const used={...base,commandCenter:{execution:{[k]:[{tag:q.tag}]}}};let blocked=false;
 try{ownerSkip(used,sector.id,q,now);}catch{blocked=true;}check(blocked,k);
}
const research={...q,tag:'test-sector-012',task:'Separate research task'};
const twin={...base,agents:[{...sector,researchFollowup:research}]};
check(ownerSkip(twin,sector.id,research,now).agents[0].queuedFollowup===q,'sibling item preserved');
});
test('owner click handles readback, cancellation, access and conditional conflicts',async()=>{

const q={tag:'s-010',task:'Read the example',status:'queued'}, sector={id:'s',name:'Synthetic',queuedFollowup:q};
const base={agents:[sector],commandCenter:{execution:{}},events:[],updatedAt:'2024-01-01T00:00:00Z'};
for(const mode of ['save','cancel','conflict','changed','visitor','offline','repeat','downgrade']){
 const tagButton={dataset:{skipSlot:'queuedFollowup',skipTag:q.tag,skipSector:sector.id}},message={textContent:''};
 let listener,puts=0,reads=0,applies=0,remote=base,validator='previous';
 if(mode==='changed')remote={...base,agents:[{...sector,queuedFollowup:{...q,task:'Changed'}}]};
 if(mode==='repeat')remote=ownerSkip(base,sector.id,q,Date.now());
 const state={access:mode==='visitor'?'visitor':'owner',snapshot:base},embedded=mode==='offline';
 const window={confirm:()=>mode!=='cancel'};
 const $=id=>id==='skipStatus'?message:{addEventListener:(name,fn)=>{listener=fn}};
 const apply=raw=>{applies++;state.snapshot=JSON.parse(raw)};
 const refresh=async()=>{};
 async function fetch(path,opts){
   if(path!=='/api/state'||opts.redirect!=='error'||opts.credentials!=='same-origin')throw Error('invalid request');
   if(opts.method==='PUT'){
     puts++;
     if(opts.headers['If-Match']!=='"rev"')throw Error('missing ETag');
     if(mode==='conflict')return {ok:false,status:412};
     remote=JSON.parse(opts.body);return {ok:true};
   }
   reads++;if(mode==='downgrade')state.access='visitor';return {ok:true,headers:{get:k=>k==='ETag'?'W/"rev"':'owner'},json:async()=>remote};
 }

const setup=new Function('$','state','window','embedded','ownerSkip','fetch','apply','refresh', 'let validator="";'+handler);
 setup($,state,window,embedded,ownerSkip,fetch,apply,refresh);
 await listener({target:{closest:()=>tagButton}});
 const pass=(mode==='save'&&puts===1&&reads===2&&applies===1&&remote.agents[0].queuedFollowup.status==='owner-skipped')
   || (mode==='repeat'&&puts===0&&applies===1)
   || (mode==='conflict'&&puts===1&&applies===0&&message.textContent.includes('queue changed'))
   || (['changed','downgrade'].includes(mode)&&reads===1&&puts===0&&applies===0)
   || (['cancel','visitor','offline'].includes(mode)&&reads===0&&puts===0&&applies===0);
 if(!pass)throw Error(mode+' failed');
}});
const names=['Professional','Product Design','Personal Dashboard','Personal Website','Financial Advice'];
const base={updatedAt:'2026-01-01T00:00:00.000Z',agents:names.map(name=>({id:name.toLowerCase().replaceAll(' ','-'),name,sourceType:'sector'})),commandCenter:{},events:[],reports:[]};
const task={tag:'professional-010',task:'Synthetic planned item',status:'queued'};
base.agents[0].queuedFollowup=task;
base.agents[0].researchFollowup={tag:'professional-009',task:'Separate study',status:'waiting'};
const owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test',Origin:'https://test.example'};
const service={'Orbit-Sync-Key':'fixture-service'};
function api(){
 let value=null, revision=0;
 const env={ORBIT_OWNER_EMAIL:'owner@example.test',ORBIT_SYNC_KEY_HASH:createHash('sha256').update('fixture-service').digest('hex'),BUCKET:{
  get:async()=>value && {etag:String(revision),json:async()=>JSON.parse(value)},
  put:async(k,body,{onlyIf})=>{
   if(onlyIf.etagMatches && String(revision)!==onlyIf.etagMatches || onlyIf.etagDoesNotMatch==='*' && value) return null;
   value=body;revision++;return {etag:String(revision)};
  }
 }};
 return (headers,body,tag)=>handleProjectState(new Request('https://test.example/api/state',{headers:{...headers,...(body?{'Content-Type':'application/json','If-Match':tag}:{})},method:body?'PUT':'GET',body:body&&JSON.stringify(body)}),env,base);
}
const advance=s=>({...structuredClone(s),updatedAt:new Date(Date.parse(s.updatedAt)+1000).toISOString()});
const reservation=advance(base);reservation.agents[0].queuedFollowup.claimId='claim/professional/professional-010';
const skipped=ownerSkip(base,'professional',task,Date.parse(base.updatedAt)+1000,'queuedFollowup');
test('service reservation wins and prevents stale or regenerated owner skips',async()=>{
 const request=api(), tag=(await request(service)).headers.get('etag');
 assert.equal((await request(owner,reservation,tag)).status,403);
 assert.equal((await request(service,reservation,'W/'+tag)).status,200);
 assert.equal((await request(owner,skipped,tag)).status,412);
 const etag=(await request(owner)).headers.get('etag');
 assert.equal((await request(owner,advance(skipped),etag)).status,409);
 const cleared=advance(reservation);delete cleared.agents[0].queuedFollowup.claimId;
 assert.equal((await request(service,cleared,etag)).status,409);
});
test('accepted owner skip survives stale reservations and canonical roundtrip with a distinct replacement',async()=>{
 const request=api(), tag=(await request(owner)).headers.get('etag');
 assert.equal((await request(owner,skipped,'W/'+tag)).status,200);
 assert.equal((await request(service,reservation,tag)).status,412);
 const response=await request(service), persisted=await response.json(), current=response.headers.get('etag');
 const can=advance(persisted);
 for(const mutate of [
  s=>{delete s.commandCenter.execution.ownerSkips},
  s=>{s.commandCenter.execution.ownerSkips[0].task='altered'},
  s=>{s.agents[0].queuedFollowup={...task}},
  s=>{s.agents[0].pendingAssignment={...task,claimId:'late'}},
  s=>{s.agents[0].queuedFollowup={...task,tag:'professional-011'}}
 ]){
  const copy=structuredClone(can);mutate(copy);assert.equal((await request(service,copy,current)).status,409);
 }
 can.agents[0].queuedFollowup={tag:'professional-011',task:'Distinct next task',status:'queued'};
 assert.equal((await request(service,can,current)).status,200);
 assert.deepEqual(await (await request(owner)).json(),can);
 assert.deepEqual(can.agents[0].researchFollowup,base.agents[0].researchFollowup);
 assert.doesNotMatch(await (await request({})).text(),/owner-skip|Synthetic planned item|professional-01/);
});
