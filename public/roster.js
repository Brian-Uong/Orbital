// Owner-side projection of the Work producer's execution ledger. Sector records,
// historical thread references and planned assignments do not identify workers.
import { rosterOffices, workerName } from './worker-roster.js';

const list = value => Array.isArray(value) ? value : [];
const string = value => typeof value === 'string' ? value.trim() : '';
const handleOf = value => /^\/root(?:\/[a-zA-Z0-9_-]+)*$/.test(string(value)) ? string(value) : '';
const liveStatuses = new Set(['working', 'running', 'started', 'in progress']);
const planned = new Set(['queued', 'planned', 'assigned', 'owner-skipped', 'skipped']);
const stateOf = value => string(value).toLowerCase();
const terminal = new Set(['verified', 'completed', 'failed', 'blocked', 'idle', 'waiting']);
const officialFloors = new Map([
  ['professional','Professional'],['product-design','Product Design'],['personal-dashboard','Personal Dashboard'],
  ['personal-website','Personal Website'],['financial-advice','Financial Advice']
]);
const lifecycleTypes = new Set(['created','assigned','started','progress','working','idle','completed','verified','failed','blocked','waiting']);
const tagOn = (tag, floor) => typeof tag === 'string' && tag.startsWith(floor+'-') && /^\d+$/.test(tag.slice(floor.length+1));

