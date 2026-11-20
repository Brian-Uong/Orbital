import { canSkip, skipSlots } from './skip.js';
import { workerName, workerMentions } from './worker-roster.js';
// Read-only projections of the owner snapshot. Only recorded, displayable fields cross into markup.
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const esc = value => text(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const lower = value => text(value).toLowerCase().replace(/[_-]+/g, ' ');
const path = id => '#history/' + encodeURIComponent(id);
const empty = message => '<p class="empty workspace-empty">' + esc(message) + '</p>';
const caption = (name, value) => text(value) ? '<div><dt>' + esc(name) + '</dt><dd>' + esc(value) + '</dd></div>' : '';
const format = new Intl.DateTimeFormat('en-US', {year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZone:'America/Los_Angeles', timeZoneName:'short'});
const stamp = row => row.verifiedAt || row.observedAt || row.checkedAt || row.at;
const instant = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const date = value => instant(value) ? '<time datetime="' + esc(value) + '">' + esc(format.format(new Date(value))) + '</time>' : '';
const kinds = {all:'All deliverables', document:'Documents & drafts', prototype:'Features & previews', package:'Packages', research:'Research & scorecards', other:'Other results'};
const finished = new Set(['completed','verified','resolved','denied','declined','approved','closed','owner skipped','skipped','superseded','cancelled','canceled','deferred','published and verified']);
const verified = row => ['completed','verified'].includes(lower(row.status));

function safeLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}
function artifactLink(value, label) {
  const url = safeLink(value);
  return url ? '<a class="thread" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>' : '';
}
function kindOf(row) {
  const explicit = lower(row.deliverableType || row.artifactType);
  if (Object.hasOwn(kinds, explicit) && explicit !== 'all') return explicit;
  const file = lower([row.artifactName, row.latestArtifactName, safeLink(row.artifactUrl).split('?')[0]].filter(Boolean).join(' '));
  const subject = lower([row.specialistName, row.intendedOutcome, row.summary].filter(Boolean).join(' '));
  if (/\.zip\b/.test(file)) return 'package';
  if (/\.pdf\b|\.docx?\b|\.md\b/.test(file)) return 'document';
  if (/\.html?\b/.test(file)) return 'prototype';
  if (/btc (model|prediction)|forecast|brier|held.out|settled (pairs|rounds)/.test(subject)) return 'research';
  if (/draft|pdf|caption|interview|outreach|one.page|linkedin (note|featured)/.test(subject)) return 'document';
  if (/prototype|preview|workflow|import|export|html|application tracker|dashboard|portfolio|cohort|pilot/.test(subject)) return 'prototype';
  return 'other';
}
function availability(row) {
  const value = lower(row.releaseStatus || row.publicationStatus);
  if (['live','published','deployed'].includes(value)) return 'Published';
  if (safeLink(row.artifactUrl).startsWith('https://chatgpt.com/library') || /private|offline|unpublished/i.test([row.constraints,row.limitations,value].join(' '))) return 'Private artifact';
  return 'Publication unconfirmed';
}
function credits(row) {
  const people = list(row.executors).filter(x => text(x.id || x.executorId));
  if (text(row.executorId) && !people.some(x => (x.id || x.executorId) === row.executorId)) people.unshift({id:row.executorId});
  if (!people.length) return '<p>Executor unrecorded</p>';
  return '<ul class="workspace-credits">' + people.map(person => {
    const id = person.id || person.executorId;
    const note = person.contribution && person.contribution !== row.summary ? '<span> '+ esc(person.contribution) + '</span>' : '';
    const url = safeLink(person.artifactUrl);
    const result = url && url !== safeLink(row.artifactUrl || row.reviewUrl) ? ' ' + artifactLink(url,'Contribution') : '';
    return '<li><strong>' + esc(workerName(id)) + '</strong>' + (id === row.executorId ? ' · Lead' : '') + note + result + '</li>';
  }).join('') + '</ul>';
}
function historyRows(sector, records) {
  const entries = [...records, sector.workEvidence].filter(Boolean);
  const previous = sector.previousVerifiedResult;
  if (previous?.tag && !entries.some(row => row.tag === previous.tag && (row.artifactUrl || row.reviewUrl) === (previous.artifactUrl || previous.reviewUrl))) {
    entries.push({...previous,status:'verified'});
  }
  const rows = entries.filter(row => row && text(row.tag).slice(0, text(row.tag).lastIndexOf('-')) === sector.id && /^\d+$/.test(text(row.tag).split('-').at(-1)) && (text(row.summary) || text(row.evidence)) && !['queued','running','assigned','planned','owner skipped'].includes(lower(row.status)));
  rows.sort((a,b) => instant(stamp(b)) - instant(stamp(a)));
  const unique = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.tag, row.artifactUrl || row.reviewUrl, row.evidence || row.test || row.summary, row.status]);
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}
function historyDisplay(row) {
  const handles = new Set([row.executorId,...list(row.executors).map(person=>person.id || person.executorId)].filter(Boolean));
  const display = {...row};
  for (const field of ['summary','evidence','intendedOutcome','assignmentSummary','test','acceptanceTest','constraints','limitations','specialistName','source']) {
    if (typeof row[field]==='string') display[field]=workerMentions(row[field],handles);
  }
  display.executors=list(row.executors).map(person=>({...person,contribution:workerMentions(person.contribution,handles)}));
  return display;
}
function revision(row) {
  const status = row.verificationOnly ? 'Verification' : text(row.status);
  const result = artifactLink(row.artifactUrl || row.reviewUrl, verified(row) ? 'Open result' : 'Open partial evidence');
  return '<div class="workspace-revision"><p class="workspace-meta">' + [date(stamp(row)),esc(status),esc(availability(row))].filter(Boolean).join(' · ') + '</p>' +
    '<h3>' + esc(row.summary || row.evidence) + '</h3>' +
    '<dl class="workspace-fields">' + caption('Assignment brief',row.intendedOutcome || row.assignmentSummary || 'Assignment brief unrecorded') +
    '<div><dt>' + (row.verificationOnly ? 'Verified by' : 'Executor') + '</dt><dd>' + credits(row) + '</dd></div>' +
    caption('Specialist',row.specialistName) + caption('Execution source',row.source) +
    caption('Verification',row.test || row.evidence) + caption('Acceptance test',row.acceptanceTest) +
    caption('Limitations',row.limitations || row.constraints) + '</dl>' + (result ? '<div class="workspace-actions">' + result + '</div>' : '') + '</div>';
}
function sectorHistory(sector, rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.tag)) groups.set(row.tag,[]);
    groups.get(row.tag).push(row);
  }
  return '<a class="thread" href="#history">All sectors</a><h2 tabindex="-1">' + esc(sector.name) + '</h2><div class="workspace-timeline">' +
    ([...groups].map(([tag,items]) => '<article class="panel workspace-card"><p class="workspace-meta">' + esc(tag) + '</p>' + revision(items[0]) +
      (items.length > 1 ? '<details class="workspace-revisions"><summary>Earlier records (' + (items.length-1) + ')</summary>' + items.slice(1).map(revision).join('') + '</details>' : '') + '</article>').join('') || empty('No matching history for this sector.')) + '</div>';
}
function historyCard(sector, rows) {
  const recent = rows.find(row => verified(row) && safeLink(row.artifactUrl || row.reviewUrl));
  return '<article class="panel workspace-card"><h2><a href="' + path(sector.id) + '">' + esc(sector.name) + '</a></h2>' +
    (recent ? '<p class="workspace-meta">Latest verified result · ' + date(stamp(recent)) + '</p><p>' + esc(recent.summary || recent.evidence) + '</p>' +
      (text(recent.test || recent.evidence) ? '<p><strong>Verified</strong> · ' + esc(recent.test || recent.evidence) + '</p>' : '') : empty('No matching verified deliverable.')) +
    '<div class="workspace-actions"><a class="thread" href="' + path(sector.id) + '">View history</a>' + (recent ? artifactLink(recent.artifactUrl || recent.reviewUrl,'Open latest result') : '') + '</div></article>';
}
function ownerDecision(item) {
  const status = lower(item.status);
  if (finished.has(status)) return false;
  const decision = item.ownerDecision || item.approval || {};
  if (finished.has(lower(decision.status))) return false;
  const approver = text(decision.approver || item.approver || decision.owner || item.decisionOwner);
  if (approver && !/^(brian( uong)?|owner)$/i.test(approver)) return false;
  if (['needs brian','awaiting owner decision','waiting for owner','awaiting owner approval','waiting for brian'].includes(status)) return true;
  if (['awaiting approval','pending approval','waiting for approval','approval required'].includes(status) && approver) return true;
  if (item.requiresOwnerApproval === true || item.requiresOwnerDecision === true || item.ownerDecisionRequired === true) return true;
  return Boolean((item.ownerDecision || approver) && ['pending','open','requested','awaiting decision'].includes(lower(decision.status)));
}
const stationProjects = new Set(['orbital', 'orbital station', 'orbital agent station', 'orbital build', 'orbital ui/ux']);
const stationProject = row => stationProjects.has(lower(row.projectId || row.project || row.projectName));
function sectorPlan(sector, now) {
  const byTag = new Map();
  function add(row, fallbackLane) {
    if (!row || !text(row.task || row.intendedOutcome || row.question || row.ownerDecision?.question || row.approval?.question)) return;
    if (row.displayOnly && stationProject(row)) return;
    const status = lower(row.status);
    if (finished.has(status)) return;
    const tag = text(row.tag || row.assignmentId);
    if (tag && tag === sector.assignmentId && finished.has(lower(sector.assignmentStatus || sector.status))) return;
    const key = tag || text(row.task || row.question || row.ownerDecision?.question || row.approval?.question);
    const decision = ownerDecision(row);
    let lane = fallbackLane;
    let reason = '';
    if (decision) { lane = 'Waiting'; reason = 'Owner decision'; }
    else if (status === 'blocked' || row.blocker) {
      lane = 'Waiting';
      const dependency = lower(row.dependencyType || row.blocker || row.dependency);
      reason = /missing (source|input|evidence)|source (material |file )?(missing|unavailable)/.test(dependency) ? 'Missing source' : 'Blocked';
    }
    else if (status === 'waiting' || /approval|decision/.test(status)) {
      lane = 'Waiting';
      const dependency = lower([row.dependencyType,row.waitingFor,row.dependency,row.task].filter(Boolean).join(' '));
      if (/missing (source|input|evidence)|source (material |file )?(missing|unavailable)/.test(dependency)) reason = 'Missing source';
      else if (/settle|next round|due date|observation window|external data/.test(dependency)) reason = 'Scheduled wait';
      else reason = 'Awaiting dependency';
    }
    else if (['queued','planned'].includes(status)) lane = 'Next';
    else if (['running','working','in progress'].includes(status)) {
      const t = instant(row.observedAt || row.startedAt);
      const active = t && now >= t && now - t < 300000;
      lane = active ? 'Current' : 'Waiting';
      reason = active ? '' : 'Awaiting fresh progress';
    }
    const item = {row, sector, tag, lane, reason, decision};
    if (!byTag.has(key) || decision) byTag.set(key,item);
  }
  if (!finished.has(lower(sector.assignmentStatus || sector.status))) {
    const live = sector.liveActivity || {};
    add({tag:sector.assignmentId, task:sector.task, status:sector.assignmentStatus || sector.status,
      acceptanceTest:sector.workAcceptance, blocker:sector.blocker, observedAt:live.observedAt || sector.workStartedAt,
      requiresOwnerApproval:sector.requiresOwnerApproval, ownerDecisionRequired:sector.ownerDecisionRequired, ownerDecision:sector.ownerDecision, approver:sector.approver, approval:sector.approval,
      partialEvidenceUrl:sector.partialEvidenceUrl}, 'Current');
  }
  add(sector.pendingAssignment,'Current');
  add(sector.queuedFollowup,'Next');
  add(sector.researchFollowup,'Next');
  return [...byTag.values()];
}

