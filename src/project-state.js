import {isStationOwner, ApiError, json, bodyOf, matchesKey, conditionalUpdate} from './api.js';

const SECTOR_KEY = 'orbital/v2/project-state.json';
const SECTOR_NAMES = new Map([
  ['professional', 'Professional'], ['product-design', 'Product Design'],
  ['personal-dashboard', 'Personal Dashboard'], ['personal-website', 'Personal Website'],
  ['financial-advice', 'Financial Advice']
]);

export function validateProjectSnapshot(value) {
  const timestamp = Date.parse(value?.updatedAt);
  if (typeof value?.updatedAt !== 'string' || !Number.isFinite(timestamp) ||
      timestamp > Date.now() + 120_000 || !value.commandCenter || typeof value.commandCenter !== 'object' ||
      !Array.isArray(value.agents) || value.agents.length !== SECTOR_NAMES.size ||
      new Set(value.agents.map(agent => agent?.id)).size !== SECTOR_NAMES.size ||
      !value.agents.every(agent => agent && agent.sourceType === 'sector' && SECTOR_NAMES.has(agent.id) &&
        SECTOR_NAMES.get(agent.id) === agent.name) ||
      !Array.isArray(value.events) || !Array.isArray(value.reports)) {
    throw new ApiError(400, 'Invalid five-sector project snapshot.');
  }
  return value;
}

function newer(stored, seed) {
  return stored && Date.parse(stored.updatedAt) >= Date.parse(seed.updatedAt) ? stored : seed;
}

function stateTag(value) {
  // An accepted snapshot's revision time is unique. Equal-time divergent writes conflict below.
  return '"' + new Date(value.updatedAt).toISOString() + '"';
}

// Construct the visitor document from known fields. Never include raw project records.
function visitorSnapshot(current) {
  const statuses = new Set(['idle', 'waiting', 'blocked', 'error', 'completed', 'assigned', 'ready', 'working']);
  const agents = Array.from(SECTOR_NAMES, ([id, name]) => {
    const agent = current.agents.find(entry => entry.id === id);
    const value = agent?.liveActivity?.status ?? agent?.status;
    const status = statuses.has(value) ? value : 'unknown';
    const time = Date.parse(agent?.liveActivity?.observedAt ?? agent?.lastSeen);
    const age = Date.now() - time;
    if (status === 'working' && age >= 0 && age < 300000) {
      return {id, name, sourceType:'sector', status, lastSeen:new Date(time).toISOString()};
    }
    return {id, name, sourceType:'sector', status:status === 'working' ? 'unknown' : status};
  });
  return {
    updatedAt:new Date(current.updatedAt).toISOString(),
    commandCenter:{id:'control', name:'Control hub'},
    agents, events:[], reports:[]
  };
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
      const record = await env.BUCKET.get(SECTOR_KEY);
      const current = newer(record ? await record.json() : null, seed);
      const headers = {'Cache-Control':'private, no-store', 'Content-Type':'application/json; charset=utf-8',
        'X-Content-Type-Options':'nosniff', 'ETag':stateTag(current)};
      const document = (owner || service) ? current : visitorSnapshot(current);
      headers['Orbit-Access'] = owner ? 'owner' : service ? 'service' :
        request.headers.get('oai-authenticated-user-id') ? 'visitor' : 'anonymous';
      return new Response(request.method === 'HEAD' ? null : JSON.stringify(document), {headers});
    }
    const origin = request.headers.get('origin');
    const ownerBrowser = owner && !service;
    const sameOrigin = origin === new URL(request.url).origin;
    if (((ownerBrowser || origin) && !sameOrigin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new ApiError(403, 'Cross-origin updates are disabled.');
    }
    const expected = request.headers.get('if-match');
    if (!expected) throw new ApiError(428, 'Read the current state and send its ETag with If-Match.');
    const incoming = validateProjectSnapshot(await bodyOf(request, 8 * 1024 * 1024));
    const acknowledgement = await conditionalUpdate(env.BUCKET, SECTOR_KEY, old => {
      const current = newer(old, seed);
      const equalTime = Date.parse(incoming.updatedAt) === Date.parse(current.updatedAt);
      const same = equalTime && JSON.stringify(incoming) === JSON.stringify(current);
      if (same && old && Date.parse(old.updatedAt) === Date.parse(current.updatedAt)) {
        return {result:{applied:false, updatedAt:current.updatedAt}};
      }
      if (stateTag(current) !== expected) throw new ApiError(412, 'The station changed. Read it again before retrying.');
      if (Date.parse(incoming.updatedAt) < Date.parse(current.updatedAt) || (equalTime && !same)) {
        throw new ApiError(409, 'Snapshot is older than, or conflicts with, the current revision.');
      }
      return {record:incoming, result:{applied:true, updatedAt:incoming.updatedAt}};
    });
    const response = json(acknowledgement);
    response.headers.set('ETag', stateTag(acknowledgement));
    return response;
  } catch (error) {
    return json({error:error instanceof ApiError ? error.message : 'Station storage could not process the request.'},
      error instanceof ApiError ? error.status : 503);
  }
}
