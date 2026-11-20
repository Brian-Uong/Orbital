import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceViews} from '../public/workspace.js';

const now = Date.parse('2025-04-12T12:00:00Z');
const stamp = elapsed => new Date(now - elapsed).toISOString();
const sector = {id:'professional', name:'Professional', sourceType:'sector', status:'completed'};
const link = suffix => 'https://chatgpt.com/library?file_id=sample-' + suffix;
const finished = {
  status:'verified', tag:'professional-001', runId:'revision-2', verifiedAt:stamp(1000),
  intendedOutcome:'Prepare the synthetic trial report.', summary:'Adjusted counts checked.',
  acceptanceTest:'Recount both samples.', test:'Both trial counts agree.', limitations:'Only synthetic trials.',
  specialistName:'Sample folder', source:'Scheduled ChatGPT Work', executorId:'/root/sample_lead',
  executors:[{id:'/root/sample_lead',contribution:'Wrote the example.'},{id:'/root/sample_check',contribution:'Recounted both samples.'}],
  artifactUrl:link('current')
};
function read(runs, agent={}, options={}, other=[]){
  const snapshot={
    agents:[{...sector,...agent},...other], updatedAt:stamp(0), events:[], reports:[],
    commandCenter:{execution:{workRuns:runs,workerEvents:[]}}
  };
  return workspaceViews(snapshot,{sectorId:sector.id,kind:'',now,...options});
}

test('sector history keeps distinct revisions, limits scope, and suppresses duplicate retries',()=>{
  const first={...finished,runId:'revision-1',verifiedAt:stamp(5000),summary:'First version checked.',artifactUrl:link('older')};
  const cross={...finished,tag:'financial-advice-001',summary:'Other sector output.',artifactUrl:link('other')};
  const queued={...finished,tag:'professional-002',status:'queued',summary:'A planned project.'};
  const result=read([first,cross,finished,{...finished},queued],{workEvidence:finished});
  assert.match(result.history,/Adjusted counts checked/);
  assert.match(result.history,/First version checked/);
  assert.doesNotMatch(result.history,/Other sector output|A planned project/);
  assert.equal(result.history.split('First version checked.').length,2);
  assert.ok(result.history.indexOf('Adjusted counts checked.')<result.history.indexOf('First version checked.'));
  for(const value of ['Prepare the synthetic trial report.', '<strong>sample_lead</strong>', '<strong>sample_check</strong>',
      'Recounted both samples.', 'Both trial counts agree.', 'Only synthetic trials.', link('current'), link('older')]){
    assert.ok(result.history.includes(value),value);
  }
});

test('history never substitutes a folder, thread, or current worker for an unattributed earlier result',()=>{
  const earlier={tag:'professional-002',status:'verified',verifiedAt:stamp(3000),summary:'Old outcome.',artifactUrl:link('legacy'),
    rawPrompt:'DO_NOT_DISPLAY_PROMPT',transcript:'DO_NOT_DISPLAY_TRANSCRIPT'};
  const result=read([earlier],{threadTitle:'DO_NOT_CREDIT_THREAD',folderAgents:[{name:'DO_NOT_CREDIT_ROLE'}],
    workSpecialists:[{executorId:'/root/do_not_credit_current'}]});
  assert.match(result.history,/Old outcome/);
  assert.doesNotMatch(result.history,/DO_NOT_|do_not_credit_current/);
});

