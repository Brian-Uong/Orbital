import { createHash } from 'node:crypto';
import { opendir, open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const WINDOW = 48 * 60 * 60_000;
const ACTIVE_WINDOW = 5 * 60_000;
const HEAD = 64 * 1024;
const TAIL = 128 * 1024;
const MAX_FILES = 96;
const SOURCES = {codex:'Codex CLI',claude:'Claude Code'};
const TOOL_TASK = new Map([
  ['Bash','Running a command'],['exec_command','Running a command'],['functions.exec_command','Running a command'],
  ['Read','Reading a file'],['Edit','Editing a file'],['Write','Writing a file'],['Grep','Searching files'],
  ['Glob','Finding files'],['apply_patch','Editing files'],['functions.apply_patch','Editing files'],
  ['Agent','Delegating a task'],['Task','Delegating a task'],['WebSearch','Searching the web'],['WebFetch','Reading a webpage']
]);

async function findCandidates(root, provider, now) {
  const candidates = [];
  const pending = [{dir:root,depth:0}];
  let remainingEntries = 22_000, remainingFolders = 900;
  while (pending.length && remainingEntries > 0 && remainingFolders-- > 0) {
    const {dir,depth} = pending.pop(), children = [];
    try {
      const handle = await opendir(dir);
      for await (const entry of handle) {
        if (--remainingEntries < 0) break;
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const full = path.join(dir,entry.name);
        if (entry.isDirectory() && depth < 5) {
          // Codex rollouts live in year/month/day folders. On Claude's side,
          // only project/session/subagents folders can contain transcripts.
          if (provider === 'codex' && !/^\d{2,4}$/.test(entry.name)) continue;
          if (provider === 'claude' && depth >= 2 && entry.name !== 'subagents') continue;
          children.push({dir:full,depth:depth+1});
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          if (provider === 'codex' && !entry.name.startsWith('rollout-')) continue;
          try {
            const info = await stat(full);
            if (info.size && info.mtimeMs >= now - WINDOW) candidates.push({file:full,touched:info.mtimeMs});
          } catch { /* A session can be cleaned up while its directory is scanned. */ }
        }
      }
    } catch { /* Missing or unreadable root and subdirectories are ordinary. */ }
    // pop() visits the newer Codex date partitions first.
    children.sort((a,b) => a.dir.localeCompare(b.dir));
    pending.push(...children);
  }
  return candidates.sort((a,b) => b.touched - a.touched).slice(0,MAX_FILES);
}

async function readRegion(file, size, position) {
  const buf = Buffer.alloc(size);
  const {bytesRead} = await file.read(buf,0,size,position);
  return buf.subarray(0,bytesRead).toString('utf8');
}

async function readLines(filename) {
  const file = await open(filename,'r');
  try {
    const {size} = await file.stat();
    if (size <= HEAD + TAIL) return (await readRegion(file,size,0)).split('\n');
    const header = (await readRegion(file,HEAD,0)).split('\n');
    const tail = (await readRegion(file,TAIL,size-TAIL)).split('\n');
    header.pop(); // Never parse a record cut by a window boundary.
    tail.shift();
    return [...header,...tail];
  } finally { await file.close(); }
}

function project(cwd) {
  if (typeof cwd !== 'string') return '';
  // Extract just the final component even if a Windows transcript was copied
  // to another OS. Do not surface encoded paths, credentials or opaque blobs.
  const label = cwd.replace(/[\\/]+$/,'').split(/[\\/]/).at(-1);
  if (!label || /^[A-Za-z]:$/.test(label) || /^(?:sk-|gh[pousr]_|github_pat_|AKIA|eyJ)/i.test(label)) return '';
  return /^[\p{L}\p{N}_ .()-]{1,64}$/u.test(label) && label !== '.' && label !== '..' ? label : '';
}

function codexSignal(row) {
  const data = row.payload;
  if (row.type === 'session_meta') return ['unknown','Session opened'];
  if (row.type === 'response_item' && ['function_call','custom_tool_call'].includes(data?.type)) {
    return ['working',TOOL_TASK.get(data.name) || 'Using a tool'];
  }
  if (row.type !== 'event_msg') return;
  switch (data?.type) {
    case 'task_started': case 'turn_started': return ['working','Running a turn'];
    case 'task_complete': case 'turn_complete': return ['completed','Turn completed'];
    case 'turn_aborted': case 'task_aborted': return ['idle','Turn stopped'];
    case 'error': return ['error','Run reported an error'];
    case 'exec_command_begin': return ['working','Running a command'];
    case 'patch_apply_begin': return ['working','Editing files'];
    case 'web_search_begin': return ['working','Searching the web'];
    default: return undefined;
  }
}

function claudeSignal(row) {
  if (row.type === 'system' && row.subtype === 'turn_duration') return ['completed','Turn completed'];
  if (row.type !== 'assistant' || row.message?.role !== 'assistant') return;
  const message = row.message;
  if (row.isApiErrorMessage === true) return ['error','Run reported an error'];
  if (message.stop_reason === 'end_turn' || message.stop_reason === 'stop_sequence') return ['completed','Turn completed'];
  if (message.stop_reason === 'max_tokens') return ['idle','Reached the response limit'];
  const tool = Array.isArray(message.content) && message.content.find(block => block?.type === 'tool_use');
  if (tool || message.stop_reason === 'tool_use') return ['working',TOOL_TASK.get(tool?.name) || 'Using a tool'];
  if (Array.isArray(message.content) && message.content.some(block => block?.type === 'text')) {
    return ['unknown','Assistant response recorded'];
  }
}

const hash = value => createHash('sha256').update(value).digest('hex').slice(0,22);

async function inspect(file,provider,now) {
  const activity = [];
  let folder = '', sessionId = '';
  for (const line of await readLines(file)) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object') continue;
    if (provider === 'codex' && (row.type === 'session_meta' || row.type === 'turn_context')) {
      folder = project(row.payload?.cwd) || folder;
      if (row.type === 'session_meta') sessionId = row.payload?.id || row.payload?.session_id;
    } else if (provider === 'claude') {
      folder = project(row.cwd) || folder;
      if (typeof row.sessionId === 'string') sessionId = row.sessionId;
    }
    const stamp = Date.parse(row.timestamp);
    if (!Number.isFinite(stamp) || stamp < now - WINDOW || stamp > now + 120_000) continue;
    const signal = provider === 'codex' ? codexSignal(row) : claudeSignal(row);
    if (signal) activity.push({stamp,status:signal[0],task:signal[1]});
  }
  if (!activity.length) return null;
  const workerFile = provider === 'claude' && path.basename(path.dirname(file)) === 'subagents';
  // IDs survive text changes. A nested Claude agent shares its parent's
  // sessionId, so its transcript name also participates in that private hash.
  const identity = typeof sessionId === 'string' && sessionId ? sessionId : file;
  const id = 'local-' + provider + '-' + hash(identity + (workerFile ? ':' + path.basename(file) : ''));
  activity.sort((a,b) => a.stamp-b.stamp);
  const latest = activity.at(-1), lastSeen = new Date(latest.stamp).toISOString();
  const stale = latest.status === 'working' && now - latest.stamp >= ACTIVE_WINDOW;
  const source = SOURCES[provider], title = workerFile ? 'Claude subagent' : source;
  const name = folder ? title + ' · ' + folder : title;
  const agent = {id,name,status:stale ? 'unknown' : latest.status,task:latest.task,lastSeen,nextRun:null,
    source,sourceType:'local',interval:'Local session',sourceObservedAt:new Date(now).toISOString(),
    detail:stale ? 'The last work signal is over five minutes old.' : 'Observed in the local session log.',
    ...(stale ? {staleReportedStatus:'working'} : {})};
  const events = new Map();
  for (const entry of activity.slice(-6)) {
    const at = new Date(entry.stamp).toISOString(), eventId = id + ':' + at + ':' + hash(entry.task);
    events.set(eventId,{id:eventId,agentId:id,title:entry.task,at});
  }
  return {agent,events:[...events.values()]};
}

