'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {WebSocketServer,WebSocket}=require('ws');
const PORT=Number(process.env.PORT||10000);
const W=2000,H=1320,MAX=4,slots=new Map();
const starts=[[170,285],[1830,285],[170,1035],[1830,1035]];
const walls=[],furniture=[];
const wall=(x,y,w,h)=>walls.push({x,y,w,h});
const cover=(x,y,w,h)=>furniture.push({x,y,w,h});
// Solid perimeter and scattered cover. Identical geometry in browser and server.
wall(0,0,2000,22);wall(0,1298,2000,22);wall(0,0,22,1320);wall(1978,0,22,1320);
for(const [x,y,w,h] of [
 [260,215,280,32],[260,215,32,175],[1460,215,280,32],[1708,215,32,175],
 [260,945,32,175],[260,1088,280,32],[1460,1088,280,32],[1708,945,32,175],
 [660,175,32,225],[660,368,170,32],[1308,175,32,225],[1170,368,170,32],
 [660,920,170,32],[660,920,32,225],[1170,920,170,32],[1308,920,32,225],
 [900,480,32,120],[1068,720,32,120]])wall(x,y,w,h);
for(const [x,y,w,h] of [
 [420,470,145,94],[1435,470,145,94],[420,750,145,94],[1435,750,145,94],
 [925,180,150,90],[925,1040,150,90],[690,625,165,38],[1145,625,165,38],
 [960,410,38,115],[1002,795,38,115],
 [380,340,58,58],[455,340,58,58],[1480,340,58,58],[1555,340,58,58],
 [380,925,58,58],[455,925,58,58],[1480,925,58,58],[1555,925,58,58],
 [780,490,55,55],[1165,775,55,55],[810,810,55,55],[1160,490,55,55]
])cover(x,y,w,h);
function hitRect(x,y,r,o){const a=Math.max(o.x,Math.min(x,o.x+o.w)),b=Math.max(o.y,Math.min(y,o.y+o.h));return (x-a)**2+(y-b)**2<r*r}
function blocked(x,y,r){return x<r||y<r||x>W-r||y>H-r||walls.some(o=>hitRect(x,y,r,o))||furniture.some(o=>hitRect(x,y,r,o))}
function occupied(p,x,y){
 if(blocked(x,y,15))return true;
 for(const q of slots.values())if(q!==p&&q.hp>0&&Math.hypot(x-q.x,y-q.y)<30)return true;
 return false;
}
function move(p,dx,dy){
 // Delsteg hindrar spelare från att hoppa genom väggar eller varandra.
 const n=Math.max(1,Math.ceil(Math.hypot(dx,dy)/7));dx/=n;dy/=n;
 for(let i=0;i<n;i++){
  if(!occupied(p,p.x+dx,p.y))p.x+=dx;
  if(!occupied(p,p.x,p.y+dy))p.y+=dy;
 }
}
// Weapons are separate from temporary powerups. Every round starts unarmed.
const types=['speed','armor','regen'];
const weapons={pistol10:{name:'Pistol',ammo:10,rate:.38,damage:22,speed:610},pistol20:{name:'Pistol XL',ammo:20,rate:.30,damage:19,speed:610},auto:{name:'Automatvapen',seconds:20,rate:.12,damage:12,speed:700}};
const lootTypes=['pistol10','pistol20','auto','speed','armor','regen'];

