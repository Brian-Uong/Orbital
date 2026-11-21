import { ownerSkip } from './skip.js';
import { workspaceViews } from './workspace.js';
import { conversationFloors } from './conversations.js';
import { mountTower } from './tower.js';
import { buildTowerFloors } from './roster.js';
import { workerMentions } from './worker-roster.js';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const embedded = $('orbital-snapshot');
const tz = 'America/Los_Angeles';
const formatters=new Map();
function format(value,options) {
  const key=JSON.stringify(options);
  if(!formatters.has(key))formatters.set(key,new Intl.DateTimeFormat('en-US',{timeZone:tz,...options}));
  return formatters.get(key).format(new Date(value));
}
const valid = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const dateText = value => valid(value) ? format(value,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}) : '';
const time = value => valid(value) ? '<time datetime="'+escape(value)+'">'+escape(dateText(value))+'</time>' : '';
const empty = message => '<p class="empty">'+escape(message)+'</p>';
const names = ['Professional','Product Design','Personal Dashboard','Personal Website','Financial Advice'];

const tones = [['#416185','#e3edfa'],['#3b6d61','#deefe7'],['#5d5c8a','#e9e8f8'],['#735c90','#f0eafa'],['#386877','#e1f0f2']];
const rank = a => {const n=names.indexOf(a.name);return n<0?50:n};

