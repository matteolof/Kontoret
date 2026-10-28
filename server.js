'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=Number(process.env.PORT||10000),PASS=process.env.GAME_PASSWORD||'';
const W=2000,H=1320,MAX=4,slots=new Map();
const starts=[[305,1030],[315,235],[1010,240],[1675,1040]];
const regions=[
 ['KONTOR 1',48,48,546,490,315,true],['KONTOR 2',727,48,546,490,1000,true],['MÖTESRUM',1406,48,546,490,1679,true],
 ['KONTOR 3',48,782,546,490,315,false],['KONTOR 4',727,782,546,490,1000,false],['FIKARUM',1406,782,546,490,1679,false]];
const walls=[],furniture=[];function rect(x,y,w,h){walls.push({x,y,w,h})}function desk(x,y,w,h){furniture.push({x,y,w,h})}
for(const [name,x,y,w,h,dx,top] of regions){rect(x,y,12,h);rect(x+w-12,y,12,h);let a=dx-63,b=dx+63;if(top){rect(x,y,w,12);rect(x,y+h-12,a-x,12);rect(b,y+h-12,x+w-b,12)}else{rect(x,y,a-x,12);rect(b,y,x+w-b,12);rect(x,y+h-12,w,12)}if(name.startsWith('KONTOR')){desk(x+64,y+100,115,52);desk(x+w-182,y+106,115,52);desk(x+66,y+300,115,52);desk(x+w-182,y+304,115,52)}else if(name==='MÖTESRUM'){desk(x+194,y+170,158,86);desk(x+70,y+300,95,36);desk(x+w-166,y+300,95,36)}else{desk(x+55,y+110,120,55);desk(x+w-170,y+110,115,55);desk(x+194,y+278,160,68)}}
function hitRect(x,y,r,o){const a=Math.max(o.x,Math.min(x,o.x+o.w)),b=Math.max(o.y,Math.min(y,o.y+o.h));return (x-a)**2+(y-b)**2<r*r}
function blocked(x,y,r){return x<r||y<r||x>W-r||y>H-r||walls.some(o=>hitRect(x,y,r,o))||furniture.some(o=>hitRect(x,y,r,o))}
function move(p,dx,dy){if(!blocked(p.x+dx,p.y,15))p.x+=dx;if(!blocked(p.x,p.y+dy,15))p.y+=dy}
const types=['damage','speed','fire','armor','bullet','regen'];
let phase='lobby',level=1,roundEnd=0,zone={x:1000,y:660,r:1300},pickups=[],shots=[],bulletId=0,pickupClock=3,now=Date.now();
function roster(){return [...slots.values()].sort((a,b)=>a.slot-b.slot).map(p=>({slot:p.slot,id:p.id,name:p.name,ready:p.ready,hp:p.hp,alive:p.hp>0,x:p.x,y:p.y,aim:p.aim,power:p.power,powerLeft:p.powerLeft,kills:p.kills}))}
function publicState(){return {phase,level,players:roster(),zone,pickups,shots:shots.map(({id,x,y})=>({id,x,y})),serverTime:Date.now(),roundEnd,required:4,max:4}}
function resetRound(){phase='playing';roundEnd=0;shots=[];pickups=[];pickupClock=2;zone={x:1000,y:660,r:1300};for(const p of slots.values()){const [x,y]=starts[p.slot-1];Object.assign(p,{x,y,hp:100,aim:0,shootClock:0,power:null,powerLeft:0,regenClock:0,input:{dx:0,dy:0,shoot:false,aim:0}})}}
function resetLobby(){phase='lobby';level=1;shots=[];pickups=[];for(const p of slots.values())p.ready=false}
function startIfReady(){if(phase==='lobby'&&slots.size===4&&[...slots.values()].every(p=>p.ready)){level=1;for(const p of slots.values())p.kills=0;resetRound()}}
function cleanup(){const t=Date.now();let removed=false;for(const [id,p] of slots)if(t-p.seen>18000){slots.delete(id);removed=true}if(removed&&phase!=='lobby')resetLobby()}
function pickupSpawn(){for(let i=0;i<100;i++){let x=35+Math.random()*(W-70),y=35+Math.random()*(H-70);if(!blocked(x,y,20)&&!pickups.some(p=>Math.hypot(p.x-x,p.y-y)<95)){pickups.push({id:crypto.randomUUID(),x,y,type:types[Math.floor(Math.random()*types.length)],life:14});return}}}
let last=Date.now();setInterval(()=>{const t=Date.now(),dt=Math.min(.08,(t-last)/1000);last=t;cleanup();if(phase==='between'){if(t>=roundEnd){level++;resetRound()}return}if(phase!=='playing')return;
 zone.r=Math.max(110,zone.r-dt*(22+(level-1)*5));pickupClock-=dt;if(pickupClock<=0){if(pickups.length<8)pickupSpawn();pickupClock=3+Math.random()*3}pickups=pickups.filter(p=>(p.life-=dt)>0);
 const people=[...slots.values()];for(const p of people){if(p.hp<=0)continue;p.shootClock-=dt;p.powerLeft=Math.max(0,p.powerLeft-dt);if(!p.powerLeft)p.power=null;const inp=p.input||{};let dx=Number(inp.dx)||0,dy=Number(inp.dy)||0,n=Math.hypot(dx,dy);if(n>1){dx/=n;dy/=n}const speed=p.power==='speed'?285:205;move(p,dx*speed*dt,dy*speed*dt);p.aim=Number.isFinite(+inp.aim)?+inp.aim:0;
 if(inp.shoot&&p.shootClock<=0){const freq=p.power==='fire'?.09:.21;p.shootClock=freq;let sp=p.power==='bullet'?850:540;shots.push({id:++bulletId,owner:p.id,x:p.x+Math.cos(p.aim)*20,y:p.y+Math.sin(p.aim)*20,vx:Math.cos(p.aim)*sp,vy:Math.sin(p.aim)*sp,damage:p.power==='damage'?29:19,life:1.9})}
 for(let i=pickups.length-1;i>=0;i--)if(Math.hypot(p.x-pickups[i].x,p.y-pickups[i].y)<29){p.power=pickups[i].type;p.powerLeft=5;pickups.splice(i,1)}
 if(p.power==='regen')p.hp=Math.min(100,p.hp+10*dt);
 if(Math.hypot(p.x-zone.x,p.y-zone.y)>zone.r)p.hp=Math.max(0,p.hp-(10+level*2)*dt);
 }
 for(let i=shots.length-1;i>=0;i--){const s=shots[i];s.x+=s.vx*dt;s.y+=s.vy*dt;s.life-=dt;let gone=s.life<=0||blocked(s.x,s.y,5);if(!gone)for(const p of people){if(p.id===s.owner||p.hp<=0)continue;if(Math.hypot(p.x-s.x,p.y-s.y)<19){p.hp=Math.max(0,p.hp-s.damage*(p.power==='armor'?.4:1));if(p.hp===0){const killer=slots.get(s.owner);if(killer)killer.kills++}gone=true;break}}if(gone)shots.splice(i,1)}
 const alive=people.filter(p=>p.hp>0);if(alive.length<=1){phase='between';roundEnd=Date.now()+4500;for(const p of people)p.ready=false}
},33);
function send(res,obj,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});res.end(JSON.stringify(obj))}
function getBody(req){return new Promise((resolve,reject)=>{let s='';req.on('data',x=>{s+=x;if(s.length>15000){reject(new Error('För stor begäran'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch{resolve({})}});req.on('error',reject)})}
const serve={'/':'index.html','/index.html':'index.html'};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&url.pathname==='/api/status')return send(res,publicState());
 if(req.method==='POST'){const b=await getBody(req);if(url.pathname==='/api/join'){if(PASS&&b.password!==PASS)return send(res,{error:'Fel lösenord'},403);let id=String(b.id||'').slice(0,100),name=String(b.name||'Spelare').trim().slice(0,20)||'Spelare',slot=Number(b.slot);if(!Number.isInteger(slot)||slot<1||slot>4)return send(res,{error:'Välj en plats 1–4'},400);let existing=slots.get(id);if(existing&&existing.slot!==slot)return send(res,{error:'Du har redan en plats'},409);if([...slots.values()].some(p=>p.slot===slot&&p.id!==id))return send(res,{error:'Platsen är upptagen'},409);if(!existing){if(phase!=='lobby')return send(res,{error:'Match pågår. Försök efter matchen.'},409);id=id||crypto.randomUUID();const [x,y]=starts[slot-1];existing={id,name,slot,ready:false,x,y,hp:100,aim:0,seen:Date.now(),power:null,powerLeft:0,kills:0,input:{}};slots.set(id,existing)}existing.name=name;existing.seen=Date.now();return send(res,{ok:true,id,slot,state:publicState()})}
 const p=slots.get(String(b.id||''));if(!p)return send(res,{error:'Din plats har gått ut, anslut igen'},403);p.seen=Date.now();if(url.pathname==='/api/ready'){if(phase!=='lobby')return send(res,{error:'Matchen är redan igång'},409);p.ready=!!b.ready;startIfReady();return send(res,{ok:true,state:publicState()})}
 if(url.pathname==='/api/input'){if(phase==='playing'){const input=b.input||{};p.input={dx:Math.max(-1,Math.min(1,Number(input.dx)||0)),dy:Math.max(-1,Math.min(1,Number(input.dy)||0)),aim:Math.max(-10000,Math.min(10000,Number(input.aim)||0)),shoot:!!input.shoot}}return send(res,publicState())}
 if(url.pathname==='/api/leave'){slots.delete(p.id);if(phase!=='lobby')resetLobby();return send(res,{ok:true})}
 }
 if(req.method==='GET'&&serve[url.pathname]){const contents=fs.readFileSync(path.join(__dirname,serve[url.pathname]));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});return res.end(contents)}res.writeHead(404);res.end('Not found')
 }catch(e){console.error(e);if(!res.headersSent)send(res,{error:'Serverfel'},500)}}).listen(PORT,'0.0.0.0',()=>console.log('Office Royale Online på port '+PORT));