function safeResult(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function observedTime(row, live) {
  const candidates = live ? [row.observedAt, row.startedAt] :
    [row.verifiedAt, row.completedAt, row.observedAt, row.checkedAt, row.at, row.startedAt];
  return candidates.find(time => typeof time === 'string' && Number.isFinite(Date.parse(time))) || '';
}

// Each task can independently end or remain active. Compare updates for that
// task first, so completing a short second job cannot erase an ongoing first.
function choose(previous, incoming) {
  if (!previous) return incoming;
  const delta = incoming.time - previous.time;
  if (delta) return delta > 0 ? incoming : previous;
  if (incoming.priority !== previous.priority) return incoming.priority > previous.priority ? incoming : previous;
  // A completion at the same instant supersedes the matching start.
  if (terminal.has(incoming.rawStatus) !== terminal.has(previous.rawStatus)) {
    return terminal.has(incoming.rawStatus) ? incoming : previous;
  }
  return incoming;
}

function floorRoster(sector, runs, events, lifecycle, now) {
  const identities = new Map();
  const unseenTags = new Set();
  const results = new Map();
  const lastStop = new Map();
  function record(handle, row, priority) {
    if (!handle) return;
    if (!identities.has(handle)) identities.set(handle, new Map());
    const reports = identities.get(handle);
    const key = row.tag || '';
    const report = {...row,priority,time:Date.parse(row.observedAt) || 0};
    reports.set(key, choose(reports.get(key), report));
    if (['completed','verified'].includes(row.rawStatus)) results.set(handle,choose(results.get(handle),report));
    if (!key && terminal.has(row.rawStatus)) lastStop.set(handle,Math.max(report.time,lastStop.get(handle) ?? 0));
  }
  function takeRun(run) {
    if (!run || !tagOn(run.tag,sector.id) || planned.has(stateOf(run.status))) return;
    const lead = handleOf(run.executorId);
    const members = new Map(list(run.executors).filter(Boolean).map(person => [handleOf(person.id || person.executorId),person]));
    members.delete('');
    if (lead && !members.has(lead)) members.set(lead,{});
    if (!members.size) unseenTags.add(run.tag);
    for (const [handle,person] of members) {
      const isLead = handle === lead;
      const personalStatus = stateOf(person.status);
      const jobStatus = stateOf(run.status);
      const finished = terminal.has(jobStatus);
      const rawStatus = finished && liveStatuses.has(personalStatus) ? jobStatus :
        personalStatus || (isLead || finished ? jobStatus : 'reported');
      if (planned.has(rawStatus)) continue;
      const live = liveStatuses.has(rawStatus);
      // A running team assignment does not establish a contributor heartbeat.
      const observedAt = observedTime(person, live) || (!live || isLead ? observedTime(run, live) : '');
      record(handle,{
        tag:run.tag,rawStatus,observedAt,expiresAt:person.expiresAt || run.expiresAt,
        role:string(person.specialistName) || (isLead ? string(run.specialistName) : ''),
        activity:string(person.contribution) || string(person.action) || (isLead ? string(run.summary) || string(run.intendedOutcome) : ''),
        source:string(person.source) || string(run.source),
        artifactUrl:safeResult(person.artifactUrl || (isLead ? run.artifactUrl || run.reviewUrl : ''))
      }, 3);
    }
  }
  for (const run of runs) takeRun(run);
  takeRun(sector.workEvidence);
  // The producer keeps observed identities on each project even as individual
  // ledger entries age out. Its folderAgents array holds navigation references.
  for (const member of list(sector.workSpecialists)) {
    if (!member || !tagOn(member.observedTag,sector.id)) continue;
    record(handleOf(member.executorId), {tag:member.observedTag,rawStatus:'reported',observedAt:'',activity:'',role:'',source:'Project specialist record',artifactUrl:''}, 0);
  }
  for (const event of events) {
    if (!event || event.agentId!==sector.id || !event.executorId || planned.has(stateOf(event.status))) continue;
    if (!tagOn(event.tag,sector.id)) continue;
    // Published result events can survive ledger truncation. The producer
    // includes the disposition in older event IDs, rather than a status field.
    const disposition = stateOf(event.status) || string(event.id).split('-').at(-1);
    if (!terminal.has(disposition)) continue;
    record(handleOf(event.executorId),{tag:event.tag,rawStatus:disposition,observedAt:string(event.at),activity:string(event.title),role:'',
      source:string(event.source),artifactUrl:safeResult(event.artifactUrl)},1);
  }
  const signals = Array.isArray(sector.liveActivity) ? sector.liveActivity : [sector.liveActivity];
  for (const signal of signals) {
    if (!signal || !signal.executorId || !string(signal.status) || planned.has(stateOf(signal.status))) continue;
    record(handleOf(signal.executorId), {tag:tagOn(signal.tag,sector.id) ? signal.tag : '',rawStatus:stateOf(signal.status),
      observedAt:observedTime(signal,liveStatuses.has(stateOf(signal.status))),expiresAt:signal.expiresAt,activity:string(signal.action),role:'',
      source:string(signal.source) || 'Executor activity',artifactUrl:''},4);
  }
  for (const row of lifecycle) {
    record(row.executorId, {
      tag:string(row.tag),rawStatus:row.type==='progress' ? 'working' : row.type,
      observedAt:row.at,role:'',activity:string(row.activity),
      source:string(row.source),artifactUrl:safeResult(row.artifactUrl)
    }, 4);
  }
  const workers = [];
  for (const [handle,reports] of identities) {
    const ordered = [...reports.values()].map(report => {
      const age = now - report.time;
      const expiry = Date.parse(report.expiresAt);
      const active = liveStatuses.has(report.rawStatus) && report.time > 0 && age >= 0 && age < 300000 && (!Number.isFinite(expiry) || now < expiry);
      const confirmed = active && report.time > (lastStop.get(handle) ?? 0);
      const expiresAt = confirmed ? new Date(Math.min(report.time+300000,Number.isFinite(expiry) ? expiry : Infinity)).toISOString() : '';
      return {...report, active:confirmed,expiresAt};
    }).sort((a,b) => Number(b.active)-Number(a.active) || b.time-a.time || b.priority-a.priority || a.tag.localeCompare(b.tag));
    const latest = ordered[0];
    const status = latest.active ? 'working' : liveStatuses.has(latest.rawStatus) ? 'last seen' :
      latest.rawStatus === 'verified' ? 'completed' :
      terminal.has(latest.rawStatus) || ['created','assigned'].includes(latest.rawStatus) ? latest.rawStatus : 'reported';
    const result = results.get(handle);
    // Keep an unfinished assignment visible when its activity animation expires.
    const hasOpenWork = ordered.some(report => {
      if (!['created','assigned'].includes(report.rawStatus) && !liveStatuses.has(report.rawStatus)) return false;
      if (report.time <= (lastStop.get(handle) ?? -1)) return false;
      return Boolean(report.tag) || !result || report.time > result.time;
    }) || [sector.pendingAssignment,sector.queuedFollowup,sector.researchFollowup].some(slot => {
      if (!slot || slot.executorId !== handle || !slot.claimId || !['assigned','running','working','waiting','blocked'].includes(stateOf(slot.status))) return false;
      const disposition = reports.get(slot.tag);
      return !disposition || !['verified','completed','idle','failed'].includes(disposition.rawStatus) || Date.parse(slot.claimedAt) > disposition.time;
    });
    const roleEvidence = runs.findLast(run => run?.tag===latest.tag && tagOn(run.tag,sector.id) && run.executorId===handle && string(run.nameSource) && string(run.specialistName));
    const lastResult = result ? {observedAt:result.observedAt,tag:result.tag,activity:result.activity,artifactUrl:result.artifactUrl,source:result.source} : null;
    workers.push({id:sector.id+':'+handle,handle,name:workerName(handle),hasOpenWork,verifiedRole:roleEvidence?.specialistName || latest.role,role:latest.role,projectId:sector.id,projectName:sector.name,
      active:latest.active,expiresAt:latest.expiresAt,lastResult,status,activity:latest.activity || 'No individual activity description was recorded.',
      observedAt:latest.observedAt,tag:latest.tag,source:latest.source,artifactUrl:latest.artifactUrl});
  }
  workers.sort((a,b)=>a.handle.localeCompare(b.handle));
  const coverage = unseenTags.size ? 'Some earlier assignments have no recorded executor.' :
    workers.length ? 'Offices reflect named Work reports.' : 'No named worker has been reported.';
  return {workers,coverage};
}

export function buildTowerFloors(snapshot, {access, now=Date.now()}={}) {
  const privateView = access==='owner' || access==='service';
  const runs = list(snapshot?.commandCenter?.execution?.workRuns);
  const events = list(snapshot?.events);
  const sectors = new Map(list(snapshot?.agents).filter(a=>a?.sourceType==='sector').map(a=>[a.id,a]));
  if (!privateView) {
    return [...officialFloors].filter(([id])=>sectors.has(id)).map(([id,name])=>({
      id,name,status:sectors.get(id).status,workers:[],coverage:'Worker details are private.'
    }));
  }
  const byProject = new Map();
  const ids = new Set();
  for (const row of list(snapshot?.commandCenter?.execution?.workerEvents)) {
    if (!row || !string(row.id) || ids.has(row.id) || !handleOf(row.executorId) || !lifecycleTypes.has(row.type) ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(string(row.projectId)) || !string(row.projectName) || !string(row.source) ||
        typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))) continue;
    ids.add(row.id);
    if (!byProject.has(row.projectId)) byProject.set(row.projectId,[]);
    byProject.get(row.projectId).push(row);
  }
  for (const id of [...byProject.keys()].sort()) {
    if (!sectors.has(id)) {
      const rows = byProject.get(id);
      const latest = rows.reduce((a,b)=>Date.parse(a.at) > Date.parse(b.at) || (a.at===b.at && a.id>b.id) ? a : b);
      sectors.set(id,{id,name:latest.projectName,status:'reported'});
    }
  }
  return [...sectors.values()].map(sector=>{
    const lifecycle = byProject.get(sector.id) || [];
    const roster = floorRoster(sector,runs,events,lifecycle,now);
    const recent = lifecycle.length && roster.workers.reduce((last,w)=>!last || Date.parse(w.observedAt)>Date.parse(last.observedAt) ? w : last,null);
    const status = roster.workers.some(worker=>worker.active) ? 'working' : recent?.status || sector.status;
    const policy = snapshot?.commandCenter?.execution?.workerRosterPolicy;
    if (!Array.isArray(policy?.roles)) return {id:sector.id,name:sector.name,status,...roster};
    const candidates = roster.workers.map(worker => ({
      projectId:sector.id,executorId:worker.handle,verifiedRole:worker.verifiedRole,
      terminal:terminal.has(worker.status),hasOpenWork:worker.hasOpenWork || worker.active,
      sortAt:Date.parse(worker.observedAt) || 0,worker
    }));
    const workers = rosterOffices(candidates,policy.roles).map(({row,label}) =>
      label===row.worker.name ? row.worker : {...row.worker,name:label}
    ).sort((a,b)=>a.name.localeCompare(b.name) || a.handle.localeCompare(b.handle));
    return {id:sector.id,name:sector.name,status,coverage:roster.coverage,workers,allWorkers:roster.workers};
  });
}
