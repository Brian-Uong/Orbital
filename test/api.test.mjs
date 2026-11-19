import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleApi} from '../src/api.js';
import {observedAt, initialAgents} from '../src/sources.js';

class MemoryBucket {
  objects = new Map();
  sequence = 0;
  async get(key) {
    const item = this.objects.get(key);
    return item && {etag:item.etag, json:async () => JSON.parse(item.text)};
  }
  async put(key, text, options = {}) {
    const existing = this.objects.get(key);
    const condition = options.onlyIf;
    if (condition?.etagMatches && existing?.etag !== condition.etagMatches) return null;
    if (condition instanceof Headers && existing && condition.get('if-none-match') === '*') return null;
    const item = {text,etag:String(++this.sequence)};
    this.objects.set(key,item);
    return item;
  }
  async list({prefix}) {
    return {objects:[...this.objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({key})),truncated:false};
  }
}

const env = () => ({ORBIT_OWNER_EMAIL:'owner@example.test',BUCKET:new MemoryBucket(),ORBIT_SYNC_KEY_HASH:createHash('sha256').update('service-key').digest('hex')});
const USER = {'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test',Origin:'https://station.example'};
const SYNC = {'Orbit-Sync-Key':'service-key'};

async function api(bindings, path, headers = {}, payload) {
  const request = new Request('https://station.example' + path,{
    method:payload === undefined ? 'GET' : 'POST',
    headers:{'Content-Type':'application/json',...headers},body:payload === undefined ? undefined : JSON.stringify(payload)
  });
  const response = await handleApi(request, bindings);
  return {status:response.status,data:await response.json()};
}

test('reads require a visitor or service credential, registration requires a visitor, sync requires service access', async () => {
  const bindings = env();
  assert.equal((await api(bindings,'/api/state')).status,401);
  assert.equal((await api(bindings,'/api/state',{'Orbit-Sync-Key':'invalid'})).status,401);
  assert.equal((await api(bindings,'/api/state',USER)).data.agents.length,initialAgents.length);
  assert.equal((await api(bindings,'/api/state',SYNC)).status,200);
  assert.equal((await api(bindings,'/api/sync',USER,{})).status,401);
  assert.equal((await api(bindings,'/api/agents',SYNC,{name:'New agent'})).status,401);
  assert.equal((await api(bindings,'/api/agents',{...USER,Origin:'https://other.example'},{name:'New agent'})).status,403);
  assert.equal((await api({ORBIT_OWNER_EMAIL:'owner@example.test'},'/api/state',USER)).status,503);
});

test('replacement, merge, exact replay, out-of-order and empty snapshots preserve actual source membership', async t => {
  const bindings = env();
  const base = Date.parse(observedAt);
  t.mock.timers.enable({apis:['Date'],now:base + 60_000});
  const sync = (sec,mode,agents) => api(bindings,'/api/sync',SYNC,{
    sourceType:'automation',observedAt:new Date(base + sec * 1000).toISOString(),mode,agents
  });
  const agent = {id:'imported',name:'Inbox',task:'Check inbox',status:'scheduled',source:'Scheduler'};
  assert.equal((await sync(1,'replace',[agent])).data.applied,true);
  assert.equal((await sync(1,'replace',[])).data.applied,false);
  assert.equal((await sync(0,'replace',[])).data.applied,false);
  assert.equal((await sync(2,'merge',[{...agent,id:'next'}])).data.count,2);
  assert.equal((await sync(3,'replace',[agent,agent])).status,400);
  const snapshot = (await api(bindings,'/api/state',USER)).data;
  assert.deepEqual(snapshot.agents.filter(a=>a.sourceType==='automation').map(a=>a.id),['imported','next']);
  assert.deepEqual(snapshot.agents.filter(a=>a.sourceType==='worker').map(a=>a.id),initialAgents.filter(a=>a.sourceType==='worker').map(a=>a.id));
  assert.equal((await sync(4,'replace',[])).data.count,0);
  assert.equal((await api(bindings,'/api/state',USER)).data.agents.some(a=>a.sourceType==='automation'),false);
});

