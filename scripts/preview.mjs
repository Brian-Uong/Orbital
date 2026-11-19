import http from 'node:http';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {latestDesktopState} from './desktop-state.mjs';

const assets = new Map([
  ['/', ['public/index.html', 'text/html']],
  ['/index.html', ['public/index.html', 'text/html']],
  ['/app.js', ['public/app.js', 'text/javascript']],
  ['/station.js', ['public/station.js', 'text/javascript']],
  ['/orbital-city.webp', ['public/orbital-city.webp', 'image/webp']],
  ['/favicon.ico', ['public/favicon.ico', 'image/x-icon']],
  ['/orbit-v2.png', ['public/orbit-v2.png', 'image/png']],
  ['/style.css', ['public/style.css', 'text/css']],
  ['/sync-guide', ['SYNC.md', 'text/plain']]
]);
const server = http.createServer(async (req, res) => {
  try {
    const port = server.address().port;
    if (!['127.0.0.1:' + port, 'localhost:' + port].includes(req.headers.host)) {
      res.writeHead(403).end();
      return;
    }
    if (!['HEAD', 'GET'].includes(req.method)) {
      res.writeHead(405, {Allow: 'GET, HEAD'}).end();
      return;
    }
    const {pathname} = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (pathname === '/api/state') {
      const state = await latestDesktopState();
      res.writeHead(state ? 200 : 503, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(state ?? {error: 'No five-sector snapshot is available.'}));
      return;
    }
    const asset = assets.get(pathname);
    if (!asset) {
      res.writeHead(404).end();
      return;
    }
    const body = await readFile(new URL('../' + asset[0], import.meta.url));
    res.writeHead(200, {'Content-Type': asset[1] + '; charset=utf-8'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500).end('Orbital could not read the requested resource.');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'Orbital is already open, or another app uses this port. Set ORBIT_PORT to choose another port.' : error.message);
  process.exitCode = 1;
});
server.listen(Number(process.env.ORBIT_PORT || '4217'), '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + server.address().port;
  console.log('Orbital is running at ' + url);
  if (process.argv.includes('--open') && process.platform === 'win32') {
    execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], {windowsHide: true}, () => {});
  }
});
