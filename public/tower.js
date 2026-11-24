import { workerName, workerMentions } from './worker-roster.js';
const by = id => document.getElementById(id);
const safe = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const floorPaint = ['#b2dacd','#e8c499','#a3cdde','#c4b6dc','#a7d3bc'];
const coats = ['#77abad','#d29a6d','#af91c7','#88a9cf','#d09caa','#91b79b','#d8b776'];
const skin = ['#e5b490','#bd856a','#e1aa88','#aa775c','#c89978'];
const statusLabel = worker => worker.active ? 'Working' : (worker.status||'Reported').replace(/^./, c => c.toUpperCase());

function hash(key) {
  let n=2166136261;
  for (const ch of key) n=Math.imul(n^ch.codePointAt(0),16777619);
  return (n^(n>>>16))>>>0;
}

// Accessories change the outline as well as the face at the smallest desk size.
const headwear = [
  // Knit watch cap, ribbed brim and pom.
  '<path d="M58 27q-2-13 8-15 13-3 14 13l-4 2-7-2-7 4z" fill="#d9a676"/><path d="m58 24 23-2 1 5-24 3z" fill="#ecd0a3"/><circle cx="66" cy="11" r="4.4" fill="#c58d68"/>',
  // Over-ear headset with a long mic.
  '<path d="M60 29q-5-15 8-16 8-1 12 6l-10 2-6 10z" fill="#373d50"/><path d="M58 28q-2-16 11-16 8 0 10 7" fill="none" stroke="#e1c6a8" stroke-width="3.2"/><rect x="56" y="24" width="9" height="13" rx="4" fill="#424c64" stroke="#a4cdcc" stroke-width="2"/><path d="m63 33 6 4 9-3" fill="none" stroke="#d5d6cb" stroke-width="2"/><rect x="75" y="31.5" width="6" height="3" rx="1.4" fill="#284553"/>',
  // High bun, upswept fringe and square frames.
  '<circle cx="59" cy="13" r="7" fill="#503c3e"/><path d="M58 30q-7-14 5-17 11-5 17 5l-2 4-11-2-5 12z" fill="#4c3639"/><path d="m71 24 13-1-2 6-8 1z" fill="#4b5665" stroke="#e1ba9b" stroke-width="1.3"/>',
  // Flat billed cap with a long contrasting visor.
  '<path d="M57 24q0-13 11-12 10 0 11 10l-12 4-9 4z" fill="#72959e"/><path d="m57 23 21-3 10 2-1 3-11-1-17 4z" fill="#a9c7bb"/><path d="m60 27 7-2-3 7-4 1z" fill="#503b3a"/>',
  // Tied ponytail and wraparound visor.
  '<path d="M59 21q-7 0-9 7l-5 9q8 1 12-5l5-8z" fill="#49333c"/><path d="M58 26q-3-13 9-14 10-1 14 7l-3 3-12-1-4 9z" fill="#51404a"/><path d="m63 23 20-2-1 6-14 2-5-2z" fill="#b8d8d1"/><path d="m74 23 7-1-2 4h-7z" fill="#526d80"/><path d="m56 22 4 3" stroke="#d19583" stroke-width="3"/>',
  // Hood and scarf framing a dark face aperture.
  '<path d="M57 37q-5-9-2-17 2-9 13-10 12 1 14 12l-6-1-5-4-5 2-1 9 4 7 6 2-7 5z" fill="#8296b5"/><path d="m57 35 9 1 10-3 1 5-12 5-9-4z" fill="#d9be94"/><path d="m71 39 5-2 5 8-5 2z" fill="#b79d80"/>'
];

