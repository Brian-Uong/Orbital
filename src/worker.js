// The build provides sectorSeed and the hosted UI assets in this Worker module.
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/state') return handleProjectState(request, env, sectorSeed);
    if (path.startsWith('/api/')) return handleApi(request, env);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', {status:405});
    if (path === '/sync-guide' && !isStationOwner(request, env) &&
        !await matchesKey(request.headers.get('Orbit-Sync-Key'), env.ORBIT_SYNC_KEY_HASH)) {
      return new Response('Owner access required.', {status:403,headers:{'Cache-Control':'no-store'}});
    }
    const asset = siteAssets[path === '/index.html' ? '/' : path];
    if (!asset || !Object.hasOwn(asset, 'body')) return new Response('Not found', {status:404});
    let body = null;
    if (request.method !== 'HEAD') {
      body = asset.binary ? Uint8Array.from(atob(asset.body), c => c.charCodeAt(0)) : asset.body;
    }
    return new Response(body, {headers:{
      'Content-Type':asset.type, 'Cache-Control':'private, no-cache',
      'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff'
    }});
  }
};