const marks=['<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12c4 3 14 3 18 0m-10 1h2"/>','<path d="m12 2 3.3 6.7 6.7 3.3-6.7 3.3L12 22l-3.3-6.7L2 12l6.7-3.3L12 2Z"/><circle cx="12" cy="12" r="2.5"/>','<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 10v10"/>','<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4.5" ry="9"/><path d="M3 12h18"/>','<path d="M3 3v17h18M6 14l4-5 4 3 6-7m-4 0h4v4"/>'];
function emblem(a) {
  const known=names.indexOf(a.name);
  const index=known>=0 ? known : Array.from(a.id).reduce((value,ch)=>(value*31+ch.codePointAt(0))>>>0,0)%tones.length;
  const [color,tint]=tones[index];
  return '<span aria-hidden="true" class="emblem" style="--hue:'+color+';--tint:'+tint+'"><svg viewBox="0 0 24 24">'+marks[index]+'</svg></span>';
}
const state={agents:[],events:[],reports:[],center:{},at:null,id:null,snapshot:null,floors:[],workerHandles:new Set(),access:'anonymous'};
let watch=null, busy=false, lastText='',issue='',publicObserved=0,expiryTimer,expiresAt=Infinity,validator='',controller=null;
const chosen=()=>state.agents.find(a=>a.id===state.id);
function status(a) {
  if (state.access!=='owner' && state.access!=='service') return a.status==='working'&&Date.now()-publicObserved>=300000?'unknown':a.status||'unknown';
  const floor=state.floors.find(f=>f.id===a.id);
  if(floor?.workers.some(w=>w.active))return 'working';
  if(a.workerProject)return floor?.status || 'reported';
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
    const link=$('coordinatorLink'),url=allowedThread(state.center.coordinator?.verifiedUrl);
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
  const station=mountTower({selectProject:select,dateText,onRouteChange:route});
const ownerPages=['history','needs','roadmap'];
function locationParts() {
  const [view,rawId]=location.hash.slice(1).split('/');
  let id;
  try {id=decodeURIComponent(rawId||'');} catch {id='';}
  return {view:(['overview','agents','activity'].includes(view) || privateView() && ownerPages.includes(view))?view:'overview',id};
}
function select(id) {
  if (!state.agents.some(a=>a.id===id))return;
  const view=locationParts().view==='agents'?'agents':'overview';
  const hash='#'+view+'/'+encodeURIComponent(id);
  if (hash===location.hash) route();
  else location.hash=hash;
}
const rendered=new WeakMap();
function markup(el,html) {
  if(rendered.get(el)!==html){el.innerHTML=html;rendered.set(el,html);}
}
function roster(target,items) {
  const buttons=items.map(a=>'<button type="button" class="sector" data-agent="'+escape(a.id)+'" aria-pressed="'+(state.id===a.id)+'">'+emblem(a)+'<span class="copy"><strong>'+escape(a.name)+'</strong>'+badge(a)+(a.task?'<span class="task-preview">'+escape(displayWork(a.task))+'</span>':'')+'</span><span class="chev" aria-hidden="true">&rsaquo;</span></button>');
  markup(target,buttons.join('')||empty('No matching sectors.'));
}
function allowedThread(url) {
  try {const u=new URL(url);return u.protocol==='https:' && u.hostname==='chatgpt.com' && !u.username && !u.password ? u.href : null;} catch {return null;}
}
const link=(url,text,style='')=>url?'<a class="thread '+style+'" href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+escape(text)+' &nearr;</a>':'';
const displayWork = value => workerMentions(value,state.workerHandles);
const field=(label,value,cls='')=>value?'<div class="field '+cls+'"><h4>'+escape(label)+'</h4><p>'+escape(displayWork(value))+'</p></div>':'';
const fact=(label,html)=>html?'<div><dt>'+escape(label)+'</dt><dd>'+html+'</dd></div>':'';
function inspector() {
  const a=chosen();
  if (!a) return empty('Select a sector to inspect its assignment.');
  const file=a.artifact, date=file?.observedAt||file?.createdAt;
  const artifact=file&&typeof file.text==='string'?'<div class="artifact"><h4>Saved work product</h4><button type="button" data-download="'+escape(a.id)+'">Download '+escape(file.name||'work product')+' &darr;</button><small>'+escape(file.source||'')+(file.source&&date?' &middot; ':'')+time(date)+'</small></div>':'';
  return '<div class="content"><div class="identity">'+emblem(a)+'<div><h3 tabindex="-1">'+escape(a.name)+'</h3>'+badge(a)+'</div></div>'+
    '<div class="quicklinks">'+link(allowedThread(a.threadUrl),'Open project','main-link')+link(allowedThread(a.latestArtifactUrl),'Latest deliverable')+
    '<a class="thread" href="#agents/'+encodeURIComponent(a.id)+'" aria-label="Permalink to '+escape(a.name)+'">Permalink</a></div>'+
    (privateView() && a.sourceType==='sector'?'<a class="work-history-link" href="#history/'+encodeURIComponent(a.id)+'">View sector history</a>':'')+
    field('Needs attention',a.blocker,'blocked')+field('Current assignment',a.task)+
    field('Observed activity',status(a)==='working'?a.liveActivity?.action:null)+field('Observed progress',a.observedProgress)+
    (a.detail?'<div class="field"><h4>Latest result</h4><p>'+escape(displayWork(a.detail))+'</p>'+time(a.lastResultAt)+'</div>':'')+
    field('Next assignment',a.nextTask)+
    '<dl class="meta">'+fact('Execution',escape(a.executionMode||a.source))+fact('Last activity',time(a.liveActivity?.observedAt??a.lastSeen))+fact('Source checked',time(a.sourceObservedAt))+fact('Next check',time(a.nextRun))+'</dl>'+artifact+'</div>';
}
function readouts() {
  $('assignedCount').textContent=state.agents.length;
  $('workingCount').textContent=privateView() ? state.floors.reduce((n,f)=>n+f.workers.filter(w=>w.active).length,0) : state.agents.filter(a=>status(a)==='working').length;
  $('workingCount').previousElementSibling.lastChild.textContent=privateView()?'Workers active':'Sectors working';
  $('attentionCount').textContent=state.agents.filter(a=>a.blocker||['waiting','blocked','error'].includes(status(a))).length;
  const next=state.center.nextBriefAt??state.center.nextReviewAt;
  $('briefTime').textContent=valid(next)?format(next,{hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Pending';
  $('briefTime').title=dateText(next);
}
function privateView() {return state.access==='owner'||state.access==='service';}
function projectFloors(now) {
  return state.snapshot ? buildTowerFloors(state.snapshot,{access:state.access,now}) : [];
}
function renderSelection() {
  const floors=state.floors;
  const view=locationParts().view;
  const html=inspector();
  for(const target of [$('inspector'),$('directoryInspector')]) if(target.dataset.rendered!==html){target.innerHTML=html;target.dataset.rendered=html;}
  const active=locationParts().id===chosen()?.id && !!chosen() && locationParts().view==='overview';
  $('rosterPane').hidden=active;$('briefPane').hidden=!active;
  document.querySelectorAll('[data-agent]').forEach(el=>{
    el.setAttribute('aria-pressed',String(state.id===el.dataset.agent));
    const a=state.agents.find(agent=>agent.id===el.dataset.agent),indicator=el.querySelector('.status');
    if(a&&indicator&&indicator.textContent.toLowerCase()!==status(a))indicator.outerHTML=badge(a);
  });
  if(view==='overview')station.update(conversationFloors(state.snapshot, floors, state.access),state.id,privateView());
  else if($('officeDialog').open)$('officeDialog').close();
  readouts();
}
function scheduleExpiry() {
  const now=Date.now(),floors=state.floors;
  clearTimeout(expiryTimer);
  const workerDeadlines=floors.flatMap(f=>f.workers.filter(w=>w.active).map(w=>Date.parse(w.expiresAt)||Date.parse(w.observedAt)+300000));
  const deadlines=[];
  if(!privateView()&&state.agents.some(a=>a.status==='working'))deadlines.push(publicObserved+300000);
  if(privateView())for(const a of state.agents) {
    if((a.liveActivity?.status??a.status)==='working')deadlines.push(Date.parse(a.liveActivity?.observedAt??a.lastSeen)+300000);
  }
  if(privateView())for(const sector of state.agents){
    for(const row of [sector.pendingAssignment,sector.queuedFollowup,sector.researchFollowup,
      {status:sector.assignmentStatus||sector.status,observedAt:sector.liveActivity?.observedAt||sector.workStartedAt}]){
      if(!row || !['working','running','in progress'].includes(String(row.status).toLowerCase().replace(/[_-]/g,' ')))continue;
      const until=Date.parse(row.observedAt||row.startedAt)+300000;
      if(until>now)deadlines.push(until);
    }
  }
  expiresAt=Math.min(...workerDeadlines,...deadlines.filter(d=>d>now));
  if(!document.hidden && Number.isFinite(expiresAt))expiryTimer=setTimeout(checkExpiry,Math.max(1,expiresAt-now));
}
function checkExpiry() {
  if(document.hidden || Date.now()<expiresAt)return;
  state.floors=projectFloors(Date.now());
  if(!privateView())for(const floor of state.floors)floor.status=status(state.agents.find(a=>a.id===floor.id));
  renderSelection();workCache=null;renderWorkViews(locationParts().view);scheduleExpiry();
}
function report(r) {
  return '<article class="report">'+time(r.at)+'<p>'+escape(displayWork(r.summary))+'</p>'+(Array.isArray(r.items)?r.items:[]).map(item=>{
    const a=state.agents.find(a=>a.id===item.agentId);if(!a)return '';
    return '<details><summary>'+escape(a.name)+'</summary><div class="report-detail">'+field('Accomplished',item.accomplished)+field('Next assignment',item.next)+'</div></details>';
  }).join('')+'</article>';
}
function events(rows) {
  return rows.map(e=>{const a=state.agents.find(a=>a.id===e.agentId);
    return '<article class="event"><div><small>'+escape(a?.name||'Control hub')+'</small>'+time(e.at)+'<strong>'+escape(displayWork(e.title))+'</strong></div></article>';}).join('')||empty('No recorded activity.');
}
function renderDirectory() {
  const term=$('agentSearch').value.trim().toLowerCase();
  roster($('directory'),state.agents.filter(a=>[a.name,a.task].some(v=>String(v??'').toLowerCase().includes(term))));
}
function renderJournal() {
  const id=$('agentFilter').value;
  markup($('activity'),events(state.events.filter(e=>!id||e.agentId===id)));
}
function connection() {
  $('notice').hidden=!issue;$('notice').textContent=issue;
  const label=watch?'Watching '+watch.name:embedded?'Saved snapshot':'Station feed';
  $('checkTime').textContent=[label,dateText(state.at)].filter(Boolean).join(' · ');
}
let workCache=null;
function renderDisclosures(panel,html,keyAttribute,heading) {
  if (rendered.get(panel)===html) return;
  const selector='details['+keyAttribute+']';
  const previous=[...panel.querySelectorAll(selector)];
  const openKey=previous.find(row=>row.open)?.getAttribute(keyAttribute);
  const focused=document.activeElement;
  const position=previous.findIndex(row=>row.contains(focused));
  const href=position>=0 ? focused.closest('a')?.getAttribute('href') : null;
  markup(panel,html);
  const rows=[...panel.querySelectorAll(selector)];
  const open=rows.find(row=>row.getAttribute(keyAttribute)===openKey);
  if(open) open.open=true;
  if(position>=0){
    const same=rows.find(row=>row.getAttribute(keyAttribute)===previous[position].getAttribute(keyAttribute));
    const target=same || rows[Math.min(position,rows.length-1)];
    const link=href && same?.open && [...same.querySelectorAll('a')].find(a=>a.getAttribute('href')===href);
    const next=link || target?.querySelector('summary') || heading;
    if(!target) next.setAttribute('tabindex','-1');
    next.focus({preventScroll:true});
  }
}
function renderWorkViews(view) {
  const owner=privateView();
  $('waitPanel').hidden=!owner;
  $('workflowControls').hidden=!owner || !!embedded;
  const paused=state.snapshot?.commandCenter.workflowControl?.paused === true;
  $('workflowState').textContent=paused?'Workflow paused':'Workflow running';
  $('pauseWorkflow').disabled=paused || state.access!=='owner';
  $('resumeWorkflow').disabled=!paused || state.access!=='owner';
  for(const el of document.querySelectorAll('[data-private-nav]'))el.hidden=!owner;
  const destinations={history:'historyBody',needs:'needsBody',roadmap:'roadmapBody',overview:'waitingBody'};
  if(!owner || !state.snapshot){
    if($('reviewEditor').open){$('reviewEditor').close();$('reviewEditForm').reset();editingReview=null;}
    workCache=null;
    for(const id of Object.values(destinations))markup($(id),'');
    markup($('historyKind'),'<option value="all">All types</option>');
    $('decisionCount').textContent='0';
    return;
  }
  const sectorId=view==='history'?locationParts().id:'';
  const kind=$('historyKind').value||'all';
  const now=Date.now();
  if(!workCache || workCache.snapshot!==state.snapshot || workCache.sectorId!==sectorId || workCache.kind!==kind || workCache.access!==state.access || now>=workCache.expiry){
    workCache={access:state.access,snapshot:state.snapshot,sectorId,kind,expiry:now+300000,data:workspaceViews(state.snapshot,{sectorId,kind,now,allowSkip:state.access==='owner'&&!embedded})};
  }
  const data=workCache.data;
  $('decisionCount').textContent=String(data.count);
  if(view==='history'){
    markup($('historyKind'),data.filters);
    $('historyKind').value=Array.from($('historyKind').options).some(o=>o.value===kind)?kind:'all';
  }
  if(view==='needs')renderDisclosures($('needsBody'),data.decisions,'data-decision-key',$('pageTitle'));
  else if(view==='overview')renderDisclosures($('waitingBody'),data.waiting,'data-wait-key',$('waitingHeading'));
  else if(destinations[view])markup($(destinations[view]),data[view]);
}
function render(purge=false) {
  $('evaluationRoute').hidden = !privateView();
  const view=locationParts().view;
  const requested=locationParts().id;
  if (requested && state.agents.some(a=>a.id===requested))state.id=requested;
  if (!chosen())state.id=state.agents[0]?.id??null;
  $('sectorCount').textContent=state.agents.length+' sectors';$('coreName').textContent='Control hub';
  $('rosterCount').textContent=String(state.agents.length);$('rosterTime').textContent=dateText(state.at);
  if(view==='overview'||purge)roster($('roster'),state.agents);
  if(view==='agents'||purge)renderDirectory();
  renderSelection();
  const pending=empty(privateView()?'The first briefing is pending.':'Briefings are available in the owner workspace.');
  if(view==='activity'||purge){
    const filter=$('agentFilter').value;
    markup($('agentFilter'),'<option value="">All sectors</option>'+state.agents.map(a=>'<option value="'+escape(a.id)+'">'+escape(a.name)+'</option>').join(''));
    $('agentFilter').value=state.agents.some(a=>a.id===filter)?filter:'';
    renderJournal();
    markup($('reportHistory'),state.reports.map(report).join('')||pending);
  }
  if(view==='overview'||purge){
    markup($('recentEvents'),events(state.events.slice(0,3)));
    markup($('latestReport'),state.reports.length?report(state.reports[0]):pending);
  }
  renderWorkViews(view);
  connection();
}
function apply(raw) {
  if(raw===lastText){checkExpiry();return;}
  const data=JSON.parse(raw.replace(/^\uFEFF/,''));
  if(!Array.isArray(data.agents)||!Array.isArray(data.events)||!valid(data.updatedAt))throw Error('The selected file is missing required snapshot fields.');
  state.snapshot=data;
  const sectors=new Map(data.agents.filter(a=>a?.sourceType==='sector' && typeof a.id==='string' && typeof a.name==='string').map(a=>[a.id,a]));
  state.floors=projectFloors(Date.now());
  state.workerHandles=new Set(state.floors.flatMap(f=>(f.allWorkers||f.workers).map(w=>w.handle)));
  state.agents=state.floors.map(f=>{
    if(!privateView())return {id:f.id,name:f.name,status:f.status,sourceType:'sector'};
    return sectors.get(f.id) || {id:f.id,name:f.name,status:f.status,workerProject:true};
  }).sort((a,b)=>rank(a)-rank(b)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  const ids=new Set(state.agents.map(a=>a.id));
  state.reports=privateView() ? (data.reports||[]).filter(r=>r&&valid(r.at)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)) : [];
  state.center=privateView() ? data.commandCenter||{} : {};
  state.events=privateView() ? data.events.filter(e=>e&&valid(e.at)&&(ids.has(e.agentId)||e.agentId===state.center.id)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)) : [];
  state.at=data.updatedAt;lastText=raw;render();scheduleExpiry();
}
function saveBlob(blob,name){const href=URL.createObjectURL(blob),el=document.createElement('a');el.href=href;el.download=name;document.body.append(el);el.click();el.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);}
async function readFile(file){if(file.size>10*1024*1024)throw Error('Choose a snapshot smaller than 10 MB.');return file.text();}
function failure(err){issue=err instanceof SyntaxError?'The snapshot contains invalid JSON.':err.message||'The snapshot could not be read.';connection();}
function showAccess(mode) {
  const wasPrivate=privateView();
  state.access=mode;
  const owner=mode==='owner'||mode==='service', signed=owner||mode==='visitor';
  const link=$('ownerAuth');
  link.hidden=false;
  link.textContent=owner?'Sign out':signed?'Switch account':'Owner sign in';
  link.href=signed?'/signout-with-chatgpt?return_to=%2F':'/signin-with-chatgpt?return_to=%2F';
  $('workspaceAccess').textContent=owner?'Owner workspace':'Public view';
  document.body.dataset.access=owner?'owner':'public';
  if(wasPrivate && !owner){
    $('skipStatus').textContent='';
    $('sectorControlStatus').textContent='';
    if(location.hash.includes('/office/') || ownerPages.includes(location.hash.slice(1).split('/')[0]))history.replaceState(null,'','#overview');
    Object.assign(state,{agents:[],events:[],reports:[],center:{},floors:[],workerHandles:new Set(),snapshot:null,id:null,at:null});
    lastText='';validator='';station.update([],null,false);
    if($('hubDialog').open)$('hubDialog').close();
    $('hubSectors').replaceChildren();$('coordinatorLink').removeAttribute('href');
    render(true);route();scheduleExpiry();
  }
}
async function refresh() {
  if(busy||document.hidden)return;
  busy=true;
  try {
    checkExpiry();
    if(watch){
      const handle=watch,raw=await readFile(await handle.getFile());
      if(handle===watch){apply(raw);if(issue){issue='';connection();}}
    } else if(!embedded){
      controller=new AbortController();
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]);
      const r=await fetch('/api/state',{cache:'no-store',headers:validator?{'If-None-Match':validator}:{},signal});
      const access=r.headers.get('Orbit-Access');
      if(r.status===304){
        const returnedTag=r.headers.get('ETag');
        if(!validator || !state.snapshot || access!==state.access ||
            returnedTag?.replace(/^W\//,'')!==validator.replace(/^W\//,'')){
          validator='';showAccess(access||'anonymous');throw Error('The station feed must be refreshed.');
        }
      }else{
        if(!r.ok){
          if(r.status===401||r.status===403){validator='';showAccess('anonymous');}
          throw Error('The station feed is unavailable.');
        }
        validator='';showAccess(access);publicObserved=Date.now();
        apply(await r.text());if(ownerPages.includes(location.hash.slice(1).split('/')[0]))route();validator=r.headers.get('ETag')||'';
      }
      if(issue){issue='';connection();}
    }
  } catch(e){if(!controller?.signal.aborted)failure(e);}
  finally{
    const resumed=controller?.signal.aborted && !document.hidden && timer!=null;
    busy=false;controller=null;
    if(resumed)refresh();
  }
}
let linkedDecision='';
function route(event) {
  const {view,id}=locationParts();
  const titles={overview:'Mission control',agents:'Sector directory',activity:'Progress briefings',history:'Results history',needs:'Needs Brian',roadmap:'Roadmap'};
  $('dateLine').textContent=format(new Date(),{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  $('pageTitle').textContent=titles[view];document.title=titles[view]+' | Orbital';
  for (const el of document.querySelectorAll('[data-page]')) {
    if(el.dataset.page===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
    $(el.dataset.page+'View').hidden=el.dataset.page!==view;
  }
  if (id && state.agents.some(a=>a.id===id))state.id=id;
  render();
  const decisionKey=view==='needs' ? id : '';
  if(!decisionKey) linkedDecision='';
  const targetDecision=decisionKey && (decisionKey!==linkedDecision || event?.type==='hashchange') &&
    [...$('needsBody').querySelectorAll('details[data-decision-key]')].find(row=>row.dataset.decisionKey===decisionKey);
  if(targetDecision){
    linkedDecision=decisionKey;
    targetDecision.open=true;
    const summary=targetDecision.querySelector('summary');
    summary.focus({preventScroll:true});
    summary.scrollIntoView({block:'nearest'});
  } else if(event?.type==='hashchange' && ownerPages.includes(view)){
    const heading=$(view+'View').querySelector('h2')||$('pageTitle');
    heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});
  }
  if(event?.type==='hashchange' && ['overview','agents'].includes(view) && id && id===chosen()?.id && !location.hash.includes('/office/')){
    const heading=document.getElementById(view==='agents'?'directoryInspector':'inspector').querySelector('h3');
    heading?.focus({preventScroll:true});
    if(matchMedia('(max-width:690px)').matches) heading?.scrollIntoView({block:'nearest'});
  }
}
$('backRoster').onclick=()=>{location.hash='overview';};

document.addEventListener('click',e=>{const target=e.target.closest('[data-agent],[data-download]');if(!target)return;if(target.hasAttribute('data-agent'))select(target.dataset.agent);else{
  const a=state.agents.find(a=>a.id===target.dataset.download);if(a?.artifact && typeof a.artifact.text==='string')saveBlob(new Blob([a.artifact.text],{type:'application/octet-stream'}),String(a.artifact.name||'Deliverable.txt').split(/[\\/]/).pop());
}});

let savingWorkflow=false;
async function controlWorkflow(paused){
  if(savingWorkflow || embedded || state.access!=='owner')return;
  savingWorkflow=true;const notice=$('workflowNotice');notice.textContent='Saving workflow setting…';
  try{
    const read=await fetch('/api/state',{cache:'no-store',redirect:'error',credentials:'same-origin'});
    if(!read.ok || read.headers.get('Orbit-Access')!=='owner')throw Error('Owner sign-in is required.');
    const response=await fetch('/api/workflow-control',{method:'POST',redirect:'error',credentials:'same-origin',headers:{'Content-Type':'application/json','If-Match':read.headers.get('ETag') || ''},body:JSON.stringify({paused})});
    const result=await response.json();if(!response.ok)throw Error(result.error || 'Could not save the workflow setting.');
    validator='';await refresh();
    if(state.snapshot?.commandCenter.workflowControl?.paused!==paused)throw Error('Refresh to verify the saved setting.');
    notice.textContent=paused?'Paused. Active work stops at its next checkpoint.':'Resumed. Work continues on the next hourly check.';
  }catch(error){notice.textContent=error.message;}finally{savingWorkflow=false;}
}
$('pauseWorkflow').onclick=()=>controlWorkflow(true);
$('resumeWorkflow').onclick=()=>controlWorkflow(false);
let savingApproval=false;
let editingReview=null, editOpener=null;
const reviewEditor=$('reviewEditor');
function closeReviewEditor(){
  if(savingApproval)return;
  reviewEditor.close();editingReview=null;$('reviewEditForm').reset();
  if(editOpener?.isConnected)editOpener.focus();else $('pageTitle').focus();
  editOpener=null;
}
$('reviewEditClose').onclick=closeReviewEditor;
$('reviewEditCancel').onclick=closeReviewEditor;
reviewEditor.addEventListener('cancel',event=>{event.preventDefault();closeReviewEditor();});
async function saveReviewDecision(review,decision,edits={}){
  if(savingApproval || embedded || state.access!=='owner')return false;
  savingApproval=true;
  const notice=decision==='revise'?$('reviewEditNotice'):$('approvalStatus');
  notice.textContent='Saving your decision…';
  $('reviewEditSubmit').disabled=true;
  try{
    const read=await fetch('/api/state',{cache:'no-store',redirect:'error',credentials:'same-origin'});
    if(!read.ok || read.headers.get('Orbit-Access')!=='owner')throw Error('Sign in as the owner and try again.');
    const current=await read.json();
    const fresh=current.commandCenter.execution?.releaseReviews?.find(r=>r.id===review.id);
    if(JSON.stringify(fresh)!==JSON.stringify(review))throw Error('This review changed. Your text is still here; copy it before closing, then refresh and review the latest version.');
    const saved=await fetch(decision==='approve'?'/api/release-approval':'/api/release-response',{
      method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json','If-Match':read.headers.get('ETag') || ''},
      body:JSON.stringify({reviewId:review.id,expectedReview:JSON.stringify(review),decision,...edits})});
    const result=await saved.json();if(!saved.ok)throw Error(result.error || 'Your decision could not be saved.');
    validator='';await refresh();
    const ledger=state.snapshot?.commandCenter.execution;
    if(!(decision==='approve'?ledger?.ownerApprovals:ledger?.ownerReviewResponses)?.some(r=>r.id===(result.approvalId || result.responseId)))throw Error('Refresh to confirm whether your decision was saved.');
    $('approvalStatus').textContent=decision==='approve'?'Approved and queued for the next hourly check.':decision==='deny'?'Denied. This idea has moved to Denied ideas and will not be published.':'Edits saved. The next hourly check will prepare a revised idea and return it here for approval.';
    return true;
  }catch(error){notice.textContent=error.message;return false;}
  finally{savingApproval=false;$('reviewEditSubmit').disabled=false;}
}
$('needsBody').addEventListener('click',async event=>{
  const button=event.target.closest('[data-approve-review],[data-deny-review],[data-edit-review]');
  if(!button || savingApproval || embedded || state.access!=='owner')return;
  const id=button.dataset.approveReview || button.dataset.denyReview || button.dataset.editReview;
  const review=state.snapshot?.commandCenter.execution?.releaseReviews?.find(r=>r.id===id);if(!review)return;
  if(button.hasAttribute('data-edit-review')){
    editingReview=structuredClone(review);editOpener=button;
    const repair=button.hasAttribute('data-fix-review');
    $('reviewEditorTitle').textContent=repair?'Fix and resubmit':'Edit and request a revision';
    $('reviewEditSubmit').textContent=repair?'Queue fix for review':'Queue revised idea';
    $('reviewEditTitle').textContent=review.title || review.id;
    $('reviewEditedOutput').value=[review.proposedOutput,review.output,review.summary].find(v=>typeof v==='string'&&v.trim()) || '';
    $('reviewInstructions').value=repair?'Resolve this blocker and return the corrected result for my approval: '+(review.releaseError || review.blocker || review.waitingDetails?.needed || review.releaseProgress || 'Identify and fix the recorded release problem.') : '';
    $('reviewEditNotice').textContent=repair?'This requests a correction. It does not approve another push.':'';
    reviewEditor.showModal();$('reviewEditedOutput').focus();return;
  }
  const decision=button.hasAttribute('data-deny-review')?'deny':'approve';
  if(!window.confirm(decision==='deny'?'Deny this idea? It will leave the pending list and will not be published.\n\n'+review.title:'Approve this change and queue its push?\n\n'+review.title+'\n'+review.action+'\nDestination: '+review.destination))return;
  button.disabled=true;await saveReviewDecision(review,decision);button.disabled=false;
});
$('reviewEditForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!editingReview || savingApproval)return;
  const editedOutput=$('reviewEditedOutput').value, instructions=$('reviewInstructions').value;
  const original=[editingReview.proposedOutput,editingReview.output,editingReview.summary].find(v=>typeof v==='string'&&v.trim()) || '';
  if((!editedOutput.trim()&&!instructions.trim()) || (editedOutput===original&&!instructions.trim())){
    $('reviewEditNotice').textContent='Change the proposed output or add instructions for AI.';return;
  }
  if(await saveReviewDecision(editingReview,'revise',{editedOutput,instructions}))closeReviewEditor();
});