const displays = [
  // Portrait monitor with a stack of folders.
  '<path d="M105 22h18v26h-18z" fill="#223544" stroke="#b1c6c4" stroke-width="2"/><path d="M108 25h12v19h-12z" fill="#80a6a4"/><path d="M110 28h8m-8 4h6m-6 4h7" stroke="#d6e1cd" stroke-width="1.8"/><path d="M114 48v3m-6 0h13" stroke="#b2c3c0" stroke-width="2"/><path d="M126 46h12v2h-12zm1 3h13v2h-13z" fill="#d5af87"/>',
  // Two independently framed displays.
  '<path d="m99 29 18-2v16l-18 2zm21-2 14 2v16l-14-2z" fill="#86aaba" stroke="#293847" stroke-width="3"/><path d="m101 39 5-4 3 1 5-5m8 7 3-4 6 2" stroke="#d9e6d1" stroke-width="1.5" fill="none"/><path d="M109 45v6m18-6v6" stroke="#aab9bc" stroke-width="2"/>',
  // Open notebook computer, coffee flask and loose workbook.
  '<path d="M99 33h23l4 15h-23z" fill="#9db4ab" stroke="#344453" stroke-width="2.5"/><path d="m101 48 25-1 5 4H96z" fill="#c7cfbf"/><path d="M104 37h13m-12 3h8" stroke="#577d80" stroke-width="1.8"/><path d="M133 38h5v12h-5z" fill="#c58a78"/><path d="M133 36h5v3h-5z" fill="#dcc19d"/>',
  // Wide vintage terminal with thick warm bezel.
  '<rect x="99" y="24" width="32" height="23" rx="3" fill="#d1bc98" stroke="#655e60" stroke-width="2"/><rect x="102" y="27" width="24" height="15" rx="2" fill="#3b646a"/><path d="m105 32 3 2-3 2m6 0h7" fill="none" stroke="#b3d6b5" stroke-width="1.8"/><path d="M108 47h15v4h-15z" fill="#b2a48e"/><circle cx="128" cy="42" r="1.1" fill="#647b6d"/>',
  // Tilted pen display and compact vertical reference screen.
  '<path d="m94 44 19-12 10 10-20 9z" fill="#87a5b4" stroke="#343d50" stroke-width="2.2"/><path d="m102 43 10-6 5 5-10 4z" fill="#c4c2bc"/><path d="M124 26h12v20h-12z" fill="#516a81" stroke="#afbfbe" stroke-width="2"/><path d="m126 39 4-7 4 4" stroke="#b5d5ce" fill="none"/><path d="M130 47v4" stroke="#c2cbc2" stroke-width="2"/>'
];

const wallDecor = {
  professional:'<path d="M10 29h32v3H10z" fill="#c2a98e"/><path d="M13 15h5v14h-5zm7 3h5v11h-5zm7-4h4l4 14-4 1z" fill="#c6afa3"/><path d="M12 34h20v11H12z" fill="#4b5663" stroke="#a3b3ab"/><path d="M16 38h12m-12 3h8" stroke="#b3c1b5"/>',
  'product-design':'<path d="M9 12h32v28H9z" fill="#8b7b78" stroke="#b49e93"/><path d="m12 16 10-1 1 10-10 1zm14 0h11v6H26zm0 11h10v8H26z" fill="#d0bb95"/><path d="m16 30 6-1 1 6-7 1z" fill="#a9c8bf"/>',
  'personal-dashboard':'<rect x="8" y="13" width="34" height="24" rx="2" fill="#253b4b" stroke="#a4b6bf"/><path d="M11 16h12v7H11zm15 0h12v7H26zm-15 10h12v7H11z" fill="#86a6ac"/><path d="m26 32 3-4 4 1 5-4" fill="none" stroke="#b9cfb3" stroke-width="2"/>',
  'personal-website':'<path d="M9 11h20v27H9z" fill="#c3b6a9"/><path d="M12 14h14v20H12z" fill="#77788e"/><circle cx="20" cy="21" r="5" fill="#deb692"/><path d="m13 32 6-6 6 6z" fill="#a7c0b3"/><path d="M32 17h9v20h-9z" fill="#acacb0"/><path d="M34 19h5v6h-5zm0 8h5v7h-5z" fill="#768e93"/>',
  'financial-advice':'<path d="M8 13h34v24H8z" fill="#263e4c" stroke="#a8aba7"/><path d="M11 29h28m-21-12v16m10-16v16" fill="none" stroke="#526571"/><path d="m11 31 7-8 5 3 6-6 3 2 6-5" stroke="#bbd3b4" stroke-width="2" fill="none"/>'
};

// Every cue depends only on the immutable ID. Adding workers, sorting reports,
// changing tasks or opening the station on another device cannot restyle a room.
function portraitFor(id) {
  return {
    head:hash('look|'+id)%headwear.length,
    desk:hash('desk|'+id)%displays.length,
    coat:hash('coat|'+id)%coats.length,
    mirror:hash('view|'+id)%2
  };
}

