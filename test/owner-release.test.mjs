import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {handleProjectState} from '../src/project-state.js';
import {workspaceViews} from '../public/workspace.js';
const seed=JSON.parse(readFileSync(new URL('../examples/station.json',import.meta.url)));
const owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test',origin:'https://test.example'};
function setup(){
 let stored=null,rev=0;
 const base=structuredClone(seed);base.updatedAt='2024-01-01T00:00:00Z';
 const review={id:'TEST',project:base.agents[0].id,title:'Sample release',action:'Deploy tested revision',destination:'Sample site',status:'awaiting owner approval'};
 base.commandCenter.execution={releaseReviews:[review]};
 const env={ORBIT_OWNER_EMAIL:'owner@example.test',BUCKET:{get:async()=>stored&&{etag:String(rev),json:async()=>structuredClone(stored)},put:async(k,v,{onlyIf})=>{if(onlyIf.etagMatches&&onlyIf.etagMatches!==String(rev))return null;stored=JSON.parse(v);return {etag:String(++rev)};}}};
 const request=(path,body,tag,headers=owner)=>handleProjectState(new Request('https://test.example'+path,{method:body?(path==='/api/state'?'PUT':'POST'):'GET',headers:{...headers,'Content-Type':'application/json',...(tag?{'If-Match':tag}:{})},body:body?JSON.stringify(body):undefined}),env,base);
 env.ORBIT_SYNC_KEY_HASH=createHash('sha256').update('synthetic-service').digest('hex');
 return {request,review};
}
const service={'Orbit-Sync-Key':'synthetic-service'};
async function stateOf(request,headers=owner){const r=await request('/api/state',null,null,headers);return {data:await r.json(),tag:r.headers.get('ETag')};}
function advance(data){data.updatedAt=new Date(Math.max(Date.now(),Date.parse(data.updatedAt)+1)).toISOString();return data;}

test('denial is private, immutable, replay-safe and removes the pending idea',async()=>{
 const {request,review}=setup();const {tag}=await stateOf(request);
 const body={reviewId:review.id,expectedReview:JSON.stringify(review),decision:'deny'};
 assert.equal((await request('/api/release-response',body,tag,{})).status,401);
 assert.equal((await request('/api/release-response',body,tag,service)).status,403);
 assert.equal((await request('/api/release-response',body,tag,{...owner,origin:'https://evil.test'})).status,403);
 assert.equal((await request('/api/release-response',body)).status,428);
 assert.equal((await request('/api/release-response',body,'"old"')).status,412);
 assert.equal((await request('/api/release-response',{...body,expectedReview:'{}'},tag)).status,409);
 assert.equal((await request('/api/release-response',body,tag)).status,200);
 assert.equal((await (await request('/api/release-response',body,tag)).json()).applied,false);
 const current=await stateOf(request);const ledger=current.data.commandCenter.execution;
 assert.equal(ledger.ownerReviewResponses.length,1);assert.equal(ledger.releaseReviews[0].status,'denied');
 assert.equal(workspaceViews(current.data).count,0);assert.match(workspaceViews(current.data).decisions,/Denied ideas/);
 assert.equal((await request('/api/release-approval',{reviewId:review.id,expectedReview:JSON.stringify(ledger.releaseReviews[0])},current.tag)).status,409);
 for(const mutate of [d=>d.commandCenter.execution.ownerReviewResponses=[],d=>d.commandCenter.execution.releaseReviews[0].status='awaiting owner approval',d=>d.commandCenter.execution.releaseReviews=[]]){
  const changed=advance(structuredClone(current.data));mutate(changed);
  assert.equal((await request('/api/state',changed,current.tag,service)).status,409);
 }
 assert.doesNotMatch(await (await request('/api/state',null,null,{})).text(),/ownerReviewResponses|TEST|denied/);
});