async function discover(codexHome,claudeHome,now) {
  const groups = await Promise.all(Object.entries({codex:path.join(codexHome,'sessions'),claude:path.join(claudeHome,'projects')}).map(async ([provider,root]) => {
    const files = await findCandidates(root,provider,now), records = [];
    // Keep maximum open files and transient transcript buffers bounded.
    for (let i = 0; i < files.length; i += 4) {
      const batch = await Promise.all(files.slice(i,i+4).map(async ({file}) => {
        try { return await inspect(file,provider,now); } catch { return null; }
      }));
      records.push(...batch.filter(Boolean));
    }
    return records;
  }));
  const byId = new Map(), events = new Map();
  for (const {agent,events:observations} of groups.flat()) {
    if (!byId.has(agent.id) || byId.get(agent.id).lastSeen < agent.lastSeen) byId.set(agent.id,agent);
    for (const event of observations) events.set(event.id,event);
  }
  return {agents:[...byId.values()].sort((a,b)=>b.lastSeen.localeCompare(a.lastSeen)),
    events:[...events.values()].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,100)};
}

let cached;
export async function readLocalAgents(options) {
  const codexHome = options?.codexHome ?? (process.env.CODEX_HOME || path.join(homedir(),'.codex'));
  const claudeHome = options?.claudeHome ?? (process.env.CLAUDE_CONFIG_DIR || path.join(homedir(),'.claude'));
  const now = options?.now ?? Date.now();
  if (options) return discover(codexHome,claudeHome,now);
  if (!cached || now - cached.started >= 12_000 || cached.codexHome !== codexHome || cached.claudeHome !== claudeHome) {
    cached = {started:now,codexHome,claudeHome,promise:discover(codexHome,claudeHome,now)};
  }
  return cached.promise;
}