let phase='lobby',level=1,roundEnd=0,countdownEnd=0,zone={x:1000,y:660,r:1250},zoneNext=null,zoneStage=0,zoneClock=0,zoneFrom=null,zoneMode='wait',pickups=[],shots=[],bulletId=0,pickupClock=3,now=Date.now();
function roster(){return [...slots.values()].sort((a,b)=>a.slot-b.slot).map(p=>({slot:p.slot,id:p.id,name:p.name,bot:!!p.bot,hp:p.hp,alive:p.hp>0,x:p.x,y:p.y,aim:p.aim,power:p.power,powerLeft:p.powerLeft,kills:p.kills,hits:p.hits||0,weapon:p.weapon,ammo:p.ammo||0,weaponLeft:p.weaponLeft||0,replay:!!p.replay}))}
function publicState(){return {phase,level,players:roster(),zone,zoneNext,zoneMode,zoneClock,zoneStage,pickups,shots:shots.map(({id,x,y})=>({id,x,y})),serverTime:Date.now(),roundEnd,countdownEnd,required:1,max:4}}
function resetRound(){phase='playing';roundEnd=0;countdownEnd=0;shots=[];pickups=[];pickupClock=.6;zone={x:1000,y:660,r:1250};zoneNext=null;zoneStage=0;zoneClock=0;zoneFrom=null;zoneMode='wait';prepareNextZone();for(const p of slots.values()){const [x,y]=starts[p.slot-1];Object.assign(p,{path:[],pathClock:0,x,y,hp:100,aim:0,shootClock:0,power:null,powerLeft:0,weapon:null,ammo:0,weaponLeft:0,hits:0,replay:false,regenClock:0,input:{dx:0,dy:0,shoot:false,aim:0}})}for(let i=0;i<7;i++)pickupSpawn()}
// A target circle is always completely contained in the current safe circle.
const zoneRadii=[900,650,465,335,235,145,65];
const ZONE_WAIT=12,ZONE_SHRINK=25;
function prepareNextZone(){
 if(zoneStage>=zoneRadii.length){zoneNext=null;zoneMode='done';return}
 const r=zoneRadii[zoneStage],maxOffset=Math.max(0,zone.r-r-3);
 // Keep the next ring inside both the previous ring and the playable map.
 let x=zone.x,y=zone.y;
 for(let i=0;i<80;i++){
  const a=Math.random()*Math.PI*2,d=Math.sqrt(Math.random())*maxOffset;
  const nx=zone.x+Math.cos(a)*d,ny=zone.y+Math.sin(a)*d;
  if((r>620 || (nx-r>=40&&nx+r<=1960&&ny-r>=40&&ny+r<=1280))){x=nx;y=ny;break}
 }
 // Large first circles may not fit the map vertically; containment in the old circle takes priority.
 zoneNext={x,y,r};zoneMode='wait';zoneClock=ZONE_WAIT;
}
function updateZone(dt){
 if(!zoneNext)return;
 zoneClock-=dt;
 if(zoneMode==='wait'&&zoneClock<=0){zoneMode='shrink';zoneClock=ZONE_SHRINK;zoneFrom={...zone}}
 if(zoneMode==='shrink'){
  const k=Math.max(0,Math.min(1,1-zoneClock/ZONE_SHRINK));
  zone.x=zoneFrom.x+(zoneNext.x-zoneFrom.x)*k;
  zone.y=zoneFrom.y+(zoneNext.y-zoneFrom.y)*k;
  zone.r=zoneFrom.r+(zoneNext.r-zoneFrom.r)*k;
  if(zoneClock<=0){zone={...zoneNext};zoneStage++;prepareNextZone()}
 }
}
function resetLobby(){phase='lobby';level=1;countdownEnd=0;shots=[];pickups=[];for(const [id,p] of slots)if(p.bot)slots.delete(id)}
function startMatch(fillBots=true){if(phase!=='lobby')return false;
 const humans=[...slots.values()].filter(p=>!p.bot);
 if(!humans.length)return false;
 for(let slot=1;slot<=4;slot++)if(fillBots&&!humans.some(p=>p.slot===slot)){
   const [x,y]=starts[slot-1],id='bot-'+slot;
   slots.set(id,{id,name:'Dator '+slot,slot,bot:true,x,y,hp:100,aim:0,kills:0,hits:0,power:null,powerLeft:0,weapon:null,ammo:0,weaponLeft:0,seen:Date.now(),input:{},path:[],pathClock:0,strafe:slot%2?1:-1});
 }
 level=1;for(const p of slots.values()){p.kills=0;p.hits=0;p.replay=false;}phase='countdown';countdownEnd=Date.now()+4000;return true;
}
function cleanup(){const t=Date.now();let removed=false;for(const [id,p] of slots)if(!p.bot&&t-p.seen>18000){slots.delete(id);removed=true}if(removed&&phase!=='lobby'&&![...slots.values()].some(p=>!p.bot))resetLobby();else if(removed&&phase==='intermission')checkReplays()}
function checkReplays(){if(phase!=='intermission')return;const humans=[...slots.values()].filter(p=>!p.bot);if(humans.length&&humans.every(p=>p.replay)){level++;phase='countdown';countdownEnd=Date.now()+4000;}}
function pickupSpawn(){for(let i=0;i<100;i++){let x=35+Math.random()*(W-70),y=35+Math.random()*(H-70);if(!blocked(x,y,20)&&!pickups.some(p=>Math.hypot(p.x-x,p.y-y)<95)){pickups.push({id:crypto.randomUUID(),x,y,type:lootTypes[Math.floor(Math.random()*lootTypes.length)],life:24});return}}}
const CELL=35,COLS=Math.ceil(W/CELL),ROWS=Math.ceil(H/CELL);
function navigate(bot,target){
 const cell=(x,y)=>[Math.max(0,Math.min(COLS-1,Math.floor(x/CELL))),Math.max(0,Math.min(ROWS-1,Math.floor(y/CELL)))];
 const [sx,sy]=cell(bot.x,bot.y),[tx,ty]=cell(target.x,target.y),start=sy*COLS+sx,goal=ty*COLS+tx;
 const queue=[start],prev=new Int32Array(COLS*ROWS).fill(-1);prev[start]=start;
 for(let at=0;at<queue.length;at++){
  const c=queue[at];if(c===goal)break;const x=c%COLS,y=Math.floor(c/COLS);
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const xx=x+dx,yy=y+dy,k=yy*COLS+xx;
   if(xx<0||yy<0||xx>=COLS||yy>=ROWS||prev[k]!==-1||blocked((xx+.5)*CELL,(yy+.5)*CELL,15))continue;
   prev[k]=c;queue.push(k);
  }
 }
 if(prev[goal]===-1)return [];
 const result=[];let c=goal;while(c!==start&&result.length<300){result.push({x:(c%COLS+.5)*CELL,y:(Math.floor(c/COLS)+.5)*CELL});c=prev[c]}
 result.reverse();return result;
}
function clearShot(a,b){const d=Math.hypot(b.x-a.x,b.y-a.y),n=Math.ceil(d/15);for(let i=1;i<n;i++){const t=i/n;if(blocked(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,4))return false}return true}
function botInput(bot,people,dt){
 // Unarmed bots search for a weapon instead of relentlessly chasing people.
 if(!bot.weapon){const loot=pickups.filter(x=>weapons[x.type]).sort((a,b)=>Math.hypot(a.x-bot.x,a.y-bot.y)-Math.hypot(b.x-bot.x,b.y-bot.y))[0];
 if(loot){bot.pathClock=(bot.pathClock||0)-dt;if(bot.pathClock<=0){bot.path=navigate(bot,loot);bot.pathClock=.7}while(bot.path?.length&&Math.hypot(bot.path[0].x-bot.x,bot.path[0].y-bot.y)<21)bot.path.shift();const next=bot.path?.[0]||loot,d=Math.hypot(next.x-bot.x,next.y-bot.y);bot.input={dx:d>5?(next.x-bot.x)/d:0,dy:d>5?(next.y-bot.y)/d:0,shoot:false,aim:bot.aim};return}}
 const others=people.filter(p=>p.id!==bot.id&&p.hp>0);if(!others.length){bot.input={dx:0,dy:0,shoot:false,aim:0};return}
 const target=others.reduce((a,b)=>Math.hypot(a.x-bot.x,a.y-bot.y)<Math.hypot(b.x-bot.x,b.y-bot.y)?a:b);
 bot.pathClock=(bot.pathClock||0)-dt;
 if(bot.pathClock<=0){bot.path=navigate(bot,target);bot.pathClock=.65+bot.slot*.06}
 while(bot.path?.length&&Math.hypot(bot.path[0].x-bot.x,bot.path[0].y-bot.y)<21)bot.path.shift();
 const next=bot.path?.[0]||target,dist=Math.hypot(next.x-bot.x,next.y-bot.y),angle=Math.atan2(target.y-bot.y,target.x-bot.x);
 // Bots need time to aim, miss occasionally and take breaks between bursts.
 bot.aimClock=(bot.aimClock||0)-dt;
 if(bot.aimClock<=0){
   bot.aimOffset=(Math.random()-.5)*0.65;
   bot.aimClock=.55+Math.random()*.55;
 }
 bot.triggerClock=(bot.triggerClock||0)-dt;
 if(bot.triggerClock<=0){
   bot.triggerOn=Math.random()<.58;
   bot.triggerClock=.38+Math.random()*.65;
 }
 bot.input={dx:dist>8?(next.x-bot.x)/dist:0,dy:dist>8?(next.y-bot.y)/dist:0,aim:angle+(bot.aimOffset||0),shoot:bot.triggerOn&&clearShot(bot,target)&&Math.hypot(target.x-bot.x,target.y-bot.y)<480};
}
let last=Date.now();setInterval(()=>{const t=Date.now(),dt=Math.min(.08,(t-last)/1000);last=t;cleanup();if(phase==='countdown'){if(t>=countdownEnd){if(level>1){ /* keep previous score */ }resetRound()}return}if(phase!=='playing')return;
 updateZone(dt);pickupClock-=dt;if(pickupClock<=0){if(pickups.length<12)pickupSpawn();pickupClock=1.8+Math.random()*2.2}pickups=pickups.filter(p=>(p.life-=dt)>0);
 const people=[...slots.values()];for(const p of people){if(p.bot&&p.hp>0)botInput(p,people,dt);if(p.hp<=0)continue;p.shootClock-=dt;
 if(p.weapon==='auto'){p.weaponLeft=Math.max(0,(p.weaponLeft||0)-dt);if(p.weaponLeft===0){p.weapon=null;p.ammo=0}}
 p.powerLeft=Math.max(0,p.powerLeft-dt);if(!p.powerLeft)p.power=null;const inp=p.input||{};let dx=Number(inp.dx)||0,dy=Number(inp.dy)||0,n=Math.hypot(dx,dy);if(n>1){dx/=n;dy/=n}const speed=(p.power==='speed'?285:(p.weapon?205:238))*(p.bot?.78:1);move(p,dx*speed*dt,dy*speed*dt);if(p.bot){p.aim=Number.isFinite(+inp.aim)?+inp.aim:p.aim}else if(Math.hypot(dx,dy)>.1){p.aim=Math.atan2(dy,dx)}
 if(inp.shoot&&p.shootClock<=0&&p.weapon&&weapons[p.weapon]){
 const gun=weapons[p.weapon];p.shootClock=p.bot?Math.max(.42,gun.rate*2):gun.rate;
 if(p.weapon!=='auto'){p.ammo--;if(p.ammo<=0){p.weapon=null;p.ammo=0}}
 let sp=gun.speed;// Kulor måste födas framför spelaren utan att överlappa en vägg eller möbel.
 const sx=p.x+Math.cos(p.aim)*20,sy=p.y+Math.sin(p.aim)*20;
 if(!blocked(sx,sy,5)&&clearShot(p,{x:sx,y:sy}))shots.push({id:++bulletId,owner:p.id,x:sx,y:sy,vx:Math.cos(p.aim)*sp,vy:Math.sin(p.aim)*sp,damage:p.bot?Math.round(gun.damage*.7):gun.damage,life:1.9})}
 for(let i=pickups.length-1;i>=0;i--)if(Math.hypot(p.x-pickups[i].x,p.y-pickups[i].y)<29){const loot=pickups[i].type;
 if(weapons[loot]){p.weapon=loot;p.ammo=weapons[loot].ammo||0;p.weaponLeft=weapons[loot].seconds||0;p.shootClock=0}
 else{p.power=loot;p.powerLeft=5}
 pickups.splice(i,1)}
 if(p.power==='regen')p.hp=Math.min(100,p.hp+10*dt);
 if(Math.hypot(p.x-zone.x,p.y-zone.y)>zone.r)p.hp=Math.max(0,p.hp-(10+level*2)*dt);
 }
 // Kulor kontrolleras längs hela rörelsen, så de inte passerar tunna väggar mellan tickar.
 for(let i=shots.length-1;i>=0;i--){
  const shot=shots[i],dx=shot.vx*dt,dy=shot.vy*dt;
  shot.life-=dt;
  let gone=shot.life<=0;
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/5));
  for(let step=0;step<steps&&!gone;step++){
   shot.x+=dx/steps;shot.y+=dy/steps;
   if(blocked(shot.x,shot.y,5)){gone=true;break}
   for(const victim of people){
    if(victim.id===shot.owner||victim.hp<=0)continue;
    if(Math.hypot(victim.x-shot.x,victim.y-shot.y)<19){
     const attacker=slots.get(shot.owner);
     if(attacker)attacker.hits=(attacker.hits||0)+1;
     victim.hp=Math.max(0,victim.hp-shot.damage*(victim.power==='armor'?.4:1));
     if(victim.hp===0&&attacker)attacker.kills++;
     gone=true;break;
    }
   }
  }
  if(gone)shots.splice(i,1);
 }
 const alive=people.filter(p=>p.hp>0);if(alive.length<=1){phase='intermission';roundEnd=Date.now();for(const p of people)if(p.bot)p.replay=true;checkReplays();}
},33);
function send(res,obj,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});res.end(JSON.stringify(obj))}
function getBody(req){return new Promise((resolve,reject)=>{let s='';req.on('data',x=>{s+=x;if(s.length>15000){reject(new Error('För stor begäran'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch{resolve({})}});req.on('error',reject)})}
const serve={'/':'index.html','/index.html':'index.html'};
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&url.pathname==='/api/status')return send(res,publicState());
 if(req.method==='POST'){const b=await getBody(req);if(url.pathname==='/api/join'){let id=String(b.id||'').slice(0,100),name=String(b.name||'Spelare').trim().slice(0,20)||'Spelare',slot=Number(b.slot);if(!Number.isInteger(slot)||slot<1||slot>4)return send(res,{error:'Välj en plats 1–4'},400);let existing=slots.get(id);if(existing&&existing.bot)return send(res,{error:'Reserverad datorplats'},409);if(existing&&existing.slot!==slot)return send(res,{error:'Du har redan en plats'},409);if([...slots.values()].some(p=>p.slot===slot&&p.id!==id))return send(res,{error:'Platsen är upptagen'},409);if(!existing){if(phase!=='lobby')return send(res,{error:'Match pågår. Försök efter matchen.'},409);id=id||crypto.randomUUID();const [x,y]=starts[slot-1];existing={id,name,slot,ready:false,x,y,hp:100,aim:0,seen:Date.now(),power:null,powerLeft:0,weapon:null,ammo:0,weaponLeft:0,kills:0,input:{}};slots.set(id,existing)}existing.name=name;existing.seen=Date.now();return send(res,{ok:true,id,slot,state:publicState()})}
 const p=slots.get(String(b.id||''));if(!p)return send(res,{error:'Din plats har gått ut, anslut igen'},403);p.seen=Date.now();if(url.pathname==='/api/start'){if(phase!=='lobby')return send(res,{error:'Matchen är redan igång'},409);const humans=[...slots.values()].filter(x=>!x.bot).sort((a,b)=>a.slot-b.slot);if(humans[0]?.id!==p.id)return send(res,{error:'Den som först reserverade en plats (lägsta platsnummer) startar matchen'},403);startMatch(b.fillBots!==false);return send(res,{ok:true,state:publicState()})}
 if(url.pathname==='/api/replay'){if(p.bot)return send(res,{error:'Datorn kan inte rösta'},403);if(phase!=='intermission')return send(res,{error:'Vänta tills rundan är slut'},409);p.replay=true;checkReplays();return send(res,{ok:true,state:publicState()})}
 if(url.pathname==='/api/input'){if(phase==='playing'){const input=b.input||{};p.input={dx:Math.max(-1,Math.min(1,Number(input.dx)||0)),dy:Math.max(-1,Math.min(1,Number(input.dy)||0)),aim:Math.max(-10000,Math.min(10000,Number(input.aim)||0)),shoot:!!input.shoot}}return send(res,publicState())}
 if(url.pathname==='/api/leave'){slots.delete(p.id);if(phase!=='lobby'&&![...slots.values()].some(x=>!x.bot))resetLobby();else if(phase==='intermission')checkReplays();return send(res,{ok:true})}
 }
 if(req.method==='GET'&&serve[url.pathname]){const contents=fs.readFileSync(path.join(__dirname,serve[url.pathname]));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});return res.end(contents)}res.writeHead(404);res.end('Not found')
 }catch(e){console.error(e);if(!res.headersSent)send(res,{error:'Serverfel'},500)}});
