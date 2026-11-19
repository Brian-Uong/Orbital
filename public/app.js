import { mountStation } from './station.js';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const embedded = $('orbital-snapshot');
const tz = 'America/Los_Angeles';
const format = (value,options) => new Intl.DateTimeFormat('en-US',{timeZone:tz,...options}).format(new Date(value));
const valid = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const dateText = value => valid(value) ? format(value,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}) : '';
const time = value => valid(value) ? '<time datetime="'+escape(value)+'">'+escape(dateText(value))+'</time>' : '';
const empty = message => '<p class="empty">'+escape(message)+'</p>';
const names = ['Professional','Product Design','Personal Dashboard','Personal Website','Financial Advice'];
const rooms=['Career agent','Product agent','Dashboard agent','Portfolio agent','Finance agent'];
const tones = [['#416185','#e3edfa'],['#3b6d61','#deefe7'],['#5d5c8a','#e9e8f8'],['#735c90','#f0eafa'],['#386877','#e1f0f2']];
const rank = a => {const n=names.indexOf(a.name);return n<0?50:n};

const marks=['<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12c4 3 14 3 18 0m-10 1h2"/>','<path d="m12 2 3.3 6.7 6.7 3.3-6.7 3.3L12 22l-3.3-6.7L2 12l6.7-3.3L12 2Z"/><circle cx="12" cy="12" r="2.5"/>','<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 10v10"/>','<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4.5" ry="9"/><path d="M3 12h18"/>','<path d="M3 3v17h18M6 14l4-5 4 3 6-7m-4 0h4v4"/>'];
function emblem(a) {
  const index=rank(a)%5, [color,tint]=tones[index];
  return '<span aria-hidden="true" class="emblem" style="--hue:'+color+';--tint:'+tint+'"><svg viewBox="0 0 24 24">'+marks[index]+'</svg></span>';
}
const state={agents:[],events:[],reports:[],center:{},at:null,id:null,labels:true};
try {state.labels=localStorage.getItem('orbital-sector-labels')!=='off';} catch {}
let watch=null, busy=false, lastText='',issue='';
const chosen=()=>state.agents.find(a=>a.id===state.id);
function status(a) {
  const value=a.liveActivity?.status??a.status, stamp=a.liveActivity?.observedAt??a.lastSeen;
  const age=Date.now()-Date.parse(stamp);
  return value==='working' && (!valid(stamp)||age<0||age>=300000) ? 'unknown' : value||'unknown';
}
function badge(a) {
  const s=status(a);
  const color=({working:'#33854f',idle:'#65828b',waiting:'#b37a2c',blocked:'#ad593c',error:'#b55c45',unknown:'#89938d',completed:'#437d61',assigned:'#78659f',ready:'#467c74'})[s]||'#7d887f';
  return '<span class="status" style="--status:'+color+'">'+escape(s.charAt(0).toUpperCase()+s.slice(1))+'</span>';
}
function openHub(){
    const link=$('coordinatorLink'),url=allowedThread(state.center.coordinator?.threadUrl);
    link.hidden=!url;
    if(url)link.href=url;else link.removeAttribute('href');
    const region=$('hubSectors');
    region.innerHTML=state.agents.map(a=>'<button type="button" data-hub-sector="'+escape(a.id)+'"><strong>'+escape(a.name)+'</strong>'+badge(a)+'</button>').join('');
    $('hubDialog').showModal();
  }
  $('hubControl').onclick=openHub;
  $('hubSectors').onclick=e=>{
    const sector=e.target.closest('[data-hub-sector]');
    if(sector){$('hubDialog').close();select(sector.dataset.hubSector);}
  };
  const station=mountStation($('map'),id=>id==='hub'?openHub():select(id));
