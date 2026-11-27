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
  const pendingHtml=data.decisions.split('<section class="release-group release-group-blocked"')[0];
  assert.equal((data.decisions.match(/<details name="owner-decisions"/g)||[]).length,3);
  assert.equal((pendingHtml.match(/<summary>/g)||[]).length,3);
  assert.ok(data.decisions.includes('<ol role="list"'));
  assert.match(data.decisions,/Alpha first[\s\S]+Beta first[\s\S]+Beta second/);
  assert.doesNotMatch(pendingHtml,/Legacy group|Station release|Already complete|Other approver|<details[^>]+ open\b/);
  assert.doesNotMatch(data.decisions,/Station release|Other approver/);
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
  assert.match(data.waiting,/Alpha<[^>]+><span class="wait-count">1 decision · 1 waiting item<\/span><\/summary>/);
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
  assert.match(data.waiting,/1 decision · 1 waiting item/);
  assert.ok(data.waiting.includes('href="#needs/'+encodeURIComponent('professional/'+legacy.tag)+'"'));
  assert.doesNotMatch(data.waiting,/javascript:|Review evidence/);
});

test('waiting items explain recorded requirements, ownership and next steps without inventing owner tasks',()=>{
 const row={tag:'professional-020',status:'blocked',task:'Compare the profile',blocker:'Source file missing',
  waitingDetails:{needed:'A dated profile export',owner:'Brian',ownerAction:'Upload the profile export.',
    nextAction:'Compare the export with verified experience.',actionUrl:link('upload')}};
 const html=read([],{pendingAssignment:row}).waiting;
 for(const phrase of ['What is needed','A dated profile export','Who acts next','Brian','What you need to do',
  'Upload the profile export.','Compare the export with verified experience.',link('upload')])assert.ok(html.includes(phrase),phrase);
 const unknown=read([],{pendingAssignment:{tag:'professional-021',status:'waiting',task:'Wait for input'}}).waiting;
 assert.match(unknown,/specific missing requirement has not been recorded/);
 assert.match(unknown,/coordinator needs to provide an exact request/);
 assert.doesNotMatch(unknown,/Upload the profile/);
});

test('scheduled data waits identify what is pending and do not manufacture an owner requirement or date',()=>{
 const row={tag:'professional-022',status:'waiting',task:'Evaluate newly settled prospective rounds through December 3.'};
 const html=read([],{pendingAssignment:row}).waiting;
 assert.match(html,/More settled rounds or observations/);
 assert.match(html,/No action from you is currently recorded/);
 assert.match(html,/hourly run/);assert.doesNotMatch(html,/Expected availability|Next recorded check|Project dependencies/);
 const explicit=read([],{pendingAssignment:{...row,waitingDetails:{ownerAction:'Provide the missing sample.',expectedAt:'2026-12-03T18:00:00Z'}}}).waiting;
 assert.match(explicit,/Provide the missing sample/);assert.match(explicit,/Expected availability/);
});

test('top-level waiting metadata survives projection and untrusted instructions remain plain text',()=>{
 const html=read([],{task:'Check records',status:'blocked',blocker:'Missing source',waitingDetails:{needed:'<img src=x onerror=alert(1)>',
  owner:'Coordinator',ownerAction:'Wait for clarification',nextAction:'Read the source',actionUrl:'javascript:bad()'}}).waiting;
 assert.match(html,/&lt;img/);assert.match(html,/Wait for clarification/);assert.match(html,/Read the source/);
 assert.doesNotMatch(html,/<img|javascript:bad/);
});

test('release groups separate approval, execution, verified publication and repairs with safe controls',()=>{
 const reviews=[
  {id:'pending',title:'Pending only',status:'awaiting owner approval',action:'Deploy',destination:'Example'},
  {id:'queued',title:'Queued only',status:'approved queued',approvalId:'approval-1'},
  {id:'inflight',title:'In-flight only',status:'publishing',approvalId:'approval-2'},
  {id:'published',title:'Verified site only',status:'published and verified',liveUrl:link('live'),verifiedAt:stamp(1)},
  {id:'pr',title:'Verified PR only',status:'published and verified',prUrl:link('pr'),verifiedAt:stamp(2)},
  {id:'unverified',title:'Missing receipt only',status:'published and verified',liveUrl:link('unverified')},
  {id:'blocked',title:'Blocked only',status:'blocked',approvalId:'approval-3',releaseError:'Patch base changed',repairAction:'Rebase on the current source'},
  {id:'needs-work',title:'Needs work only',status:'needs work'},
 ].map(r=>({...r,project:'alpha'}));
 const snapshot={agents:[{id:'alpha',name:'Alpha'}],commandCenter:{execution:{releaseReviews:reviews}}};
 const view=workspaceViews(snapshot,{allowSkip:true});const html=view.decisions;
 const section=key=>html.match(new RegExp('<section class="release-group release-group-'+key+'"[^>]*>[\\s\\S]*?</section>'))?.[0] || '';
 assert.equal(view.count,1);
 assert.match(section('pending'),/Pending only/);assert.doesNotMatch(section('pending'),/Blocked only/);
 assert.match(section('queued'),/Queued only/);assert.doesNotMatch(section('queued'),/Verified site only|Blocked only/);
 assert.match(section('publishing'),/In-flight only/);assert.match(section('publishing'),/Missing receipt only/);
 assert.match(section('published'),/Verified site only/);assert.match(section('published'),/Verified PR only/);
 assert.match(section('published'),/production deployment is not recorded/);
 assert.doesNotMatch(section('published'),/Missing receipt only|Blocked only/);
 assert.match(section('blocked'),/Patch base changed/);assert.match(section('blocked'),/Rebase on the current source/);
 assert.match(section('blocked'),/data-fix-review/);assert.doesNotMatch(section('blocked'),/data-approve-review/);
 assert.doesNotMatch(workspaceViews(snapshot).decisions,/data-fix-review/);
});

