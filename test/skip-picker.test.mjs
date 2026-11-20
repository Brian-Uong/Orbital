import test from 'node:test';
import {readFileSync} from 'node:fs';
import {workspaceViews} from '../public/workspace.js';
import {ownerSkip} from '../public/skip.js';
const app = readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const handler = app.slice(app.indexOf('let savingSkip=false;'),app.indexOf("$('historyKind').onchange="));

function fixture() {
  const date = '2026-01-02T12:00:00.000Z';
  const sector = {id:'sample', name:'Example', sourceType:'sector', assignmentId:'sample-001', assignmentStatus:'verified',
    queuedFollowup:{tag:'sample-002', task:'Review the sample <draft>', status:'planned'},
    researchFollowup:{tag:'sample-003', task:'Check a second sample', status:'queued'},
    pendingAssignment:{tag:'sample-004', task:'Already claimed', status:'queued', claimId:'claim/already'}};
  return {updatedAt:date,agents:[sector],events:[],reports:[],commandCenter:{execution:{workerEvents:[],workRuns:[]}}};
}
function check(ok,msg) { if (!ok) throw Error(msg); }
function viewCases(render) {
  const snap=fixture();
  const roadmap=render(snap,{allowSkip:true}).roadmap;
  check(roadmap.indexOf('data-skip-picker') < roadmap.indexOf('class="workspace-lanes"'), 'picker precedes the sector lanes');
  check(roadmap.includes('<option value="">Choose an item</option>'), 'no task is preselected');
  check((roadmap.match(/<option value="sample-/g)||[]).length===2, 'two eligible options');
  check(roadmap.includes('Review the sample &lt;draft&gt;') && !roadmap.includes('value="sample-004"'), 'escaped label and claimed exclusion');
  check(roadmap.includes('data-skip-slot="researchFollowup" data-skip-tag="sample-003"'), 'slot binding');
  const readonly=render(snap,{allowSkip:false}).roadmap;
  check(readonly.includes('live Roadmap') && !readonly.includes('data-skip-picker') && !readonly.includes('data-skip-tag'), 'read-only explanation without actions');
  snap.agents[0].queuedFollowup.status='waiting';
  snap.agents[0].researchFollowup.status='owner-skipped';
  const empty=render(snap,{allowSkip:true}).roadmap;
  check(empty.includes('No unclaimed planned items') && !empty.includes('data-skip-picker'), 'empty eligibility explained');
}
async function eventCases(source,ownerSkip) {
  for (const mode of ['blank','cancel','save','changed','visitor','embedded','inline']) {
    const initial=fixture(); let remote=JSON.parse(JSON.stringify(initial));
    const status={textContent:''}, expected={skipTag:'sample-003',skipSlot:'researchFollowup',skipSector:'sample'};
    let puts=0,gets=0,confirmations=0,focused=false,handler;
    const option={dataset:mode==='blank'?{}:expected};
    const select={selectedOptions:[option],focus:()=>{focused=true}};
    const button={dataset:mode==='inline'?expected:{skipPicker:''},closest:()=>({querySelector:()=>select})};
    const target={closest:()=>button};
    const state={access:mode==='visitor'?'visitor':'owner',snapshot:initial};
    if(mode==='changed')remote.agents[0].researchFollowup.claimId='claim/race';
    const documentGet=id=>id==='skipStatus'?status:{addEventListener:(_event,fn)=>{handler=fn}};
    const confirm=message=>{confirmations++;check(message.includes('Check a second sample'),'confirmation names the selected task');return mode!=='cancel'};
    const fetchMock=async (_url,init)=>{
      if(init.method==='PUT'){puts++;check(init.headers['If-Match']==='"v1"','revision binding');remote=JSON.parse(init.body);return {ok:true};}
      gets++;return {ok:true,headers:{get:k=>k==='Orbit-Access'?'owner':'"v1"'},json:async()=>remote};
    };
    const bind=new Function('$','window','embedded','state','ownerSkip','fetch','refresh','apply','showAccess',
      'let validator="";'+source);
    bind(documentGet,{confirm},mode==='embedded',state,ownerSkip,fetchMock,async()=>{},raw=>{state.snapshot=JSON.parse(raw)},()=>{});
    await handler({target});
    if(mode==='blank')check(focused && status.textContent.includes('Choose') && gets===0 && confirmations===0,'blank choice');
    if(mode==='cancel')check(puts===0 && gets===0 && confirmations===1,'cancellation preserved');
    if(['visitor','embedded'].includes(mode))check(!puts&&!gets&&!confirmations,'read-only protection');
    if(mode==='changed')check(puts===0 && gets===1 && status.textContent.includes('changed'),'stale choice');
    if(['save','inline'].includes(mode))check(puts===1 && gets===2 && remote.agents[0].researchFollowup.status==='owner-skipped' &&
      remote.agents[0].queuedFollowup.status==='planned' && remote.commandCenter.execution.ownerSkips.length===1,'only the selected slot is skipped');
  }
}

test('Roadmap places eligible planned items first and explains read-only or empty states', () => viewCases(workspaceViews));
test('Picker and inline controls confirm and conditionally write the selected slot', () => eventCases(handler, ownerSkip));
