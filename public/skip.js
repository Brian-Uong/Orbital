export const skipSlots = ['queuedFollowup', 'researchFollowup', 'pendingAssignment'];
const skipId = (sectorId, tag) => 'owner-skip/' + sectorId + '/' + tag;
const skipRows = (snapshot) => snapshot?.commandCenter?.execution?.ownerSkips || [];
const skipKey = (row) => JSON.stringify([row?.tag, row?.task, row?.input || '', row?.acceptanceTest || '']);
export function canSkip(snapshot, sector, row) {
  if (!sector || !row || !skipSlots.some(slot => sector[slot] === row)) return false;
  if (!['planned','queued'].includes(row.status) || typeof row.tag !== 'string' || !row.task) return false;
  if (!row.tag.startsWith(sector.id + '-') || !/^[0-9]{3,}$/.test(row.tag.slice(sector.id.length + 1))) return false;
  if (sector.workEvidence?.tag === row.tag || sector.liveActivity?.tag === row.tag) return false;
  if (row.claimId || row.partialEvidenceUrl || row.blocker || row.startedAt || row.partialEvidence || row.requiresOwnerApproval || row.requiresOwnerDecision || row.ownerDecisionRequired || row.ownerDecision || row.approval) return false;
  const ledger = snapshot.commandCenter?.execution || {};
  if (skipRows(snapshot).some(x => x.id === skipId(sector.id,row.tag))) return false;
  if (sector.assignmentId === row.tag && !['queued','planned'].includes(sector.assignmentStatus)) return false;
  return ![...(ledger.workerEvents || []), ...(ledger.workRuns || [])].some(x => x.tag === row.tag);
}
export function ownerSkip(snapshot, sectorId, expected, now, slot = null) {
  const id = skipId(sectorId, expected.tag);
  if (skipRows(snapshot).some(x => x.id === id)) return snapshot;
  const sector = snapshot.agents.find(a => a.id === sectorId);
  const slots = skipSlots.filter(k => sector?.[k]?.tag === expected.tag);
  if ((slot && !slots.includes(slot)) || !slots.length || slots.some(k => !canSkip(snapshot,sector,sector[k]) || skipKey(sector[k]) !== skipKey(expected)))
    throw new Error('This item has changed or already started. Review the current Roadmap.');
  const at = new Date(Math.max(now,Date.parse(snapshot.updatedAt)+1)).toISOString();
  const updated = {...sector};
  for (const slot of slots) updated[slot] = {...sector[slot],status:'owner-skipped',displayStatus:'owner-skipped'};
  if (updated.nextTask === expected.task) updated.nextTask = 'Awaiting the next assignment';
  if (updated.assignmentId === expected.tag) updated.assignmentStatus = 'owner-skipped';
  const receipt = {id,sectorId,tag:expected.tag,task:expected.task,slot:slot || slots[0],input:expected.input || '',acceptanceTest:expected.acceptanceTest || '',status:'owner-skipped',at,source:'Owner Roadmap'};
  const center = snapshot.commandCenter;
  const event = {id,agentId:sectorId,tag:expected.tag,at,title:'Owner skipped: '+expected.task,source:'Owner Roadmap'};
  return {...snapshot,updatedAt:at,agents:snapshot.agents.map(a=>a===sector?updated:a),
    commandCenter:{...center,execution:{...center.execution,ownerSkips:[...skipRows(snapshot),receipt]}},
    events:[event,...snapshot.events.filter(x=>x.id!==id)].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,100)};
}