// A framed woven emblem gives even workers with the same stock accessories
// distinct art. Each handle character supplies a column of seven binary tiles.
// Mixing with the previous column is reversible; different handles therefore
// differ in the design itself, even if their short palette hashes collide.
function officePrint(worker) {
  const handle=worker.handle || worker.id;
  const letters=Array.from(handle.startsWith('/root/') ? handle.slice(6) : handle);
  let previous=hash('weave|'+worker.projectId)%128, tiles='';
  for(let i=0;i<letters.length;i++){
    const bits=(letters[i].charCodeAt(0)*53+previous+i)%128;
    previous=bits;
    for(let j=0;j<7;j++){
      if(bits & (1<<j))tiles+='M'+(i*2)+' '+(j*2)+'h1.8v1.8h-1.8z';
    }
  }
  const ink=coats[hash('ink|'+worker.id)%coats.length];
  return '<rect x="155" y="7" width="23" height="16" rx="1" fill="#3c4859" stroke="#af9e8d"/>'+
    '<svg x="157" y="9" width="19" height="12" viewBox="0 0 '+(2*letters.length)+' 14" preserveAspectRatio="none"><path fill="'+ink+'" d="'+tiles+'"/></svg>';
}

export function officeMotion(worker) {
  if(worker.active===true)return 'working';
  return ['idle','completed','verified'].includes(String(worker.status).toLowerCase())?'resting':'waiting';
}

