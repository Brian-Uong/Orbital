const localDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
});
const list = value => Array.isArray(value) ? value : [];

export function journalDay(value) {
  if (value == null || value === '' || !Number.isFinite(new Date(value).getTime())) return '';
  const parts = Object.fromEntries(localDate.formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

// Derive the private journal from immutable receipts on each accepted snapshot.
// Legacy events retain their original IDs. Retry aliases refer to the same message.
export function journalEvents(snapshot) {
  const center = snapshot.commandCenter || {};
  const ledger = center.execution || {};
  const result = [];
  const seen = new Set();
  const ids = new Set(list(snapshot.agents).map(a => a.id));
  ids.add(center.id);
  function add(row, aliases = []) {
    if (!row?.title || !ids.has(row.agentId)) return;
    const keys = [row.id, row.receiptId, ...aliases].filter(Boolean);
    const duplicate = keys.some(key => seen.has(key));
    keys.forEach(key => seen.add(key));
    if (!duplicate) result.push(row);
  }
  for (const row of list(snapshot.events)) add(row);
  const verdicts = new Map(list(ledger.evaluationReceipts).filter(r => r.messageId).map(r => [r.messageId, r]));
  const outputs = new Map(list(ledger.evaluationIntake).filter(r => r.producerReplyId).map(r => [r.producerReplyId, r]));
  for (const r of list(ledger.projectConversationReceipts)) {
    if (!r.id || !r.messageId || !r.threadTitle || !['reply','result'].includes(r.type || r.id.split('/')[0])) continue;
    const v = verdicts.get(r.messageId);
    const output = outputs.get(r.messageId);
    const label = v?.verdict === 'PASS' ? 'Evaluation passed' : v?.verdict === 'RETURN' ? 'Returned for changes' : 'Reply received';
    add({id:r.id, agentId:r.project, at:r.observedAt, executorId:r.threadTitle,
      title:r.threadTitle + ' · ' + label + (r.summary ? ' · ' + r.summary : ''),
      artifactUrl:output?.evidenceUrl || r.evidenceUrl || v?.evidenceUrl || r.threadUrl},
      ['result/' + r.tag + '/' + r.messageId, 'message/' + r.messageId]);
  }
  for (const r of list(ledger.workerEvents)) {
    if (r.type !== 'completed' || !r.id || !r.executorId || !r.activity) continue;
    add({id:r.id, agentId:r.projectId, at:r.at, executorId:r.executorId,
      title:r.executorId + ' · ' + r.activity, artifactUrl:r.artifactUrl});
  }
  for (const r of list(ledger.releaseReviews)) {
    if (!r.id || !r.verifiedAt || !['published and verified','review completed'].includes(r.status)) continue;
    add({id:'verified/' + (r.approvalId || r.id), agentId:r.project, at:r.verifiedAt,
      title:r.title + ' · ' + r.status, artifactUrl:r.prUrl || r.githubUrl || r.liveUrl || r.evidenceUrl});
  }
  for (const r of list(center.websiteImprovements?.backlog)) {
    if (r?.status !== 'published and verified' || !r.id || !r.githubUrl || !r.deploymentId) continue;
    const version = '/v' + r.siteVersion;
    add({id:'deployment/' + r.deploymentId, agentId:center.id, at:r.verifiedAt || r.completedAt,
      title:(r.owner || 'Station') + ' · ' + r.title, artifactUrl:r.githubUrl},
      ['station-release/' + r.id + version, 'station/' + r.id + '/' + r.revision + version]);
  }
  const order = r => Number.isFinite(Date.parse(r.at)) ? Date.parse(r.at) : -Infinity;
  return result.sort((a,b) => order(b) - order(a));
}

export function journalGroups(rows, now = Date.now()) {
  const today = journalDay(now);
  const groups = {today:[], previous:[], undated:[], future:[]};
  for (const row of rows) {
    const day = journalDay(row.at);
    if (!day) groups.undated.push(row);
    else if (day === today) groups.today.push(row);
    else if (day < today) groups.previous.push(row);
    else groups.future.push(row);
  }
  return groups;
}

export function journalMarkup(rows, now, renderEvents) {
  const groups = journalGroups(rows, now);
  const section = (label, entries) => entries.length ? '<h3>' + label + '</h3>' + renderEvents(entries) : '';
  const archived = [...groups.previous, ...groups.undated];
  const previous = archived.length ? '<details class="journal-archive"><summary>Previous days <span>' +
    archived.length + '</span></summary>' + renderEvents(archived) + '</details>' : '';
  return '<h3>Today</h3>' + (groups.today.length ? renderEvents(groups.today) : '<p class="empty">No activity recorded today.</p>') +
    previous + section('Future-dated records', groups.future);
}
