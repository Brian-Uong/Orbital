import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationFloors} from '../public/conversations.js';
import {officeMotion,renderOfficeScene} from '../public/tower.js';

const now=Date.parse('2026-11-24T18:00:00Z');
const url='https://chatgpt.com/c/00000000-0000-4000-8000-000000000001';
function fixture(receipts=[]){
 return {agents:[{id:'professional',sourceType:'sector',name:'Professional',originalThreadReference:{threadTitle:'Example',threadUrl:url},folderAgents:[{name:'Example',url,nameSource:'fixture'}]}],commandCenter:{execution:{projectConversationReceipts:receipts}}};
}
const receipt=(type,delta=0,extra={})=>({project:'professional',threadTitle:'Example',threadUrl:url,messageId:'sample-'+type,type,observedAt:new Date(now+delta).toISOString(),...extra});
const room=(data,time=now)=>conversationFloors(data,[],'owner',time)[0].workers[0];

test('fresh exact conversation execution drives motion; handoffs and unrelated execution do not',()=>{
 for(const type of ['started','working','progress']){
  const w=room(fixture([receipt(type,-1000)]));assert.equal(w.active,true);assert.equal(officeMotion(w),'working');
 }
 for(const row of [receipt('sent'),receipt('assigned'),receipt('started',0,{messageId:''}),receipt('started',0,{project:'stella-zhang'}),receipt('started',0,{threadTitle:'Another chat'}),receipt('started',0,{threadUrl:url.replace('000001','000002')})]){
  assert.equal(room(fixture([row])).active,false);
 }
});
test('activity expires exactly after five minutes without a new snapshot; stale and future signals stay neutral',()=>{
 const data=fixture([receipt('started')]);
 assert.equal(room(data,now+299999).active,true);
 const expired=room(data,now+300000);assert.equal(expired.active,false);assert.equal(officeMotion(expired),'waiting');
 assert.equal(expired.status,'Activity unconfirmed');
 for(const row of [receipt('started',1),receipt('started',0,{observedAt:'invalid'}),receipt('started',0,{expiresAt:new Date(now-1).toISOString()})])assert.equal(room(fixture([row])).active,false);
 assert.equal(Date.parse(room(data).expiresAt),now+300000);
});
test('completion overrides a prior activity pulse and puts the same occupant in bed',()=>{
 for(const type of ['idle','completed','verified','reply','result']){
  const data=fixture([receipt('started',-20000),receipt(type,-1000)]);
  const w=room(data);assert.equal(w.active,false);assert.equal(officeMotion(w),'resting');
  data.commandCenter.execution.projectConversationReceipts.reverse();assert.equal(officeMotion(room(data)),'resting');
 }
 const blocked=room(fixture([receipt('started',-20000),receipt('blocked',-1000)]));assert.equal(officeMotion(blocked),'waiting');
});
test('room identity and artwork stay stable through working, resting and neutral states',()=>{
 const base={id:'professional/example',projectId:'professional',handle:'chat:Example'};
 const art=renderOfficeScene(base);
 for(const status of ['idle','working','blocked','Activity unconfirmed'])assert.equal(renderOfficeScene({...base,status,active:status==='working'}),art);
 assert.match(art,/class="room-shell"[^>]+width="100%"[^>]+height="100%"/);
 assert.match(art,/class="sleeping-worker"/);assert.match(art,/class="desk-worker"/);
 assert.equal(officeMotion({active:false,status:'Awaiting verified link'}),'waiting');
 assert.equal(officeMotion({active:true,status:'idle'}),'working');
 assert.equal(officeMotion({active:false,status:'Idle'}),'resting');
});
test('activity updates do not change the room roster or expose private rooms publicly',()=>{
 const data=fixture([receipt('started')]);const first=room(data);
 data.commandCenter.execution.projectConversationReceipts.push(receipt('progress',-10));
 assert.equal(room(data).id,first.id);
 assert.equal(conversationFloors(data,[],'owner',now)[0].workers.length,1);
 assert.deepEqual(conversationFloors(data,[],'anonymous',now),[]);
});
