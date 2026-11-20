import {createHash, randomUUID} from 'node:crypto';
import {readFile, rename, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual, parseArgs} from 'node:util';
import {validateProjectSnapshot} from '../src/project-state.js';

const fields = ['id','projectId','projectName','executorId','type','at','source','tag','activity','artifactUrl'];
const required = ['projectId','projectName','executorId','type','at','source'];

function toEvent(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
      required.some(key => typeof receipt[key] !== 'string' || !receipt[key].trim()) ||
      Object.keys(receipt).some(key => key !== 'observationKey' && !fields.includes(key))) {
    throw new Error('Supply only a structured worker lifecycle receipt with project, executor, source, type and observation time.');
  }
  // An observation key is the producer's immutable assignment/transition key,
  // not the snapshot revision or the time this transfer was retried.
  let id = receipt.id;
  if (id === undefined && typeof receipt.observationKey === 'string' && receipt.observationKey.trim()) {
    const identity = [receipt.projectId,receipt.executorId,receipt.observationKey,receipt.type];
    id = 'worker-' + createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  }
  if (typeof id !== 'string' || !id.trim()) throw new Error('A stable receipt id or observationKey is required.');
  const event = {id};
  for (const key of fields.slice(1)) {
    if (receipt[key] !== undefined) event[key] = receipt[key];
  }
  return event;
}

export function mergeWorkerReceipts(bytes, receipts, now = Date.now()) {
  if (!Array.isArray(receipts)) throw new Error('Expected a JSON array of worker receipts.');
  // latin1 maps JS character offsets one-to-one to byte offsets. The original
  // UTF-8 shell, BOM, line endings and optional desktop payload stay intact.
  const script = /<script\b(?=[^>]*\sid\s*=\s*["']orbital-snapshot["'])[^>]*>([\s\S]*?)<\/script\s*>/gid;
  const matches = [...bytes.toString('latin1').matchAll(script)];
  if (matches.length !== 1) throw new Error('Expected exactly one orbital-snapshot script.');
  const [start,end] = matches[0].indices[1];
  const original = bytes.subarray(start,end);
  const state = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));
  validateProjectSnapshot(state);
  const prior = state.commandCenter.execution?.workerEvents ?? [];
  const known = new Map(prior.map(event => [event.id,event]));
  const added = [];
  for (const receipt of receipts) {
    const next = toEvent(receipt);
    if (known.has(next.id)) {
      if (!isDeepStrictEqual(known.get(next.id),next)) throw new Error('Receipt ID conflicts with an existing observation.');
      continue;
    }
    added.push(next);
    known.set(next.id,next);
  }
  if (!added.length) return {html:bytes, state:original, added:0};
  state.commandCenter.execution ??= {};
  state.commandCenter.execution.workerEvents = [...prior,...added];
  state.updatedAt = new Date(Math.max(now,Date.parse(state.updatedAt)+1)).toISOString();
  validateProjectSnapshot(state);
  const json = Buffer.from(JSON.stringify(state).replace(/</g,'\\u003c'));
  return {html:Buffer.concat([bytes.subarray(0,start),json,bytes.subarray(end)]),state:json,added:added.length};
}

async function main() {
  const {values} = parseArgs({options:Object.fromEntries(
    ['snapshot','events','output','state'].map(name=>[name,{type:'string'}])
  )});
  if (['snapshot','events','output','state'].some(key=>!values[key])) {
    throw new Error('Usage: node scripts/record-worker-events.mjs --snapshot INPUT.html --events RECEIPTS.json --output OUTPUT.html --state TO_SYNC.json');
  }
  const paths = Object.values(values).map(value=>resolve(value));
  if (new Set(paths).size !== paths.length) throw new Error('Use distinct input and output file paths.');
  const bytes = await readFile(values.snapshot);
  const receipts = JSON.parse(await readFile(values.events,'utf8'));
  const result = mergeWorkerReceipts(bytes,receipts);
  // Stage both products before installing either. The caller advances the
  // canonical version only after this command has returned success.
  const suffix = '.'+randomUUID()+'.tmp';
  const htmlTemp = values.output+suffix, stateTemp = values.state+suffix;
  try {
    await writeFile(htmlTemp,result.html,{flag:'wx',mode:0o600});
    await writeFile(stateTemp,result.state,{flag:'wx',mode:0o600});
    await rename(stateTemp,values.state);
    await rename(htmlTemp,values.output);
  } finally {
    await Promise.all([rm(htmlTemp,{force:true}),rm(stateTemp,{force:true})]);
  }
  console.log(JSON.stringify({added:result.added}));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
