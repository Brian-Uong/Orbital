import {readFile, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withSectorActivity} from './sector-activity.mjs';

const projectNames = new Set(['Professional', 'Product Design', 'Personal Dashboard', 'Personal Website', 'Financial Advice']);
const feedName = 'Orbital-Agent-State.json';

function isSectorSnapshot(value) {
  if (!value?.commandCenter || !Number.isFinite(Date.parse(value.updatedAt)) ||
      !Array.isArray(value.reports) || !Array.isArray(value.events) ||
      !Array.isArray(value.agents) || value.agents.length !== projectNames.size) return false;
  const ids = new Set(value.agents.map(agent => agent?.id));
  const names = new Set(value.agents.map(agent => agent?.name));
  return ids.size === projectNames.size && names.size === projectNames.size &&
    value.agents.every(agent => agent?.sourceType === 'sector' && typeof agent.id === 'string' &&
      agent.id.length > 0 && projectNames.has(agent.name));
}

async function loadSnapshot(path) {
  try {
    if ((await stat(path)).size > 32 * 1024 * 1024) return null;
    let json = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
    if (path.toLowerCase().endsWith('.html')) {
      const match = json.match(/<script id="orbital-snapshot" type="application\/json">([\s\S]*?)<\/script>/);
      if (!match) return null;
      json = match[1];
    }
    const snapshot = JSON.parse(json);
    return isSectorSnapshot(snapshot) ? snapshot : null;
  } catch {
    // A feed being replaced, unavailable, or still on the legacy schema is skipped.
    return null;
  }
}

export async function latestDesktopState(paths = [
  process.env.ORBIT_STATE_FILE,
  fileURLToPath(new URL('../' + feedName, import.meta.url)),
  fileURLToPath(new URL('../examples/station.json', import.meta.url))
]) {
  const candidates = await Promise.all([...new Set(paths.filter(Boolean))].map(loadSnapshot));
  const latest = candidates.filter(Boolean).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  return latest ? withSectorActivity(latest) : null;
}
