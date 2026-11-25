import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluationPassed} from '../public/evaluation.js';
import {workspaceViews} from '../public/workspace.js';
test('only the latest evaluator reply on the exact artifact permits its owner review',()=>{
  const row={id:'sample',title:'Synthetic change',status:'awaiting owner approval',action:'Open PR',destination:'example',artifactDigest:'sample-digest',project:'example'};
  const ledger={evaluationGate:{path:'/example'},evaluationReceipts:[],releaseReviews:[row]};
  const snapshot={commandCenter:{execution:ledger},agents:[{id:'example',name:'Example',sourceType:'sector'}]};
  const visible=()=>workspaceViews(snapshot,{allowSkip:true}).decisions.includes('data-approve-review="sample"');
  assert.equal(visible(),false);
  const receipt={reviewId:row.id,artifactDigest:row.artifactDigest,evaluatorPath:'/example',review:{...row},messageId:'synthetic',evidenceUrl:'https://example.org/check',expected:'One link',observed:'One link',verdict:'PASS'};
  ledger.evaluationReceipts.push(receipt);
  assert.equal(evaluationPassed(ledger,row),true);
  assert.equal(visible(),true);
  assert.equal(evaluationPassed(ledger,{...row,destination:'another site'}),false);
  ledger.evaluationReceipts.push({...receipt,verdict:'RETURN'});
  assert.equal(visible(),false);
  assert.equal(evaluationPassed(ledger,{...row,id:'sample-repair'}),false);
});

test('an immutable PASS can bind an exact approval scope without rewriting its receipt',()=>{
  const row={id:'sample',title:'Display copy',status:'awaiting owner approval',action:'Publish exact patch',destination:'Existing hosted Site',artifactDigest:'sample-digest',project:'example'};
  const base={reviewId:row.id,artifactDigest:row.artifactDigest,evaluatorPath:'/example',messageId:'reply',evidenceUrl:'https://example.org/check',expected:'One link',observed:'One link',verdict:'PASS'};
  const ledger={evaluationGate:{path:'/example'},evaluationReceipts:[base]};
  assert.equal(evaluationPassed(ledger,row),false);
  ledger.evaluationReceipts.push({...base,id:'accepted-readback',reviewScope:{project:row.project,artifactDigest:row.artifactDigest,action:row.action,destination:row.destination}});
  assert.equal(evaluationPassed(ledger,row),true);
  assert.equal(evaluationPassed(ledger,{...row,action:'Merge instead'}),false);
  assert.equal(evaluationPassed(ledger,{...row,destination:'Another Site'}),false);
  assert.equal(evaluationPassed(ledger,{...row,project:'other'}),false);
  assert.equal(evaluationPassed(ledger,{...row,artifactDigest:'another-digest'}),false);
});
