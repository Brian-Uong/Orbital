import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('the built Worker revalidates static bytes and keeps owner routes private', async t => {
  const root = await mkdtemp(join(tmpdir(),'orbital-assets-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  for (const dir of ['public','scripts','examples','.openai']) await mkdir(join(root,dir));
  for (const name of ['src','scripts/build.mjs','public/skip.js','public/evaluation.js','package.json']) {
    await cp(new URL('../'+name,import.meta.url),join(root,name),{recursive:true});
  }
  const names = ['Professional','Product Design','Personal Dashboard','Personal Website','Financial Advice'];
  const agents = names.map(name => ({id:name.toLowerCase().replaceAll(' ','-'),name,sourceType:'sector'}));
  const seed = {updatedAt:'2025-01-01T00:00:00Z',commandCenter:{},agents,events:[],reports:[]};
  const bytes = Buffer.from([0,127,200,255]);
  await Promise.all([
    writeFile(join(root,'sample.json'),JSON.stringify(seed)),
    writeFile(join(root,'public','index.html'),'<title>Sample</title>'),
    writeFile(join(root,'public','image.png'),bytes),
    writeFile(join(root,'.openai','hosting.json'),'{}'),
    writeFile(join(root,'examples','hosting.json'),'{}'),
    writeFile(join(root,'SYNC.md'),'Private example')
  ]);
  execFileSync(process.execPath,['scripts/build.mjs','sample.json'],{cwd:root});
  const {default:worker} = await import(pathToFileURL(join(root,'dist/server/index.js')));
  const get = (path,tag,method='GET') => worker.fetch(new Request('https://station.example'+path,{
    method,headers:tag?{'If-None-Match':tag}:{}
  }),{});
  const first = await get('/image.png');
  const tag = '"'+createHash('sha256').update(bytes).digest('hex')+'"';
  assert.equal(first.headers.get('ETag'),tag);
  assert.deepEqual(Buffer.from(await first.arrayBuffer()),bytes);
  for (const validator of [tag,'W/'+tag,'"old", W/'+tag,'*']) {
    const repeat = await get('/image.png',validator);
    assert.equal(repeat.status,304);
    assert.equal((await repeat.arrayBuffer()).byteLength,0);
    assert.equal(repeat.headers.get('ETag'),tag);
  }
  assert.equal((await get('/image.png','"old"')).status,200);
  assert.equal((await get('/image.png',tag,'HEAD')).status,304);
  assert.equal((await get('/image.png',null,'HEAD')).body,null);
  const shellTag = (await get('/')).headers.get('ETag');
  assert.equal((await get('/index.html',shellTag)).status,304);
  assert.equal((await get('/sync-guide','*')).status,403);
  assert.equal((await get('/missing','*')).status,404);
});
