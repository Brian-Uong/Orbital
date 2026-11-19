import {glob, lstat, open, realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, isAbsolute, join, relative, resolve, sep} from 'node:path';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const heartbeatMs = 5 * 60_000;
const locateCache = new Map();
const actions = new Map([
  ['task_started', ['working', 'Processing an assignment']],
  ['turn_started', ['working', 'Processing an assignment']],
  ['exec_command_begin', ['working', 'Running a command']],
  ['patch_apply_begin', ['working', 'Editing a file']],
  ['web_search_begin', ['working', 'Researching a source']],
  ['task_complete', ['idle', 'Turn completed']],
  ['turn_complete', ['idle', 'Turn completed']],
  ['turn_aborted', ['idle', 'Turn stopped']],
  ['task_aborted', ['idle', 'Turn stopped']],
  ['error', ['error', 'Thread reported an error']]
]);

async function matchingFiles(root, id, now) {
  const key = root + '|' + id;
  const prior = locateCache.get(key);
  if (prior && now >= prior.checked && now - prior.checked < 45_000) return prior.files;
  const files = [];
  const rootPath = await realpath(root);
  for await (const name of glob('????/??/??/rollout-*-' + id + '.jsonl', {cwd:rootPath})) {
    const file = resolve(rootPath, name);
    const info = await lstat(file);
    if (!info.isFile()) continue;
    const local = relative(rootPath, await realpath(file));
    if (isAbsolute(local) || local.startsWith('..' + sep) || local === '..') continue;
    if (basename(local).toLowerCase().endsWith('-' + id + '.jsonl')) files.push(file);
  }
  if (locateCache.size >= 32) locateCache.delete(locateCache.keys().next().value);
  locateCache.set(key, {files, checked:now});
  return files;
}

async function readPart(handle, from, length) {
  const buffer = Buffer.alloc(length);
  const {bytesRead} = await handle.read(buffer, 0, length, from);
  return buffer.toString('utf8', 0, bytesRead);
}

async function readSignal(file, id, now) {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (info.mtimeMs < now - 30 * 60_000) return null;
    const first = await readPart(handle, 0, Math.min(info.size, 256 * 1024));
    const end = first.indexOf('\n');
    if (end < 0) return null;
    const meta = JSON.parse(first.slice(0, end));
    if (meta.type !== 'session_meta' || meta.payload?.id?.toLowerCase() !== id) return null;
    const start = Math.max(0, info.size - 256 * 1024);
    const tail = first.length === info.size && start === 0 ? first : await readPart(handle, start, info.size-start);
    const lines = tail.split('\n');
    if (start > 0) lines.shift();
    // A writer may still be appending an incomplete final record.
    for (let index = lines.length - 1; index >= 0; index--) {
      let row;
      try { row = JSON.parse(lines[index]); } catch { continue; }
      const at = Date.parse(row.timestamp);
      if (!Number.isFinite(at) || at > now || at < now - 30 * 60_000) continue;
      let signal;
      if (row.type === 'event_msg') signal = actions.get(row.payload?.type);
      if (row.type === 'response_item' && ['function_call','custom_tool_call'].includes(row.payload?.type))
        signal = ['working', 'Using a tool'];
      if (!signal) continue;
      const [status, action] = signal;
      const expired = now - at >= heartbeatMs;
      return {status:expired ? 'unknown' : status, action:expired ? 'Last activity signal expired' : action,
        observedAt:new Date(at).toISOString()};
    }
    return null;
  } finally { await handle.close(); }
}

// Each returned observation is ephemeral. End-of-turn records describe a thread
// lifecycle, not the success of the sector assignment.
export async function withSectorActivity(snapshot, options = {}) {
  const root = options.sessionsRoot ?? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
  const now = options.now ?? Date.now();
  const agents = await Promise.all(snapshot.agents.map(async agent => {
    const id = agent.codexThreadId ?? agent.localWorker?.codexThreadId;
    if (agent.sourceType !== 'sector' || typeof id !== 'string' || !uuid.test(id)) return agent;
    try {
      const match = id.toLowerCase();
      const files = await matchingFiles(root, match, now);
      const found = await Promise.all(files.map(file => readSignal(file, match, now).catch(() => null)));
      const latest = found.filter(Boolean).sort((a,b) => b.observedAt.localeCompare(a.observedAt))[0];
      if (!latest || Date.parse(latest.observedAt) < Date.parse(agent.lastSeen)) return agent;
      return {...agent, liveActivity:latest};
    } catch { return agent; }
  }));
  return {...snapshot, agents};
}