export function renderOfficeScene(worker) {
  const {head,desk,coat}=portraitFor(worker.id);
  const mirrored=''; // Room orientation is shared so the bed and desk never overlap.
  const furniture=Object.hasOwn(wallDecor,worker.projectId) ? wallDecor[worker.projectId] : wallDecor.professional;
  const complexion=skin[hash('skin|'+worker.id)%skin.length];
  return '<svg class="office-scene" aria-hidden="true" focusable="false" width="100%" height="100%">'+
  '<svg class="room-shell" width="100%" height="100%" viewBox="0 0 360 120" preserveAspectRatio="none">'+
  '<path d="M0 0h360v120H0z" fill="#344254"/><path d="M0 0h360v5H0z" fill="#8c9b9c"/><path d="M9 7h342v88H9z" fill="#435367"/><path d="M0 0l9 7v88L0 108zm360 0-9 7v88l9 13z" fill="#253446"/>'+
  '<path d="M9 95h342l9 13v12H0v-12z" fill="#657078"/><path d="M0 108h360M40 120l30-25m80 25 10-25m95 25-10-25m85 25-30-25" fill="none" stroke="#7e898c" stroke-width=".7"/>'+
  '<path d="M68 14h223v63H68z" fill="#203449" stroke="#95a9b0" stroke-width="2"/><path d="M71 17h217v57H71z" fill="#59748b"/><path d="M71 74V52h17V38h16v23h18V29h21v26h17V45h26v13h15V33h24v24h14V42h26v19h23v13z" fill="#314c64"/>'+
  '<path d="M94 44h3v4h-3zm36-9h3v4h-3zm0 10h3v4h-3zm80-6h4v4h-4zm0 9h4v4h-4zm39 1h3v4h-3zm-76 7h3v4h-3z" fill="#b6d5ce" opacity=".7"/><path d="M124 15v61m55-61v61m55-61v61M69 61h220" stroke="#8ca5b0" stroke-width="1.5"/><path d="M64 78h231" stroke="#c0c7bd" stroke-width="3"/>'+
  '<path d="M12 91h337" stroke="#bcc7c0" stroke-width="2"/><path d="M13 88h336" stroke="#91c5bd" opacity=".4"/>'+ '</svg>'+
  '<svg class="room-lounge" width="100%" height="100%" viewBox="0 0 290 100" preserveAspectRatio="xMidYMax meet">'+
  '<path d="m45 82 200-1 12 13H33z" fill="#82978f"/><path d="m44 87 197-1" stroke="#a6b5a8" stroke-width="2"/>'+
  '<path d="M6 18h43v68H6z" fill="#9f8d79"/><path d="M10 22h35v59H10z" fill="#3c4d59"/><path d="M8 43h39M8 64h39" stroke="#baa68d" stroke-width="3"/><path d="M13 27h5v14h-5zm7 2h5v12h-5zm9-3 4-1 5 15-4 1z" fill="#e0c097"/><path d="M12 49h7v13h-7zm10 3h5v10h-5zm10-4h7v14h-7z" fill="#91b2b1"/><path d="M14 70h23v8H14z" fill="#bc947d"/><path d="M11 86v5m33-5v5" stroke="#293e4e" stroke-width="3"/>'+
  '<rect x="75" y="48" width="134" height="31" rx="8" fill="#577b82"/><rect x="70" y="68" width="144" height="18" rx="5" fill="#759a99"/><path d="M74 59q-9 0-9 8v17h15V64q0-5-6-5zm136 0q9 0 9 8v17h-15V64q0-5 6-5z" fill="#8aabaa"/><path d="M81 85v6m120-6v6" stroke="#334552" stroke-width="4"/><path d="M140 51v29" stroke="#466c76" stroke-width="2"/><path d="m87 55 20-3 4 19-21 3z" fill="'+coats[coat]+'"/><path d="m176 54 18 3-3 16-18-3z" fill="#d1ba96"/>'+
  '<ellipse cx="145" cy="85" rx="35" ry="6" fill="#c5af91"/><path d="M120 86v9m50-9v9" stroke="#354958" stroke-width="3"/><path d="M138 80h15v3h-15z" fill="#5f8290"/><path d="M156 78h5v5h-5z" fill="#e1d6bc"/>'+
  '<path d="M247 71h23l-4 19h-15z" fill="#b59b80"/><path d="M258 74q-25-24-18-28 21 3 19 27-4-35 7-40 12 16-7 40 14-25 23-20-1 15-24 21" fill="#8db4a1"/>'+
  '<path d="M85 15h47v23H85z" fill="#263e50" stroke="#97b3b7"/><path d="m90 32 9-9 10 5 15-8" fill="none" stroke="#d4c29b" stroke-width="2"/><path d="M155 17h38v3h-38zm4 5h30v2h-30z" fill="#afc5bf"/>'+
  '</svg>'+
  '<svg class="rest-area" x="2%" y="0" width="38%" height="100%" viewBox="0 0 105 90" preserveAspectRatio="xMidYMax meet">'+
  '<path d="M6 73h91v8H6z" fill="#3b4c5b"/><path d="M9 61h78v14H9z" fill="#c6a47f"/><path d="M9 58h78v12H9z" fill="#d4ded1"/><path d="M9 49h5v31H9zm76 9h5v22h-5z" fill="#9b7e68"/><rect x="16" y="56" width="22" height="8" rx="4" fill="#edf0df"/><path d="M40 59h44v12H40z" fill="'+coats[coat]+'"/><path d="M42 67h39" stroke="#d4dfcf" opacity=".5"/>'+
  '<g class="sleeping-worker"><g class="sleeping-head"><circle cx="27" cy="56" r="6" fill="'+complexion+'"/><path d="M21 54q-1-8 8-5l4 4-8-1-2 4z" fill="#50434b"/><path d="m24 57 3 1" stroke="#534449" stroke-width="1"/></g><path class="sleep-blanket" d="M36 57q12-9 22 0h24v14H36z" fill="'+coats[coat]+'"/><path d="M40 61q14-4 22 2" fill="none" stroke="#d1dfd6" opacity=".5"/><g class="sleep-drift" fill="#c9e5dc" font-family="sans-serif" font-size="8"><text x="32" y="41">z</text><text x="40" y="33" font-size="6">z</text></g></g>'+
  '<path d="M92 60h11v4H92zm2 4h2v15h-2zm7 0h2v15h-2z" fill="#a28d77"/><path d="M97 59V48m-5 0h11l-3-8h-5z" fill="#dfbe8c" stroke="#c2b39c"/><g transform="translate(4 -2) scale(.9)">'+furniture+'</g>'+
  '</svg><svg class="desk-area" x="40%" width="59%" height="100%" viewBox="46 4 138 68" preserveAspectRatio="xMidYMax meet"><g transform="'+mirrored+'">'+
  officePrint(worker)+'<path d="M134 49l12-27 11 1 17 27z" fill="#f6c27d" opacity=".14"/><path d="M142 49h15m-8-1 5-15-7-10" fill="none" stroke="#b1aa9e" stroke-width="2"/><path d="m142 20 7-1 5 7-16 1z" fill="#e7bd85"/><path d="M140 27h12" stroke="#fff2b6" stroke-width="2"/>'+
  '<g class="screen-light">'+displays[desk]+'</g>'+
  '<path d="M84 50h81v4H84z" fill="#c6a180"/><path d="M89 54h3v13h-3zm66 0h4v13h-4z" fill="#323745"/><path d="M141 54h12v10h-12z" fill="#6d645f"/><path d="M144 57h5" stroke="#bfae9a"/><path d="M128 46h4v4h-4z" fill="#d6c6b7"/>'+
  '<g class="desk-keyboard"><path d="m86 48 22-1 3 5H84z" fill="#344b5a" stroke="#acbdb7" stroke-width=".8"/><path d="M89 49h3m2 0h3m2 0h3m2 0h3m-16 2h11" stroke="#8fafb0" stroke-width=".8"/><path class="key-activity" d="M91 49h3m6 1h3" stroke="#d7f0d6" stroke-width="1.2"/></g>'+
  '<path d="M55 42q4-3 7 1l4 13h12v4H60z" fill="#293743" stroke="#7d8691"/><path d="M66 60v7m-8 2 8-3 9 3" fill="none" stroke="#b1a9a8" stroke-width="2"/>'+
  '<g class="seated-legs"><path d="m65 53 18 1 6 10-4 2-8-9-14-1z" fill="#232e3f"/><path d="m84 65 6-2 4 4H84z" fill="#202a37"/></g>'+
  '<g class="desk-worker"><path d="M62 35q5-3 12 0l6 7 2 12H57l3-14z" fill="'+coats[coat]+'" stroke="#443e49" stroke-width="1.4"/><g class="worker-head"><path d="m68 32 7 1-1 6-5 2-4-5z" fill="'+complexion+'"/><path d="M60 24q0-11 11-10 9 1 9 10l3 4-4 1-1 5q-6 5-14-2z" fill="'+complexion+'"/>'+headwear[head]+'</g>'+
  '<path d="m61 40 3 3" stroke="#e5d7be" stroke-width="2.6"/><g class="typing-arm-alt"><path d="m66 41 10 6 14 1" fill="none" stroke="'+coats[coat]+'" stroke-width="4.5" stroke-linecap="round"/><path d="m90 48 6 0" stroke="'+complexion+'" stroke-width="3" stroke-linecap="round"/></g><g class="typing-arm"><path d="m73 40 9 9 16 1" fill="none" stroke="'+coats[coat]+'" stroke-width="5.5" stroke-linecap="round"/><path d="m98 50 6 0" stroke="'+complexion+'" stroke-width="3" stroke-linecap="round"/></g></g>'+
  '<path d="M13 53h9l-2 9h-5z" fill="#bd987d"/><path d="M17 54q-10-11-8-13 9 2 9 12-1-15 5-19 4 10-5 20 5-11 11-11-1 9-11 12" fill="#8ca99a"/></g></svg></svg>';
}