test('stored markup and unsafe protocols cannot create executable history content',()=>{
  const hostile={...finished,summary:'<img src=x onerror=run()>',artifactUrl:'javascript:fake()',
    executors:[{id:'/root/check',contribution:'<svg onload=run()>',artifactUrl:'data:text/html,alert(1)'}]};
  const {history}=read([hostile]);
  assert.doesNotMatch(history,/<img\b|<svg onload|href\s*=\s*["']\s*(?:data|javascript):/i);
});

test('scheduled data collection is a wait, planned work is separate, and skipped work stays closed',()=>{
  const waiting={tag:'professional-004',status:'waiting',task:'Collect the next settled sample.',acceptanceTest:'Grade after settlement.'};
  const queued={tag:'professional-005',status:'queued',task:'Build another fixture.',acceptanceTest:'Two fixtures pass.'};
  const skipped={tag:'professional-003',status:'owner-skipped',task:'Reopen abandoned analysis.'};
  const result=read([finished],{queuedFollowup:waiting,researchFollowup:queued,pendingAssignment:skipped});
  assert.equal(result.count,0);
  assert.match(result.waiting,/Collect the next settled sample/);
  assert.doesNotMatch(result.waiting,/Build another fixture|Reopen abandoned analysis/);
  assert.match(result.roadmap,/Build another fixture/);
  assert.doesNotMatch(result.decisions,/Collect the next settled sample|Build another fixture|Reopen abandoned analysis/);
});

test('the decision count is reserved for Brian and includes evidence and follow-through',()=>{
  const base={tag:'professional-003',task:'Review sample release.',status:'awaiting approval'};
  const details={status:'pending',approver:'Brian',question:'Publish the sample?',reason:'Sample visibility changes.',
    nextAction:'Publish the approved revision.',evidenceUrl:link('decision')};
  const open=read([],{pendingAssignment:{...base,ownerDecision:details}});
  assert.equal(open.count,1);
  for(const expected of [details.question,details.reason,details.nextAction,details.evidenceUrl]) assert.ok(open.decisions.includes(expected));
  for(const decision of [{...details,status:'approved'},{...details,approver:'Counterparty'}]) {
    assert.equal(read([],{pendingAssignment:{...base,ownerDecision:decision}}).count,0);
  }
});

test('elapsed running signals expire at five minutes; fresh signals never enter the waiting panel',()=>{
  const progress={tag:'professional-003',task:'A sample calculation.',status:'running'};
  const check=elapsed=>read([],{pendingAssignment:{...progress,observedAt:stamp(elapsed)}});
  assert.doesNotMatch(check(299999).waiting,/A sample calculation/);
  assert.match(check(300000).waiting,/A sample calculation/);
  assert.match(check(-1000).waiting,/A sample calculation/);
});

test('pending queued work belongs in Next and stale copies cannot reopen completed work',()=>{
  const queue={tag:'professional-001',task:'Queued sample.',status:'queued'};
  const queued=read([],{pendingAssignment:queue});
  assert.match(queued.roadmap,/<h3>Next<\/h3>(?:(?!<h3>).)*Queued sample/s);
  const complete=read([finished],{assignmentId:queue.tag,assignmentStatus:'verified',pendingAssignment:queue});
  assert.doesNotMatch(complete.roadmap,/Queued sample/);
});

test('deliverable filter uses the requested type; newest verified link skips pending results',()=>{
  const doc={...finished,summary:'Sample document.',deliverableType:'document'};
  const proto={...finished,tag:'professional-002',summary:'Sample interactive feature.',deliverableType:'prototype'};
  const blocked={...finished,tag:'professional-004',verifiedAt:stamp(200),summary:'Incomplete feature.',status:'blocked',artifactUrl:link('partial')};
  const result=read([doc,proto],{}, {kind:'document'});
  assert.match(result.history,/Sample document/);
  assert.doesNotMatch(result.history,/Sample interactive feature/);
  const all=read([finished,blocked],{}, {sectorId:''});
  assert.match(all.history,/href="#history\/professional"/);
  assert.ok(all.history.includes(link('current')));
  assert.ok(!all.history.includes(link('partial')));
});

test('assignment ids with overlapping project prefixes do not cross project attribution',()=>{
  const other={...finished,tag:'professional-team-003',summary:'Other team result.'};
  assert.doesNotMatch(read([other],{}, {}, [{id:'professional-team',name:'Other team',sourceType:'sector'}]).history,/Other team result/);
});

test('each workspace view renders on demand and reuses its snapshot',()=>{
  let reads=0;
  const evidence={...finished, get summary(){reads++;return 'Sample report';}};
  const views=read([evidence],{queuedFollowup:{tag:'professional-099',task:'Sample follow-up',status:'queued'}},{allowSkip:true});
  assert.equal(views.count,0);
  assert.ok(views.waiting && views.decisions && views.roadmap);
  assert.equal(reads,0,'the Roadmap, waiting panel and badge should leave History untouched');
  assert.match(views.history,/Sample report/);
  const afterHistory=reads;
  assert.ok(afterHistory>0);
  assert.match(views.history,/Sample report/);
  assert.equal(reads,afterHistory,'a repeat read should use the same History markup');
});

test('Roadmap groups eligible actions in reading order and omits empty groups',()=>{
  const row={tag:'professional-099',task:'Sample follow-up',status:'queued',input:link('plan')};
  const plan=(item,allowSkip)=>read([],{queuedFollowup:item},{allowSkip}).roadmap;
  assert.match(plan(row,true),/<div class="plan-actions"><a\b[^>]*>Review evidence<\/a><button\b[^>]*>Skip next item<\/button><\/div>/);
  assert.doesNotMatch(plan(row,false),/<button[^>]+data-skip/);
  assert.doesNotMatch(plan({...row,input:''},false),/class="plan-actions"/);
});

test('Needs Brian numbers individual reviews under their own project and keeps station releases out',()=>{
  const review=(id,project,title,extras={})=>({id,project,title,status:'awaiting owner approval',...extras});
  const rows=[review('B1','beta','Beta first'),review('A1','alpha','Alpha first'),
    review('AUTO','Orbital Build','Station release'),review('B2','beta','Beta second'),
    review('CLOSED','beta','Already complete',{status:'published and verified'}),
    review('OTHER','beta','Other approver',{ownerDecision:{status:'pending',approver:'Someone else'}})];
  const mirror=(ids,project)=>({tag:'release-review/'+ids.join('+'),project,displayOnly:true,reviewIds:ids,
    status:'awaiting owner approval',task:'Legacy group '+ids.join('+')});
  const beta={id:'beta',name:'Beta',pendingAssignment:mirror(['B1','B2','CLOSED'],'beta'),
    researchFollowup:mirror(['AUTO'],'Orbital Build')};
  const data=workspaceViews({agents:[{id:'alpha',name:'Alpha'},beta],commandCenter:{execution:{releaseReviews:rows}}});
  assert.equal(data.count,3);
  assert.equal((data.decisions.match(/<details name="owner-decisions"/g)||[]).length,3);
  assert.equal((data.decisions.match(/<summary>/g)||[]).length,3);
  assert.ok(data.decisions.includes('<ol role="list"'));
  assert.match(data.decisions,/Alpha first[\s\S]+Beta first[\s\S]+Beta second/);
  assert.doesNotMatch(data.decisions,/Legacy group|Station release|Already complete|Other approver|<details[^>]+ open\b/);
  assert.doesNotMatch(data.roadmap,/Legacy group AUTO/);
  assert.doesNotMatch(data.waiting,/Legacy group AUTO/);
});

test('owner list preserves real assignment decisions, safe evidence and legacy records',()=>{
  const reg={id:'D1',project:'alpha',title:'Check <draft>',status:'awaiting owner approval',
    action:'Read the evidence',diffUrl:link('diff'),registerUrl:link('register')};
  const ordinary={tag:'alpha-015',task:'Choose delivery',status:'pending approval',
    ownerDecision:{approver:'Brian',status:'open',reason:'Two possible formats',evidenceUrl:link('choice')}};
  const legacy={tag:'mirror-L1',project:'alpha',displayOnly:true,reviewIds:['L1'],status:'awaiting owner approval',
    task:'Legacy review',ownerDecision:{evidenceUrl:'javascript:bad()'}};
  const data=workspaceViews({agents:[{id:'alpha',name:'Alpha',pendingAssignment:ordinary,queuedFollowup:legacy}],
    commandCenter:{execution:{releaseReviews:[reg]}}});
  assert.equal(data.count,3);
  for(const field of ['L1','Legacy review','Choose delivery','Two possible formats',link('choice'),link('diff'),link('register'),'Check &lt;draft&gt;'])assert.ok(data.decisions.includes(field),field);
  assert.doesNotMatch(data.decisions,/javascript:bad|<draft>/);
  assert.equal(workspaceViews({agents:[],commandCenter:{execution:{releaseReviews:[]}}}).count,0);
});

test('Command groups waits by their actual project and links directly to each open decision',()=>{
  const review = (id,project,title,status='awaiting owner approval')=>({id,project,title,status});
  const alpha = {id:'alpha',name:'Alpha',pendingAssignment:{tag:'mirror',task:'Grouped placeholder',displayOnly:true,
    status:'awaiting owner approval',project:'beta',reviewIds:['B/1','B 2','finished']},
    queuedFollowup:{tag:'alpha-001',status:'blocked',task:'Check <source>',blocker:'Missing source file',
      acceptanceTest:'A lengthy Roadmap test.',partialEvidenceUrl:link('blocker')}};
  const reviews = [review('B/1','beta','First & second'), review('B 2','beta','Repair label'),
    review('A','alpha','Check copy'), review('C','New project','Decide on venue'),
    review('finished','beta','Past decision','approved'), review('auto','Orbital Build','Station task')];
  const data=workspaceViews({agents:[alpha,{id:'beta',name:'Beta'},{id:'idle',name:'Idle'}],
    commandCenter:{execution:{releaseReviews:reviews}}});
  assert.equal((data.waiting.match(/<details /g)||[]).length,3);
  assert.match(data.waiting,/Alpha<[^>]+><span class="wait-count">1 decision · 1 dependency<\/span><\/summary>/);
  assert.match(data.waiting,/Beta<[^>]+><span class="wait-count">2 decisions<\/span><\/summary>/);
  assert.match(data.waiting,/Alpha[\s\S]+Beta[\s\S]+New project/);
  for(const title of ['Check &lt;source&gt;','Missing source file',link('blocker'),'First &amp; second'])assert.ok(data.waiting.includes(title));
  for(const key of ['review/B/1','review/B 2','review/A','review/C']){
    assert.ok(data.waiting.includes('href="#needs/'+encodeURIComponent(key)+'"'));
    assert.ok(data.decisions.includes('data-decision-key="'+key+'"'));
  }
  assert.doesNotMatch(data.waiting,/Grouped placeholder|Past decision|Station task|Idle|lengthy Roadmap test|<details[^>]* open\b/);
  assert.match(data.roadmap,/A lengthy Roadmap test/);
});

test('Command handles an empty queue and keeps legacy assignment decisions reachable',()=>{
  assert.match(read([],{}).waiting,/No work is waiting/);
  const legacy={tag:'professional-013',status:'awaiting owner approval',task:'Choose the release day'};
  const dependency={tag:'professional-014',status:'waiting',task:'Wait for a sample',partialEvidenceUrl:'javascript:unsafe()'};
  const data=read([],{pendingAssignment:legacy,queuedFollowup:dependency});
  assert.match(data.waiting,/1 decision · 1 dependency/);
  assert.ok(data.waiting.includes('href="#needs/'+encodeURIComponent('professional/'+legacy.tag)+'"'));
  assert.doesNotMatch(data.waiting,/javascript:|Review evidence/);
});
