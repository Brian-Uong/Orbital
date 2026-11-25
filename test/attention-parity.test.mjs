import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceViews} from '../public/workspace.js';

test('overview and Needs Brian share current evaluated decisions, excluding stale waits and deferred merges',()=>{
  const row={id:'feature-r3',project:'example',title:'Publish current feature',status:'awaiting owner approval',action:'Publish',destination:'Example site',artifactDigest:'digest'};
  const held={...row,id:'merge-r1',title:'Merge old PR',status:'deferred',releaseProgress:'Waiting for team discussion. Reopen only on owner direction.'};
  const ledger={evaluationGate:{path:'/c/synthetic'},releaseReviews:[row,held],evaluationReceipts:[{reviewId:row.id,artifactDigest:'digest',verdict:'PASS',messageId:'reply',evaluatorPath:'/c/synthetic',expected:'Works',observed:'Works',evidenceUrl:'https://example.test/evidence',review:{...row}}]};
  const snapshot={commandCenter:{execution:ledger},agents:[{id:'example',name:'Example',status:'waiting',task:'Old evaluation message',releaseReviewId:row.id,pendingAssignment:{tag:'example-001',task:'Old evaluation message',status:'awaiting evaluation',artifactDigest:'digest'}}]};
  const view=workspaceViews(snapshot,{allowSkip:true});
  assert.equal(view.count,1);
  assert.match(view.attention,/data-attention-review="feature-r3"/);
  assert.match(view.decisions,/data-approve-review="feature-r3"/);
  assert.doesNotMatch(view.attention,/merge-r1|Old evaluation/);
  assert.doesNotMatch(view.backgroundWaiting,/Old evaluation/);
  assert.match(view.decisions,/<details class="release-fold"><summary><h2 id="release-heading-deferred">On hold by you/);
  assert.match(view.decisions,/Waiting for team discussion/);
  assert.doesNotMatch(view.decisions,/data-(?:approve|edit|deny)-review="merge-r1"/);
  ledger.evaluationReceipts.push({...ledger.evaluationReceipts[0],verdict:'RETURN'});
  const returned=workspaceViews(snapshot,{allowSkip:true});
  assert.equal(returned.count,0);assert.doesNotMatch(returned.attention,/data-attention-review/);
  assert.doesNotMatch(returned.decisions,/data-approve-review/);
});

test('publication access waits are visible separately from decisions after completed assignment',()=>{
 const snapshot={commandCenter:{execution:{}},agents:[{id:'example',name:'Example',status:'completed',assignmentStatus:'verified',publicationFollowup:{status:'waiting',task:'Publish reviewed item',waitingDetails:{needed:'Signed-in editing surface',owner:'Owner / original project chat',ownerAction:'Continue the reviewed item in the original chat.',nextAction:'Save and independently read back.'}}}]};
 const view=workspaceViews(snapshot);
 assert.equal(view.count,0);assert.match(view.attention,/No decisions need you/);
 assert.match(view.backgroundWaiting,/Signed-in editing surface/);
 assert.match(view.backgroundWaiting,/Save and independently read back/);
 assert.doesNotMatch(view.backgroundWaiting,/data-approve-review/);
});