const evidenceDigest = 'a'.repeat(64);
const evaluatorPath = '/c/sample-evaluator';
const producerReply = {
  project:'professional', tag:'professional-071', messageId:'producer-message', type:'producer completed',
  threadUrl:'https://chatgpt.com/g/sample-project/c/sample-producer', threadTitle:'Example project',
  observedAt:stamp(4000), summary:'Returned exact project artifact.',
  artifactDigest:evidenceDigest, artifactUrl:link('evaluated'), privateTranscript:'never-render-transcript'
};
const evalReply = {
  ...producerReply, messageId:'evaluator-message', type:'evaluation passed', threadUrl:'https://chatgpt.com/g/sample-project'+evaluatorPath,
  observedAt:stamp(3000), summary:'Verified the exact revision.', evidenceUrl:link('evaluation')
};
function projectHistory({receipts=[producerReply,evalReply], evaluations=[], releases=[], workRuns=[], sectorId=sector.id}={}) {
  return workspaceViews({
    agents:[sector],commandCenter:{execution:{
      workRuns, evaluationGate:{path:evaluatorPath}, projectConversationReceipts:receipts,
      evaluationReceipts:evaluations, releaseReviews:releases
    }}
  },{sectorId,now}).history;
}

test('History combines evaluated chat artifacts and legacy results once per exact revision',()=>{
  const legacyDuplicate={...finished,tag:producerReply.tag,artifactDigest:evidenceDigest,artifactUrl:producerReply.artifactUrl};
  const otherRevision={...legacyDuplicate,artifactDigest:'b'.repeat(64),summary:'Earlier distinct revision.'};
  const history=projectHistory({receipts:[producerReply,{...producerReply},evalReply,{...evalReply}],workRuns:[finished,legacyDuplicate,otherRevision]});
  assert.match(history,/Evaluated private artifact/);
  assert.match(history,/Open independent evaluation/);
  assert.match(history,/Example project/);
  assert.match(history,/Earlier distinct revision/);
  assert.equal(history.split(producerReply.summary).length,2);
  assert.equal(history.split(finished.summary).length,2);
  assert.doesNotMatch(history,/never-render-transcript/);
});

test('History excludes deliveries, incomplete work, and mismatched or returned evaluations',()=>{
  for (const receipts of [
    [{...producerReply,type:'sent'},evalReply],
    [producerReply,{...evalReply,artifactDigest:'b'.repeat(64)}],
    [producerReply,{...evalReply,project:'different-sector'}],
    [producerReply,{...evalReply,threadUrl:'https://example.org'+evaluatorPath}],
    [producerReply,{...evalReply,evidenceUrl:''}],
    [producerReply,evalReply,{...evalReply,type:'evaluation returned',observedAt:stamp(1000)}]
  ]) assert.doesNotMatch(projectHistory({receipts}),/Returned exact project artifact/);
  assert.doesNotMatch(projectHistory({workRuns:[{...finished,status:'awaiting evaluation'}]}),/Adjusted counts checked/);
});

test('History distinguishes a verified pull request and a verified live release using exact evidence',()=>{
  const review={id:'SAMPLE-R1',project:sector.id,artifactDigest:evidenceDigest,verifiedAt:stamp(2000),
    diffUrl:link('patch'),title:'Sample publication'};
  const pr='https://github.com/sample/repo/pull/1', site='https://example.org/results';
  const evaluation={...evalReply,reviewId:review.id,evaluatorPath,verdict:'PASS'};
  const inputs={receipts:[{...producerReply,artifactUrl:''}],evaluations:[evaluation]};
  const pull=projectHistory({...inputs,releases:[{...review,status:'feature branch and PR created',pullRequestUrl:pr}]});
  assert.match(pull,/Pull request verified/);
  assert.ok(pull.includes(pr));
  assert.doesNotMatch(pull,/Verified release|Open verified live site/);
  const released={...review,status:'published and verified',liveUrl:site,siteVersion:3};
  const live=projectHistory({...inputs,releases:[released]});
  assert.match(live,/Verified release · v3/);
  assert.equal(live.split(site).length,2);
  assert.doesNotMatch(live,/Verified project releases/);
  assert.match(projectHistory({...inputs,releases:[released],sectorId:''}),/Verified release · v3/);
  assert.doesNotMatch(projectHistory({releases:[{...released,status:'deployed'}]}),/Verified release|Open verified live site/);
  assert.doesNotMatch(projectHistory({releases:[{...released,artifactDigest:'b'.repeat(64)}]}),/Verified release · v3/);
});
