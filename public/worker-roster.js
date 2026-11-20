// Apply only after the existing access check and per-project identity resolution.
export function workerName(value) {
  if (typeof value !== 'string') return '';
  if (value === '/root') return 'Coordinator';
  return value.startsWith('/root/') ? value.slice(6) : value;
}

// Input is one resolved row per (projectId, executorId), taken from private
// Work evidence. hasOpenWork includes an accepted handoff or unfinished
// claim by this handle. Timed-out animation alone never ends an assignment.
export function rosterOffices(rows, roles) {
  const membership = new Map();
  const roleKeys = new Set();
  const key = (project, name) => JSON.stringify([project, name]);
  for (const role of roles) {
    const roleKey = key(role.project, role.displayName);
    roleKeys.add(roleKey);
    for (const handle of role.observedHandles || []) {
      const memberKey = key(role.project, handle);
      if (membership.has(memberKey) && membership.get(memberKey) !== roleKey) {
        membership.set(memberKey, null);
      } else if (!membership.has(memberKey)) membership.set(memberKey, roleKey);
    }
  }
  const activeRoles = new Set();
  const visible = [];
  const resting = new Map();
  for (const row of rows) {
    if (!row.projectId || !row.executorId) continue;
    const memberKey = key(row.projectId, row.executorId);
    const reportedRole = row.verifiedRole && key(row.projectId, row.verifiedRole);
    const role = reportedRole ? (roleKeys.has(reportedRole) ? reportedRole : null) : membership.get(memberKey);
    if (row.hasOpenWork || row.terminal !== true) {
      visible.push({ row, label: workerName(row.executorId), recurringRole: role && JSON.parse(role)[1] });
      if (role) activeRoles.add(role);
    } else if (role) {
      const previous = resting.get(role);
      if (!previous || (row.sortAt || 0) > (previous.sortAt || 0) ||
          (row.sortAt === previous.sortAt && row.executorId < previous.executorId)) resting.set(role, row);
    }
  }
  for (const [role, row] of resting) {
    if (!activeRoles.has(role)) visible.push({ row, label: JSON.parse(role)[1], recurringRole: JSON.parse(role)[1] });
  }
  return visible;
}
export function workerMentions(value, handles) {
  if (typeof value !== 'string' || !value.includes('/root')) return value;
  const known = handles instanceof Set ? handles : new Set(handles);
  // Only match a standalone, recorded Work handle in display text.
  return value.replace(/(^|[\s(\[·])((?:\/root)(?:\/[a-z0-9_-]+)*)(?=$|[\s)\]·,.;:!?])/gi,
    (token, before, handle) => known.has(handle) ? before + workerName(handle) : token);
}