function planEntry(item) {
  const {row,tag,reason} = item;
  const approval = row.ownerDecision || row.approval || {};
  const title = text(approval.question) || row.question || row.task || row.intendedOutcome;
  const evidence = safeLink(row.partialEvidenceUrl || approval.evidenceUrl || row.evidenceUrl || row.input);
  const review = artifactLink(evidence,'Review evidence');
  const skip = item.skippable
    ? '<button type="button" data-skip-sector="'+esc(item.sector.id)+'" data-skip-slot="'+esc(skipSlots.find(k=>item.sector[k]===row))+'" data-skip-tag="'+esc(tag)+'">Skip next item</button>'
    : '';
  const actions = review || skip ? '<div class="plan-actions">' + review + skip + '</div>' : '';
  return '<div class="workspace-entry"><p class="workspace-meta">' + [esc(tag),esc(reason)].filter(Boolean).join(' · ') + '</p><h4>' + esc(title) + '</h4>' +
    '<dl class="workspace-fields">' + caption('Dependency',row.blocker || row.dependency || row.waitingFor) +
    caption('Why this needs you',approval.reason || row.decisionReason) + caption('After your decision',approval.nextAction || row.nextAction) +
    caption('Acceptance test',row.acceptanceTest) + '</dl>' + actions + '</div>';
}
function skipControls(plans, allowSkip) {
  const intro = '<section class="panel workspace-card" aria-labelledby="skipHeading"><h2 id="skipHeading">Skip a planned item</h2>';
  if (!allowSkip) {
    return intro + '<p>Sign in as the owner on the live Roadmap to skip a planned item.</p></section>';
  }
  const eligible = plans.flat().filter(item => item.skippable);
  if (!eligible.length) {
    return intro + '<p>No unclaimed planned items are available to skip.</p></section>';
  }
  const options = eligible.map(({sector, row, tag}) => {
    const slot = skipSlots.find(key => sector[key] === row);
    const title = [sector.name, tag, row.task].map(esc).join(' · ');
    return '<option value="' + esc(tag) + '" data-skip-sector="' + esc(sector.id) +
      '" data-skip-slot="' + esc(slot) + '" data-skip-tag="' + esc(tag) + '">' + title + '</option>';
  });
  return intro + '<div class="skip-controls" data-skip-controls><label for="skipChoice">Planned item</label>' +
    '<select id="skipChoice"><option value="">Choose an item</option>' + options.join('') + '</select>' +
    '<button class="thread" type="button" data-skip-picker>Skip selected item</button></div></section>';
}

