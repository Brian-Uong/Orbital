import test from 'node:test';
import assert from 'node:assert/strict';
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
 return {request,review};
}
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
