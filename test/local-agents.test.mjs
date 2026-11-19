import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readLocalAgents} from '../scripts/local-agents.mjs';

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(),'orbital-session-test-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const codexHome = path.join(home,'codex'), claudeHome = path.join(home,'claude'), now = Date.now();
  return {now,at:(mins)=>new Date(now-mins*60_000).toISOString(),run:()=>readLocalAgents({codexHome,claudeHome,now}),
    async write(kind,name,rows) {
      const parent = kind === 'codex' ? path.join(codexHome,'sessions','2026','11','19') : path.join(claudeHome,'projects','private-project');
      const file = path.join(parent,name);
      await mkdir(path.dirname(file),{recursive:true});
      await writeFile(file,rows.map(r=>typeof r==='string'?r:JSON.stringify(r)).join('\n'));
    }};
}

test('Codex reports structured turn events through truncated logs and hides all user content',async t=>{
  const f=await fixture(t);
  const row=(mins,type,payload)=>({timestamp:f.at(mins),type,payload});
  await f.write('codex','rollout-session.jsonl',[
    row(10,'session_meta',{id:'private-session-uuid',cwd:'C:\\Users\\secret-owner\\Source\\Finance'}),
    row(6,'event_msg',{type:'task_started'}),
    row(4,'response_item',{type:'function_call',name:'exec_command',arguments:'dummy-secret-command'}),
    row(2,'event_msg',{type:'task_complete',last_agent_message:'dummy-private-response'}),
    row(1,'event_msg',{type:'user_message',message:'dummy-private-question'}),'{"incomplete":'
  ]);
  const state=await f.run(), agent=state.agents[0];
  assert.equal(state.agents.length,1);
  assert.equal(agent.name,'Codex CLI · Finance');
  assert.equal(agent.status,'completed');
  assert.equal(agent.lastSeen,f.at(2));
  assert.equal((await f.run()).agents[0].id,agent.id);
  assert.ok(state.events.some(e=>e.title==='Running a command'));
  assert.doesNotMatch(JSON.stringify(state),/secret-owner|private-session|dummy-|Users/);
});

test('Claude identifies live/stale tools and nested subagents, ignores human-only and expired transcripts',async t=>{
  const f=await fixture(t);
  const row=(mins,content,stop_reason=null,type='assistant')=>({type,timestamp:f.at(mins),cwd:'/private-home/orbit',sessionId:'same-session',
    message:{role:type,stop_reason,content}});
  const tool=[{type:'tool_use',name:'Dummy-Customer-Internal-Tool',input:{foo:'dummy-secret'}}];
  await f.write('claude','same-session.jsonl',[row(1,tool)]);
  await f.write('claude','same-session/subagents/agent-test.jsonl',[row(6,tool)]);
  await f.write('claude','human.jsonl',[row(1,[{type:'text',text:'dummy-human'}],null,'user')]);
  await f.write('claude','expired.jsonl',[row(49*60,tool)]);
  const {agents,events}=await f.run();
  assert.equal(agents.length,2);
  assert.equal(agents[0].name,'Claude Code · orbit');
  assert.equal(agents[0].status,'working');
  assert.equal(agents[0].task,'Using a tool');
  assert.equal(agents[1].name,'Claude subagent · orbit');
  assert.equal(agents[1].status,'unknown');
  assert.notEqual(agents[0].id,agents[1].id);
  assert.doesNotMatch(JSON.stringify({agents,events}),/private-home|Dummy-Customer|dummy-|same-session/);
  await f.write('claude','same-session.jsonl',[row(1,tool),row(0,[{type:'text',text:'dummy-private-answer'}],'end_turn')]);
  const completed=(await f.run()).agents[0];
  assert.equal(completed.status,'completed');
  assert.equal(completed.id,agents[0].id);
});

test('bounded tail reads recover a terminal record beyond an oversized line',async t=>{
  const f=await fixture(t);
  await f.write('codex','rollout-large.jsonl',[
    {type:'session_meta',timestamp:f.at(4),payload:{id:'test',cwd:'/work/demo'}},
    {type:'event_msg',timestamp:f.at(3),payload:{type:'user_message',message:'q'.repeat(260_000)}},
    {type:'event_msg',timestamp:f.at(1),payload:{type:'turn_aborted'}}
  ]);
  assert.equal((await f.run()).agents[0].status,'idle');
});
