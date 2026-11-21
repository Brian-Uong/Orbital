import { evaluationPassed } from './evaluation.js';
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
      (recent.intendedOutcome && recent.intendedOutcome !== recent.summary ? '<p><strong>Purpose</strong> · '+esc(recent.intendedOutcome)+'</p>' : '') +
      (recent.limitations ? '<p><strong>Limitations</strong> · '+esc(recent.limitations)+'</p>' : '') +
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
      partialEvidenceUrl:sector.partialEvidenceUrl, waitingDetails:sector.waitingDetails,
      waitingFor:sector.waitingFor, dependency:sector.dependency, dependencyType:sector.dependencyType,
      dependencyOwner:sector.dependencyOwner, ownerAction:sector.ownerAction, nextAction:sector.nextAction,
      nextCheckAt:sector.nextCheckAt, expectedAt:sector.expectedAt}, 'Current');
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

function roadmapCard(sector, items, snapshot, editable) {
  const paused=snapshot.commandCenter?.sectorControls?.[sector.id]?.paused===true;
  const globalPaused=snapshot.commandCenter?.workflowControl?.paused===true;
  const label=paused?'Sector paused':globalPaused?'Paused by global control':'Ready for hourly work';
  const controls='<div class="sector-control"><span class="sector-status'+(paused||globalPaused?' is-paused':'')+'">'+label+'</span>'+
    (editable?'<button type="button" data-sector-control="'+esc(sector.id)+'" data-paused="'+paused+'" aria-label="'+(paused?'Resume ':'Pause ')+esc(sector.name)+'">'+(paused?'Resume sector':'Pause sector')+'</button>':'')+'</div>';
  const note=paused?'Queued work stays here. Active work stops at its next safe checkpoint.':globalPaused?'This sector is enabled, but global Pause holds its work.':'Work is picked up on the next hourly check.';
  return '<article class="panel workspace-card"><div class="sector-heading"><h2>' + esc(sector.name) + '</h2>'+controls+'</div><p class="sector-control-note">'+note+'</p><div class="workspace-lanes">' +
    ['Current','Next','Waiting'].map(lane => '<section><h3>' + lane + '</h3>' + (items.filter(i => i.lane === lane).map(planEntry).join('') || empty('None recorded.')) + '</section>').join('') + '</div></article>';
}
function waitingExplanation({row,reason}) {
  const details=row.waitingDetails || {};
  const explicitNeed=text(details.needed) || text(row.waitingFor) || text(row.blocker) || text(row.dependency);
  const scheduled=reason==='Scheduled wait' || details.kind==='scheduled';
  const stale=reason==='Awaiting fresh progress';
  const observations=scheduled && /settle|next round|observation/i.test([row.task,row.waitingFor,row.dependency].filter(Boolean).join(' '));
  const needed=explicitNeed || (observations?'More settled rounds or observations for the planned evaluation.':
    scheduled?'The scheduled time or external data to become available.':
    stale?'A fresh progress report from the assigned worker.':'The specific missing requirement has not been recorded yet.');
  const owner=text(details.owner) || text(row.dependencyOwner) ||
    (scheduled?'External data or the scheduled time; coordinator checks availability.':
      stale?'Coordinator: verify the worker’s status.':'Coordinator: identify what is missing and who can provide it.');
  const action=text(details.ownerAction) || text(row.ownerAction) ||
    (scheduled?'No action from you is currently recorded.':
      stale?'No action from you is currently recorded. The coordinator needs to check progress.':
      'Not specified yet. The coordinator needs to provide an exact request before you can act.');
  const next=text(details.nextAction) || text(row.nextAction) ||
    (scheduled?'The coordinator checks availability on its hourly run and continues when the required data or time is available.':
      stale?'The coordinator checks whether work is running, completed, or blocked and updates this item.':
      'The coordinator must name the missing input, who provides it, and the step that unblocks this work.');
  return {needed,owner,action,next,expectedAt:details.expectedAt || row.expectedAt,
    nextCheckAt:row.nextCheckAt,label:scheduled?'Waiting for data or time':stale?'Progress needs checking':reason==='Missing source'?'Source material needed':'Input or access needed'};
}
function waitingDependency(item) {
  const {row,tag}=item;
  const title=text(row.title) || text(row.task || row.intendedOutcome || row.question) || tag;
  const detail=waitingExplanation(item);
  const evidence=artifactLink(row.partialEvidenceUrl || row.evidenceUrl || row.input,'Review evidence');
  const action=artifactLink(row.waitingDetails?.actionUrl || row.actionUrl,'Open required source');
  const timing=(instant(detail.expectedAt)?'<div><dt>Expected availability</dt><dd>'+date(detail.expectedAt)+'</dd></div>':'')+
    (instant(detail.nextCheckAt)?'<div><dt>Next recorded check</dt><dd>'+date(detail.nextCheckAt)+'</dd></div>':'');
  return '<li><span class="wait-reason">'+esc(detail.label)+'</span><p class="wait-task">'+esc(title)+'</p>'+
    '<dl class="wait-requirements">'+caption('What is needed',detail.needed)+caption('Who acts next',detail.owner)+
    caption('What you need to do',detail.action)+caption('Next step',detail.next)+timing+'</dl>'+
    (action || evidence?'<div class="wait-links">'+action+evidence+'</div>':'')+'</li>';
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
    if (dependencies.length) counts.push(dependencies.length+(dependencies.length === 1 ? ' waiting item' : ' waiting items'));
    const reviewList = reviews.map(r => '<li><a href="#needs/'+encodeURIComponent(r.key)+'">'+esc(r.title || r.id)+'</a></li>').join('');
    rows.push('<li><details name="command-waits" data-wait-key="'+esc(key)+'"><summary>' +
      '<span class="wait-project">'+esc(name)+'</span><span class="wait-count">'+counts.join(' · ')+'</span></summary>' +
      '<div class="wait-content">'+(reviewList ? '<section><h3>Needs Brian</h3><ul class="wait-reviews">'+reviewList+'</ul></section>' : '') +
      (dependencies.length ? '<section><h3>What this work is waiting for</h3><ul class="wait-dependencies">'+dependencies.map(waitingDependency).join('')+'</ul></section>' : '') +
      '</div></details></li>');
  }
  return rows.length ? '<ul role="list" class="wait-list" aria-label="Projects with waiting work">'+rows.join('')+'</ul>' : empty('No work is waiting.');
}
function reviewOutcome(row) {
  return text(row.proposedOutput) || text(row.revisionOutcome) || text(row.output) || text(row.summary) ||
    (Array.isArray(row.details) ? row.details : []).map(text).find(line => line && line !== row.destination && line !== row.limitations && line !== row.liveImpact) ||
    text(row.action);
}
function reviewFacts(row) {
  const check = row.latestPinnedCheck;
  const target = [row.targetBranch, row.baseCommit].filter(Boolean).join(' · ');
  return caption('What approval authorizes', row.proposedAction || row.action) +
    caption('Destination', row.destination) + caption('Effect on the live project', row.liveImpact) +
    caption('Test results', row.test || row.acceptanceTest) +
    (Number.isInteger(check?.nativePassing) ? caption('Latest independent check', check.nativePassing + ' native tests passed. ' + (check.scope || '')) : '') +
    caption('Limitations at review', row.limitations) + caption('Reviewed branch and base', target) +
    caption('Reviewed patch SHA-256', row.diffSha256);
}
const repairStatuses=new Set(['blocked','failed','needs work','needs changes','revision required','changes requested']);
function verifiedRelease(row) {
  return lower(row.status)==='published and verified' && Boolean(instant(row.verifiedAt) &&
    [row.liveUrl,row.prUrl,row.githubUrl].some(safeLink));
}
function revisedReview(receipt, releases) {
  const original = releases.find(row => row.id === receipt.reviewId);
  return releases.find(row => row.revisionOfResponseId === receipt.id && row.revisesReviewId === receipt.reviewId) ||
    releases.find(row => original?.responseId === receipt.id && row.id === original.revisionReviewId &&
      row.revisesReviewId === receipt.reviewId && !row.revisionOfResponseId);
}
function releaseLane(row) {
  const status=lower(row.status);
  if(['denied','declined','closed','cancelled','canceled','superseded','deferred'].includes(status))return 'archive';
  if(repairStatuses.has(status) || text(row.releaseError))return 'blocked';
  if(verifiedRelease(row))return 'published';
  if(['publishing','published','pushed','deployed','verifying','awaiting verification','published and verified'].includes(status))return 'publishing';
  if(row.approvalId && status!=='awaiting owner approval' || ['approved','approved queued','queued for release'].includes(status))return 'queued';
  if(row.responseId)return 'blocked';
  if(ownerDecision(row))return 'pending';
  return 'blocked';
}
function releaseDescription(row, {allowRepair=false, project=''}={}) {
  const lane=releaseLane(row),verified=lane==='published';
  const result=artifactLink(row.liveUrl,verified?'Open verified live site':'Open site (verification pending)')+
    artifactLink(row.prUrl,verified?'Open verified pull request':'Open pull request')+
    artifactLink(row.githubUrl,verified?'Open verified GitHub result':'Open GitHub result');
  const status=verified?(row.liveUrl?'Published and verified':row.prUrl?'Pull request pushed and verified; production deployment is not recorded':'GitHub push verified; production deployment is not recorded'):
    lane==='queued'?'Approved; waiting for the hourly coordinator':lane==='publishing'?'Publishing or awaiting verification':text(row.status) || 'Needs clarification';
  const facts=lane==='blocked'?'<dl class="wait-requirements">'+
    caption('What needs fixing',row.releaseError || row.blocker || row.waitingDetails?.needed || row.releaseProgress || 'The coordinator has not recorded the blocker yet.')+
    caption('Next step',row.repairAction || row.waitingDetails?.nextAction || row.nextAction || (row.responseId?'The requested revision is already queued. The coordinator will return it for approval.':'Use Fix and resubmit to give instructions. AI will prepare a new review on the next unpaused hourly run.'))+'</dl>':'';
  const controls=allowRepair && lane==='blocked' && !row.responseId &&
    ['blocked','failed','needs work','needs changes','revision required'].includes(row.status)?
    '<div class="review-buttons repair-actions"><button type="button" data-edit-review="'+esc(row.id)+'" data-fix-review>Fix and resubmit</button><button type="button" class="review-deny" data-deny-review="'+esc(row.id)+'">Deny</button></div>':'';
  const timestamp=verified?'<p class="workspace-meta">Verified '+date(row.verifiedAt)+'</p>':'';
  return '<article class="workspace-card panel release-card" data-release-id="'+esc(row.id)+'"><h3>'+esc(row.title || row.id)+'</h3>'+
    (project?'<p class="release-project">'+esc(project)+'</p>':'')+'<p>'+esc(reviewOutcome(row))+'</p>'+
    '<p class="release-state release-state-'+lane+'">'+esc(status)+'</p>'+timestamp+
    (row.releaseProgress && lane!=='blocked'?'<p>'+esc(row.releaseProgress)+'</p>':'')+facts+
    '<details><summary>Scope, tests and evidence</summary><dl class="workspace-fields">'+reviewFacts(row)+'</dl>'+
    artifactLink(row.diffUrl || row.evidenceUrl || row.artifactUrl || list(row.sources)[0]?.url,'Open reviewed evidence')+'</details>'+
    (result?'<div class="wait-links">'+result+'</div>':'')+controls+'</article>';
}
function releaseGroups(reviews,sectors,allowRepair) {
  const groups=[['blocked','Blocked or needs work','Resolve the blocker or request a revision. Changed work returns for your approval.'],
    ['queued','Approved and queued','Approved work waiting for the hourly coordinator. It has not been confirmed as pushed.'],
    ['publishing','Publishing or awaiting verification','A push may be in progress or recorded, but verified completion is still pending.'],
    ['published','Published and verified','Recorded completion with a verification timestamp and a result link. A verified pull request does not mean production was deployed.']];
  return groups.map(([key,title,description])=>{
    const rows=reviews.filter(r=>releaseLane(r)===key && !(r.responseId && reviews.some(c=>c.revisionOfResponseId===r.responseId)));
    return '<section class="release-group release-group-'+key+'" aria-labelledby="release-heading-'+key+'"><header><h2 id="release-heading-'+key+'">'+title+'</h2><span class="release-count">'+rows.length+'</span></header><p class="release-help">'+description+'</p>'+
      (rows.length?'<div class="release-list">'+rows.map(r=>{
        const p=sectors.find(s=>s.id===(r.project || r.projectId) || s.name===(r.project || r.projectId));
        return '<details class="release-item" data-decision-key="review/'+esc(r.id)+'"><summary><span>'+esc(r.title || r.id)+'</span><small>'+esc(p?.name || r.projectName || r.project || r.projectId || 'Project unrecorded')+'</small></summary>'+releaseDescription(r,{allowRepair,project:p?.name || r.projectName || r.project || r.projectId})+'</details>';
      }).join('')+'</div>':empty('No items in this section.'))+'</section>';
  }).join('');
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
    if (releaseLane(row)!=='pending' || row.responseId || (row.approvalId && row.status !== 'awaiting owner approval') || stationProject(row) || row.approvalRequired === false || row.releaseMode === 'automatic' || !ownerDecision(row)) continue;
    const fallback = mirror.get(id);
    const projectKey = text(row.project || row.projectId || fallback?.row.project || fallback?.sector.id);
    const project = projects.get(lower(projectKey));
    const primary = [row.artifactUrl,row.diffUrl,row.evidenceUrl,row.ownerDecision?.evidenceUrl,
      ...list(row.sources).map(source=>source.url)].map(safeLink).find(Boolean);
    const register = safeLink(row.registerUrl || fallback?.row.ownerDecision?.evidenceUrl);
    entries.set('review/'+id,{key:'review/'+id,id,project:project?.name || text(row.projectName) || projectKey || 'Unassigned',
      canRespond:true, canApprove:!!(row.action && row.destination), order:project?.order ?? sectors.length, title:text(row.title) || text(row.ownerDecision?.question) || id,
      record:row, outcome:reviewOutcome(row), action:row.action || row.ownerDecision?.reason, destination:row.destination, notes:row.limitations, output:row.proposedOutput || row.output || row.summary, revisionOf:row.revisesReviewId,
      next:row.ownerDecision?.nextAction || row.liveImpact, test:row.test || row.acceptanceTest,
      evidence:primary || register, register:primary && register !== primary ? register : ''});
  }
  // Keep the recorded order within each project, including after a refresh.
  return [...entries.values()].sort((a,b)=>a.order-b.order);
}
function decisionList(rows, allowApproval) {
  if (!rows.length) return empty('No decisions need your input.');
  const entries = rows.map((row,i) => {
    const body = row.record ? reviewFacts(row.record) + caption('Revises review',row.revisionOf) : caption('Requested action',row.action) + caption('Destination',row.destination) +
      caption('Proposed output',row.output) + caption('Revises review',row.revisionOf) + caption('Review notes',row.notes) + caption('Verification',row.test) + caption('After your decision',row.next);
    const links = artifactLink(row.evidence,'Review evidence') + artifactLink(row.register,'Open review entry');
    const action = allowApproval && row.canRespond ? '<div class="approval-actions"><div class="review-buttons">'+
      (row.canApprove ? '<button type="button" data-approve-review="'+esc(row.id)+'">Approve and queue push</button>' : '') +
      '<button type="button" class="review-edit" data-edit-review="'+esc(row.id)+'">Edit / request changes</button><button type="button" class="review-deny" data-deny-review="'+esc(row.id)+'">Deny</button></div><p>Approvals and requested revisions run at the next hourly check. Revisions return for your approval before publishing.</p></div>' : '';
    return '<li><details name="owner-decisions" data-decision-key="'+esc(row.key)+'"><summary>' +
      '<span class="decision-number" aria-hidden="true">'+(i+1)+'</span><span class="decision-title">'+esc(row.title)+(row.outcome && row.outcome!==row.title ? '<small class="review-outcome">'+esc(row.outcome)+'</small>' : '')+'</span>' +
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
  const ledger = snapshot?.commandCenter?.execution;
  const reviewed = list(ledger?.releaseReviews).filter(row => evaluationPassed(ledger,row));
  const decisions = decisionInbox(sectors,reviewed,ledger?.evaluationGate ? [] : waiting);
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
      const released=list(snapshot?.commandCenter?.execution?.releaseReviews).filter(row =>
        verifiedRelease(row) && !stationProject(row) && (!selected || row.project===selected.id || row.projectId===selected.id));
      if(released.length && activeKind==='all') historyHtml='<section><h2>Verified project releases</h2>'+released.map(releaseDescription).join('')+'</section>'+historyHtml;
      return historyHtml;
    },
    get roadmap() {
      if (roadmapHtml !== undefined) return roadmapHtml;
      if (allowSkip) {
        for (const item of plans.flat()) {
          item.skippable = item.lane === 'Next' && canSkip(snapshot,item.sector,item.row);
        }
      }
      roadmapHtml = skipControls(plans,allowSkip) + '<div class="workspace-timeline">' + sectors.map((a,i) => roadmapCard(a,plans[i],snapshot,allowSkip)).join('') + '</div>';
      return roadmapHtml;
    },
    get decisions() {
      if (decisionsHtml !== undefined) return decisionsHtml;
      const releases=list(snapshot?.commandCenter?.execution?.releaseReviews).filter(r=>{
        const approver=text(r.ownerDecision?.approver || r.approval?.approver || r.approver || r.decisionOwner);
        if (ledger?.evaluationGate && !r.approvalId && !r.responseId && ['pending','blocked'].includes(releaseLane(r)) && !evaluationPassed(ledger,r)) return false;
        return !stationProject(r) && r.approvalRequired!==false && r.releaseMode!=='automatic' && (!approver || /^(brian( uong)?|owner)$/i.test(approver));
      });
      const responses = list(snapshot?.commandCenter?.execution?.ownerReviewResponses);
      const revisions = responses.filter(receipt => receipt.decision === 'revise').map(receipt => ({
        receipt, original: releases.find(row => row.id === receipt.reviewId), revised: revisedReview(receipt,releases)
      }));
      const superseded = new Set(revisions.filter(item => item.revised).map(item => item.receipt.reviewId));
      const progress=releaseGroups(releases.filter(row => !superseded.has(row.id)),sectors,allowSkip);
      const resolved = item => item.revised && (verifiedRelease(item.revised) || releaseLane(item.revised) === 'archive');
      const groups = [
        ['Requested revisions', revisions.filter(item => !item.revised)],
        ['Revisions prepared', revisions.filter(item => item.revised && !resolved(item))],
        ['Resolved revision requests', revisions.filter(resolved)],
        ['Denied ideas', responses.filter(receipt => receipt.decision === 'deny').map(receipt => ({
          receipt, original: releases.find(row => row.id === receipt.reviewId)
        }))]
      ];
      const responseHistory = groups.map(([title,rows])=>{
        if(!rows.length)return '';
        return '<details class="release-progress response-history"><summary>'+title+' ('+rows.length+')</summary><ul>'+rows.map(({receipt,original,revised})=>{
          const outcome = revised ? (verifiedRelease(revised) ? 'Repair published and verified' : 'Revised result: '+text(revised.status)) :
            receipt.decision === 'deny' ? 'Declined by you' : original?.releaseError ? 'Repair blocked' : 'Awaiting repair';
          return '<li><h3>'+esc(receipt.review?.title || receipt.reviewId)+'</h3>'+date(receipt)+
            '<p><strong>'+esc(outcome)+'</strong></p><p>'+esc(revised?.releaseProgress || original?.releaseProgress || '')+'</p>'+
            (revised?'<a class="thread" href="#needs/'+encodeURIComponent('review/'+revised.id)+'">Open revised result '+esc(revised.id)+'</a>':
              '<dl>'+caption('What is needed',original?.releaseError || original?.waitingDetails?.needed)+
              caption('Next step',original?.repairAction || original?.waitingDetails?.nextAction)+'</dl>')+
            (receipt.editedOutput?'<h4>Your edited output</h4><p class="review-copy">'+esc(receipt.editedOutput)+'</p>':'')+
            (receipt.instructions?'<h4>Your instructions</h4><p class="review-copy">'+esc(receipt.instructions)+'</p>':'')+'</li>';
        }).join('')+'</ul></details>';
      }).join('');
      return decisionsHtml = '<section class="release-group release-group-pending"><header><h2>Awaiting your approval</h2><span class="release-count">'+decisions.length+'</span></header>'+decisionList(decisions,allowSkip)+'</section>'+progress+responseHistory;
    },
    get waiting() { return waitingHtml ??= waitingItems(sectors,waiting,decisions); },
    count:decisions.length,
    filters:Object.entries(kinds).map(([value,label]) => '<option value="' + value + '"' + (value === activeKind ? ' selected' : '') + '>' + label + '</option>').join('')
  };
}
