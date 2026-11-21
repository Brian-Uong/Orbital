// Shared by private cards and the coordinator's measurement readback.
export function observedTransitions(snapshot) {
  const ledger = snapshot?.commandCenter?.execution || {};
  const events = new Map();
  function add(event) {
    if (event?.id && event.stage && event.project && Number.isFinite(Date.parse(event.at)) && !events.has(event.id)) {
      events.set(event.id, event);
    }
  }
  for (const row of ledger.workflowTransitions || []) add(row);
  const reviews = new Map((ledger.releaseReviews || []).map(r => [r.id, r]));
  for (const agent of snapshot.agents || []) {
    for (const slot of ['pendingAssignment','queuedFollowup','researchFollowup']) {
      const item = agent[slot];
      if (item?.tag && item.readyAt) add({id:'ready/'+agent.id+'/'+item.tag, stage:'ready', project:agent.id, tag:item.tag, at:item.readyAt});
    }
  }
  for (const row of ledger.projectConversationReceipts || []) {
    if (!row.messageId || !row.threadUrl || !row.tag) continue;
    const type = row.type || row.id?.split('/')[0];
    let route;
    try { route=new URL(row.threadUrl); } catch { continue; }
    const evaluation = route.origin==='https://chatgpt.com' && ledger.evaluationGate?.path && route.pathname.endsWith(ledger.evaluationGate.path);
    const stage = type==='sent' ? (evaluation?'evaluation submitted':'handoff') :
      ['reply','result'].includes(type) ? 'reply' : undefined;
    add({id:row.id, stage, project:row.project, tag:row.tag, reviewId:row.reviewId, revision:row.artifactDigest, at:row.observedAt});
  }
  for (const row of ledger.evaluationReceipts || []) {
    if (!row.messageId || !['PASS','RETURN'].includes(row.verdict)) continue;
    add({id:'evaluation/'+row.messageId, stage:row.verdict, project:row.review?.project, reviewId:row.reviewId, revision:row.artifactDigest, at:row.at});
  }
  for (const row of [...(ledger.ownerApprovals || []), ...(ledger.ownerReviewResponses || [])]) {
    add({id:row.id, stage:row.decision || 'approved', project:row.review?.project, reviewId:row.reviewId, revision:row.review?.artifactDigest, at:row.at});
  }
  for (const row of reviews.values()) {
    const kind = row.status==='review completed' ? 'manual review' : row.status==='published and verified' ?
      (row.liveUrl?'deployment':row.prUrl?'pull request':row.githubUrl?'GitHub push':null) : null;
    if (kind && row.approvalId && !row.responseId) add({id:'verified/'+row.approvalId, stage:'completed', kind,
      project:row.project, reviewId:row.id, revision:row.artifactDigest, approvalId:row.approvalId, at:row.verifiedAt});
  }
  return [...events.values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}

export function waitAge(events, now=Date.now()) {
  const last=events.at(-1);
  if (!last) return 'Elapsed time unknown.';
  const minutes=Math.floor((now-Date.parse(last.at))/60000);
  if (minutes<0) return 'Elapsed time unknown.';
  const duration=minutes<60 ? minutes+' min' : Math.floor(minutes/60)+' h '+minutes%60+' min';
  return duration+' since '+last.stage+' · '+last.at;
}

export function windowMetrics(snapshot, start, end) {
  const all=observedTransitions(snapshot).filter(e=>Date.parse(e.at)<Date.parse(end));
  const events=all.filter(e=>Date.parse(e.at)>=Date.parse(start));
  function pairs(from,to,match) {
    const starts=events.filter(e=>e.stage===from), stops=events.filter(e=>e.stage===to);
    const durations=[], byKind={};
    let open=0;
    for (const a of starts) {
      const b=stops.find(b=>match(a,b) && Date.parse(b.at)>=Date.parse(a.at));
      if (!b) { open++; continue; }
      const ms=Date.parse(b.at)-Date.parse(a.at);
      durations.push(ms);
      (byKind[b.kind || to] ||= []).push(ms);
    }
    function stats(values) {
      const sorted=values.slice().sort((a,b)=>a-b),n=sorted.length;
      return {count:n, medianMs:n?(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2:null};
    }
    return {...stats(durations),open,missingStart:stops.filter(b=>!all.some(a=>a.stage===from && match(a,b) && Date.parse(a.at)<=Date.parse(b.at))).length,
      byKind:Object.fromEntries(Object.entries(byKind).map(([k,v])=>[k,stats(v)]))};
  }
  return {readyToHandoff:pairs('ready','handoff',(a,b)=>a.project===b.project && a.tag===b.tag),
    approvalToCompletion:pairs('approved','completed',(a,b)=>a.id===b.approvalId)};
}
