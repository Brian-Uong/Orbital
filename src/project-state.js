import { canSkip, skipSlots, ownerSkip } from '../public/skip.js';
import {isStationOwner, ApiError, json, bodyOf, matchesKey, conditionalUpdate} from './api.js';

const SECTOR_KEY = 'orbital/v2/project-state.json';
const SECTOR_NAMES = new Map([
  ['professional', 'Professional'], ['product-design', 'Product Design'],
  ['personal-dashboard', 'Personal Dashboard'], ['personal-website', 'Personal Website'],
  ['financial-advice', 'Financial Advice']
]);

const projectId = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const named = value => typeof value === 'string' && value.trim().length > 0;
const lifecycleTypes = new Set(['created','assigned','started','progress','working','idle','completed','verified','failed','blocked','waiting']);

function receiptContents(row) {
  return JSON.stringify([row.projectId,row.projectName,row.executorId,row.type,row.at,
    row.tag,row.activity,row.artifactUrl,row.source]);
}

function validWorkerEvents(events) {
  if (events === undefined) return true;
  if (!Array.isArray(events)) return false;
  const seen = new Map();
  for (const row of events) {
    if (!row || !named(row.id) || !projectId(row.projectId) || !named(row.projectName) ||
        (SECTOR_NAMES.has(row.projectId) && SECTOR_NAMES.get(row.projectId) !== row.projectName) ||
        typeof row.executorId !== 'string' || !/^\/root(?:\/[a-zA-Z0-9_-]+)*$/.test(row.executorId) ||
        !lifecycleTypes.has(row.type) || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at)) ||
        Date.parse(row.at) > Date.now()+120_000 || !named(row.source) ||
        ['tag','activity','artifactUrl'].some(key=>row[key] !== undefined && typeof row[key] !== 'string')) return false;
    // Replayed observations are harmless; reusing an ID to change an
    // observation would make room state depend on transmission order.
    const identity = receiptContents(row);
    if (seen.has(row.id) && seen.get(row.id) !== identity) return false;
    seen.set(row.id,identity);
  }
  return true;
}

export function validateProjectSnapshot(value) {
  const timestamp = Date.parse(value?.updatedAt);
  if (typeof value?.updatedAt !== 'string' || !Number.isFinite(timestamp) ||
      timestamp > Date.now() + 120_000 || !value.commandCenter || typeof value.commandCenter !== 'object' ||
      !Array.isArray(value.agents) ||
      new Set(value.agents.map(agent => agent?.id)).size !== value.agents.length ||
      !value.agents.every(agent => agent?.sourceType === 'sector' && projectId(agent.id) && named(agent.name)) ||
      ![...SECTOR_NAMES].every(([id,name])=>value.agents.some(agent=>agent.id===id && agent.name===name)) ||
      !validWorkerEvents(value.commandCenter.execution?.workerEvents) ||
      !Array.isArray(value.events) || !Array.isArray(value.reports)) {
    throw new ApiError(400, 'Invalid station projects or worker lifecycle records.');
  }
  return value;
}

function newer(stored, seed) {
  return stored && Date.parse(stored.updatedAt) >= Date.parse(seed.updatedAt) ? stored : seed;
}

// Private revision times are unique. Give each access mode its own validator
// so a change of identity always receives its newly authorized representation.
function stateTag(value, access) {
  const revision = new Date(value.updatedAt).toISOString();
  return '"' + (access ? access + ':' : '') + revision + '"';
}

const publicStatuses = new Set(['idle', 'waiting', 'blocked', 'error', 'completed', 'assigned', 'ready', 'working']);
const readIndex = new WeakMap();

function publicIndex(current) {
  // Keep only the five allowlisted statuses and their freshness clocks in the
  // isolate. Full private documents and request identities are never cached.
  return {
    updatedAt:new Date(current.updatedAt).toISOString(),
    sectors:Array.from(SECTOR_NAMES, ([id, name]) => {
      const agent = current.agents.find(entry => entry.id === id);
      const value = agent?.liveActivity?.status ?? agent?.status;
      const status = publicStatuses.has(value) ? value : 'unknown';
      const time = Date.parse(agent?.liveActivity?.observedAt ?? agent?.lastSeen);
      return {id, name, status, time};
    })
  };
}

