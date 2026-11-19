import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [statePath,outputPath,desktopPath]=process.argv.slice(2);
if (!statePath || !outputPath || process.argv.length>5) {
  console.error('Usage: node scripts/standalone.mjs <state.json> <station.html> [desktop.zip]');
  process.exit(1);
}
const publicRoot=fileURLToPath(new URL('../public/',import.meta.url));
const [html,css,app,station,snapshot,desktop] = await Promise.all([
  ...['index.html','style.css','app.js','station.js'].map(name=>readFile(resolve(publicRoot,name),'utf8')),
  readFile(resolve(statePath),'utf8'),
  desktopPath ? readFile(resolve(desktopPath)) : null
]);
const data=JSON.parse(snapshot.replace(/^\uFEFF/,''));
if (!Array.isArray(data.agents) || !Array.isArray(data.events) || !Number.isFinite(Date.parse(data.updatedAt))) {
  throw new Error('Snapshot requires agents, events and an ISO update time.');
}
// JSON in an HTML raw text element must never contain an opening tag.
const safeJson=JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const importLine="import { mountStation } from './station.js';";
const exported='export function mountStation(';
if (!app.includes(importLine) || !station.includes(exported)) throw new Error('The station module entry point changed. Update the standalone bundler.');
const scene=station.replace(exported,'function mountStation(');
// A private lexical scope keeps the pixel renderer and dashboard palettes independent.
const javascript='(() => {\n"use strict";\nconst mountStation = (() => {\n'+scene+'\nreturn mountStation;\n})();\n'+app.replace(importLine,'')+'\n})();';
const marker='<script id="orbital-snapshot" type="application/json">'+safeJson+'</script>';
const archive=desktop ? '\n<script type="application/octet-stream" id="orbital-desktop">'+desktop.toString('base64')+'</script>' : '';
function replaceRequired(source,needle,replacement) {
  if(!source.includes(needle)) throw new Error('Missing HTML entry point '+needle);
  return source.replace(needle,()=>replacement);
}
let output=replaceRequired(html,'<link rel="stylesheet" href="/style.css">','<style>\n'+css+'\n</style>');
const iconBytes=(await readFile(resolve(publicRoot,'orbit-v2.png'))).toString('base64');
for (const [file,type] of [['favicon.ico','image/x-icon'],['orbit-v2.png','image/png']]) {
  output=replaceRequired(output,'href="/'+file+'"','href="data:'+type+';base64,'+(await readFile(resolve(publicRoot,file))).toString('base64')+'"');
}
output=output.replace('url(/orbit-v2.png)',()=> 'url(data:image/png;base64,'+iconBytes+')');
const city=(await readFile(resolve(publicRoot,'orbital-city.webp'))).toString('base64');
output=replaceRequired(output,'url(/orbital-city.webp)','url(data:image/webp;base64,'+city+')');
output=replaceRequired(output,'<script type="module" src="/app.js"></script>','');
const policy="<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'\">";
output=replaceRequired(output,'<meta charset="utf-8">','<meta charset="utf-8">\n  '+policy);
output=replaceRequired(output,'</body>',marker+archive+'\n<script>\n'+javascript.replace(/<\/script/gi,'<\\/script')+'\n</script>\n</body>');
await mkdir(dirname(resolve(outputPath)),{recursive:true});
await writeFile(resolve(outputPath),output,'utf8');
console.log('Standalone station generated with '+data.agents.length+' agents and '+data.events.length+' events.');
