import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleProjectState} from '../src/project-state.js';
import {handleApi} from '../src/api.js';

const origin='https://station.example';
const owner={'oai-authenticated-user-id':'site-owner','oai-authenticated-user-email':'owner@example.test'};
const viewer={'oai-authenticated-user-id':'signed-in-visitor','oai-authenticated-user-email':'other@example.test'};
const service={'Orbit-Sync-Key':'test-service'};
const names=['Professional','Product Design','Personal Dashboard','Personal Website','Financial Advice'];
const seed={updatedAt:'2025-01-01T12:00:00Z', commandCenter:{secret:'private-canary'},
  agents:names.map(name=>({id:name.toLowerCase().replaceAll(' ','-'),name,sourceType:'sector',status:'completed',task:'private-canary',
    artifact:{text:'private-canary'},privateThread:'private-canary'})),events:[{title:'private-canary'}],reports:[{data:'private-canary'}]};
function bindings(){
  let saved;
  return {ORBIT_OWNER_EMAIL:'Owner@Example.Test',ORBIT_SYNC_KEY_HASH:createHash('sha256').update('test-service').digest('hex'),
    BUCKET:{get:async()=>saved,put:async(key,text)=>{saved={etag:'stored',json:async()=>JSON.parse(text)};return saved;}}};
}
const call=(env,headers={},method='GET',body)=>handleProjectState(new Request(origin+'/api/state',{method,headers:{'Content-Type':'application/json',...headers},body:body&&JSON.stringify(body)}),env,seed);

test('visitor state exposes only the allowlisted map even with an unrelated signed-in identity',async()=>{
  for(const headers of [{},viewer,{'oai-authenticated-user-email':'owner@example.test'},{'oai-authenticated-user-id':'site-owner'}]){
    const res=await call(bindings(),headers);
    assert.equal(res.status,200);assert.match(res.headers.get('Cache-Control'),/no-store/);
    const publicState=await res.json();
    assert.doesNotMatch(JSON.stringify(publicState),/canary/);
    assert.deepEqual(publicState.events,[]);assert.deepEqual(publicState.reports,[]);
    assert.equal(publicState.agents.length,5);
    assert.deepEqual(Object.keys(publicState.agents[0]).sort(),['id','name','sourceType','status']);
  }
  const missing=bindings();delete missing.ORBIT_OWNER_EMAIL;
  assert.doesNotMatch(await (await call(missing,owner)).text(),/canary/);
  assert.equal((await call(bindings(),{'Orbit-Sync-Key':'invalid'})).status,401);
});

test('only the owner session or service can read and conditionally replace private state',async()=>{
  for(const headers of [owner,service]){
    const env=bindings(),get=await call(env,headers);
    assert.match(await get.text(),/private-canary/);
    const etag=get.headers.get('ETag'), next={...seed,updatedAt:'2025-01-01T13:00:00Z'};
    assert.equal((await call(env,{...headers,Origin:origin},'PUT',next)).status,428);
    assert.equal((await call(env,{...headers,'If-Match':'"older"',Origin:origin},'PUT',next)).status,412);
    assert.equal((await call(env,{...headers,'If-Match':etag,...(headers===owner?{Origin:origin}:{})},'PUT',next)).status,200);
    assert.deepEqual(await (await call(env,headers)).json(),next);
  }
});

test('anonymous and unrelated users cannot mutate the shared feed or use legacy agent endpoints',async()=>{
  for(const headers of [{},viewer]){
    const env=bindings();assert.equal((await call(env,headers,'PUT',seed)).status,401);
    for(const path of ['/api/sync','/api/agents','/api/agents/agent-11111111-1111-4111-8111-111111111111/report']){
      const res=await handleApi(new Request(origin+path,{method:'POST',headers:{Origin:origin,...headers},body:'{}'}),env);
      assert.equal(res.status,401);
    }
    assert.equal((await handleApi(new Request(origin+'/api/state',{headers}),env)).status,401);
  }
  for(const originHeader of [{},{Origin:'https://other.example'},{Origin:origin,'Sec-Fetch-Site':'cross-site'}]){
    assert.equal((await call(bindings(),{...owner,...originHeader},'PUT',seed)).status,403);
  }
});


test('even fresh working sectors never expose an activity clock or executor to a visitor',async()=>{
  const recent = new Date(Date.now()-3000).toISOString();
  const fresh = {...seed,agents:seed.agents.map(a=>({...a,liveActivity:{status:'working',observedAt:recent,executorId:'/root/example'}}))};
  const env = bindings();
  for (const headers of [{},viewer]) {
    const response = await handleProjectState(new Request(origin+'/api/state',{headers}),env,fresh);
    const projected = await response.json();
    assert.ok(projected.agents.every(a=>a.status==='working' && Object.keys(a).sort().join(',')==='id,name,sourceType,status'));
    assert.doesNotMatch(JSON.stringify(projected),/\/root\/example|observedAt|lastSeen/);
  }
});

