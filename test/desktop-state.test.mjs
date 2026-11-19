import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {latestDesktopState} from '../scripts/desktop-state.mjs';

const agents = ['Professional', 'Product Design', 'Personal Dashboard', 'Personal Website', 'Financial Advice']
  .map(name => ({name, id: name.toLowerCase().replaceAll(' ', '-'), sourceType: 'sector'}));
const state = {updatedAt: '2026-11-19T08:00:00Z', commandCenter: {}, agents, events: [], reports: []};

test('prefers newer sector snapshots over legacy or invalid files and supports the saved HTML report', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'orbital-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const paths = ['legacy.json', 'older.json', 'current.html', 'partial.json'].map(name => join(dir, name));
  await Promise.all([
    writeFile(paths[0], JSON.stringify({...state, updatedAt: '2026-12-01T00:00:00Z', agents: [{sourceType:'automation'}]})),
    writeFile(paths[1], JSON.stringify({...state, updatedAt: '2026-11-18T08:00:00Z'})),
    writeFile(paths[2], '<script id="orbital-snapshot" type="application/json">' + JSON.stringify(state) + '</script>'),
    writeFile(paths[3], '{')
  ]);
  assert.deepEqual(await latestDesktopState(paths), state);
  assert.equal(await latestDesktopState([paths[0], paths[3], join(dir, 'missing')]), null);
});
