import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withSectorActivity} from '../scripts/sector-activity.mjs';

const id = '2d41fb29-ffd1-47c2-8a28-d0bb0725f05a';
const other = '4f955834-92fe-4675-9122-51508629a2d0';
const agent = {sourceType:'sector', status:'ready', codexThreadId:id};
const event = (at, type) => JSON.stringify({timestamp:new Date(at).toISOString(),
  type:'event_msg',payload:{type, raw:'PRIVATE MESSAGE'}});
const header = uuid => JSON.stringify({type:'session_meta', payload:{id:uuid}});

test('reads recent activity only for the exact local binding, without exposing the transcript', async t => {
  const root = await mkdtemp(join(tmpdir(),'orbital-live-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const partition = join(root,'2026','11','19');
  await mkdir(partition,{recursive:true});
  const now = Date.now();
  const file = join(partition, 'rollout-test-' + id + '.jsonl');
  await writeFile(file,[header(id),event(now - 1000,'turn_started'),''].join('\n'));
  const spoofed = join(partition,'rollout-test-' + other + '.jsonl');
  await writeFile(spoofed,[header(id),event(now, 'turn_started'),''].join('\n'));
  const agents = [agent, {...agent,codexThreadId:other}, {sourceType:'sector', threadId:id},
    {...agent,codexThreadId:'../../../sessions'}, {...agent,sourceType:'custom'}];
  const snapshot = {agents};
  const check = (time = now) => withSectorActivity(snapshot,{now:time,sessionsRoot:root});
  const first = await check();
  assert.deepEqual(first.agents[0].liveActivity, {status:'working', action:'Processing an assignment', observedAt:new Date(now-1000).toISOString()});
  assert.deepEqual(first.agents.slice(1), agents.slice(1));
  assert.equal(first.agents[0].status, 'ready');
  assert.equal(snapshot.agents[0].liveActivity, undefined);
  assert.ok(!JSON.stringify(first).includes('PRIVATE MESSAGE'));
  assert.equal((await check(now + 300_000)).agents[0].liveActivity.status,'unknown');
  await appendFile(file, event(now,'turn_complete')+'\n');
  const done = await check();
  assert.equal(done.agents[0].liveActivity.status,'idle');
  assert.equal(done.agents[0].status, 'ready');
  const local = {agents:[{sourceType:'sector',localWorker:{codexThreadId:id}}]};
  assert.equal((await withSectorActivity(local,{now,sessionsRoot:root})).agents[0].liveActivity.status,'idle');
  const after = {agents:[{...agent,lastSeen:new Date(now+1).toISOString()}]};
  assert.deepEqual(await withSectorActivity(after,{now,sessionsRoot:root}), after);
  assert.deepEqual(await withSectorActivity(snapshot,{now,sessionsRoot:join(root,'absent')}),snapshot);
});
