// Small orthographic diorama. Rooms, props and crew share one world coordinate system.
const decks=['professional','product-design','personal-dashboard','personal-website','financial-advice'].map((id,i)=>{
  const a=i*2*Math.PI/5-1.76;
  return {id,x:Math.cos(a)*5.9,z:Math.sin(a)*5.9};
});
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
// Each sector owns a radial lane. The stop is inside the hub's outer ring
// with enough clearance for the operator, console and the visiting agent's feet.
function patrol(d,index,time,touring){
  const length=Math.hypot(d.x,d.z), dock=1.30, home=length-.36;
  const clock=touring?(time+index*4.72)%24:0;
  const incoming=clock>=4 && clock<11, outgoing=clock>=15 && clock<22;
  const q=incoming?(clock-4)/7:outgoing?1-(clock-15)/7:clock>=11&&clock<15?1:0;
  const distance=home+(dock-home)*q;
  return {x:d.x*distance/length,z:d.z*distance/length,moving:incoming||outgoing,heading:Math.atan2(d.x,d.z)+(outgoing?0:Math.PI)};
}
export function mountStation(canvas,onSelect){

  const c=canvas.getContext('2d'), by=id=>document.getElementById(id), motion=matchMedia('(prefers-reduced-motion: reduce)');
  let yaw=.32,pitch=.89,zoom=1,focus=false,play=!motion.matches,tour=true,t=0,selected,labels=true,agents=[],drag=null,points=[],raf=0,last=0,visible=true;
  let cx=0,cz=0,w=1,h=1,k=1;
  function project(x,y,z){
    const a=x-cx,b=z-cz,u=a*Math.cos(yaw)-b*Math.sin(yaw),d=a*Math.sin(yaw)+b*Math.cos(yaw);
    return [w*.5+u*k,h*.52+(d*Math.sin(pitch)-y*Math.cos(pitch))*k,d*Math.cos(pitch)+y*Math.sin(pitch)];
  }
  // Project the platforms, skybridges and crew from their shared world coordinates.
  // Curved silhouettes and glass reflections are drawn at display resolution.
  const colors=['#9ad2ff','#90f4ce','#adacff','#dfb3ff','#86edf5'];
  const projects=['Professional','Product Design','Personal Dashboard','Personal Website','Financial Advice'];
  const roles=['Career agent','Product agent','Dashboard agent','Portfolio agent','Finance agent'];
  let hoveredCrew=null,crewHits=[];
  let lastLabels=[];
  function ellipse(x,y,rx,ry,fill,stroke=null,lw=1){
    c.beginPath();c.ellipse(x,y,Math.max(.1,rx),Math.max(.1,ry),0,0,Math.PI*2);
    if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=lw;c.stroke();}
  }
  function line(x,y,X,Y,color,width=1){
    c.beginPath();c.moveTo(x,y);c.lineTo(X,Y);c.strokeStyle=color;c.lineWidth=width;c.stroke();
  }
  function gradient(x,y,X,Y,stops){
    const g=c.createLinearGradient(x,y,X,Y);stops.forEach(([p,color])=>g.addColorStop(p,color));return g;
  }
  const hubRadius = 1.86, roomRadius = 1.55;
  let cityLayer, cityKey;
  function backdrop(){
    // Cache the skyline; camera movement introduces a slower background parallax.
    const key=[w,h,Math.round(yaw*18)].join('/');
    if(key!==cityKey){
      cityKey=key;cityLayer=document.createElement('canvas');cityLayer.width=Math.ceil(w);cityLayer.height=Math.ceil(h);
      const g=cityLayer.getContext('2d'), sky=g.createLinearGradient(0,0,w*.35,h);
      sky.addColorStop(0,'#374570');sky.addColorStop(.32,'#7d76a7');sky.addColorStop(.54,'#86aabf');sky.addColorStop(.8,'#345971');sky.addColorStop(1,'#172e4c');
      g.fillStyle=sky;g.fillRect(0,0,w,h);
      const moonX=w*.79,moonY=h*.19,moonR=h*.09;
      const bloom=g.createRadialGradient(moonX,moonY,0,moonX,moonY,moonR*3.6);
      bloom.addColorStop(0,'#ffe3ed90');bloom.addColorStop(1,'#ffdce900');g.fillStyle=bloom;g.fillRect(0,0,w,h);
      g.fillStyle='#ffdfedbd';g.beginPath();g.arc(moonX,moonY,moonR,0,Math.PI*2);g.fill();
      g.strokeStyle='#ffeaf162';g.beginPath();g.ellipse(moonX,moonY,moonR*1.65,moonR*.21,-.26,0,Math.PI*2);g.stroke();
      const noise=(v)=>{const n=Math.sin(v*78.23+16.72)*43284.4;return n-Math.floor(n);};
      for(let layer=0;layer<3;layer++){
        const span=h*(.051+layer*.032),offset=yaw*span*(layer+1)*.55,shift=Math.floor(offset/span);
        for(let n=-3;n<w/span+3;n++){
          const seed=n+shift+layer*349, x=n*span-(offset-shift*span), roof=h*(.46+layer*.19-noise(seed)*(.23+layer*.06)), bw=span*(.65+noise(seed+9)*.47), side=bw*.23;
          g.fillStyle=['#9f91af','#647d99','#32516d'][layer];g.fillRect(x,roof,bw,h-roof);
          g.fillStyle=['#9189a9','#556e8d','#29445e'][layer];g.fillRect(x+bw-side,roof,side,h-roof);
          g.fillStyle=['#d5bfd4','#99b6cd','#769ab3'][layer];g.fillRect(x,roof,bw,1.6);
          if(noise(seed+8)>.48){g.fillStyle=['#ad9bb7','#70879d','#395a72'][layer];g.fillRect(x+bw*.23,roof-span*.22,bw*.51,span*.22);}
          if(noise(seed+13)>.77){g.fillStyle='#c2daea';g.fillRect(x+bw*.47,roof-span*.62,1,span*.44);}
          const step=Math.max(4,span*.12);
          for(let row=0,yy=roof+step;yy<h;yy+=step*1.3,row++){
            if(noise(seed+row*17)<.5)continue;
            g.fillStyle=layer===2?(row%5?'#9cbfd25c':'#ecc3edb0'):'#d4dee059';g.fillRect(x+bw*.1,yy,bw*(.18+.36*noise(seed+row)),1.5);
          }
          if(layer===2&&noise(seed)>.56){g.fillStyle='#a0f5e0a6';g.fillRect(x+bw-side-2,roof+3,2,span*.64);}
          if(layer===2&&noise(seed+16)>.60){
            const height=span*.69,left=x+bw*.17,top=roof+span*.33;
            g.fillStyle='#324563';g.fillRect(left,top,span*.15,height);
            g.fillStyle=noise(seed+10)>.5?'#d5b2f4':'#97f0e1';
            for(let mark=0;mark<4;mark++)g.fillRect(left+2,top+3+mark*height*.21,span*.082,2);}
        }
      }
      const mist=g.createLinearGradient(0,0,w,0);mist.addColorStop(0,'#354c7200');mist.addColorStop(.48,'#32496648');mist.addColorStop(1,'#354c7200');g.fillStyle=mist;g.fillRect(0,0,w,h);
    }
    c.drawImage(cityLayer,0,0,w,h);
    // Distant transit tracks carry a pair of slow light trains below the decks.
    for(let i=0;i<2;i++){
      const y=h*(.78+i*.16),slope=i?.14:-.12;
      line(0,y,w,y+w*slope,'#182b4766',3);line(0,y-2,w,y+w*slope-2,'#a3d9ea66',1);
      const x=w*((t*.025+i*.43)%1);line(x,y+x*slope-2,x+w*.048,y+(x+w*.048)*slope-2,i?'#c8baff':'#a2f7e7',2);
    }
  }
  // Build each walkable span in the same horizontal plane as both landing pads.
  // The ends extend into the pads so no gap can open when the camera rotates.
  function skybridge(d) {
    const length = Math.hypot(d.x,d.z), ux=d.x/length, uz=d.z/length;
    function surface(start,end,halfWidth,elevation,fill) {
      const corners = [[start,-1],[end,-1],[end,1],[start,1]];
      c.beginPath();
      corners.forEach(([dist,side],i)=>{
        const [x,y]=project(ux*dist-uz*side*halfWidth,elevation,uz*dist+ux*side*halfWidth);
        if(i===0)c.moveTo(x,y); else c.lineTo(x,y);
      });
      c.closePath(); c.fillStyle=fill; c.fill();
    }
    const start=hubRadius-.40,end=length-roomRadius+.40;
    surface(start,end,.47,-.25,'#273c59');
    surface(start,end,.47,0,'#a3faef');
    surface(start,end,.39,0,'#5a748e');
    const pulse=start+(end-start)*((t*.16+length*.17)%1);
    surface(pulse,Math.min(end,pulse+.30),.045,.012,'#d5fffa');
  }
  function platform(d,i) {
    const hub=i<0, radius=hub?hubRadius:roomRadius;
    const [x,y]=project(d.x,0,d.z), rx=radius*k, ry=rx*Math.sin(pitch);
    const depth=k*(hub?.54:.38), color=hub?'#aaf8ed':colors[i];
    // An inset service level and luminous fascia give the slabs visible thickness.
    const drop=depth+k*(hub?.74:.35);
    ellipse(x,y+drop,rx*.66,ry*.66,'#203247');
    c.fillStyle=gradient(x-rx,0,x+rx,0,[[0,'#26374f'],[.35,'#536a80'],[.72,'#2d4059'],[1,'#142b42']]);
    c.fillRect(x-rx*.66,y+depth,rx*1.32,drop-depth);
    c.beginPath();c.ellipse(x,y+drop-k*.08,rx*.66,ry*.66,0,0,Math.PI);
    c.strokeStyle=color+'a6';c.lineWidth=Math.max(1,k*.048);c.stroke();
    ellipse(x,y+depth,rx,ry,'#30445f');
    c.fillStyle='#30445f';c.fillRect(x-rx,y,rx*2,depth);
    c.beginPath();c.ellipse(x,y+depth*.72,rx,ry,0,0,Math.PI);c.strokeStyle=color;c.lineWidth=Math.max(1,k*.05);c.stroke();
    ellipse(x,y,rx,ry,gradient(x-rx,y-ry,x+rx,y+ry,[[0,'#b0cbd8'],[.55,'#8397b3'],[1,'#526e8c']]),color,Math.max(1.2,k*.055));
    if(hub){
      ellipse(x,y,rx*.79,ry*.79,null,'#c2f8edb0',1.2);
      ellipse(x,y,rx*.47,ry*.47,'#314764','#bcb9fd',1.6);
      // Five lit docking plates face their matching room. The operator stays at the console.
      decks.forEach((room,index)=>{
        const len=Math.hypot(room.x,room.z),[dx,dy]=project(room.x/len*1.30,.01,room.z/len*1.30);
        ellipse(dx,dy,k*.29,k*.29*Math.sin(pitch),colors[index]+'a0');
      });
      return;
    }
    // Small floor markings tie the rooms to their directory emblems.
    c.save();c.translate(x,y);c.scale(k*.041,k*.041*Math.sin(pitch));c.translate(-12,-12);
    c.strokeStyle='#effaff';c.lineWidth=1.2;c.lineJoin='round';c.lineCap='round';
    const symbols=['M4 8h16v12H4z M8 8V5h8v3 M4 13h16','M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z','M3 4h18v16H3z M3 10h18 M10 10v10','M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0 M12 3c-6 4-6 14 0 18c6-4 6-14 0-18 M3 12h18','M3 4v16h18 M6 15l4-5 4 2 6-7'];
    c.stroke(new Path2D(symbols[i]));c.restore();
    // Service consoles sit on the outer half of each deck, clear of its approach lane.
    const distance=Math.hypot(d.x,d.z),dx=d.x/distance,dz=d.z/distance;
    for(let n=0;n<2;n++){
      const across=(n-.5)*.64,xx=d.x+dx*.78-dz*across,zz=d.z+dz*.78+dx*across;
      const [bx,by]=project(xx,0,zz), height=k*(.31+.14*((i+n)%3));
      c.fillStyle='#344d67';c.fillRect(bx-k*.17,by-height,k*.34,height);
      ellipse(bx,by-height,k*.17,k*.08,color);line(bx-k*.10,by-height*.62,bx+k*.09,by-height*.62,color,1.4);
    }
    // A low curved canopy on the outward half leaves the hub-facing entrance open.
    const outward=Math.atan2(d.z,d.x), arc=[];
    for(let n=0;n<=24;n++){
      const a=outward+(n/24-.5)*Math.PI*.93;
      arc.push([d.x+Math.cos(a)*radius*.86,d.z+Math.sin(a)*radius*.86]);
    }
    c.beginPath();
    [...arc.map(([x,z])=>project(x,0,z)),...arc.slice().reverse().map(([x,z])=>project(x,.57,z))].forEach(([x,y],n)=>n?c.lineTo(x,y):c.moveTo(x,y));
    c.closePath();c.fillStyle=gradient(0,y-ry-k*.6,0,y+ry,[[0,color+'cc'],[.55,'#4c658dc2'],[1,'#40536fa0']]);c.fill();c.strokeStyle='#758ba399';c.lineWidth=1;c.stroke();
    c.beginPath();arc.forEach(([x,z],n)=>{const [sx,sy]=project(x,.57,z);if(n)c.lineTo(sx,sy);else c.moveTo(sx,sy);});
    c.strokeStyle='#ffffff';c.lineWidth=Math.max(1.4,k*.065);c.stroke();
  }
  function crew(x,z,col,phase,heading){
    const [u,v]=project(x,0,z),s=k*.78,step=Math.sin(phase)*s*.10;
    ellipse(u,v+1,s*.33,s*.088,'#050a1b91');c.lineCap='round';
    for(const sign of [-1,1]){line(u+sign*s*.08,v-s*.36,u+sign*s*.13+step*sign,v-s*.04,'#192432',s*.14);line(u+sign*s*.13+step*sign,v-s*.04,u+sign*s*.14+step*sign+s*.04,v,'#8298ab',s*.095);}
    const suit=gradient(u-s*.26,0,u+s*.26,0,[[0,'#12293c'],[.24,col],[.43,'#9aaeba'],[.65,'#40546b'],[1,'#172333']]);
    ellipse(u,v-s*.52,s*.23,s*.34,suit);line(u-s*.17,v-s*.56,u-s*.24-step*.4,v-s*.34,'#8298a4',s*.09);
    const helm=gradient(u-s*.22,v-s*.99,u+s*.21,v-s*.72,[[0,'#e6fbff'],[.32,'#a7c2d3'],[.62,'#536b87'],[1,'#202b3e']]);
    ellipse(u,v-s*.93,s*.265,s*.26,helm);ellipse(u+Math.sin(heading+yaw)*s*.07,v-s*.93,s*.193,s*.117,'#102134',col,s*.028);
    line(u-s*.09,v-s*.96,u+s*.085,v-s*.98,col,Math.max(1,s*.04));c.lineCap='butt';
  }
  function draw(){
    if(!w||!h)return;const target=decks.find(d=>d.id===selected)||decks[0];
    cx=focus?target.x:0;cz=focus?target.z:0;k=Math.min(w/(focus?8.8:18.4),h/(focus?6.6:15.0))*zoom;
    backdrop();points=[];crewHits=[];const objects=[],add=(x,z,fn)=>objects.push([project(x,0,z)[2],fn]);
    decks.forEach((d,i)=>{skybridge(d);add(d.x,d.z,()=>platform(d,i));});
    add(0,0,()=>platform({x:0,z:0},-1));
    const hubDepth=project(0,0,0)[2];
    objects.push([hubDepth+.4,()=>{
      const [x,y]=project(0,0,0);ellipse(x,y,k*.48,k*.48*Math.sin(pitch),'#263750','#aaf5e7');
      crew(0,0,'#aefdea',0,0);
      const top=project(0,1.32,0);
      const hologram=c.createRadialGradient(top[0],top[1],0,top[0],top[1],k*.74);
      hologram.addColorStop(0,'#a8ffea80');hologram.addColorStop(1,'#83eee000');
      ellipse(top[0],top[1],k*.74,k*.74,hologram);
      c.save();c.translate(top[0],top[1]);c.rotate(-.32);
      ellipse(0,0,k*.35,k*.34,'#95f9e730','#b1ffeb',1.2);
      ellipse(0,0,k*.16,k*.34,null,'#bbfce6aa');ellipse(0,0,k*.52,k*.12,null,'#dfcffb',1.3);
      c.restore();
    }]);
    decks.forEach((d,i)=>{
      const route=patrol(d,i,t,tour),{x,z}=route;
      // The support deck always paints before the feet standing on it.
      let depth=project(x,0,z)[2];
      if(Math.hypot(x,z)<=hubRadius+.22) depth=Math.max(depth,hubDepth+.03);
      if(Math.hypot(x-d.x,z-d.z)<=roomRadius+.22) depth=Math.max(depth,project(d.x,0,d.z)[2]+.03);
      const [sx,sy]=project(x,.44,z);crewHits.push({id:d.id,x:sx,y:sy,r:Math.max(6,k*.31)});
      objects.push([depth+.10,()=>crew(x,z,colors[i],route.moving?t*7+i:0,route.heading)]);
    });
    objects.sort((a,b)=>a[0]-b[0]).forEach(o=>o[1]());
    const [hx,hy]=project(0,0,0);
    points.push({id:'hub',x:hx,y:hy,r:k*hubRadius});
    if(labels&&!focus){
      const text='CONTROL HUB';c.font='650 '+(w<520?9:11)+'px Consolas,monospace';const tw=c.measureText(text).width+14;
      const ly=hy+k*hubRadius*Math.sin(pitch)+8;
      c.fillStyle='#17283e';c.beginPath();c.roundRect(hx-tw/2,ly-8,tw,16,4);c.fill();
      c.textBaseline='middle';c.fillStyle='#abfbe8';c.fillText(text,hx-tw/2+7,ly);
      points.push({id:'hub',x:hx,y:ly,r:tw/2,label:true});
    }
    lastLabels=[];decks.forEach((d,i)=>{
      let [x,y]=project(d.x,0,d.z);points.push({id:d.id,x,y,r:1.85*k});if(!labels||(focus&&d!==target))return;
      const small=w<520,title=agents.find(a=>a.id===d.id)?.name||projects[i],fs=small?10:13;
      c.font='600 '+fs+'px Segoe UI, sans-serif';
      const width=c.measureText(title).width+16,height=small?20:25;
      const [ax,ay]=project(d.x*1.34,0,d.z*1.34);
      x=clamp(ax+(ax-w/2)*.05,width/2+4,w-width/2-4);
      y=clamp(ay+(ay<h*.52?-1:1)*height*.62,height/2+3,h-height/2-3);
      for(const p of lastLabels) if(Math.abs(p.x-x)<(p.width+width)/2+3&&Math.abs(p.y-y)<height+2)y=clamp(p.y+height+3,height/2+2,h-height/2-3);
      lastLabels.push({x,y,width});
      c.beginPath();c.roundRect(x-width/2,y-height/2,width,height,height/2);
      c.fillStyle='#ffffffed';c.fill();c.strokeStyle='#b7c9d4';c.lineWidth=1;c.stroke();
      c.fillStyle='#293b50';c.textBaseline='middle';c.fillText(title,x-width/2+8,y);
      points.push({id:d.id,x,y,r:width/2,label:true});
    });
    const watched=crewHits.find(hit=>hit.id===hoveredCrew);if(watched&&labels){
      const i=decks.findIndex(d=>d.id===watched.id),label=roles[i];c.font='600 11px Consolas, monospace';const width=c.measureText(label).width+12;
      const x=clamp(watched.x,width/2,w-width/2),y=clamp(watched.y-k*.62,12,h-12);c.fillStyle='#081622';c.fillRect(x-width/2,y-9,width,17);c.fillStyle=colors[i];c.fillText(label,x-width/2+6,y);
    }
  }
  function frame(now){raf=0;if(!visible||document.hidden)return;if(last&&now-last<32&&play&&tour&&!motion.matches){raf=requestAnimationFrame(frame);return;}if(last&&play&&tour&&!motion.matches)t+=Math.min(.10,(now-last)/1000);last=now;draw();if(play&&tour&&!motion.matches)raf=requestAnimationFrame(frame);}
  function refresh(){if(!raf&&visible&&!document.hidden)raf=requestAnimationFrame(frame);}
  function resize(){const r=canvas.getBoundingClientRect();w=r.width;h=r.height;const scale=Math.min(2,devicePixelRatio||1);canvas.width=w*scale;canvas.height=h*scale;c.setTransform(scale,0,0,scale,0,0);refresh();}
  function controls(){by('sceneMode').textContent=tour?'Show positions':'Crew tour';by('sceneMode').setAttribute('aria-pressed',tour);by('scenePlay').textContent=play?'Pause':'Resume';by('scenePlay').setAttribute('aria-pressed',play);by('sceneFocus').textContent=focus?'Full map':'Focus room';by('sceneFocus').setAttribute('aria-pressed',focus);by('sceneCaption').textContent=tour?'Crew patrol':'Agent positions';by('sceneEvidence').textContent=tour?'Ambient movement':'Assigned home rooms';refresh();}
  by('sceneMode').onclick=()=>{tour=!tour;controls();};by('scenePlay').onclick=()=>{play=!play;last=0;controls();};by('sceneFocus').onclick=()=>{focus=!focus;zoom=1;controls();};
  by('orbitLeft').onclick=()=>{yaw-=.30;refresh();};by('orbitRight').onclick=()=>{yaw+=.30;refresh();};
  function scale(f){zoom=clamp(zoom*f,.7,2.25);refresh();}
  by('zoomIn').onclick=()=>scale(1.18);by('zoomOut').onclick=()=>scale(1/1.18);
  canvas.onpointerdown=e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,yaw,pitch,moved:false};canvas.setPointerCapture(e.pointerId);};
  canvas.onpointermove=e=>{if(!drag){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const hit=crewHits.find(q=>Math.hypot(q.x-x,q.y-y)<q.r);const id=hit?.id||null;if(id!==hoveredCrew){hoveredCrew=id;refresh();}return;}const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)drag.moved=true;if(drag.moved){yaw=drag.yaw+dx*.009;pitch=clamp(drag.pitch+dy*.005,.27,1.22);refresh();}};
  canvas.onpointerup=e=>{if(drag&&!drag.moved){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const p=crewHits.find(q=>Math.hypot(q.x-x,q.y-y)<q.r)||points.filter(q=>q.label?Math.abs(q.x-x)<q.r&&Math.abs(q.y-y)<11:Math.hypot(q.x-x,(q.y-y)*1.3)<q.r).at(-1);if(p&&(p.id==='hub'||agents.some(a=>a.id===p.id)))onSelect(p.id);}drag=null;};canvas.onpointercancel=()=>{drag=null;};
  canvas.onkeydown=e=>{if(e.key==='ArrowLeft')yaw-=.18;else if(e.key==='ArrowRight')yaw+=.18;else if(e.key==='ArrowUp')pitch=clamp(pitch+.10,.27,1.22);else if(e.key==='ArrowDown')pitch=clamp(pitch-.10,.27,1.22);else if(e.key==='Home'){yaw=.32;pitch=.89;zoom=1;focus=false;controls();}else return;e.preventDefault();refresh();};
  const ro=new ResizeObserver(resize);ro.observe(canvas);const io=new IntersectionObserver(([r])=>{visible=r.isIntersecting;last=0;refresh();});io.observe(canvas);
  const visibility=()=>{last=0;refresh();};document.addEventListener('visibilitychange',visibility);motion.addEventListener('change',visibility);resize();controls();
  return {update(s){agents=s.agents;selected=s.selectedId;labels=s.labels;refresh();},destroy(){cancelAnimationFrame(raf);ro.disconnect();io.disconnect();document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',visibility);}};
}
