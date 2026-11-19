import {readFile,rename,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const [statePath,htmlPath]=process.argv.slice(2);
if (!statePath || !htmlPath) throw Error('Usage: node scripts/refresh-report.mjs <updated-state.json> <existing-Orbital.html>');
const state=JSON.parse(await readFile(statePath,'utf8'));
if (!Array.isArray(state.agents) || !Array.isArray(state.events) || !Number.isFinite(Date.parse(state.updatedAt))) throw Error('Invalid state');
const input=await readFile(htmlPath,'utf8');
const pattern=/(<script id="orbital-snapshot" type="application\/json">)([\s\S]*?)(<\/script>)/g;
const matches=[...input.matchAll(pattern)];
if (matches.length!==1) throw Error('Expected exactly one report data element');
const old = JSON.parse(matches[0][2]);
if (Date.parse(old.updatedAt)>Date.parse(state.updatedAt)) throw Error('The report already contains newer data');
const safeJson=JSON.stringify(state).replace(/</g,'\\u003c');
const output=input.replace(pattern,(_,open,data,close)=>open+safeJson+close);
const temporary=htmlPath+'.'+randomUUID()+'.tmp';
await writeFile(temporary,output);
await rename(temporary,htmlPath);
console.log('Updated the saved observation for ' + state.agents.length + ' agents.');
