import { initialAgents, observedAt } from './sources.js';

// A single conditional object write commits each source's telemetry and activity
// together. Independent sources and independently connected agents never contend.
const ROOT = 'orbital/v1/';
const SOURCES = ['automation', 'worker'];
const STATUSES = new Set(['working', 'idle', 'waiting', 'offline', 'error', 'unknown', 'scheduled', 'paused', 'completed']);
const MAX_EVENTS = 100;
const CLOCK_SKEW = 2 * 60_000;
const RECORD_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/;
const byNewest = (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id);

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(data, status = 200) {
  return Response.json(data, {status, headers: {'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff'}});
}

function textField(value, label, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new ApiError(400, 'Invalid ' + label + '.');
  }
  return value.trim();
}

function dateField(value, label, pastOnly = false) {
  if (value == null || value === '') return null;
  const when = typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(when) || (pastOnly && when > Date.now() + CLOCK_SKEW)) {
    throw new ApiError(400, 'Invalid ' + label + '.');
  }
  return new Date(when).toISOString();
}

async function bodyOf(request, limit = 512 * 1024) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'Send application/json.');
  }
  if (Number(request.headers.get('content-length')) > limit) throw new ApiError(413, 'Report is too large.');
  const reader = request.body?.getReader();
  let raw = '', bytes = 0;
  const decoder = new TextDecoder();
  if (reader) {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new ApiError(413, 'Report is too large.'); }
      raw += decoder.decode(value, {stream:true});
    }
    raw += decoder.decode();
  }
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Produce the same validation error for malformed and absent JSON. */ }
  throw new ApiError(400, 'A JSON object is required.');
}

async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    b => b.toString(16).padStart(2, '0')).join('');
}

async function matchesKey(submitted, expectedDigest) {
  if (!submitted || submitted.length > 8192 || !/^[a-f0-9]{64}$/i.test(expectedDigest || '')) return false;
  const actual = await digest(submitted);
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expectedDigest.toLowerCase().charCodeAt(i);
  return diff === 0;
}

function event(agent, at, title, suffix = '') {
  return {id: [agent.id, at, suffix || agent.status].join(':'), agentId: agent.id, at, title};
}

function inboxHistory(before, agent, checkedAt) {
  if (!before) {
    if (agent.lastSeen) return event(agent, agent.lastSeen,
      agent.sourceType === 'worker' ? 'Checkpoint recorded · ' + agent.name : 'Run reported · ' + agent.name);
    return event(agent, checkedAt, 'Schedule observed · ' + agent.name, 'observed');
  }
  if (before.lastSeen !== agent.lastSeen && agent.lastSeen) {
    return event(agent, agent.lastSeen, agent.sourceType === 'worker' ? 'Checkpoint recorded · ' + agent.name : 'Run reported · ' + agent.name);
  }
  if (before.status !== agent.status || before.task !== agent.task) {
    return event(agent, checkedAt, agent.name + ' · ' + agent.status);
  }
  return null;
}

function seed(sourceType) {
  const agents = initialAgents.filter(agent => agent.sourceType === sourceType).map(a => sourceAgent(a, sourceType));
  const updatedAt = new Date(observedAt).toISOString();
  return {agents, updatedAt, events: agents.map(a => inboxHistory(null, a, updatedAt))};
}

function sourceAgent(raw, group) {
  if (!raw || !RECORD_ID.test(raw.id || '') || typeof raw.id !== 'string' || raw.id.startsWith('agent-') || !STATUSES.has(raw.status)) {
    throw new ApiError(400, 'Each agent needs a valid source ID and status.');
  }
  if (raw.sourceType && raw.sourceType !== group) throw new ApiError(400, 'Agent source type does not match the snapshot.');
  return {id:raw.id, name:textField(raw.name, 'agent name', 180, true), status:raw.status,
    task:textField(raw.task, 'task', 1000), lastSeen:dateField(raw.lastSeen, 'last report', true),
    nextRun:dateField(raw.nextRun, 'next run'), source:textField(raw.source, 'source', 160),
    sourceType:group, detail:textField(raw.detail, 'detail', 2400), interval:textField(raw.interval, 'interval', 250)};
}

function normalizeForDisplay(agent, checkedAt) {
  const age = agent.lastSeen ? Date.now() - Date.parse(agent.lastSeen) : Infinity;
  const stale = (agent.status === 'working' && age > 10 * 60_000)
    || (agent.sourceType === 'worker' && agent.status === 'idle' && age >= 20 * 60_000);
  return {...agent, ...(stale ? {status:'unknown',staleReportedStatus:agent.status} : {}), sourceObservedAt:checkedAt};
}

