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