function room(worker) {
  return '<button type="button" class="office-room" data-worker="'+safe(worker.id)+'" data-active="'+Boolean(worker.active)+'" data-motion="'+officeMotion(worker)+'" style="--work-delay:-'+(hash(worker.id)%40/10)+'s" aria-haspopup="dialog" aria-label="'+safe(worker.name+' · '+statusLabel(worker)+' · '+worker.projectName)+'">'+renderOfficeScene(worker)+
    '<span class="office-plaque"><strong>'+safe(worker.name)+'</strong><span class="office-state">'+safe(statusLabel(worker))+'</span></span></button>';
}
function textIfChanged(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function htmlNode(markup) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = markup;
  return wrapper.firstElementChild;
}

function createFloor(id) {
  const el = htmlNode('<section class="tower-floor"><div class="floor-core"><button type="button" class="floor-index"><span></span><strong></strong></button></div><div class="floor-bays"></div></section>');
  const index = el.querySelector('.floor-index');
  el.dataset.floor = index.dataset.project = id;
  return {el, index, bays:el.querySelector('.floor-bays'), rooms:new Map(), gallery:null, nav:null, model:null};
}

function updateNav(floor) {
  const {gallery, nav} = floor;
  if (!nav || floor.el.hidden) return;
  nav.hidden = gallery.scrollWidth <= gallery.clientWidth + 1;
  nav.firstElementChild.disabled = gallery.scrollLeft <= 1;
  nav.lastElementChild.disabled = gallery.scrollLeft >= gallery.scrollWidth - gallery.clientWidth - 1;
}