test('authorized snapshots retain new private floors and lifecycle events; visitors always receive only five original floors',async()=>{
  const env=bindings();const base=await call(env,service);
  const event={id:'fixture-create-1',executorId:'/root/fixture',projectId:'private-lab',projectName:'Private Lab',type:'created',at:'2025-01-01T13:00:00Z',source:'Scheduled ChatGPT Work'};
  const data={...seed,updatedAt:'2025-01-01T13:00:00Z',commandCenter:{execution:{workerEvents:[event,event]}},
    agents:[...seed.agents,{id:'private-lab',name:'Private Lab',sourceType:'sector',status:'ready'}]};
  const etag=base.headers.get('ETag');
  assert.equal((await call(env,{...service,'If-Match':etag},'PUT',data)).status,200);
  assert.deepEqual(await (await call(env,owner)).json(),data);
  for(const headers of [{},viewer]){
    const pub=await (await call(env,headers)).json();
    assert.deepEqual(pub.agents.map(a=>a.name),names);
    assert.doesNotMatch(JSON.stringify(pub),/Private Lab|private-lab|fixture/);
  }
  const invalid={...data,updatedAt:'2025-01-01T14:00:00Z',commandCenter:{execution:{workerEvents:[event,{...event,type:'assigned'}]}}};
  const current=await call(env,owner);
  assert.equal((await call(env,{...service,'If-Match':current.headers.get('ETag')},'PUT',invalid)).status,400);
  assert.deepEqual(await (await call(env,owner)).json(),data);
  for (const workerEvents of [[], [{...event,type:'assigned'}]]) {
    const lost={...data,updatedAt:'2025-01-01T15:00:00Z',commandCenter:{execution:{workerEvents}}};
    assert.equal((await call(env,{...service,'If-Match':current.headers.get('ETag')},'PUT',lost)).status,409);
  }
  assert.deepEqual(await (await call(env,owner)).json(),data);
});

test('conditional reads revalidate the stored object, omit idle bodies and respect audience changes',async()=>{
  const env=bindings();
  let snapshot=seed, revision='stored-v1', parses=0, validations=0;
  env.BUCKET.get=async(key,options)=>{
    if(options?.onlyIf?.etagDoesNotMatch===revision) {
      validations++;
      return {etag:revision};
    }
    return {etag:revision,json:async()=>{parses++;return snapshot;}};
  };
  const first=await call(env,owner);
  const ownerTag=first.headers.get('ETag');
  assert.match(await first.text(),/private-canary/);
  const idle=await call(env,{...owner,'If-None-Match':ownerTag});
  assert.equal(idle.status,304);
  assert.equal(idle.headers.get('Orbit-Access'),'owner');
  assert.equal(idle.headers.get('ETag'),ownerTag);
  assert.equal((await idle.arrayBuffer()).byteLength,0);
  assert.equal(parses,1);assert.equal(validations,1);
  const weakTag='W/'+ownerTag;
  const browserIdle=await call(env,{...owner,'If-None-Match':weakTag});
  assert.equal(browserIdle.status,304);
  assert.equal(browserIdle.headers.get('ETag'),weakTag);
  assert.equal(browserIdle.headers.get('Orbit-Access'),'owner');
  assert.equal((await browserIdle.arrayBuffer()).byteLength,0);
  assert.equal(parses,1);assert.equal(validations,2);
  for(const identity of [viewer,{}]) {
    const changed=await call(env,{...identity,'If-None-Match':weakTag});
    assert.equal(changed.status,200);
    const publicTag=changed.headers.get('ETag');
    assert.notEqual(publicTag,ownerTag);
    assert.doesNotMatch(await changed.text(),/canary/);
    assert.equal((await call(env,{...identity,'If-None-Match':publicTag})).status,304);
    assert.equal((await call(env,{...owner,'If-None-Match':publicTag})).status,200);
  }
  const serviceRead=await call(env,{...service,'If-None-Match':ownerTag});
  assert.equal(serviceRead.status,200);
  assert.equal((await call(env,{...service,'If-None-Match':serviceRead.headers.get('ETag')})).status,304);
  revision='stored-v2';
  snapshot={...seed,updatedAt:'2025-01-02T13:00:00Z'};
  const fresh=await call(env,{...owner,'If-None-Match':weakTag});
  assert.equal(fresh.status,200);assert.deepEqual(await fresh.json(),snapshot);
  assert.equal((await call(env,{...owner,'If-None-Match':fresh.headers.get('ETag')},'HEAD')).status,304);
});

test('public validators account for expiry without transmitting a private activity time',async(t)=>{
  const now=Date.parse('2025-05-01T12:00:00Z');
  t.mock.timers.enable({apis:['Date'],now});
  const env=bindings();
  const current={...seed,agents:seed.agents.map(a=>({...a,liveActivity:{status:'working',observedAt:new Date(now-299999).toISOString()}}))};
  let parses=0;
  env.BUCKET.get=async(key,options)=>options?.onlyIf?.etagDoesNotMatch==='same' ? {etag:'same'} :
    {etag:'same',json:async()=>{parses++;return current;}};
  const live=await call(env), tag=live.headers.get('ETag');
  assert.ok((await live.json()).agents.every(a=>a.status==='working'));
  t.mock.timers.tick(1);
  const expired=await call(env,{'If-None-Match':'W/'+tag});
  assert.equal(expired.status,200);
  assert.notEqual(expired.headers.get('ETag'),tag);
  assert.ok((await expired.json()).agents.every(a=>a.status==='unknown'));
  assert.equal(parses,1);
});
