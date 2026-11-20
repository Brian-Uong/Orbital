import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTowerFloors} from '../public/roster.js';

const now = Date.parse('2025-01-02T13:20:00Z');
const stamp = delta => new Date(now+delta).toISOString();
const tag = 'professional-001';
const lead = '/root/example';
const contributor = '/root/reviewer';
const sector = {id:'professional',name:'Professional',sourceType:'sector',status:'working'};
function snapshot(runs=[],extras={},events=[]) {
  return {agents:[{...sector,...extras}],commandCenter:{execution:{workRuns:runs}},events};
}
const run = {tag,executorId:lead,status:'running',observedAt:stamp(-5000),summary:'Reviewing sample invoices',source:'Scheduled ChatGPT Work'};
const floor = value => buildTowerFloors(value,{access:'owner',now})[0];

test('one stable office per case-sensitive project executor across ledger, summaries, specialist list and events',()=>{
  const finished = {...run,status:'verified',verifiedAt:stamp(-1000),artifactUrl:'https://example.test/work',
    executors:[{id:lead,contribution:'Wrote the draft'},{id:contributor,contribution:'Checked dates',artifactUrl:'https://example.test/check'}]};
  const data = snapshot([run,finished,finished],{workEvidence:finished,
    workSpecialists:[{executorId:lead,observedTag:tag}]},[{agentId:sector.id,executorId:lead,tag,at:finished.verifiedAt,title:'Repeated card'}]);
  const rooms = floor(data).workers;
  assert.deepEqual(rooms.map(w=>[w.handle,w.status,w.activity]),[[lead,'completed','Wrote the draft'],[contributor,'completed','Checked dates']]);
  assert.equal(rooms[1].artifactUrl,'https://example.test/check');
  data.commandCenter.execution.workRuns.reverse();
  assert.deepEqual(floor(data).workers.map(w=>w.id),rooms.map(w=>w.id));
});

test('multiple simultaneous reports expire independently, including contributor-specific evidence',()=>{
  const active = {...run,executors:[{id:contributor,status:'working',observedAt:stamp(-230000),contribution:'Checking synthetic amounts'},
    {id:'/root/nopulse',contribution:'Wrote earlier notes'},{id:'/root/no_clock',status:'running',contribution:'No timestamp'}]};
  const data = snapshot([active,{...run,tag:'professional-002',status:'verified',verifiedAt:stamp(-1000)}]);
  const workers = delta=>buildTowerFloors(data,{access:'service',now:now+delta})[0].workers.filter(w=>w.active).map(w=>w.handle);
  assert.deepEqual(workers(0),[lead,contributor]);
  assert.deepEqual(workers(70000),[lead]);
  assert.deepEqual(workers(295000),[]);
  assert.equal(floor(snapshot([{...run,observedAt:stamp(1200)}])).workers[0].active,false);
  assert.equal(floor(snapshot([{...run,expiresAt:stamp(-1)}])).workers[0].active,false);
});

test('historical threads, schedules, queued work and unattributed project heartbeats create no rooms',()=>{
  const data = snapshot([{tag,status:'verified'}, {...run,status:'queued'}, {...run,tag:'professional-001junk'}],{
    threadTitle:'Project room',folderAgents:[{name:'Example folder'}],queuedFollowup:{executorId:lead,status:'planned'},
    liveActivity:{status:'working',action:'Thread signal',observedAt:stamp(-1000)}});
  assert.deepEqual(floor(data).workers,[]);
  assert.match(floor(data).coverage,/no recorded executor/);
});

test('named activity with timestamps can distinguish simultaneous live signals from an old report',()=>{
  const data = snapshot([],{liveActivity:[
    {executorId:lead,status:'working',observedAt:stamp(-10000),action:'Writing'},
    {executorId:contributor,status:'working',observedAt:stamp(-300000),action:'Reading'}
  ]});
  assert.deepEqual(floor(data).workers.map(w=>[w.status,w.active]),[['working',true],['last seen',false]]);
});

test('visitor projection contains zero private worker fields and remains fail-closed for unknown roles',()=>{
  for (const access of ['visitor','anonymous',undefined]) {
    const projected = buildTowerFloors(snapshot([run]),{access,now});
    assert.deepEqual(projected[0].workers,[]);
    assert.doesNotMatch(JSON.stringify(projected),/\/root|invoices/);
  }
});

test('the first authoritative lifecycle observation creates an office on its private project floor',()=>{
  const projectId = 'sample-lab';
  const created = {id:'record-1',projectId,projectName:'Sample Lab',executorId:lead,type:'created',
    at:stamp(-20000),source:'Interactive ChatGPT Work',activity:'Review worker created'};
  const row = (id,type,delta,extra={})=>({...created,id,type,at:stamp(delta),...extra});
  const input=snapshot();
  const lifecycle=input.commandCenter.execution.workerEvents=[created];
  const read=()=>buildTowerFloors(input,{access:'owner',now}).find(f=>f.id===projectId);
  const first=read();
  assert.equal(first.name,'Sample Lab');
  assert.equal(first.workers.length,1);
  assert.equal(first.workers[0].status,'created');
  assert.equal(first.workers[0].active,false);
  lifecycle.push(row('record-2','assigned',-18000,{tag:'sample-lab-001'}),created);
  assert.equal(read().workers[0].status,'assigned');
  assert.equal(read().workers[0].id,first.workers[0].id);
  lifecycle.push(row('record-3','started',-16000,{tag:'sample-lab-001'}));
  assert.equal(read().workers[0].status,'working');
  assert.equal(read().workers[0].expiresAt,stamp(284000));
  lifecycle.push(row('record-4','completed',-15000,{tag:'sample-lab-001',activity:'Approved synthetic handoff',artifactUrl:'https://example.test/result'}));
  lifecycle.push(row('record-5','started',-10000,{tag:'sample-lab-002',activity:'Preparing the second sample'}));
  lifecycle.reverse();
  const active=read().workers[0];
  assert.equal(active.status,'working');
  assert.equal(active.tag,'sample-lab-002');
  assert.equal(active.artifactUrl,'');
  assert.equal(active.lastResult.artifactUrl,'https://example.test/result');
  assert.equal(active.lastResult.tag,'sample-lab-001');
  lifecycle.push(row('record-6','idle',-5000));
  assert.equal(read().workers[0].status,'idle');
  assert.equal(read().workers[0].active,false);
  assert.equal(read().workers[0].lastResult.activity,'Approved synthetic handoff');
  // Even an improperly passed private document returns only known public floors in visitor mode.
  input.agents.push({sourceType:'sector',id:projectId,name:'Sample Lab',status:'ready'});
  assert.equal(buildTowerFloors(input,{access:'visitor',now}).some(f=>f.id===projectId),false);
});

test('named assignments create a room before completion; planning, bad handles and missing provenance cannot',()=>{
  const base={id:'1',type:'assigned',projectId:'research',projectName:'Research',executorId:lead,source:'Scheduled ChatGPT Work',at:stamp(-1000)};
  const data=snapshot();
  data.commandCenter.execution.workerEvents=[{...base,type:'planned'},{...base,id:'2',executorId:'example'},
    {...base,id:'3',source:''}];
  assert.equal(buildTowerFloors(data,{access:'owner',now}).length,1);
  data.commandCenter.execution.workerEvents.push(base,{...base,id:'4',executorId:contributor});
  const added=buildTowerFloors(data,{access:'service',now})[1];
  assert.equal(added.workers.length,2);assert.equal(added.status,'assigned');assert.ok(added.workers.every(w=>!w.active));
});
