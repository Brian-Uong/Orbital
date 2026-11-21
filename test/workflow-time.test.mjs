import test from 'node:test';
import assert from 'node:assert/strict';
import {observedTransitions,windowMetrics,waitAge} from '../public/workflow-time.js';
import {workspaceViews,reviewLocation,discloseReview} from '../public/workspace.js';

const stamp=h=>'2026-10-01T'+String(h).padStart(2,'0')+':00:00Z';
test('paired durations reuse receipts, separate completion kinds and retain missing endpoints',()=>{
  const receipt={id:'sent/1',type:'sent',messageId:'m',project:'sample',tag:'one',threadUrl:'https://chatgpt.com/c/example',observedAt:stamp(3)};
  const snapshot={agents:[{id:'sample',pendingAssignment:{tag:'one',readyAt:stamp(1)}}],commandCenter:{execution:{
    projectConversationReceipts:[receipt,receipt,{...receipt,id:'sent/2',tag:'two'},{...receipt,id:'sent/3',tag:'two',observedAt:stamp(5)}],
    ownerApprovals:[{id:'ok',at:stamp(2),reviewId:'copy',review:{project:'sample'}}],
    releaseReviews:[{id:'copy',project:'sample',approvalId:'ok',status:'review completed',verifiedAt:stamp(3)}]
  }}};
  const metrics=windowMetrics(snapshot,stamp(0),stamp(10));
  assert.equal(metrics.readyToHandoff.medianMs,7200000);
  assert.equal(metrics.readyToHandoff.missingStart,1);
  assert.equal(metrics.approvalToCompletion.byKind['manual review'].count,1);
  assert.equal(waitAge([],Date.parse(stamp(4))),'Elapsed time unknown.');
  assert.match(waitAge(observedTransitions(snapshot),Date.parse(stamp(6))),/1 h/);
});

test('manual completion leaves the queue and remote releases have a collapsed group',()=>{
  const row={id:'sample',project:'test',title:'Approved caption',approvalId:'a',status:'review completed',verifiedAt:stamp(3)};
  const view=workspaceViews({agents:[],commandCenter:{execution:{releaseReviews:[row]}}}).decisions;
  assert.match(view,/release-group-manual[\s\S]*data-decision-key="review\/sample"/);
  assert.doesNotMatch(view.match(/release-group-queued[\s\S]*?<\/section>/)[0],/Approved caption/);
  assert.match(view,/<details class="release-fold"><summary>/);
});


test('literal and encoded links open nested reviews and focus the selected summary',()=>{
  for (const hash of ['#needs/review/fixture%2F2','#needs/review%2Ffixture%2F2']) {
    assert.deepEqual(reviewLocation(hash),{view:'needs',id:'review/fixture/2'});
  }
  assert.equal(reviewLocation('#overview/example/office/fixture').id,'example');
  assert.equal(reviewLocation('#needs/%ZZ').id,'');
  const group={open:false};
  const outer={open:false,parentElement:{closest:()=>group}};
  let focused=false,scrolled=false;
  const summary={focus(){focused=true;},scrollIntoView(){scrolled=true;}};
  const card={open:false,parentElement:{closest:()=>outer},querySelector:()=>summary};
  discloseReview(card);
  assert.ok(group.open && outer.open && card.open && focused && scrolled);
});