// Keep the floor, gallery, rooms and their SVG subtrees alive across snapshots.
// Layout reads are deferred until the structural writes across floors finish.
function reconcileFloor(view, floor, level, color, privateView) {
  const prior = view.model;
  const renamed = prior?.name !== floor.name;
  if (renamed) {
    view.el.setAttribute('aria-label',floor.name);
    view.index.lastElementChild.textContent = floor.name;
  }
  textIfChanged(view.index.firstElementChild,'Level '+level);
  if (view.color !== color) {
    view.el.style.setProperty('--floor-accent',color);
    view.color = color;
  }
  view.model = floor;
  if (!floor.workers.length) {
    if (!view.facade) {
      view.facade = htmlNode('<div class="private-facade"><span class="facade-lights" aria-hidden="true"></span><span class="facade-plaque"></span></div>');
      view.bays.replaceChildren(view.facade);
      view.rooms.clear();
      view.gallery = null;
      view.nav?.remove();
      view.nav = null;
    }
    textIfChanged(view.facade.lastElementChild,privateView?(floor.allWorkers?.length?'No current workers':'No recorded workers'):floor.status||'Status unavailable');
    return false;
  }

  let layoutChanged = renamed;
  if (!view.gallery) {
    view.gallery = document.createElement('div');
    view.gallery.className = 'office-gallery';
    view.bays.replaceChildren(view.gallery);
    view.facade = null;
    layoutChanged = true;
  }
  if (renamed || layoutChanged) view.gallery.setAttribute('aria-label',floor.name+' offices');
  if (floor.workers.length>1 && !view.nav) {
    view.nav = htmlNode('<span class="bay-nav" hidden><button type="button" data-pan="-1">‹</button><button type="button" data-pan="1">›</button></span>');
    view.index.parentElement.append(view.nav);
    layoutChanged = true;
  } else if (floor.workers.length===1 && view.nav) {
    view.nav.remove();
    view.nav = null;
    layoutChanged = true;
  }
  if (view.nav && layoutChanged) {
    view.nav.firstElementChild.setAttribute('aria-label','Previous offices on '+floor.name);
    view.nav.lastElementChild.setAttribute('aria-label','More offices on '+floor.name);
  }

  // Iterating a cursor avoids repeatedly indexing a live HTMLCollection.
  let cursor = view.gallery.firstElementChild;
  for (const worker of floor.workers) {
    let cached = view.rooms.get(worker.id);
    if (!cached) {
      const el = htmlNode(room(worker));
      cached = {el, status:el.querySelector('.office-state'), worker};
      view.rooms.set(worker.id,cached);
    } else {
      if (worker.active!==cached.worker.active) cached.el.dataset.active = String(Boolean(worker.active));
      if (officeMotion(worker)!==officeMotion(cached.worker))cached.el.dataset.motion=officeMotion(worker);
      if (worker.name!==cached.worker.name) textIfChanged(cached.el.querySelector('.office-plaque strong'),worker.name);
      if (worker.active!==cached.worker.active || worker.status!==cached.worker.status || worker.name!==cached.worker.name || renamed) {
        const label = statusLabel(worker);
        textIfChanged(cached.status,label);
        cached.el.setAttribute('aria-label',worker.name+' · '+label+' · '+floor.name);
      }
      cached.worker = worker;
    }
    if (cached.el!==cursor) {
      view.gallery.insertBefore(cached.el,cursor);
      layoutChanged = true;
    }
    cursor = cached.el.nextElementSibling;
  }
  while (cursor) {
    const next = cursor.nextElementSibling;
    view.rooms.delete(cursor.dataset.worker);
    cursor.remove();
    cursor = next;
    layoutChanged = true;
  }
  return layoutChanged;
}

export function officeByHandle(floor,handle) {
  return floor?.workers.find(worker=>worker.handle===handle) || floor?.allWorkers?.find(worker=>worker.handle===handle);
}

