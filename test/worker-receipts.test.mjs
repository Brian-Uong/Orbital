import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeWorkerReceipts} from '../scripts/record-worker-events.mjs';
import {buildTowerFloors} from '../public/roster.js';

const now = Date.parse('2026-01-02T00:00:00Z');
const stamp = delta => new Date(now+delta).toISOString();
const names = ['Professional','Product Design','Personal Dashboard','Personal Website','Financial Advice'];
const state = {updatedAt:stamp(-2000),commandCenter:{privateNote:'Keep 🎨',execution:{workRuns:[]}},
  agents:names.map(name=>({id:name.toLowerCase().replaceAll(' ','-'),name,sourceType:'sector'})),
  events:[{id:'existing'}], reports:[{id:'existing-brief'}]};
const prefix = Buffer.from('\uFEFF<!doctype html>\r\n<p>東京</p><script type="application/json" id="orbital-snapshot">');
const suffix = Buffer.from('</script><script type="application/octet-stream" id="orbital-desktop">UEsDBA==</script>\r\n');
const shell = Buffer.concat([prefix,Buffer.from(JSON.stringify(state,null,2)),suffix]);
const receipt = {observationKey:'first-use:fixture-001',projectId:'fixture-project',projectName:'Fixture project',
  executorId:'/root/fixture',type:'assigned',at:stamp(-1000),source:'Synthetic Work',activity:'Read A < B'};

test('first use registers the office, repeated submission preserves revision and all original shell bytes',()=>{
  const merged = mergeWorkerReceipts(shell,[receipt,receipt],now);
  assert.equal(merged.added,1);
  assert.ok(merged.html.subarray(0,prefix.length).equals(prefix));
  assert.ok(merged.html.subarray(-suffix.length).equals(suffix));
  assert.ok(merged.state.toString().includes('A \\u003c B'));
  const next = JSON.parse(merged.state);
  assert.deepEqual(next.reports,state.reports);
  assert.deepEqual(next.events,state.events);
  assert.equal(next.commandCenter.privateNote,'Keep 🎨');
  assert.equal(next.commandCenter.execution.workerEvents.length,1);
  const floor = buildTowerFloors(next,{access:'owner',now}).at(-1);
  assert.deepEqual(floor.workers.map(w=>[w.handle,w.status]),[['/root/fixture','assigned']]);
  const replay = mergeWorkerReceipts(merged.html,[receipt],now+60000);
  assert.equal(replay.added,0);assert.deepEqual(replay.html,merged.html);
  assert.deepEqual(JSON.parse(replay.state),next);
});

test('distinct executors and out-of-order changes survive refresh without reversing the latest room state',()=>{
  const done = {...receipt,id:'result-1',type:'completed',at:stamp(-200),activity:'Checked the fixture'};
  const result = mergeWorkerReceipts(shell,[done,{...receipt,executorId:'/root/second'},receipt],now);
  const data = JSON.parse(result.state);
  assert.equal(data.commandCenter.execution.workerEvents.length,3);
  const workers = buildTowerFloors(data,{access:'owner',now}).at(-1).workers;
  assert.deepEqual(workers.map(w=>[w.handle,w.status]),[['/root/fixture','completed'],['/root/second','assigned']]);
});

test('divergent retries, unknown payload fields and ambiguous snapshot scripts are rejected',()=>{
  assert.throws(()=>mergeWorkerReceipts(shell,[receipt,{...receipt,activity:'Changed'}],now),/conflicts/);
  assert.throws(()=>mergeWorkerReceipts(shell,[{...receipt,transcript:'Do not persist'}],now),/structured worker/);
  assert.throws(()=>mergeWorkerReceipts(Buffer.concat([shell,shell]),[],now),/exactly one/);
});