test('edited output survives sync, creates a separately reviewed revision and never carries approval forward',async()=>{
 const {request,review}=setup();const {tag}=await stateOf(request);
 const body={reviewId:review.id,expectedReview:JSON.stringify(review),decision:'revise',editedOutput:'Use my revised text <script>alert(1)</script>',instructions:'Keep it concise.'};
 assert.equal((await request('/api/release-response',{...body,editedOutput:' ',instructions:''},tag)).status,400);
 assert.equal((await request('/api/release-response',{...body,instructions:'x'.repeat(10001)},tag)).status,400);
 assert.equal((await request('/api/release-response',{...body,decision:'publish'},tag)).status,400);
 const result=await (await request('/api/release-response',body,tag)).json();assert.ok(result.responseId);
 assert.equal((await (await request('/api/release-response',body,tag)).json()).applied,false);
 let current=await stateOf(request);let ledger=current.data.commandCenter.execution;
 assert.deepEqual(ledger.ownerReviewResponses[0].review,review);
 assert.equal(ledger.ownerReviewResponses[0].editedOutput,body.editedOutput);
 const view=workspaceViews(current.data,{allowSkip:true});assert.equal(view.count,0);assert.match(view.decisions,/Requested revisions/);assert.doesNotMatch(view.decisions,/<script>/);
 const revision={...review,id:'TEST-r2',proposedOutput:'Rewritten output',revisesReviewId:review.id,revisionOfResponseId:result.responseId};
 let next=advance(structuredClone(current.data));next.commandCenter.execution.releaseReviews.push({...revision,status:'approved queued',approvalId:'fake'});
 assert.equal((await request('/api/state',next,current.tag,service)).status,409);
 next=advance(structuredClone(current.data));next.commandCenter.execution.releaseReviews.push(revision);
 assert.equal((await request('/api/state',next,current.tag,service)).status,200);
 current=await stateOf(request);assert.equal(workspaceViews(current.data).count,1);
 assert.match(workspaceViews(current.data,{allowSkip:true}).decisions,/data-edit-review="TEST-r2"/);
 assert.doesNotMatch(workspaceViews(current.data).decisions,/data-edit-review/);
 assert.equal((await request('/api/release-approval',{reviewId:revision.id,expectedReview:JSON.stringify(revision)},current.tag)).status,200);
 current=await stateOf(request);assert.equal(current.data.commandCenter.execution.ownerApprovals[0].reviewId,revision.id);
 assert.equal(current.data.commandCenter.execution.releaseReviews[0].status,'changes requested');
});

test('two competing owner decisions cannot both win and paused revisions stay queued',async()=>{
 const {request,review}=setup();let {tag}=await stateOf(request);
 await request('/api/workflow-control',{paused:true},tag);({tag}=await stateOf(request));
 const body={reviewId:review.id,expectedReview:JSON.stringify(review),decision:'revise',instructions:'Change the introduction.'};
 const results=await Promise.all([request('/api/release-response',body,tag),request('/api/release-approval',body,tag)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,412]);
 const {data}=await stateOf(request);assert.equal(data.commandCenter.workflowControl.paused,true);
 assert.equal((data.commandCenter.execution.ownerReviewResponses?.length || 0)+(data.commandCenter.execution.ownerApprovals?.length || 0),1);
});
test('approval is owner-only, revision-bound, idempotent and retained for execution',async()=>{
 const {request,review}=setup();const read=await request('/api/state');const tag=read.headers.get('ETag');const body={reviewId:review.id,expectedReview:JSON.stringify(review)};
 assert.equal((await request('/api/release-approval',body,tag,{})).status,401);
 assert.equal((await request('/api/release-approval',body,tag,{...owner,origin:'https://other.test'})).status,403);
 assert.equal((await request('/api/release-approval',body,'"stale"')).status,412);
 assert.equal((await request('/api/release-approval',{...body,expectedReview:'{}'},tag)).status,409);
 const saved=await request('/api/release-approval',body,tag);assert.equal(saved.status,200);const receipt=await saved.json();
 assert.equal((await request('/api/release-approval',body,tag)).status,200);
 const current=await request('/api/state');const data=await current.json();assert.equal(data.commandCenter.execution.ownerApprovals.length,1);
 assert.equal(data.commandCenter.execution.ownerApprovals[0].id,receipt.approvalId);
 assert.deepEqual(data.commandCenter.execution.ownerApprovals[0].review,review);
 const view=workspaceViews(data,{allowSkip:true});assert.equal(view.count,0);assert.match(view.decisions,/Approved releases/);assert.doesNotMatch(view.decisions,/data-approve-review/);
 const lost=structuredClone(data);lost.updatedAt=new Date().toISOString();lost.commandCenter.execution.ownerApprovals=[];
 assert.equal((await request('/api/state',lost,current.headers.get('ETag'))).status,409);
 assert.doesNotMatch(await (await request('/api/state',null,null,{})).text(),/TEST|ownerApprovals|Sample release/);
});
test('pause and resume persist with conditional writes and cannot be overwritten by a stale sync',async()=>{
 const {request}=setup();let current=await request('/api/state');let tag=current.headers.get('ETag');
 assert.equal((await request('/api/workflow-control',{paused:true},tag)).status,200);
 assert.equal((await request('/api/workflow-control',{paused:false},tag)).status,412);
 current=await request('/api/state');const data=await current.json();assert.equal(data.commandCenter.workflowControl.paused,true);
 const lost=structuredClone(data);lost.updatedAt=new Date().toISOString();delete lost.commandCenter.workflowControl;
 assert.equal((await request('/api/state',lost,current.headers.get('ETag'))).status,409);
 assert.equal((await request('/api/workflow-control',{paused:false},current.headers.get('ETag'))).status,200);
 assert.equal((await (await request('/api/state')).json()).commandCenter.workflowControl.paused,false);
});