async function conditionalUpdate(bucket, key, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const object = await bucket.get(key);
    const previous = object ? await object.json() : null;
    const {record, result} = await change(previous);
    if (!record) return result;
    const onlyIf = object ? {etagMatches:object.etag} : new Headers({'if-none-match':'*'});
    if (await bucket.put(key, JSON.stringify(record), {onlyIf})) return result;
  }
  throw new ApiError(409, 'Another report arrived simultaneously. Retry this report.');
}

async function state(bucket) {
  const groups = await Promise.all(SOURCES.map(async sourceType => {
    const item = await bucket.get(ROOT + sourceType + '.json');
    return item ? item.json() : seed(sourceType);
  }));
  let cursor;
  const agents = groups.flatMap(g => {
    const stamps = new Map(g.stamps);
    return g.agents.map(a => normalizeForDisplay(a, stamps.get(a.id) || g.updatedAt));
  });
  const events = groups.flatMap(g => g.events);
  const times = groups.map(g => g.updatedAt);
  do {
    const listing = await bucket.list({prefix:ROOT + 'agents/', cursor, limit:200});
    const records = await Promise.all(listing.objects.map(async item => (await bucket.get(item.key))?.json()));
    for (const record of records) {
      if (!record) continue;
      agents.push(normalizeForDisplay(record.agent, record.updatedAt));
      events.push(...record.events);
      times.push(record.updatedAt);
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
  return {agents,events:events.sort(byNewest).slice(0, MAX_EVENTS),updatedAt:times.sort().at(-1)};
}

async function sync(bucket, payload) {
  const group = payload.sourceType;
  if (!SOURCES.includes(group) || !['merge','replace'].includes(payload.mode) || !Array.isArray(payload.agents) || payload.agents.length > 256) {
    throw new ApiError(400, 'Supply sourceType, mode, and an agents array with up to 256 agents.');
  }
  const checkedAt = dateField(payload.observedAt, 'observation time', true);
  if (!checkedAt) throw new ApiError(400, 'Supply the time the source was observed.');
  const incoming = payload.agents.map(a => sourceAgent(a, group));
  if (new Set(incoming.map(a => a.id)).size !== incoming.length) throw new ApiError(400, 'The source snapshot contains duplicate IDs.');
  const incomingEvents = payload.events || [];
  if (!Array.isArray(incomingEvents) || incomingEvents.length>100) throw new ApiError(400,'Supply up to 100 source events.');
  const byId = new Map(incoming.map(a=>[a.id,a]));
  const history = incomingEvents.map(row=>{
    const agent = byId.get(row?.agentId), at = dateField(row?.at,'event time',true);
    if (!agent || !at) throw new ApiError(400,'Each source event needs a current agent and a timestamp.');
    return event(agent,at,textField(row.title,'event title',500,true),'source');
  });
  return conditionalUpdate(bucket, ROOT + group + '.json', previous => {
    const old = previous || seed(group);
    const lastReplacement = old.lastReplacement || old.updatedAt;
    if (checkedAt < lastReplacement || (previous && checkedAt === lastReplacement)) {
      return {result:{applied:false,updatedAt:old.updatedAt,count:old.agents.length}};
    }
    const before = new Map(old.agents.map(a => [a.id,a]));
    const next = new Map(before);
    const stamps = new Map(old.stamps || old.agents.map(a => [a.id,old.updatedAt]));
    const knownEvents = new Set(old.events.map(e=>e.id));
    const events = [...old.events,...history.filter(e=>!knownEvents.has(e.id))];
    let changed = false;
    for (const a of incoming) {
      if (previous && stamps.get(a.id) >= checkedAt) continue;
      next.set(a.id,a);
      stamps.set(a.id,checkedAt);
      changed = true;
      const e = inboxHistory(before.get(a.id), a, checkedAt);
      if (e) events.push(e);
    }
    if (payload.mode === 'replace') {
      const present = new Set(incoming.map(a => a.id));
      for (const a of before.values()) {
        if (present.has(a.id) || stamps.get(a.id) > checkedAt) continue;
        next.delete(a.id);
        stamps.delete(a.id);
        events.push(event(a, checkedAt, 'Removed from source · ' + a.name, 'removed'));
      }
    } else if (!changed && events.length===old.events.length) {
      return {result:{applied:false,updatedAt:old.updatedAt,count:next.size}};
    }
    const updatedAt = checkedAt > old.updatedAt ? checkedAt : old.updatedAt;
    const unique = new Map(events.map(e=>[e.id,e]));
    const record = {agents:[...next.values()],events:[...unique.values()].sort(byNewest).slice(0,MAX_EVENTS),updatedAt,stamps:[...stamps],
      lastReplacement:payload.mode === 'replace' ? checkedAt : lastReplacement};
    return {record,result:{applied:true,updatedAt,count:next.size}};
  });
}

async function register(bucket, payload) {
  const now = new Date().toISOString();
  const agent = {id:'agent-' + crypto.randomUUID(), name:textField(payload.name, 'agent name', 90, true), status:'waiting',
    task:textField(payload.task, 'task', 1000) || 'Awaiting first report',source:textField(payload.source, 'source', 160) || 'Custom agent',
    sourceType:'custom',detail:'',interval:'',lastSeen:null,nextRun:null};
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
  const record = {agent,updatedAt:now,tokenHash:await digest(token),reportIds:[],events:[event(agent,now,'Agent registered · ' + agent.name,'registered')]};
  await bucket.put(ROOT + 'agents/' + agent.id, JSON.stringify(record));
  return {agent,connection:{path:'/api/agents/' + agent.id + '/report',token,method:'POST',body:{status:'working',task:'Describe the current task'}}};
}

async function report(bucket, agentId, request) {
  const token = request.headers.get('Orbit-Agent-Key');
  if (!token || token.length !== 64) throw new ApiError(401, 'A valid agent key is required.');
  const payload = await bodyOf(request);
  if (!STATUSES.has(payload.status)) throw new ApiError(400, 'Invalid agent status.');
  const task = textField(payload.task,'task',1000,true);
  const detail = textField(payload.detail,'detail',2400);
  const eventId = textField(payload.eventId,'event ID',160);
  const now = new Date().toISOString();
  const at = dateField(payload.lastSeen,'last report',true) || now;
  return conditionalUpdate(bucket, ROOT + 'agents/' + agentId, async old => {
    if (!old || !await matchesKey(token, old.tokenHash)) throw new ApiError(401, 'A valid agent key is required.');
    if ((eventId && old.reportIds.includes(eventId)) || (old.agent.lastSeen && at < old.agent.lastSeen)) {
      return {result:{applied:false,agent:old.agent}};
    }
    const agent = {...old.agent,status:payload.status,task,lastSeen:at,detail};
    const changed = !old.agent.lastSeen || old.agent.status !== agent.status || old.agent.task !== task || old.agent.detail !== detail;
    if (!changed && !eventId && at === old.agent.lastSeen) return {result:{applied:false,agent:old.agent}};
    const events = changed ? [event(agent,at,task,eventId),...old.events].slice(0,MAX_EVENTS) : old.events;
    return {record:{...old,agent,events,updatedAt:now,reportIds:eventId ? [eventId,...old.reportIds].slice(0,256) : old.reportIds},result:{applied:true,agent}};
  });
}

export async function handleApi(request, env) {
  try {
    const url = new URL(request.url);
    const isVisitor = Boolean(request.headers.get('oai-authenticated-user-id')?.trim());
    const isMutation = !['GET','HEAD'].includes(request.method);
    const origin = request.headers.get('origin');
    if (isMutation && ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site')) {
      throw new ApiError(403, 'Cross-origin updates are disabled.');
    }
    const isState = request.method === 'GET' && url.pathname === '/api/state';
    const isSync = request.method === 'POST' && url.pathname === '/api/sync';
    const isRegister = request.method === 'POST' && url.pathname === '/api/agents';
    const reporting = request.method === 'POST' && url.pathname.match(/^\/api\/agents\/(agent-[a-f0-9-]{36})\/report$/);
    if (!isState && !isSync && !isRegister && !reporting) throw new ApiError(404, 'Endpoint not found.');
    if (isSync || (isState && !isVisitor)) {
      if (!await matchesKey(request.headers.get('Orbit-Sync-Key'), env.ORBIT_SYNC_KEY_HASH)) {
        throw new ApiError(401, 'An authorized station connection is required.');
      }
    } else if (isRegister && !isVisitor) {
      throw new ApiError(401, 'Sign in to register an agent.');
    }
    if (!env.BUCKET) throw new ApiError(503, 'Station storage is unavailable.');
    if (isState) return json(await state(env.BUCKET));
    if (isSync) return json(await sync(env.BUCKET,await bodyOf(request)));
    if (isRegister) return json(await register(env.BUCKET,await bodyOf(request)),201);
    return json(await report(env.BUCKET,reporting[1],request));
  } catch (error) {
    return json({error:error.status ? error.message : 'Station storage could not process the request.'},error.status || 503);
  }
}

export {ApiError, json, bodyOf, matchesKey, conditionalUpdate};