function roadmapCard(sector, items) {
  return '<article class="panel workspace-card"><h2>' + esc(sector.name) + '</h2><div class="workspace-lanes">' +
    ['Current','Next','Waiting'].map(lane => '<section><h3>' + lane + '</h3>' + (items.filter(i => i.lane === lane).map(planEntry).join('') || empty('None recorded.')) + '</section>').join('') + '</div></article>';
}
function waitingDependency({row,tag,reason}) {
  const title = text(row.title) || text(row.task || row.intendedOutcome || row.question) || tag;
  const detail = text(row.blocker || row.dependency || row.waitingFor);
  const evidence = artifactLink(row.partialEvidenceUrl || row.evidenceUrl || row.input,'Review evidence');
  return '<li><span class="wait-reason">'+esc(reason)+'</span><p class="wait-task">'+esc(title)+'</p>' +
    (detail && detail !== title ? '<p class="wait-note">'+esc(detail)+'</p>' : '') + evidence + '</li>';
}
function waitingItems(sectors, items, decisions) {
  const group = name => ({name, decisions:[], dependencies:[]});
  const groups = new Map(sectors.map(s => ['sector/'+s.id,group(s.name)]));
  for (const review of decisions) {
    const sector = sectors[review.order];
    const key = sector ? 'sector/'+sector.id : 'project/'+review.project;
    if (!groups.has(key)) groups.set(key,group(review.project));
    groups.get(key).decisions.push(review);
  }
  for (const item of items) {
    if (!item.decision && !(item.row.displayOnly && item.row.reviewIds?.length)) {
      groups.get('sector/'+item.sector.id).dependencies.push(item);
    }
  }
  const rows = [];
  for (const [key,{name,decisions:reviews,dependencies}] of groups) {
    if (!reviews.length && !dependencies.length) continue;
    const counts = [];
    if (reviews.length) counts.push(reviews.length+(reviews.length === 1 ? ' decision' : ' decisions'));
    if (dependencies.length) counts.push(dependencies.length+(dependencies.length === 1 ? ' dependency' : ' dependencies'));
    const reviewList = reviews.map(r => '<li><a href="#needs/'+encodeURIComponent(r.key)+'">'+esc(r.title || r.id)+'</a></li>').join('');
    rows.push('<li><details name="command-waits" data-wait-key="'+esc(key)+'"><summary>' +
      '<span class="wait-project">'+esc(name)+'</span><span class="wait-count">'+counts.join(' · ')+'</span></summary>' +
      '<div class="wait-content">'+(reviewList ? '<section><h3>Needs Brian</h3><ul class="wait-reviews">'+reviewList+'</ul></section>' : '') +
      (dependencies.length ? '<section><h3>Project dependencies</h3><ul class="wait-dependencies">'+dependencies.map(waitingDependency).join('')+'</ul></section>' : '') +
      '</div></details></li>');
  }
  return rows.length ? '<ul role="list" class="wait-list" aria-label="Projects with waiting work">'+rows.join('')+'</ul>' : empty('No work is waiting.');
}
function decisionInbox(sectors, records, waiting) {
  const projects = new Map(sectors.flatMap((sector,order) => {
    const label = {name:sector.name, order};
    return [[lower(sector.id),label],[lower(sector.name),label]];
  }));
  const registry = new Map(list(records).filter(r => text(r.id)).map(r => [r.id,r]));
  const entries = new Map();
  const mirror = new Map();
  for (const item of waiting.filter(item => item.decision)) {
    const row = item.row;
    const reviewIds = Array.isArray(row.reviewIds) ? row.reviewIds.filter(id => text(id)) : [];
    for (const id of reviewIds) mirror.set(id,item);
    if (reviewIds.length && reviewIds.every(id => registry.has(id))) continue;
    const ids = reviewIds.length ? reviewIds.filter(id => !registry.has(id)) : [item.tag || row.task];
    for (const id of ids) {
      if (registry.has(id)) continue;
      const project = projects.get(lower(row.project || item.sector.id));
      const decision = row.ownerDecision || row.approval || {};
      const key = reviewIds.length ? 'review/'+id : item.sector.id+'/'+id;
      entries.set(key,{key, id:reviewIds.length ? id : item.tag || id, project:project?.name || text(row.project) || item.sector.name,
        order:project?.order ?? sectors.length, title:decision.question || row.question || row.task || row.intendedOutcome,
        action:decision.reason || row.decisionReason || row.blocker, next:decision.nextAction || row.nextAction,
        test:row.acceptanceTest, evidence:safeLink(row.partialEvidenceUrl || decision.evidenceUrl || row.evidenceUrl || row.input)});
    }
  }
  for (const [id,row] of registry) {
    if ((row.approvalId && row.status !== 'awaiting owner approval') || stationProject(row) || row.approvalRequired === false || row.releaseMode === 'automatic' || !ownerDecision(row)) continue;
    const fallback = mirror.get(id);
    const projectKey = text(row.project || row.projectId || fallback?.row.project || fallback?.sector.id);
    const project = projects.get(lower(projectKey));
    const primary = [row.artifactUrl,row.diffUrl,row.evidenceUrl,row.ownerDecision?.evidenceUrl,
      ...list(row.sources).map(source=>source.url)].map(safeLink).find(Boolean);
    const register = safeLink(row.registerUrl || fallback?.row.ownerDecision?.evidenceUrl);
    entries.set('review/'+id,{key:'review/'+id,id,project:project?.name || text(row.projectName) || projectKey || 'Unassigned',
      canApprove:!!(row.action && row.destination), order:project?.order ?? sectors.length, title:text(row.title) || text(row.ownerDecision?.question) || id,
      action:row.action || row.ownerDecision?.reason, destination:row.destination, notes:row.limitations,
      next:row.ownerDecision?.nextAction || row.liveImpact, test:row.test || row.acceptanceTest,
      evidence:primary || register, register:primary && register !== primary ? register : ''});
  }
  // Keep the recorded order within each project, including after a refresh.
  return [...entries.values()].sort((a,b)=>a.order-b.order);
}
function decisionList(rows, allowApproval) {
  if (!rows.length) return empty('No decisions need your input.');
  const entries = rows.map((row,i) => {
    const body = caption('Requested action',row.action) + caption('Destination',row.destination) +
      caption('Review notes',row.notes) + caption('Verification',row.test) + caption('After your decision',row.next);
    const links = artifactLink(row.evidence,'Review evidence') + artifactLink(row.register,'Open review entry');
    const action = allowApproval && row.canApprove ? '<div class="approval-actions"><button type="button" data-approve-review="'+esc(row.id)+'">Approve and queue push</button><p>The next hourly check validates this revision and publishes the approved change. Progress appears here.</p></div>' : '';
    return '<li><details name="owner-decisions" data-decision-key="'+esc(row.key)+'"><summary>' +
      '<span class="decision-number" aria-hidden="true">'+(i+1)+'</span><span class="decision-title">'+esc(row.title)+'</span>' +
      '<span class="decision-project">'+esc(row.project)+'</span><span class="decision-toggle" aria-hidden="true"></span></summary>' +
      '<div class="decision-detail"><p class="decision-ref">Review ID <strong>'+esc(row.id)+'</strong></p>' +
      (body ? '<dl>'+body+'</dl>' : '') + (links ? '<div class="decision-links">'+links+'</div>' : '') + action + '</div></details></li>';
  });
  return '<p class="decision-total">'+rows.length+' pending '+(rows.length===1?'decision':'decisions')+'</p>' +
    '<ol role="list" class="decision-list" aria-label="Pending decisions">'+entries.join('')+'</ol>';
}
export function workspaceViews(snapshot, {sectorId = '', kind = 'all', now = Date.now(), allowSkip = false} = {}) {
  const sectors = list(snapshot?.agents).filter(a => text(a.id) && text(a.name) && (!a.sourceType || a.sourceType === 'sector'));
  const activeKind = Object.hasOwn(kinds,kind) ? kind : 'all';
  const plans = sectors.map(a => sectorPlan(a,Number(now)));
  const waiting = plans.flat().filter(i => i.lane === 'Waiting');
  const decisions = decisionInbox(sectors,snapshot?.commandCenter?.execution?.releaseReviews,waiting);
  // The sidebar only needs the count. Build each screen on its first visit
  // and reuse it for the lifetime of this snapshot and filter selection.
  let historyHtml, roadmapHtml, decisionsHtml, waitingHtml;
  return {
    get history() {
      if (historyHtml !== undefined) return historyHtml;
      const records = list(snapshot?.commandCenter?.execution?.workRuns);
      const rowsFor = sector => historyRows(sector,records).filter(row => activeKind === 'all' || kindOf(row) === activeKind).map(historyDisplay);
      const selected = sectors.find(sector => sector.id === sectorId);
      historyHtml = selected ? sectorHistory(selected,rowsFor(selected)) :
        '<div class="workspace-grid">' + sectors.map(sector => historyCard(sector,rowsFor(sector))).join('') + '</div>';
      return historyHtml;
    },
    get roadmap() {
      if (roadmapHtml !== undefined) return roadmapHtml;
      if (allowSkip) {
        for (const item of plans.flat()) {
          item.skippable = item.lane === 'Next' && canSkip(snapshot,item.sector,item.row);
        }
      }
      roadmapHtml = skipControls(plans,allowSkip) + '<div class="workspace-timeline">' + sectors.map((a,i) => roadmapCard(a,plans[i])).join('') + '</div>';
      return roadmapHtml;
    },
    get decisions() {
      if (decisionsHtml !== undefined) return decisionsHtml;
      const releases = list(snapshot?.commandCenter?.execution?.releaseReviews).filter(r=>r.approvalId);
      const progress = releases.length ? '<section class="release-progress"><h2>Approved releases</h2><ul>'+releases.map(r=>
        '<li><h3>'+esc(r.title || r.id)+'</h3><p>'+esc(r.status)+'</p><p>'+esc(r.releaseProgress || r.releaseError || '')+'</p>'+artifactLink(r.liveUrl || r.prUrl || r.githubUrl,'Open published result')+'</li>').join('')+'</ul></section>' : '';
      return decisionsHtml = decisionList(decisions,allowSkip)+progress;
    },
    get waiting() { return waitingHtml ??= waitingItems(sectors,waiting,decisions); },
    count:decisions.length,
    filters:Object.entries(kinds).map(([value,label]) => '<option value="' + value + '"' + (value === activeKind ? ' selected' : '') + '>' + label + '</option>').join('')
  };
}

