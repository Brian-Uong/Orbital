import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {handleProjectState} from '../src/project-state.js';
import {workspaceViews} from '../public/workspace.js';
const owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test',origin:'https://test.example'};
const service={'Orbit-Sync-Key':'synthetic-service'};
function setup(){
 const names=['Professional','Stella Zhang','Personal Dashboard','Personal Website','Financial Advice'];
 const seed={updatedAt:'2024-01-01T00:00:00Z',agents:names.map(name=>({id:name.toLowerCase().replaceAll(' ','-'),name,sourceType:'sector',queuedFollowup:{tag:name.toLowerCase().replaceAll(' ','-')+'-010',task:'Synthetic planned work',status:'queued'}})),commandCenter:{execution:{releaseReviews:[{id:'review-1',project:'professional',status:'approved queued'}]}},events:[],reports:[]};
 let stored=null,rev=0;
 const env={ORBIT_OWNER_EMAIL:'owner@example.test',ORBIT_SYNC_KEY_HASH:createHash('sha256').update('synthetic-service').digest('hex'),BUCKET:{get:async()=>stored&&{etag:String(rev),json:async()=>structuredClone(stored)},put:async(k,v,{onlyIf})=>{if(onlyIf.etagMatches&&onlyIf.etagMatches!==String(rev))return null;stored=JSON.parse(v);return {etag:String(++rev)};}}};
 const request=(path,body,tag,headers=owner)=>handleProjectState(new Request('https://test.example'+path,{method:body?(path==='/api/state'?'PUT':'POST'):'GET',headers:{...headers,'Content-Type':'application/json',...(tag?{'If-Match':tag}:{})},body:body?JSON.stringify(body):undefined}),env,seed);
 const read=async(headers=owner)=>{const r=await request('/api/state',null,null,headers);return {data:await r.json(),tag:r.headers.get('ETag')};};
 const control=async(sectorId,paused)=>request('/api/sector-control',{sectorId,paused},(await read()).tag);
 return {request,read,control};
}
const advance=data=>({...data,updatedAt:new Date(Math.max(Date.now(),Date.parse(data.updatedAt)+1)).toISOString()});
test('sector controls require owner, origin, current revision and valid sector',async()=>{
 const {request,read}=setup();const {tag}=await read(),body={sectorId:'professional',paused:true};
 for(const [headers,status] of [[{},401],[service,403],[{...owner,origin:'https://other.test'},403]])assert.equal((await request('/api/sector-control',body,tag,headers)).status,status);
 assert.equal((await request('/api/sector-control',body)).status,428);
 assert.equal((await request('/api/sector-control',body,'"stale"')).status,412);
 for(const invalid of [{sectorId:'missing',paused:true},{sectorId:'__proto__',paused:true},{sectorId:'professional',paused:'true'}])assert.equal((await request('/api/sector-control',invalid,tag)).status,400);
});
test('pause preserves queues and sibling sectors; repeat is idempotent; resume is independent',async()=>{
 const {read,control,request}=setup();const initial=await read();
 assert.equal((await control('professional',true)).status,200);
 const paused=await read();assert.deepEqual(paused.data.agents,initial.data.agents);assert.deepEqual(paused.data.commandCenter.execution,initial.data.commandCenter.execution);
 assert.equal(Object.keys(paused.data.commandCenter.sectorControls).length,1);
 const repeat=await request('/api/sector-control',{sectorId:'professional',paused:true},initial.tag);
 assert.equal((await repeat.json()).applied,false);assert.equal((await read()).tag,paused.tag);
 await control('financial-advice',true);await control('professional',false);
 const end=(await read()).data.commandCenter.sectorControls;
 assert.equal(end.professional.paused,false);assert.equal(end['financial-advice'].paused,true);
 const publicState=(await read({})).data;
 assert.equal(publicState.commandCenter.sectorControls,undefined);
});
test('full state sync cannot erase or change sector decisions',async()=>{
 const {read,control,request}=setup();await control('professional',true);
 for(const headers of [owner,service]){
  const current=await read();const changed=advance(structuredClone(current.data));delete changed.commandCenter.sectorControls;
  assert.equal((await request('/api/state',changed,current.tag,headers)).status,409);
 }
 const current=await read();assert.equal((await request('/api/state',advance(current.data),current.tag,service)).status,200);
});
test('global resume preserves sector pauses and sector resume preserves global pause',async()=>{
 const {read,control,request}=setup();await control('professional',true);
 await request('/api/workflow-control',{paused:true},(await read()).tag);
 await control('professional',false);assert.equal((await read()).data.commandCenter.workflowControl.paused,true);
 await control('professional',true);
 await request('/api/workflow-control',{paused:false},(await read()).tag);
 assert.equal((await read()).data.commandCenter.sectorControls.professional.paused,true);
});
test('paused sectors reject new assignment and release claims while other sectors continue',async()=>{
 const {read,control,request}=setup();await control('professional',true);
 for(const type of ['assignment','releaseClaimId','revisionClaimId']){
  const current=await read(),next=advance(structuredClone(current.data));
  if(type==='assignment')next.agents[0].queuedFollowup.claimId='new';else next.commandCenter.execution.releaseReviews[0][type]='new';
  assert.equal((await request('/api/state',next,current.tag,service)).status,409,type);
 }
 const current=await read(),next=advance(structuredClone(current.data));next.agents[1].queuedFollowup.claimId='other-sector';
 assert.equal((await request('/api/state',next,current.tag,service)).status,200);
 await control('professional',false);
 const resumed=await read(),run=advance(structuredClone(resumed.data));run.agents[0].queuedFollowup.claimId='resumed';
 assert.equal((await request('/api/state',run,resumed.tag,service)).status,200);
 await control('professional',true);
 const active=await read(),done=advance(structuredClone(active.data));done.agents[0].queuedFollowup.status='completed';
 assert.equal((await request('/api/state',done,active.tag,service)).status,200,'existing work may record checkpoint completion');
});
test('global pause blocks new claims even if the sector is enabled',async()=>{
 const {read,request}=setup();await request('/api/workflow-control',{paused:true},(await read()).tag);
 const current=await read(),next=advance(structuredClone(current.data));next.agents[0].queuedFollowup.claimId='new';
 assert.equal((await request('/api/state',next,current.tag,service)).status,409);
});
test('Roadmap shows independent accessible owner controls and effective global pause',async()=>{
 const {read,control,request}=setup();await control('professional',true);
 const data=(await read()).data;const html=workspaceViews(data,{allowSkip:true}).roadmap;
 assert.equal((html.match(/data-sector-control=/g)||[]).length,5);
 assert.match(html,/aria-label="Resume Professional"/);assert.match(html,/aria-label="Pause Financial Advice"/);
 assert.match(html,/Sector paused/);assert.match(html,/Synthetic planned work/);
 assert.doesNotMatch(workspaceViews(data).roadmap,/data-sector-control=/);
 await request('/api/workflow-control',{paused:true},(await read()).tag);
 assert.match(workspaceViews((await read()).data,{allowSkip:true}).roadmap,/Paused by global control/);
});
test('Roadmap click persists and verifies exact sector, handles conflicts, and guards access',async()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const handler=app.slice(app.indexOf('let savingSector='),app.indexOf('let savingSkip='));
 for(const mode of ['pause','resume-global','conflict','unverified','visitor','embedded']){
  let listener,writes=0,reads=0,applied=0;
  const paused=mode==='resume-global';
  let data={agents:[{id:'professional',name:'Professional'}],commandCenter:{sectorControls:{professional:{paused}},workflowControl:{paused}}};
  const button={dataset:{sectorControl:'professional',paused:String(paused)},disabled:false};
  const notice={textContent:''},state={access:mode==='visitor'?'visitor':'owner'};
  const $=id=>id==='sectorControlStatus'?notice:{addEventListener:(event,fn)=>listener=fn};
  const fetch=async(path,options)=>{
   assert.equal(options.redirect,'error');assert.equal(options.credentials,'same-origin');
   if(path==='/api/state'){reads++;return {ok:true,headers:{get:k=>k==='ETag'?'"revision"':'owner'},json:async()=>data};}
   writes++;assert.equal(path,'/api/sector-control');assert.equal(options.headers['If-Match'],'"revision"');
   const body=JSON.parse(options.body);assert.deepEqual(body,{sectorId:'professional',paused:!paused});
   if(mode==='conflict')return {ok:false,json:async()=>({error:'Station changed'})};
   if(mode!=='unverified')data={...data,commandCenter:{...data.commandCenter,sectorControls:{professional:{paused:!paused}}}};
   return {ok:true,json:async()=>({applied:true})};
  };
  new Function('$','state','embedded','fetch','apply','document','let validator="";'+handler)($,state,mode==='embedded',fetch,()=>applied++,{querySelectorAll:()=>[]});
  await listener({target:{closest:()=>button}});
  if(['visitor','embedded'].includes(mode)){assert.equal(writes,0);assert.equal(reads,0);}
  else if(mode==='conflict'){assert.equal(applied,0);assert.match(notice.textContent,/Station changed/);}
  else if(mode==='unverified'){assert.equal(applied,0);assert.match(notice.textContent,/changed again/);}
  else {assert.equal(writes,1);assert.equal(reads,2);assert.equal(applied,1);assert.match(notice.textContent,mode==='pause'?/Professional paused/:/Global Pause/);}
  assert.equal(button.disabled,false);
 }
});
