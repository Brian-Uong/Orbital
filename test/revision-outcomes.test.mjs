import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceViews} from '../public/workspace.js';

function fixture() {
  const originals = ['OPEN','DONE','DENIED','READY'].map(id => ({
    id, title:id, project:'professional', status:'changes requested', responseId:'response/'+id,
    revisionReviewId:id === 'OPEN' ? undefined : id+'/2'
  }));
  originals[0].releaseError='Current About text is missing.';
  originals[0].repairAction='Provide the current About text.';
  const children = [
    {id:'DONE/2',revisesReviewId:'DONE',status:'published and verified',verifiedAt:'2026-11-20T19:00:00Z',liveUrl:'https://example.com'},
    {id:'DENIED/2',revisesReviewId:'DENIED',status:'denied'},
    {id:'READY/2',revisesReviewId:'READY',revisionOfResponseId:'response/READY',status:'awaiting owner approval',action:'Publish this revision',destination:'https://example.com'}
  ].map(row => ({...row,project:'professional'}));
  return {agents:[{id:'professional',name:'Professional',sourceType:'sector'}],commandCenter:{execution:{
    releaseReviews:[...originals,...children],
    ownerReviewResponses:originals.map(row => ({id:row.responseId,reviewId:row.id,decision:'revise',review:{title:row.title},instructions:'Saved instruction <script>.'}))
  }}};
}

test('repair requests show actual outcomes for current and linked legacy children', () => {
  const snapshot=fixture(), saved=JSON.stringify(snapshot);
  const view=workspaceViews(snapshot,{allowSkip:true}).decisions;
  assert.match(view,/Requested revisions \(1\)/);
  assert.match(view,/Revisions prepared \(1\)/);
  assert.match(view,/Resolved revision requests \(2\)/);
  assert.match(view,/Repair published and verified/);
  assert.match(view,/Revised result: denied/);
  assert.match(view,/Repair blocked/);
  assert.match(view,/Current About text is missing/);
  assert.match(view,/Provide the current About text/);
  for(const id of ['DONE','DENIED','READY']) {
    assert.doesNotMatch(view,new RegExp('data-decision-key="review/'+id+'"'));
    assert.ok(view.includes('#needs/'+encodeURIComponent('review/'+id+'/2')));
  }
  assert.match(view,/Saved instruction &lt;script&gt;/);
  assert.equal(JSON.stringify(snapshot),saved);
});

test('mismatched legacy links and unverified publication remain unresolved', () => {
  const snapshot=fixture(), rows=snapshot.commandCenter.execution.releaseReviews;
  rows.find(row=>row.id==='DONE/2').verifiedAt=null;
  rows.find(row=>row.id==='DENIED/2').revisesReviewId='UNRELATED';
  const view=workspaceViews(snapshot).decisions;
  assert.match(view,/Requested revisions \(2\)/);
  assert.match(view,/Revisions prepared \(2\)/);
  assert.doesNotMatch(view,/Resolved revision requests/);
  assert.doesNotMatch(view,/Repair published and verified/);
});

test('prepared decisions act once on the eligible child and disappear on access downgrade',()=>{
  const snapshot=fixture(), child=snapshot.commandCenter.execution.releaseReviews.at(-1);
  const html=workspaceViews(snapshot,{allowSkip:true}).decisions;
  for(const action of ['approve','edit','deny']) assert.equal(html.split('data-'+action+'-review="'+child.id+'"').length,2);
  assert.match(html,/Revisions prepared[\s\S]*data-approve-review="READY\/2"/);
  assert.doesNotMatch(workspaceViews(snapshot).decisions,/data-approve-review=/);
  snapshot.commandCenter.execution.evaluationGate={path:'/c/example'};
  const held=workspaceViews(snapshot,{allowSkip:true}).decisions;
  assert.match(held,/Awaiting evaluation/);assert.doesNotMatch(held,/data-approve-review=/);
});
