function node(tag, label, className) {
  const element = document.createElement(tag);
  element.textContent = label;
  if (className) element.className = className;
  return element;
}
function chatLink(value) {
  try {
    const url = new URL(value);
    if (url.origin === 'https://chatgpt.com' && !url.username && !url.password && /\/c\/[a-f\d-]{36}\/?$/i.test(url.pathname)) return url.href;
  } catch {}
}
export function renderConversations(root, snapshot) {
  root.replaceChildren();
  root.hidden = !snapshot?.commandCenter?.execution?.evaluationGate;
  if (root.hidden) return;
  root.append(node('h3','Orbital Operations Coordinator'));
  const folders = node('div','','chat-folders');
  for (const sector of snapshot.agents.filter(a => a.sourceType === 'sector')) {
    const floor = node('section','','chat-folder');
    floor.append(node('h4',sector.name));
    for (const chat of (sector.folderAgents || []).filter(c=>c.name && c.nameSource && !c.workOnly)) {
      const url = chatLink(chat.url);
      const label = node(url ? 'a' : 'strong',chat.name);
      if (url) label.href = url;
      floor.append(label,node('small', chat.scope || 'Project conversation'));
      if (!url) floor.append(node('small', 'Awaiting verified link','chat-status'));
    }
    folders.append(floor);
  }
  const gate = snapshot.commandCenter.execution.evaluationGate;
  root.append(folders,node('strong',gate.name),node('p','Project results return to their original chat for repairs. A verified pass sends the reviewed revision to Needs Brian.'));
}
