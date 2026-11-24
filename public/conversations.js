const sectorOrder = ['professional', 'product-design', 'personal-dashboard', 'personal-website', 'financial-advice'];

function originalChat(value) {
  try {
    const url = new URL(value);
    if (url.origin === 'https://chatgpt.com' && !url.username && !url.password &&
        /\/c\/[a-f\d-]{36}\/?$/i.test(url.pathname)) return url.href;
  } catch {}
}

// Private room assignments are persistent. A Work ledger entry can be opened
// from History without gaining a room in the illustrated building.
export function conversationFloors(snapshot, historyFloors, access, now=Date.now()) {
  if (!['owner', 'service'].includes(access)) return historyFloors;
  const center = snapshot?.commandCenter;
  const ledger = center?.execution;
  if (!center || !ledger) return [];
  const receipts = ledger.projectConversationReceipts || [];

  function floor(id, name, chats, archived = []) {
    const workers = chats.map(chat => {
      const url = originalChat(chat.url);
      const handle = 'chat:' + chat.name;
      const matches = url ? receipts.filter(r => r.messageId && r.threadTitle === chat.name &&
        r.threadUrl === url && (r.project === id || id === 'evaluation' && chat.name === ledger.evaluationGate?.name))
        .sort((a,b)=>String(b.observedAt).localeCompare(String(a.observedAt))) : [];
      const receipt = matches[0];
      const signal=matches.find(r=>['started','working','progress','idle','completed','verified','reply','result','blocked','failed'].includes(r.type || r.id?.split('/')[0]));
      const signalType=signal && (signal.type || signal.id?.split('/')[0]);
      const observed=Date.parse(signal?.observedAt), deadline=Math.min(observed+300000,signal?.expiresAt?Date.parse(signal.expiresAt):Infinity);
      const liveSignal=['started','working','progress'].includes(signalType);
      const active=Boolean(liveSignal && observed<=now && now<deadline);
      const status=!url?'Awaiting verified link':active?'Working':liveSignal?'Activity unconfirmed':
        ['blocked','failed'].includes(signalType)?signalType:'Idle';
      const type = r => r.type || r.id?.split('/')[0];
      const sent = matches.find(r => type(r)==='sent'), reply = matches.find(r => ['reply','result'].includes(type(r)));
      const verified = ledger.scheduledOriginalChatVerification;
      const scheduled = matches.find(r => r.messageId === verified?.replyMessageId && r.runId === verified.runId &&
        matches.some(s => s.messageId === verified.sentMessageId && s.runId === r.runId) &&
        verified.ownerEquality && verified.anonymousPrivacyVerified);
      const at = r => r && r.observedAt ? [r.observedAt,r.executionSource || (r.runId===scheduled?.runId && scheduled?'Scheduled Work':'mode unrecorded')].join(' · ') : 'Unrecorded';
      const evidence = [
        ['Last handoff',at(sent)], ['Last reply',at(reply)],
        ['Requested model / effort',[sent?.requestedModel || 'Unknown',sent?.requestedReasoningEffort || 'Unknown'].join(' / ')],
        ['Selected model / effort',[sent?.selectedModel || 'Unknown',sent?.selectedReasoningEffort || 'Unknown'].join(' / ')],
        ['Runtime model',reply?.actualModel || 'Unverified'], ['Verified unattended result',at(scheduled)]
      ];
      return {id:id + '/' + handle, handle, name:chat.name, projectId:id, projectName:name,
        conversation:true, evidence, role:chat.scope, chatUrl:url, active, expiresAt:active?new Date(deadline).toISOString():undefined,
        status, activity:receipt?.summary,
        observedAt:receipt?.observedAt, tag:receipt?.tag};
    });
    return {id, name, workers, allWorkers:[...workers, ...archived]};
  }

  const levels = [];
  const coordinator = center.coordinator;
  if (coordinator?.name) levels.push(floor('operations', coordinator.project || 'Operations', [{name:coordinator.name,
    scope:'Coordinates assignments and reviews.', url:coordinator.verifiedUrl}]));
  for (const id of sectorOrder) {
    const sector = snapshot.agents.find(a => a.sourceType === 'sector' && a.id === id);
    if (!sector) continue;
    const chats = (sector.folderAgents || []).filter(c => c.name && c.nameSource && !c.workOnly);
    if (!chats.length) continue;
    const history = historyFloors.find(f => f.id === id);
    const reference = sector.originalThreadReference;
    const occupants = chats.map(chat => {
      const verified = chat.name === reference?.threadTitle && chat.url === reference.threadUrl;
      const url = verified ? chat.url : chat.routeStatus === 'verified' && chat.verifiedUrl;
      return {...chat, url};
    });
    levels.push(floor(id, sector.name, occupants, history?.allWorkers || history?.workers));
  }
  const gate = ledger.evaluationGate;
  if (gate?.name) levels.push(floor('evaluation', coordinator?.project || 'Evaluation', [{name:gate.name,
    scope:'Checks each revision against its requirements.', url:gate.routeStatus === 'verified' && gate.verifiedUrl}]));
  return levels;
}

