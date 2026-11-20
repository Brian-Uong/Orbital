import test from 'node:test';
import assert from 'node:assert/strict';
import {renderOfficeScene} from '../public/tower.js';

function worker(handle) {
  return {handle,projectId:'professional',id:'professional:'+handle};
}

test('office art stays stable when a report changes or an earlier-sorting new worker arrives',()=>{
  const original=worker('/root/sample');
  const first=renderOfficeScene(original);
  renderOfficeScene(worker('/root/added'));
  assert.equal(renderOfficeScene({...original,name:'Sample',active:true,activity:'Checking a synthetic note'}),first);
});

test('identities that share all stock costume, desk and palette choices still have distinct wall emblems',()=>{
  const a=renderOfficeScene(worker('/root/fixture_11'));
  const b=renderOfficeScene(worker('/root/fixture_133'));
  assert.notEqual(a,b);
  const emblem=/<svg x="157"[^>]*>.*?<\/svg>/;
  assert.equal(a.replace(emblem,''),b.replace(emblem,''));
  assert.notEqual(a.match(emblem)[0],b.match(emblem)[0]);
});