export function mountTower({selectProject,dateText,onRouteChange}) {
  const root=by('officeTower'),dialog=by('officeDialog'),scene=by('towerSite');
  let floors=[],current=null,project=null,focus=false,privateView=false;
  const views = new Map();
  const observedRooms=new Set();
  const motionObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    for(const entry of entries)entry.target.dataset.visible=String(entry.isIntersecting);
  },{threshold:0}):null;
  const visibility=()=>scene.classList.toggle('desks-hidden',document.hidden);
  document.addEventListener('visibilitychange',visibility);visibility();
  let opener=null, previousDetail='';
  function roomNav() { for (const view of views.values()) updateNav(view); }
  const resize=new ResizeObserver(roomNav);resize.observe(root);
  root.addEventListener('scroll',event=>{
    const view=views.get(event.target.closest?.('[data-floor]')?.dataset.floor);
    if(view)updateNav(view);
  },true);
  function officeById(floor,id) {
    return floor?.workers.find(worker=>worker.id===id) || floor?.allWorkers?.find(worker=>worker.id===id);
  }
  function floorForOffice() {return floors.find(floor=>officeById(floor,current));}
  function navigationWorkers(floor) {
    return floor.workers.some(worker=>worker.id===current) ? floor.workers : floor.allWorkers || floor.workers;
  }
  function draw() {
    const activeElement=document.activeElement;
    const resized=[];
    let cursor=root.firstElementChild;
    for (const [i,floor] of floors.entries()) {
      let view=views.get(floor.id);
      if (!view) {
        view=createFloor(floor.id);
        views.set(floor.id,view);
      }
      const moved=view.el!==cursor;
      if (moved) root.insertBefore(view.el,cursor);
      cursor=view.el.nextElementSibling;
      const hidden=Boolean(focus && project && project!==floor.id);
      const visibilityChanged=view.el.hidden!==hidden;
      if (visibilityChanged) view.el.hidden=hidden;
      const level=String(floors.length-i).padStart(2,'0');
      const changed=reconcileFloor(view,floor,level,floorPaint[i%floorPaint.length],privateView);
      if (changed || moved || visibilityChanged) resized.push(view);
    }
    while (cursor) {
      const next=cursor.nextElementSibling;
      views.delete(cursor.dataset.floor);
      cursor.remove();
      cursor=next;
    }
    if (document.activeElement!==activeElement && root.contains(activeElement)) activeElement.focus({preventScroll:true});
    for(const view of resized)updateNav(view);
    const currentRooms=new Set([...views.values()].flatMap(view=>[...view.rooms.values()].map(room=>room.el)));
    for(const el of observedRooms)if(!currentRooms.has(el)){motionObserver?.unobserve(el);observedRooms.delete(el);}
    for(const el of currentRooms)if(!observedRooms.has(el)){
      observedRooms.add(el);if(motionObserver)motionObserver.observe(el);else el.dataset.visible='true';
    }
    textIfChanged(by('sceneFocus'),focus?'All floors':'Focus floor');
    by('sceneFocus').setAttribute('aria-pressed',String(focus));
  }
  function clearOffice() {
    previousDetail='';
    if(dialog.open)dialog.close();
    current=null;
    for(const id of ['officeTitle','officeProject','officeDetail'])by(id).replaceChildren();
  }
  function showRoom() {
    const f=floorForOffice(),w=officeById(f,current);
    if(!w){clearOffice();return;}
    textIfChanged(by('officeTitle'),w.name);
    textIfChanged(by('officeProject'),f.name);
    const stamp=dateText(w.observedAt);
    const result=w.lastResult;
    const prior=result && (w.observedAt!==result.observedAt || w.tag!==result.tag ||
      w.activity!==result.activity || w.artifactUrl!==result.artifactUrl);
    const resultLink=(url,label)=>url?'<a class="thread" href="'+safe(url)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>':'';
    const handles = (f.allWorkers || f.workers).map(worker=>worker.handle);
    const detail=w.conversation ? '<p>'+safe(w.role || 'Project conversation')+'</p>'+
      (w.chatUrl ? resultLink(w.chatUrl,'Open conversation ↗') : '<p>Awaiting verified link</p>')+
      '<dl class="workspace-fields">'+(w.evidence || []).map(([label,value])=>'<div><dt>'+safe(label)+'</dt><dd>'+safe(value)+'</dd></div>').join('')+'</dl>'+
      (w.activity ? '<h3>Last recorded activity</h3><p>'+safe(w.activity)+'</p>' : '') : (w.name!==workerName(w.handle) ? '<p class="office-meta">Executor · '+safe(workerName(w.handle))+'</p>' : '')+'<div class="office-status-line"><b>'+safe(statusLabel(w))+'</b>'+(stamp?'<time>'+safe(stamp)+'</time>':'')+'</div>'+
      '<h3>Reported activity</h3><p>'+safe(workerMentions(w.activity,handles)||'No individual activity detail was recorded.')+'</p>'+
      (w.role?'<p class="office-meta">'+safe(workerMentions(w.role,handles))+'</p>':'')+
      (w.tag||w.source?'<p class="office-meta">'+safe([w.tag,w.source].filter(Boolean).join(' · '))+'</p>':'')+
      resultLink(w.artifactUrl,'Open result ↗')+
      (prior?'<h3>Last completed result</h3><p>'+safe(workerMentions(result.activity,handles) || 'Completed work recorded.')+'</p>'+
        (result.observedAt?'<p class="office-meta">'+safe(dateText(result.observedAt))+'</p>':'')+
        resultLink(result.artifactUrl,'Open previous result ↗'):'')+
      '<a class="office-permalink" href="#overview/'+encodeURIComponent(f.id)+'/office/'+encodeURIComponent(w.handle)+'">Link to this office</a>'+
      (f.coverage?'<p class="office-coverage">'+safe(f.coverage)+'</p>':'');
    if(previousDetail!==detail) {
      const target=by('officeDetail');
      const focused=target.contains(document.activeElement) ? document.activeElement.getAttribute('href') : null;
      target.innerHTML=detail;
      previousDetail=detail;
      if(focused) [...target.querySelectorAll('a')].find(link=>link.getAttribute('href')===focused)?.focus({preventScroll:true});
    }
    by('officeSector').hidden=['operations','evaluation'].includes(f.id);
    by('officePrevious').disabled=by('officeNext').disabled=navigationWorkers(f).length<2;
    if(!dialog.open)dialog.showModal();
  }
  // A fragment keeps the selected private office through a reload without
  // sending its identifier to the server or writing it into browser storage.
  function chooseOffice(w) {
    if(!privateView || !w)return;
    history.replaceState(null,'','#overview/'+encodeURIComponent(w.projectId)+'/office/'+encodeURIComponent(w.handle));
    onRouteChange();
  }
  function step(direction) {
    const f=floorForOffice();if(!f)return;
    const options=navigationWorkers(f);
    chooseOffice(options[(options.findIndex(x=>x.id===current)+direction+options.length)%options.length]);
  }
  root.onclick=event=>{
    const pan=event.target.closest('[data-pan]');
    if(pan){
      const gallery=pan.closest('.tower-floor').querySelector('.office-gallery');
      gallery.scrollBy({left:Number(pan.dataset.pan)*gallery.firstElementChild.getBoundingClientRect().width,behavior:'instant'});updateNav(views.get(pan.closest('.tower-floor').dataset.floor));return;
    }
    const office=event.target.closest('[data-worker]');
    if(office){opener=office;const f=floors.find(f=>f.id===office.closest('[data-floor]').dataset.floor);chooseOffice(f?.workers.find(w=>w.id===office.dataset.worker));return;}
    const floor=event.target.closest('[data-project]');if(floor){const f=floors.find(f=>f.id===floor.dataset.project);if(f && ['operations','evaluation'].includes(f.id))chooseOffice(f.workers[0]);else selectProject(floor.dataset.project);}
  };
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    const id=current;current=null;previousDetail='';
    const returnTo=root.querySelector('[data-worker="'+CSS.escape(id||'')+'"]')||opener;
    returnTo?.focus({preventScroll:true});opener=null;
    if (id && location.hash.startsWith('#overview/') && location.hash.includes('/office/')) {
      history.replaceState(null,'',location.hash.split('/office/')[0]);
      onRouteChange();
    }
    for(const field of ['officeTitle','officeProject','officeDetail'])by(field).replaceChildren();
  });
  by('officeNext').onclick=()=>step(1);
  by('officePrevious').onclick=()=>step(-1);
  by('officeSector').onclick=()=>{const id=floorForOffice()?.id;dialog.close();if(id)selectProject(id);};

  by('roomZoom').oninput=()=>{scene.style.setProperty('--bay',by('roomZoom').value+'px');roomNav();};
  by('sceneFocus').onclick=()=>{focus=!focus;draw();};
  by('scenePlay').onclick=()=>{
    const paused=scene.classList.toggle('desks-paused');
    by('scenePlay').textContent=paused?'Resume desks':'Pause desks';
    by('scenePlay').setAttribute('aria-pressed',String(paused));
  };
  return {
    update(next,selected,isPrivate) {

      floors=next;
      const route=location.hash.slice(1).split('/');
      project=route[2]==='office' && next.some(f=>f.id===route[1]) ? route[1] : selected;
      privateView=isPrivate;
      draw();
      const count=floors.reduce((n,f)=>n+f.workers.length,0);
      by('towerCoverage').textContent=!floors.length?'':isPrivate?count+(count===1?' visible office':' visible offices'):'Worker offices are private.';
      by('roomZoom').closest('details').hidden=!privateView;
      const [view,floor,word,handle]=location.hash.slice(1).split('/');
      if(privateView && view==='overview' && word==='office' && handle) {
        try {
          const f=floors.find(f=>f.id===decodeURIComponent(floor));
          const decoded=decodeURIComponent(handle);
          const w=officeByHandle(f,decoded);
          if(w){current=w.id;project=f.id;showRoom();return;}
        } catch {}
      }
      if(current || dialog.open)clearOffice();
    },
    activeCount(){return floors.reduce((n,f)=>n+f.workers.filter(w=>w.active).length,0);},
    destroy(){resize.disconnect();motionObserver?.disconnect();observedRooms.clear();document.removeEventListener('visibilitychange',visibility);}
  };
}