let savingSector=false;
$('roadmapBody').addEventListener('click',async event=>{
  const button=event.target.closest('button[data-sector-control]');
  if(!button || savingSector || embedded || state.access!=='owner')return;
  const sectorId=button.dataset.sectorControl, paused=button.dataset.paused!=='true';
  const notice=$('sectorControlStatus');
  savingSector=true;button.disabled=true;notice.textContent='Saving sector setting.';
  async function readOwner(){
    const read=await fetch('/api/state',{cache:'no-store',redirect:'error',credentials:'same-origin'});
    if(!read.ok || read.headers.get('Orbit-Access')!=='owner' || state.access!=='owner')throw Error('Owner sign-in is required.');
    const data=await read.json();
    return {data,tag:read.headers.get('ETag') || ''};
  }
  try{
    const current=await readOwner();
    const sector=current.data.agents.find(a=>a.id===sectorId);
    if(!sector)throw Error('This sector is no longer available. Refresh Roadmap.');
    const response=await fetch('/api/sector-control',{method:'POST',redirect:'error',credentials:'same-origin',headers:{'Content-Type':'application/json','If-Match':current.tag},body:JSON.stringify({sectorId,paused})});
    const result=await response.json();if(!response.ok)throw Error(result.error || 'Could not save the sector setting.');
    const saved=await readOwner();
    if((saved.data.commandCenter.sectorControls?.[sectorId]?.paused===true)!==paused)throw Error('The setting changed again. Refresh to see its current state.');
    validator='';apply(JSON.stringify(saved.data));
    notice.textContent=sector.name+(paused?' paused. Active work stops at its next safe checkpoint.':saved.data.commandCenter.workflowControl?.paused?' enabled. Global Pause still holds its work.':' resumed. Work continues on the next hourly check.');
    document.querySelectorAll('button[data-sector-control]').forEach(el=>{if(el.dataset.sectorControl===sectorId)el.focus();});
  }catch(error){notice.textContent=error.message;}finally{savingSector=false;button.disabled=false;}
});

