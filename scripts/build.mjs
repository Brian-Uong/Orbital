import {readFile, writeFile, mkdir, copyFile, readdir} from 'node:fs/promises';
import {extname, join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateProjectSnapshot} from '../src/project-state.js';

// Build a single private Sites Worker with no network or package installation.
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => readFile(join(root, name), 'utf8');
const seedPath = process.argv[2] || join(root, 'examples/station.json');
const seed = validateProjectSnapshot(JSON.parse((await readFile(seedPath, 'utf8')).replace(/^\uFEFF/, '')));
const types = new Map(Object.entries({
  '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
  '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml',
  '.woff2':'font/woff2', '.woff':'font/woff', '.avif':'image/avif', '.ico':'image/x-icon'
}));
const assets = {};
const publicRoot = join(root, 'public');
async function addFiles(directory) {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await addFiles(path);
      continue;
    }
    const mime = types.get(extname(path).toLowerCase());
    if (!entry.isFile() || !mime) continue;
    const key = '/' + relative(publicRoot, path).split(sep).join('/');
    const bytes = await readFile(path);
    const binary = !mime.startsWith('text/') && mime !== 'image/svg+xml';
    const etag = '"' + createHash('sha256').update(bytes).digest('hex') + '"';
    assets[key === '/index.html' ? '/' : key] = {body:bytes.toString(binary ? 'base64' : 'utf8'), binary, etag,
      type:mime + (binary ? '' : '; charset=utf-8')};
  }
}
await addFiles(publicRoot);
assets['/sync-guide'] = {body:await read('SYNC.md'), type:'text/plain; charset=utf-8'};
const sources = await read('src/sources.js');
const api = (await read('src/api.js')).replace(/^import [^\n]*from '\.\/sources\.js';\r?\n/m,'');
const skip = await read('public/skip.js');
const sector = (await read('src/project-state.js')).replace(/^import [^\n]*from '\.\/api\.js';\r?\n/m,'');
const projectState = sector.replace(/^import [^\n]*from '\.\.\/public\/skip\.js';\r?\n/m,'');
const worker = await read('src/worker.js');
const serverDir = join(root, 'dist', 'server');
const metadataDir = join(root, 'dist', '.openai');
await Promise.all([mkdir(serverDir,{recursive:true}), mkdir(metadataDir,{recursive:true})]);
await writeFile(join(serverDir,'index.js'), [sources, api, skip, projectState, 'const sectorSeed = '+JSON.stringify(seed)+';',
  'const siteAssets = '+JSON.stringify(assets)+';', worker].join('\n'));
const manifest = process.env.ORBIT_HOSTING_MANIFEST || join(root, 'examples', 'hosting.json');
await copyFile(manifest, join(metadataDir, 'hosting.json'));
console.log('Built the Orbital Worker with '+seed.agents.length+' sector records and '+Object.keys(assets).length+' UI assets.');
