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
      if (current.commandCenter.workflowControl?.paused || current.commandCenter.sectorControls?.[sector.id]?.paused) conflict('This sector is paused. Keep its planned work queued.');
      if (!previous || previous.tag !== next.tag || previous.task !== next.task ||
          !canSkip(current, prior, previous)) conflict('Reservation requires the same eligible planned item.');
    }
  }
}

export async function handleProjectState(request, env, seed) {
  try {
    const sectorRoute = new URL(request.url).pathname === '/api/sector-control';
    const controlRoute = new URL(request.url).pathname === '/api/workflow-control';
    const responseRoute = new URL(request.url).pathname === '/api/release-response';
    const approvalRoute = sectorRoute || responseRoute || controlRoute || new URL(request.url).pathname === '/api/release-approval';
    const read = !approvalRoute && (request.method === 'GET' || request.method === 'HEAD');
    if ((!approvalRoute && !read && request.method !== 'PUT') || (approvalRoute && request.method !== 'POST')) {
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
    if (approvalRoute) {
      if (!ownerBrowser) throw new ApiError(403,'Sign in as the owner to approve a release.');
      const intent = await bodyOf(request, 512 * 1024);
      const result = await conditionalUpdate(env.BUCKET, SECTOR_KEY, old => {
        const current = newer(old,seed);
        const ledger = current.commandCenter.execution || {};
        if (sectorRoute) {
          if (!projectId(intent.sectorId) || !current.agents.some(a=>a.id===intent.sectorId && a.sourceType==='sector')) throw new ApiError(400,'Choose an existing sector.');
          if (typeof intent.paused !== 'boolean') throw new ApiError(400,'Choose pause or resume.');
          const controls=current.commandCenter.sectorControls || {};
          const control=controls[intent.sectorId];
          if ((control?.paused===true)===intent.paused) return {result:{sectorId:intent.sectorId,paused:intent.paused,applied:false}};
          if (expected !== stateTag(current,'owner')) throw new ApiError(412,'The station changed. Refresh and try again.');
          const at=new Date(Math.max(Date.now(),Date.parse(current.updatedAt)+1)).toISOString();
          const next={paused:intent.paused,updatedAt:at,source:'Owner Roadmap'};
          return {record:{...current,updatedAt:at,commandCenter:{...current.commandCenter,sectorControls:{...controls,[intent.sectorId]:next}}},result:{sectorId:intent.sectorId,...next,applied:true}};
        }
        if (controlRoute) {
          if (typeof intent.paused !== 'boolean') throw new ApiError(400,'Choose pause or resume.');
          const control = current.commandCenter.workflowControl;
          if (control?.paused === intent.paused) return {result:{paused:control.paused,updatedAt:control.updatedAt}};
          if (expected !== stateTag(current,'owner')) throw new ApiError(412,'The workflow changed. Refresh and try again.');
          const at = new Date(Math.max(Date.now(),Date.parse(current.updatedAt)+1)).toISOString();
          const next = {paused:intent.paused,updatedAt:at,source:'Owner Command'};
          return {record:{...current,updatedAt:at,commandCenter:{...current.commandCenter,workflowControl:next}},result:next};
        }
        if (responseRoute) {
          const {decision, editedOutput = '', instructions = ''} = intent;
          if (!['deny','revise'].includes(decision) || typeof editedOutput !== 'string' || typeof instructions !== 'string' ||
              editedOutput.length > 20000 || instructions.length > 10000) throw new ApiError(400,'Enter a valid decision and keep edits within the displayed limits.');
          if (decision === 'revise' && !editedOutput.trim() && !instructions.trim()) throw new ApiError(400,'Add your revised output or instructions.');
          const prior = (ledger.ownerReviewResponses || []).find(r => r.reviewId === intent.reviewId &&
            JSON.stringify(r.review) === intent.expectedReview && r.decision === decision && r.editedOutput === editedOutput && r.instructions === instructions);
          if (prior) return {result:{responseId:prior.id,applied:false}};
          if (expected !== stateTag(current,'owner')) throw new ApiError(412,'The review changed. Refresh and review it again.');
          const review = ledger.releaseReviews?.find(r => r.id === intent.reviewId);
          if (!review || JSON.stringify(review) !== intent.expectedReview || review.responseId ||
              !['awaiting owner approval','needs brian','pending approval','awaiting approval','ready for review','blocked','failed','needs work','needs changes','revision required'].includes(review.status)) {
            throw new ApiError(409,'This idea is no longer awaiting a decision or repair request.');
          }
          const at = new Date(Math.max(Date.now(),Date.parse(current.updatedAt)+1)).toISOString();
          const receipt = {id:'owner-response/'+review.id+'/'+at,reviewId:review.id,at,source:'Owner Needs Brian',
            decision,editedOutput,instructions,review:structuredClone(review)};
          const entry = {...review,status:decision === 'deny' ? 'denied' : 'changes requested',responseId:receipt.id,
            releaseProgress:decision === 'deny' ? 'Denied by Brian. This revision will not be published.' : 'Your edits are queued for the next hourly check. The revised result will return here for approval.'};
          const record = {...current,updatedAt:at,commandCenter:{...current.commandCenter,execution:{...ledger,
            ownerReviewResponses:[...(ledger.ownerReviewResponses || []),receipt],releaseReviews:ledger.releaseReviews.map(r=>r===review?entry:r)}}};
          return {record,result:{responseId:receipt.id,applied:true}};
        }
        const prior = (ledger.ownerApprovals || []).find(a => a.reviewId === intent.reviewId && JSON.stringify(a.review) === intent.expectedReview);
        if (prior) return {result:{approvalId:prior.id,applied:false}};
        if (expected !== stateTag(current,'owner')) throw new ApiError(412,'The review changed. Refresh and review it again.');
        const review = ledger.releaseReviews?.find(r => r.id === intent.reviewId);
        if (!review || review.responseId || JSON.stringify(review) !== intent.expectedReview || !review.action || !review.destination ||
            !['awaiting owner approval','needs brian','pending approval','awaiting approval','ready for review'].includes(review.status)) {
          throw new ApiError(409,'This release is no longer awaiting your approval.');
        }
        const at = new Date(Math.max(Date.now(),Date.parse(current.updatedAt)+1)).toISOString();
        const receipt = {id:'owner-approval/'+review.id+'/'+at,reviewId:review.id,at,source:'Owner Needs Brian',review:structuredClone(review)};
        const entry = {...review,status:'approved queued',approvalId:receipt.id,releaseProgress:'Queued for the next hourly coordinator check.'};
        const record = {...current,updatedAt:at,commandCenter:{...current.commandCenter,execution:{...ledger,
          ownerApprovals:[...(ledger.ownerApprovals || []),receipt],releaseReviews:ledger.releaseReviews.map(r=>r===review?entry:r)}}};
        return {record,result:{approvalId:receipt.id,applied:true}};
      });
      return json(result);
    }
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
      if (JSON.stringify(current.commandCenter.workflowControl) !== JSON.stringify(incoming.commandCenter.workflowControl)) {
        throw new ApiError(409,'Preserve the owner workflow setting. Use Pause or Resume to change it.');
      }
      if (JSON.stringify(current.commandCenter.sectorControls || {}) !== JSON.stringify(incoming.commandCenter.sectorControls || {})) {
        throw new ApiError(409,'Preserve the owner sector settings. Use Roadmap Pause or Resume to change them.');
      }
      const approvals = current.commandCenter.execution?.ownerApprovals || [];
      const proposed = incoming.commandCenter.execution?.ownerApprovals || [];
      if (JSON.stringify(approvals) !== JSON.stringify(proposed)) throw new ApiError(409,'Preserve every owner approval. Use the approval action for new decisions.');
      if (!service && JSON.stringify(current.commandCenter.execution?.releaseReviews) !== JSON.stringify(incoming.commandCenter.execution?.releaseReviews)) {
        throw new ApiError(403,'Use the release approval action.');
      }
      for (const receipt of approvals) {
        const before = current.commandCenter.execution.releaseReviews?.find(r=>r.id===receipt.reviewId);
        const after = incoming.commandCenter.execution?.releaseReviews?.find(r=>r.id===receipt.reviewId);
        if (before?.approvalId===receipt.id && after?.approvalId!==receipt.id) throw new ApiError(409,'Keep approved releases and their receipt references.');
      }
      const responses = current.commandCenter.execution?.ownerReviewResponses || [];
      if (JSON.stringify(responses) !== JSON.stringify(incoming.commandCenter.execution?.ownerReviewResponses || [])) {
        throw new ApiError(409,'Preserve all owner review responses. Use the response action for new decisions.');
      }
      const reviews = incoming.commandCenter.execution?.releaseReviews || [];
      for (const receipt of responses) {
        const row = reviews.find(r=>r.id===receipt.reviewId);
        if (!row || row.responseId !== receipt.id || row.status !== (receipt.decision === 'deny' ? 'denied' : 'changes requested')) {
          throw new ApiError(409,'Keep the original owner decision. Submit revised work as a new review.');
        }
      }
      for (const row of reviews) {
        const prior=current.commandCenter.execution?.releaseReviews?.find(r=>r.id===row.id);
        const newClaim=['releaseClaimId','revisionClaimId'].some(key=>row[key] && row[key]!==prior?.[key]);
        if (newClaim) {
          const sector=current.agents.find(a=>a.id===(row.projectId || row.project) || a.name===row.project);
          if (current.commandCenter.workflowControl?.paused || (sector && current.commandCenter.sectorControls?.[sector.id]?.paused)) {
            throw new ApiError(409,'Work is paused. Keep this release or revision queued.');
          }
          if (Object.values(current.commandCenter.sectorControls || {}).some(c=>c.paused) && !sector) {
            throw new ApiError(409,'Identify the exact sector before reserving this release or revision.');
          }
        }
        if (row.approvalId && !approvals.some(a=>a.id===row.approvalId && a.reviewId===row.id)) {
          throw new ApiError(409,'Every approval must belong to this exact review.');
        }
        if (!row.revisionOfResponseId) continue;
        const receipt = responses.find(r=>r.id===row.revisionOfResponseId && r.decision==='revise');
        if (!receipt || row.id===receipt.reviewId || row.revisesReviewId!==receipt.reviewId) throw new ApiError(409,'Invalid revision lineage.');
        if (!current.commandCenter.execution?.releaseReviews?.some(r=>r.id===row.id) &&
            (row.status!=='awaiting owner approval' || row.approvalId || row.responseId)) {
          throw new ApiError(409,'Revised work requires a new owner review before publication.');
        }
      }
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