function visitorSnapshot(index, now) {
  return {
    updatedAt:index.updatedAt, commandCenter:{id:'control', name:'Control hub'},
    agents:index.sectors.map(({id, name, status, time}) => ({
      id, name, sourceType:'sector',
      status:status === 'working' && !(time <= now && now < time + 300000) ? 'unknown' : status
    })),
    events:[], reports:[]
  };
}

async function readProjectState(request, bucket, seed, access) {
  const privateView = access === 'owner' || access === 'service';
  const validator = request.headers.get('If-None-Match');
  // Content coding at the gateway can weaken a response ETag. For a read,
  // compare the opaque value weakly; its audience and revision still match exactly.
  const readTag = validator?.replace(/^W\//, '');
  const previous = readIndex.get(bucket);
  // R2 checks the object's ETag every time, including on a warm isolate.
  // Only request a metadata-only hit if we can answer without its body.
  const canReuse = previous?.seed === seed && previous.etag &&
    (!privateView || request.method === 'HEAD' || readTag === stateTag(previous.index, access));
  const record = canReuse
    ? await bucket.get(SECTOR_KEY, {onlyIf:{etagDoesNotMatch:previous.etag}})
    : await bucket.get(SECTOR_KEY);
  let current, index;
  if (canReuse && record?.etag === previous.etag && typeof record.json !== 'function') {
    index = previous.index;
  } else {
    current = newer(record ? await record.json() : null, seed);
    index = publicIndex(current);
    readIndex.set(bucket, {seed, etag:record?.etag, index});
  }
  const view = privateView ? current : visitorSnapshot(index, Date.now());
  // The public representation can change as signals expire with no write.
  const tag = privateView ? stateTag(index, access) :
    '"' + access + ':' + index.updatedAt + ':' + view.agents.map(a => a.status).join('.') + '"';
  const headers = {'Cache-Control':'private, no-store', 'Content-Type':'application/json; charset=utf-8',
    'X-Content-Type-Options':'nosniff', 'Orbit-Access':access, 'ETag':tag};
  if (readTag === tag) {
    // Already-open v12 tabs compare the returned tag literally. Preserve the
    // matching spelling they received on their last full response.
    headers.ETag = validator;
    return new Response(null, {status:304, headers});
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(view), {headers});
}

// Check assignment decisions inside the same R2 retry callback as the revision.
function preserveDecisions(current, incoming, service) {
  const conflict = message => { throw new ApiError(409, message); };
  const before = current.commandCenter.execution?.ownerSkips ?? [];
  const after = incoming.commandCenter.execution?.ownerSkips ?? [];
  if (!Array.isArray(after)) throw new ApiError(400, 'Invalid owner decisions.');
  const byId = new Map(after.map(row => [row?.id, row]));
  if (byId.size !== after.length || before.some(row => JSON.stringify(row) !== JSON.stringify(byId.get(row.id)))) {
    conflict('Keep every accepted owner decision.');
  }
  const existing = new Set(before.map(row => row.id));
  for (const row of after) {
    const sector = incoming.agents.find(a => a.id === row?.sectorId);
    if (!sector || !row.tag || row.id !== 'owner-skip/'+sector.id+'/'+row.tag) conflict('Invalid owner decision.');
    if (!existing.has(row.id)) {
      const previous = current.agents.find(a => a.id === sector.id);
      const item = previous?.[row.slot];
      if (!skipSlots.includes(row.slot) || item?.tag !== row.tag || !canSkip(current,previous,item)) {
        conflict('This assignment is no longer eligible.');
      }
      let projected;
      try { projected = ownerSkip(current,sector.id,item,Date.parse(row.at),row.slot); }
      catch { conflict('The assignment has changed.'); }
      if (JSON.stringify(projected) !== JSON.stringify(incoming)) conflict('Update only the selected assignment.');
    }
    if (skipSlots.some(slot => sector[slot]?.tag === row.tag &&
        (sector[slot].status !== 'owner-skipped' || sector[slot].claimId)) ||
        (sector.assignmentId === row.tag && sector.assignmentStatus !== 'owner-skipped')) {
      conflict('A skipped assignment cannot be reclaimed.');
    }
  }
  for (const sector of incoming.agents) {
    const prior = current.agents.find(a => a.id === sector.id);
    for (const slot of skipSlots) {
      const previous = prior?.[slot], next = sector[slot];
      if (previous?.claimId && !service && JSON.stringify(previous) !== JSON.stringify(next)) {
        throw new ApiError(403, 'Only the runner may advance its reserved assignment.');
      }
      if (next?.tag !== previous?.tag && ['queued','planned'].includes(next?.status) &&
          after.some(row => row.sectorId === sector.id && row.task === next.task)) {
        conflict('Choose a distinct replacement for the skipped work.');
      }
      if (previous?.claimId && previous.tag === next?.tag && next.claimId !== previous.claimId) {
        conflict('Keep the accepted assignment reservation.');
      }
      if (!next?.claimId || (previous?.claimId === next.claimId && previous?.tag === next.tag)) continue;
      if (!service) throw new ApiError(403,'Only the runner may reserve planned work.');
      if (!previous || previous.tag !== next.tag || previous.task !== next.task ||
          !canSkip(current, prior, previous)) conflict('Reservation requires the same eligible planned item.');
    }
  }
}

export async function handleProjectState(request, env, seed) {
  try {
    const read = request.method === 'GET' || request.method === 'HEAD';
    if (!read && request.method !== 'PUT') {
      const response = json({error:'Use GET, HEAD or PUT.'}, 405);
      response.headers.set('Allow', 'GET, HEAD, PUT');
      return response;
    }
    const owner = isStationOwner(request, env);
    const key = request.headers.get('Orbit-Sync-Key');
    const service = Boolean(key && await matchesKey(key, env.ORBIT_SYNC_KEY_HASH));
    if ((key && !service) || (!read && !owner && !service)) {
      throw new ApiError(401, 'Owner sign-in or an authorized station connection is required.');
    }
    if (!env.BUCKET) throw new ApiError(503, 'Station storage is unavailable.');
    if (read) {
      const access = owner ? 'owner' : service ? 'service' :
        request.headers.get('oai-authenticated-user-id') ? 'visitor' : 'anonymous';
      return await readProjectState(request, env.BUCKET, seed, access);
    }
    const origin = request.headers.get('origin');
    const ownerBrowser = owner && !service;
    const sameOrigin = origin === new URL(request.url).origin;
    if (((ownerBrowser || origin) && !sameOrigin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new ApiError(403, 'Cross-origin updates are disabled.');
    }
    const expected = request.headers.get('if-match')?.replace(/^W\//, '');
    if (!expected) throw new ApiError(428, 'Read the current state and send its ETag with If-Match.');
    const incoming = validateProjectSnapshot(await bodyOf(request, 8 * 1024 * 1024));
    const acknowledgement = await conditionalUpdate(env.BUCKET, SECTOR_KEY, old => {
      const current = newer(old, seed);
      const equalTime = Date.parse(incoming.updatedAt) === Date.parse(current.updatedAt);
      const same = equalTime && JSON.stringify(incoming) === JSON.stringify(current);
      if (same && old && Date.parse(old.updatedAt) === Date.parse(current.updatedAt)) {
        return {result:{applied:false, updatedAt:current.updatedAt}};
      }
      if (![stateTag(current), stateTag(current, 'owner'), stateTag(current, 'service')].includes(expected)) throw new ApiError(412, 'The station changed. Read it again before retrying.');
      if (Date.parse(incoming.updatedAt) < Date.parse(current.updatedAt) || (equalTime && !same)) {
        throw new ApiError(409, 'Snapshot is older than, or conflicts with, the current revision.');
      }
      preserveDecisions(current, incoming, service);
      const previousEvents = current.commandCenter.execution?.workerEvents ?? [];
      if (previousEvents.length) {
        const nextEvents = new Map((incoming.commandCenter.execution?.workerEvents ?? [])
          .map(event => [event.id, receiptContents(event)]));
        if (previousEvents.some(event => nextEvents.get(event.id) !== receiptContents(event))) {
          throw new ApiError(409, 'Preserve previously accepted worker receipts and merge new observations.');
        }
      }
      return {record:incoming, result:{applied:true, updatedAt:incoming.updatedAt}};
    });
    const response = json(acknowledgement);
    response.headers.set('ETag', stateTag(acknowledgement, owner ? 'owner' : 'service'));
    return response;
  } catch (error) {
    return json({error:error instanceof ApiError ? error.message : 'Station storage could not process the request.'},
      error instanceof ApiError ? error.status : 503);
  }
}