function locationParts() {
  const [view,rawId]=location.hash.slice(1).split('/');
  let id;
  try {id=decodeURIComponent(rawId||'');} catch {id='';}
  return {view:['overview','agents','activity'].includes(view)?view:'overview',id};
}
function select(id) {
  if (!state.agents.some(a=>a.id===id))return;
  const view=locationParts().view==='agents'?'agents':'overview';
  const hash='#'+view+'/'+encodeURIComponent(id);
  if (hash===location.hash) route();
  else location.hash=hash;
}
function roster(target,items) {
  const buttons=items.map(a=>'<button type="button" class="sector" data-agent="'+escape(a.id)+'" aria-pressed="'+(state.id===a.id)+'">'+emblem(a)+'<span class="copy"><strong>'+escape(a.name)+'</strong><span class="room-name">'+escape(rooms[rank(a)]||'')+'</span>'+badge(a)+(a.task?'<span class="task-preview">'+escape(a.task)+'</span>':'')+'</span><span class="chev" aria-hidden="true">&rsaquo;</span></button>');
  target.innerHTML=buttons.join('')||empty('No matching sectors.');
}
function allowedThread(url) {
  try {const u=new URL(url);return u.protocol==='https:' && u.hostname==='chatgpt.com' && !u.username && !u.password ? u.href : null;} catch {return null;}
}
const link=(url,text,style='')=>url?'<a class="thread '+style+'" href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+escape(text)+' &nearr;</a>':'';
const field=(label,value,cls='')=>value?'<div class="field '+cls+'"><h4>'+escape(label)+'</h4><p>'+escape(value)+'</p></div>':'';
const fact=(label,html)=>html?'<div><dt>'+escape(label)+'</dt><dd>'+html+'</dd></div>':'';
function inspector() {
  const a=chosen();
  if (!a) return empty('Select a sector to inspect its assignment.');
  const file=a.artifact, date=file?.observedAt||file?.createdAt;
  const artifact=file&&typeof file.text==='string'?'<div class="artifact"><h4>Saved work product</h4><button type="button" data-download="'+escape(a.id)+'">Download '+escape(file.name||'work product')+' &darr;</button><small>'+escape(file.source||'')+(file.source&&date?' &middot; ':'')+time(date)+'</small></div>':'';
  return '<div class="content"><div class="identity">'+emblem(a)+'<div><h3 tabindex="-1">'+escape(a.name)+'</h3>'+badge(a)+'</div></div>'+
    '<div class="quicklinks">'+link(allowedThread(a.threadUrl),'Open project','main-link')+link(allowedThread(a.latestArtifactUrl),'Latest deliverable')+
    '<a class="thread" href="#agents/'+encodeURIComponent(a.id)+'" aria-label="Permalink to '+escape(a.name)+'">Permalink</a></div>'+
    field('Needs attention',a.blocker,'blocked')+field('Current assignment',a.task)+
    field('Observed activity',status(a)==='working'?a.liveActivity?.action:null)+field('Observed progress',a.observedProgress)+
    (a.detail?'<div class="field"><h4>Latest result</h4><p>'+escape(a.detail)+'</p>'+time(a.lastResultAt)+'</div>':'')+
    field('Next assignment',a.nextTask)+
    '<dl class="meta">'+fact('Execution',escape(a.executionMode||a.source))+fact('Last activity',time(a.liveActivity?.observedAt??a.lastSeen))+fact('Source checked',time(a.sourceObservedAt))+fact('Next check',time(a.nextRun))+'</dl>'+artifact+'</div>';
}
function readouts() {
  $('assignedCount').textContent=state.agents.length;
  $('workingCount').textContent=state.agents.filter(a=>status(a)==='working').length;
  $('attentionCount').textContent=state.agents.filter(a=>a.blocker||['waiting','blocked','error'].includes(status(a))).length;
  const next=state.center.nextBriefAt??state.center.nextReviewAt;
  $('briefTime').textContent=valid(next)?format(next,{hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Pending';
  $('briefTime').title=dateText(next);
}
function renderSelection() {
  const html=inspector();
  for(const target of [$('inspector'),$('directoryInspector')]) if(target.dataset.rendered!==html){target.innerHTML=html;target.dataset.rendered=html;}
  const active=locationParts().id===chosen()?.id && !!chosen() && locationParts().view==='overview';
  $('rosterPane').hidden=active;$('briefPane').hidden=!active;
  document.querySelectorAll('[data-agent]').forEach(el=>{
    el.setAttribute('aria-pressed',String(state.id===el.dataset.agent));
    const a=state.agents.find(agent=>agent.id===el.dataset.agent),indicator=el.querySelector('.status');
    if(a&&indicator&&indicator.textContent.toLowerCase()!==status(a))indicator.outerHTML=badge(a);
  });
  station.update({agents:state.agents,selectedId:state.id,labels:state.labels});
  $('labels').setAttribute('aria-pressed',String(state.labels));readouts();
}
function report(r) {
  return '<article class="report">'+time(r.at)+'<p>'+escape(r.summary)+'</p>'+(Array.isArray(r.items)?r.items:[]).map(item=>{
    const a=state.agents.find(a=>a.id===item.agentId);if(!a)return '';
    return '<details><summary>'+escape(a.name)+'</summary><div class="report-detail">'+field('Accomplished',item.accomplished)+field('Next assignment',item.next)+'</div></details>';
  }).join('')+'</article>';
}
function events(rows) {
  return rows.map(e=>{const a=state.agents.find(a=>a.id===e.agentId);
    return '<article class="event"><div><small>'+escape(a?.name||'Control hub')+'</small>'+time(e.at)+'<strong>'+escape(e.title)+'</strong></div></article>';}).join('')||empty('No recorded activity.');
}
function renderDirectory() {
  const term=$('agentSearch').value.trim().toLowerCase();
  roster($('directory'),state.agents.filter(a=>[a.name,a.task].some(v=>String(v??'').toLowerCase().includes(term))));
}
function renderJournal() {
  const id=$('agentFilter').value;
  $('activity').innerHTML=events(state.events.filter(e=>!id||e.agentId===id));
  $('recentEvents').innerHTML=events(state.events.slice(0,3));
}
function connection() {
  $('notice').hidden=!issue;$('notice').textContent=issue;
  const label=watch?'Watching '+watch.name:embedded?'Saved snapshot':'Station feed';
  $('checkTime').textContent=[label,dateText(state.at)].filter(Boolean).join(' · ');
}
function render() {
  const requested=locationParts().id;
  if (requested && state.agents.some(a=>a.id===requested))state.id=requested;
  if (!chosen())state.id=state.agents[0]?.id??null;
  $('sectorCount').textContent=state.agents.length+' sectors';$('coreName').textContent='Control hub';
  $('rosterCount').textContent=String(state.agents.length);$('rosterTime').textContent=dateText(state.at);
  roster($('roster'),state.agents);renderDirectory();renderSelection();
  const filter=$('agentFilter').value;
  $('agentFilter').innerHTML='<option value="">All sectors</option>'+state.agents.map(a=>'<option value="'+escape(a.id)+'">'+escape(a.name)+'</option>').join('');
  $('agentFilter').value=state.agents.some(a=>a.id===filter)?filter:'';
  renderJournal();$('reportHistory').innerHTML=state.reports.map(report).join('')||empty('The first briefing is pending.');
  $('latestReport').innerHTML=state.reports.length?report(state.reports[0]):empty('The first briefing is pending.');connection();
}
function apply(raw) {
  if(raw===lastText){renderSelection();connection();return;}
  const data=JSON.parse(raw.replace(/^\uFEFF/,''));
  if(!Array.isArray(data.agents)||!Array.isArray(data.events)||!valid(data.updatedAt))throw Error('The selected file is missing required snapshot fields.');
  state.agents=data.agents.filter(a=>a?.sourceType==='sector'&&typeof a.id==='string'&&typeof a.name==='string').sort((a,b)=>rank(a)-rank(b));
  const ids=new Set(state.agents.map(a=>a.id));state.reports=(data.reports||[]).filter(r=>r&&valid(r.at)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  state.center=data.commandCenter||{};state.events=data.events.filter(e=>e&&valid(e.at)&&(ids.has(e.agentId)||e.agentId===state.center.id)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  state.at=data.updatedAt;lastText=raw;render();
}
function saveBlob(blob,name){const href=URL.createObjectURL(blob),el=document.createElement('a');el.href=href;el.download=name;document.body.append(el);el.click();el.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);}
async function readFile(file){if(file.size>10*1024*1024)throw Error('Choose a snapshot smaller than 10 MB.');return file.text();}
function failure(err){issue=err instanceof SyntaxError?'The snapshot contains invalid JSON.':err.message||'The snapshot could not be read.';renderSelection();connection();}
async function refresh(){if(busy||document.hidden)return;busy=true;try{
  if(watch){const handle=watch,raw=await readFile(await handle.getFile());if(handle===watch){issue='';apply(raw);}}
  else if(!embedded){const r=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('The station feed is unavailable.');issue='';apply(await r.text());}
  else {renderSelection();connection();}
}catch(e){failure(e);}finally{busy=false;}}
function route(event) {
  const {view,id}=locationParts();
  const titles={overview:'Mission control',agents:'Sector directory',activity:'Progress briefings'};
  $('dateLine').textContent=format(new Date(),{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  $('pageTitle').textContent=titles[view];document.title=titles[view]+' | Orbital';
  for (const el of document.querySelectorAll('[data-page]')) {
    if(el.dataset.page===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
    $(el.dataset.page+'View').hidden=el.dataset.page!==view;
  }
  if (id && state.agents.some(a=>a.id===id))state.id=id;
  renderSelection();
  if(event?.type==='hashchange' && id && id===chosen()?.id){
    const heading=document.getElementById(view==='agents'?'directoryInspector':'inspector').querySelector('h3');
    heading?.focus({preventScroll:true});
    if(matchMedia('(max-width:690px)').matches) heading?.scrollIntoView({block:'nearest'});
  }
}
$('backRoster').onclick=()=>{location.hash='overview';};

document.addEventListener('click',e=>{const target=e.target.closest('[data-agent],[data-download]');if(!target)return;if(target.hasAttribute('data-agent'))select(target.dataset.agent);else{
  const a=state.agents.find(a=>a.id===target.dataset.download);if(a?.artifact && typeof a.artifact.text==='string')saveBlob(new Blob([a.artifact.text],{type:'application/octet-stream'}),String(a.artifact.name||'Deliverable.txt').split(/[\\/]/).pop());
}});
$('labels').onclick=()=>{state.labels=!state.labels;try{localStorage.setItem('orbital-sector-labels',state.labels?'on':'off');}catch{}renderSelection();};
$('agentSearch').oninput=renderDirectory;$('agentFilter').onchange=renderJournal;
window.addEventListener('hashchange',route);route();
$('refresh').onclick=refresh;
if(embedded){$('loadSnapshot').hidden=false;$('loadSnapshot').onclick=async()=>{if(typeof showOpenFilePicker!=='function'){$('snapshotFile').click();return;}
  let handle;try{[handle]=await showOpenFilePicker({types:[{description:'Orbital snapshot',accept:{'application/json':['.json']}}]});}
  catch(e){if(e.name!=='AbortError')$('snapshotFile').click();return;}
  try{const raw=await readFile(await handle.getFile());issue='';apply(raw);watch=handle;connection();}catch(e){failure(e);}};
  $('snapshotFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{issue='';apply(await readFile(f));watch=null;connection();}catch(err){failure(err);}finally{e.target.value='';}};
  const zip=$('orbital-desktop');if(zip){$('downloadDesktop').hidden=false;$('downloadDesktop').onclick=()=>saveBlob(new Blob([Uint8Array.from(atob(zip.textContent.trim()),c=>c.charCodeAt(0))],{type:'application/zip'}),'Orbital-Desktop.zip');}
  try{apply(embedded.textContent);}catch(e){failure(e);}
}else{$('refresh').hidden=false;refresh();}
let timer;function polling(){clearInterval(timer);if(!document.hidden){refresh();timer=setInterval(refresh,15000);}}
document.addEventListener('visibilitychange',polling);window.addEventListener('pageshow',polling);window.addEventListener('pagehide',e=>{clearInterval(timer);if(!e.persisted)station.destroy();});
polling();