test('per-agent report key stays private, only updates its own agent, deduplicates retries, expires a working signal', async t => {
  const bindings=env();
  const base = Date.parse(observedAt) + 60_000;
  t.mock.timers.enable({apis:['Date'],now:base});
  const a = await api(bindings,'/api/agents',USER,{name:'My bot'});
  const b = await api(bindings,'/api/agents',USER,{name:'Other bot',source:'Local'});
  assert.equal(a.status,201);
  assert.equal(a.data.agent.lastSeen,null);
  const path=a.data.connection.path, key={...SYNC,'Orbit-Agent-Key':a.data.connection.token};
  const body={task:'Reviewing a draft',status:'working',eventId:'draft:1'};
  assert.equal((await api(bindings,b.data.connection.path,key,body)).status,401);
  assert.equal((await api(bindings,path,SYNC,body)).status,401);
  assert.equal((await api(bindings,path,key,body)).data.applied,true);
  t.mock.timers.tick(1000);
  assert.equal((await api(bindings,path,key,body)).data.applied,false);
  assert.equal((await api(bindings,path,key,{...body,eventId:'draft:2',lastSeen:new Date(base-100).toISOString()})).data.applied,false);
  const fresh=(await api(bindings,'/api/state',USER)).data;
  assert.equal(fresh.agents.find(agent=>agent.id===a.data.agent.id).status,'working');
  assert.equal(fresh.events.filter(ev=>ev.title==='Reviewing a draft').length,1);
  assert.ok(!JSON.stringify(fresh).includes(a.data.connection.token));
  assert.ok(!JSON.stringify(fresh).includes('tokenHash'));
  t.mock.timers.tick(11 * 60_000);
  const stale=(await api(bindings,'/api/state',USER)).data.agents.find(agent=>agent.id===a.data.agent.id);
  assert.equal(stale.status,'unknown');
  assert.equal(stale.staleReportedStatus,'working');
  assert.equal(stale.lastSeen,new Date(base).toISOString());
});

test('concurrent partial observations merge, and an older full roster preserves a later agent observation', async t => {
  const bindings = env();
  const base = Date.parse(observedAt);
  t.mock.timers.enable({apis:['Date'],now:base+60_000});
  const agent = id => ({id,name:id,status:'scheduled',task:'Process queue'});
  const write = (mode,second,ids) => api(bindings,'/api/sync',SYNC,{
    sourceType:'automation',mode,observedAt:new Date(base + second*1000).toISOString(),agents:ids.map(agent)
  });
  const both = await Promise.all([write('merge',5,['alpha']),write('merge',5,['beta'])]);
  assert.ok(both.every(r=>r.data.applied));
  await write('replace',4,['older']);
  const state = (await api(bindings,'/api/state',USER)).data;
  assert.deepEqual(state.agents.filter(a=>a.sourceType==='automation').map(a=>a.id).sort(),['alpha','beta','older']);
  assert.equal((await write('merge',5,['beta'])).data.applied,false);
  assert.equal((await write('merge',3,['removed'])).data.applied,false);
});

test('an idle watcher becomes unknown 20 minutes after its latest checkpoint', async t => {
  const bindings = env();
  const base = Date.parse(observedAt) + 6000;
  const at = new Date(base).toISOString();
  t.mock.timers.enable({apis:['Date'],now:base});
  await api(bindings,'/api/sync',SYNC,{sourceType:'worker',mode:'replace',observedAt:at,
    agents:[{id:'watcher',name:'Watcher',status:'idle',task:'Check the journal',lastSeen:at}]});
  const watcher = async () => (await api(bindings,'/api/state',USER)).data.agents.find(a => a.id === 'watcher');
  t.mock.timers.tick(20 * 60_000 - 1);
  assert.equal((await watcher()).status,'idle');
  t.mock.timers.tick(1);
  const expired = await watcher();
  assert.equal(expired.status,'unknown');
  assert.equal(expired.lastSeen,at);
  assert.equal(expired.staleReportedStatus,'idle');
});
