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
export function conversationFloors(snapshot, historyFloors, access) {
  if (!['owner', 'service'].includes(access)) return historyFloors;
  const center = snapshot?.commandCenter;
  const ledger = center?.execution;
  if (!center || !ledger) return [];
  const receipts = ledger.projectConversationReceipts || [];

  function floor(id, name, chats, archived = []) {
    const workers = chats.map(chat => {
      const url = originalChat(chat.url);
      const handle = 'chat:' + chat.name;
      const receipt = url && receipts.filter(r => r.messageId && r.threadTitle === chat.name &&
        r.threadUrl === url && r.project === id).sort((a,b) =>
          String(b.observedAt).localeCompare(String(a.observedAt)))[0];
      return {id:id + '/' + handle, handle, name:chat.name, projectId:id, projectName:name,
        conversation:true, role:chat.scope, chatUrl:url, active:false,
        status:url ? 'Idle' : 'Awaiting verified link', activity:receipt?.summary,
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