// Samma HTTP-server och port används för HTTPS och WSS på Render.
const wss=new WebSocketServer({server,path:'/ws',maxPayload:2048});
const connections=new Map();
function broadcast(){
 if(!connections.size)return;
 const payload=JSON.stringify({type:'state',state:publicState()});
 for(const ws of connections.keys())if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<100000)ws.send(payload);
}
function notify(){broadcast()}
wss.on('connection',ws=>{
 connections.set(ws,null);
 ws.on('message',buf=>{
  let msg;try{msg=JSON.parse(buf.toString())}catch{return}
  if(!msg||typeof msg!=='object')return;
  if(msg.type==='hello'){
   const id=String(msg.id||'').slice(0,100),p=slots.get(id);
   if(!p||p.bot){ws.send(JSON.stringify({type:'error',error:'Anslut till en spelarplats först'}));return}
   connections.set(ws,id);p.seen=Date.now();ws.send(JSON.stringify({type:'state',state:publicState()}));return;
  }
  const id=connections.get(ws),p=id&&slots.get(id);
  if(!p||p.bot)return;
  p.seen=Date.now();
  if(msg.type==='input'&&phase==='playing'){
   const inp=msg.input||{};
   const finite=v=>Number.isFinite(Number(v))?Number(v):0;
   p.input={dx:Math.max(-1,Math.min(1,finite(inp.dx))),dy:Math.max(-1,Math.min(1,finite(inp.dy))),shoot:!!inp.shoot,aim:0};
  }
 });
 ws.on('close',()=>connections.delete(ws));ws.on('error',()=>connections.delete(ws));
});
setInterval(broadcast,50); // 20 speluppdateringar per sekund
server.listen(PORT,'0.0.0.0',()=>console.log('Paintball Arena + WebSocket på port '+PORT));