let savingSkip=false;
$('roadmapBody').addEventListener('click', async event => {
  const button=event.target.closest('button[data-skip-tag], button[data-skip-picker]');
  if (!button || savingSkip || embedded || state.access!=='owner') return;
  let choice=button;
  if (button.dataset.skipPicker !== undefined) {
    const select=button.closest('[data-skip-controls]')?.querySelector('select');
    choice=select?.selectedOptions[0];
    if (!choice?.dataset.skipTag) {
      $('skipStatus').textContent='Choose a planned item first.';
      select?.focus();
      return;
    }
  }
  const {skipTag,skipSector,skipSlot}=choice.dataset;
  const sector=state.snapshot?.agents.find(a=>a.id===skipSector);
  const expected=sector?.[skipSlot];
  if (!expected || expected.tag!==skipTag || !window.confirm('Skip “'+expected.task+'” for '+sector.name+'?')) return;
  const message=$('skipStatus');
  savingSkip=true; button.disabled=true; message.textContent='Saving…';
  async function readOwner() {
    const r=await fetch('/api/state',{cache:'no-store',redirect:'error',credentials:'same-origin'});
    const access=r.headers.get('Orbit-Access');
    if(r.ok && access!=='owner') showAccess(access || 'anonymous');
    if(!r.ok || access!=='owner' || state.access!=='owner') throw Error('Owner sign-in is required.');
    const etag=r.headers.get('ETag');
    if(!etag)throw Error('Could not verify the current revision.');
    const snapshot=await r.json();
    if(state.access!=='owner') throw Error('Owner sign-in is required.');
    return {etag:etag.replace(/^W\//,''),snapshot};
  }
  try {
    const {etag,snapshot}=await readOwner();
    const next=ownerSkip(snapshot,skipSector,expected,Date.now(),skipSlot);
    if(next!==snapshot){
      const saved=await fetch('/api/state',{method:'PUT',redirect:'error',credentials:'same-origin',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(next)});
      if(!saved.ok)throw Error(saved.status===412||saved.status===409?'The queue changed. Review it and try again.':'Could not save. Refresh to check this item.');
    }
    const receipt=await readOwner();
    if(!receipt.snapshot.commandCenter.execution.ownerSkips?.some(x=>x.id==='owner-skip/'+skipSector+'/'+skipTag))throw Error('Skip could not be verified. Refresh to check this item.');
    validator=''; apply(JSON.stringify(receipt.snapshot));
    message.textContent='Skipped '+skipTag+'. A different item can be planned on the next check.';
  }catch(error){
    validator='';await refresh();if(state.access==='owner')message.textContent=error.message;
  }finally{button.disabled=false;savingSkip=false;}
});

$('historyKind').onchange=()=>renderWorkViews('history');
$('agentSearch').oninput=renderDirectory;$('agentFilter').onchange=renderJournal;
window.addEventListener('hashchange',route);route();
$('refresh').onclick=refresh;
if(embedded){showAccess('owner');route();$('ownerAuth').hidden=true;$('loadSnapshot').hidden=false;$('loadSnapshot').onclick=async()=>{if(typeof showOpenFilePicker!=='function'){$('snapshotFile').click();return;}
  let handle;try{[handle]=await showOpenFilePicker({types:[{description:'Orbital snapshot',accept:{'application/json':['.json']}}]});}
  catch(e){if(e.name!=='AbortError')$('snapshotFile').click();return;}
  try{const raw=await readFile(await handle.getFile());issue='';apply(raw);watch=handle;connection();}catch(e){failure(e);}};
  $('snapshotFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{issue='';apply(await readFile(f));watch=null;connection();}catch(err){failure(err);}finally{e.target.value='';}};
  const zip=$('orbital-desktop');if(zip){$('downloadDesktop').hidden=false;$('downloadDesktop').onclick=()=>saveBlob(new Blob([Uint8Array.from(atob(zip.textContent.trim()),c=>c.charCodeAt(0))],{type:'application/zip'}),'Orbital-Desktop.zip');}
  try{apply(embedded.textContent);}catch(e){failure(e);}
}else{$('refresh').hidden=false;showAccess('anonymous');}
let timer;
function suspend() {
  clearInterval(timer);timer=null;
  clearTimeout(expiryTimer);controller?.abort();
}
function polling() {
  if(document.hidden){suspend();return;}
  if(timer!=null)return;
  checkExpiry();scheduleExpiry();refresh();timer=setInterval(refresh,15000);
}
document.addEventListener('visibilitychange',polling);
window.addEventListener('online',refresh);
window.addEventListener('pageshow',polling);
window.addEventListener('pagehide',e=>{suspend();if(!e.persisted)station.destroy();});
polling();




