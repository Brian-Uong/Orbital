import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTowerFloors} from '../public/roster.js';
import {officeByHandle} from '../public/tower.js';
import {workerName,workerMentions} from '../public/worker-roster.js';
import {workspaceViews} from '../public/workspace.js';

const now=Date.parse('2026-01-02T10:00:00Z');
const sector={id:'professional',name:'Sample project',sourceType:'sector',status:'completed'};
const handle='/root/sample', prior='/root/earlier', once='/root/one_off';
const role={project:sector.id,displayName:'Sample research',observedHandles:[handle,prior]};
const tag=n=>'professional-'+String(n).padStart(3,'0');
const receipt=(executorId,type,i,n=i)=>({id:'receipt-'+i,projectId:sector.id,projectName:sector.name,tag:tag(n),
  executorId,type,source:'Synthetic Work',at:new Date(now-600000+i*1000).toISOString(),artifactUrl:'https://example.test/result'});
const done=[receipt(prior,'completed',1),receipt(handle,'completed',2),receipt(once,'completed',3)];
function snapshot(events=done,workRuns=[]) {
  return {agents:[sector],events:[],reports:[],commandCenter:{execution:{workerEvents:events,workRuns,workerRosterPolicy:{roles:[role]}}}};
}
const floor=data=>buildTowerFloors(data,{access:'owner',now})[0];

test('a completed one-off leaves Command and aliases share one recurring office',()=>{
  const state=snapshot(); const original=JSON.stringify(state);const result=floor(state);
  assert.deepEqual(result.workers.map(w=>[w.name,w.handle]),[['Sample research',handle]]);
  assert.equal(result.allWorkers.length,3);
  const historical=officeByHandle(result,once);
  assert.equal(historical.name,'one_off');assert.equal(historical.artifactUrl,'https://example.test/result');
  assert.equal(historical.id,sector.id+':'+once);assert.equal(original,JSON.stringify(state));
});
test('a new assignment revives an archived worker and two unfinished specialists stay separate',()=>{
  const rows=[...done,receipt(once,'assigned',4),receipt(prior,'assigned',5),receipt(handle,'assigned',6)];
  const result=floor(snapshot(rows));
  assert.deepEqual(result.workers.map(w=>w.name).sort(),['earlier','one_off','sample']);
  assert.ok(result.workers.every(w=>!w.active));
});
test('a fresh completion for a different task cannot hide a stale unfinished task',()=>{
  const result=floor(snapshot([...done,receipt(once,'started',4),receipt(once,'completed',5)]));
  assert.ok(result.workers.some(w=>w.handle===once && !w.active && w.hasOpenWork));
});
test('a completed assignment cannot be reopened by replay of its old receipt',()=>{
  const start=receipt(once,'assigned',5,4),end=receipt(once,'completed',6,4);
  const result=floor(snapshot([...done,start,end,start]));
  assert.ok(!result.workers.some(w=>w.handle===once));
});
test('private archive and role names are absent from public and visitor views',()=>{
  for (const access of ['visitor','anonymous']) {
    const projected=buildTowerFloors(snapshot(),{access,now});assert.equal(projected.length,1);
    assert.deepEqual(projected[0].workers,[]);assert.ok(!Object.hasOwn(projected[0],'allWorkers'));
    assert.doesNotMatch(JSON.stringify(projected),/one_off|Sample research|\/root/);
  }
});
test('people-facing path cleanup preserves nested identities, URLs and original history',()=>{
  assert.equal(workerName('/root'),'Coordinator');assert.equal(workerName('/root/team/check'),'team/check');
  assert.equal(workerName('/rooted/check'),'/rooted/check');
  assert.equal(workerMentions('Work · /root/sample · https://example.test/root/sample',new Set([handle])),
    'Work · sample · https://example.test/root/sample');
  const row={tag:tag(2),executorId:handle,specialistName:handle,source:'Synthetic Work',status:'verified',
    summary:'Work · /root/sample · completed',artifactUrl:'https://example.test/result',verifiedAt:new Date(now).toISOString()};
  const state=snapshot(done,[row]);const history=workspaceViews(state,{sectorId:sector.id,now}).history;
  assert.match(history,/<strong>sample<\/strong>/);assert.doesNotMatch(history,/\/root\//);
  assert.ok(history.includes(row.artifactUrl));assert.equal(row.executorId,'/root/sample');
});
