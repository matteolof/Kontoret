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
let phase='lobby',level=1,roundEnd=0,countdownEnd=0,zone={x:1000,y:660,r:1300},pickups=[],shots=[],bulletId=0,pickupClock=3,now=Date.now();
function roster(){return [...slots.values()].sort((a,b)=>a.slot-b.slot).map(p=>({slot:p.slot,id:p.id,name:p.name,bot:!!p.bot,hp:p.hp,alive:p.hp>0,x:p.x,y:p.y,aim:p.aim,power:p.power,powerLeft:p.powerLeft,kills:p.kills,hits:p.hits||0,replay:!!p.replay}))}
function publicState(){return {phase,level,players:roster(),zone,pickups,shots:shots.map(({id,x,y})=>({id,x,y})),serverTime:Date.now(),roundEnd,countdownEnd,required:1,max:4}}
function resetRound(){phase='playing';roundEnd=0;countdownEnd=0;shots=[];pickups=[];pickupClock=2;zone={x:1000,y:660,r:1300};for(const p of slots.values()){const [x,y]=starts[p.slot-1];Object.assign(p,{path:[],pathClock:0,x,y,hp:100,aim:0,shootClock:0,power:null,powerLeft:0,hits:0,replay:false,regenClock:0,input:{dx:0,dy:0,shoot:false,aim:0}})}}
function resetLobby(){phase='lobby';level=1;countdownEnd=0;shots=[];pickups=[];for(const [id,p] of slots)if(p.bot)slots.delete(id)}
function startMatch(){if(phase!=='lobby')return false;
 const humans=[...slots.values()].filter(p=>!p.bot);
 if(!humans.length)return false;
 for(let slot=1;slot<=4;slot++)if(!humans.some(p=>p.slot===slot)){
   const [x,y]=starts[slot-1],id='bot-'+slot;
   slots.set(id,{id,name:'Dator '+slot,slot,bot:true,x,y,hp:100,aim:0,kills:0,hits:0,power:null,powerLeft:0,seen:Date.now(),input:{},path:[],pathClock:0,strafe:slot%2?1:-1});
 }
 level=1;for(const p of slots.values()){p.kills=0;p.hits=0;p.replay=false;}phase='countdown';countdownEnd=Date.now()+4000;return true;
}
function cleanup(){const t=Date.now();let removed=false;for(const [id,p] of slots)if(!p.bot&&t-p.seen>18000){slots.delete(id);removed=true}if(removed&&phase!=='lobby'&&![...slots.values()].some(p=>!p.bot))resetLobby();else if(removed&&phase==='intermission')checkReplays()}
function checkReplays(){if(phase!=='intermission')return;const humans=[...slots.values()].filter(p=>!p.bot);if(humans.length&&humans.every(p=>p.replay)){level++;phase='countdown';countdownEnd=Date.now()+4000;}}
function pickupSpawn(){for(let i=0;i<100;i++){let x=35+Math.random()*(W-70),y=35+Math.random()*(H-70);if(!blocked(x,y,20)&&!pickups.some(p=>Math.hypot(p.x-x,p.y-y)<95)){pickups.push({id:crypto.randomUUID(),x,y,type:types[Math.floor(Math.random()*types.length)],life:14});return}}}
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
 zone.r=Math.max(110,zone.r-dt*(22+(level-1)*5));pickupClock-=dt;if(pickupClock<=0){if(pickups.length<8)pickupSpawn();pickupClock=3+Math.random()*3}pickups=pickups.filter(p=>(p.life-=dt)>0);
 const people=[...slots.values()];for(const p of people){if(p.bot&&p.hp>0)botInput(p,people,dt);if(p.hp<=0)continue;p.shootClock-=dt;p.powerLeft=Math.max(0,p.powerLeft-dt);if(!p.powerLeft)p.power=null;const inp=p.input||{};let dx=Number(inp.dx)||0,dy=Number(inp.dy)||0,n=Math.hypot(dx,dy);if(n>1){dx/=n;dy/=n}const speed=(p.power==='speed'?285:205)*(p.bot?.78:1);move(p,dx*speed*dt,dy*speed*dt);if(p.bot){p.aim=Number.isFinite(+inp.aim)?+inp.aim:p.aim}else if(Math.hypot(dx,dy)>.1){p.aim=Math.atan2(dy,dx)}
 if(inp.shoot&&p.shootClock<=0){const freq=p.power==='fire'?.09:.21;p.shootClock=p.bot?Math.max(.48,freq*2.5):freq;let sp=p.power==='bullet'?850:540;shots.push({id:++bulletId,owner:p.id,x:p.x+Math.cos(p.aim)*20,y:p.y+Math.sin(p.aim)*20,vx:Math.cos(p.aim)*sp,vy:Math.sin(p.aim)*sp,damage:p.bot?(p.power==='damage'?15:10):(p.power==='damage'?29:19),life:1.9})}
 for(let i=pickups.length-1;i>=0;i--)if(Math.hypot(p.x-pickups[i].x,p.y-pickups[i].y)<29){p.power=pickups[i].type;p.powerLeft=5;pickups.splice(i,1)}
 if(p.power==='regen')p.hp=Math.min(100,p.hp+10*dt);
 if(Math.hypot(p.x-zone.x,p.y-zone.y)>zone.r)p.hp=Math.max(0,p.hp-(10+level*2)*dt);
 }
 for(let i=shots.length-1;i>=0;i--){const s=shots[i];s.x+=s.vx*dt;s.y+=s.vy*dt;s.life-=dt;let gone=s.life<=0||blocked(s.x,s.y,5);if(!gone)for(const p of people){if(p.id===s.owner||p.hp<=0)continue;if(Math.hypot(p.x-s.x,p.y-s.y)<19){const attacker=slots.get(s.owner);if(attacker)attacker.hits=(attacker.hits||0)+1;p.hp=Math.max(0,p.hp-s.damage*(p.power==='armor'?.4:1));if(p.hp===0){const killer=slots.get(s.owner);if(killer)killer.kills++}gone=true;break}}if(gone)shots.splice(i,1)}
 const alive=people.filter(p=>p.hp>0);if(alive.length<=1){phase='intermission';roundEnd=Date.now();for(const p of people)if(p.bot)p.replay=true;checkReplays();}
},33);
function send(res,obj,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});res.end(JSON.stringify(obj))}
function getBody(req){return new Promise((resolve,reject)=>{let s='';req.on('data',x=>{s+=x;if(s.length>15000){reject(new Error('För stor begäran'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch{resolve({})}});req.on('error',reject)})}
const serve={'/':'index.html','/index.html':'index.html'};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&url.pathname==='/api/status')return send(res,publicState());
 if(req.method==='POST'){const b=await getBody(req);if(url.pathname==='/api/join'){if(PASS&&b.password!==PASS)return send(res,{error:'Fel lösenord'},403);let id=String(b.id||'').slice(0,100),name=String(b.name||'Spelare').trim().slice(0,20)||'Spelare',slot=Number(b.slot);if(!Number.isInteger(slot)||slot<1||slot>4)return send(res,{error:'Välj en plats 1–4'},400);let existing=slots.get(id);if(existing&&existing.bot)return send(res,{error:'Reserverad datorplats'},409);if(existing&&existing.slot!==slot)return send(res,{error:'Du har redan en plats'},409);if([...slots.values()].some(p=>p.slot===slot&&p.id!==id))return send(res,{error:'Platsen är upptagen'},409);if(!existing){if(phase!=='lobby')return send(res,{error:'Match pågår. Försök efter matchen.'},409);id=id||crypto.randomUUID();const [x,y]=starts[slot-1];existing={id,name,slot,ready:false,x,y,hp:100,aim:0,seen:Date.now(),power:null,powerLeft:0,kills:0,input:{}};slots.set(id,existing)}existing.name=name;existing.seen=Date.now();return send(res,{ok:true,id,slot,state:publicState()})}
 const p=slots.get(String(b.id||''));if(!p)return send(res,{error:'Din plats har gått ut, anslut igen'},403);p.seen=Date.now();if(url.pathname==='/api/start'){if(phase!=='lobby')return send(res,{error:'Matchen är redan igång'},409);const humans=[...slots.values()].filter(x=>!x.bot).sort((a,b)=>a.slot-b.slot);if(humans[0]?.id!==p.id)return send(res,{error:'Den som först reserverade en plats (lägsta platsnummer) startar matchen'},403);startMatch();return send(res,{ok:true,state:publicState()})}
 if(url.pathname==='/api/replay'){if(p.bot)return send(res,{error:'Datorn kan inte rösta'},403);if(phase!=='intermission')return send(res,{error:'Vänta tills rundan är slut'},409);p.replay=true;checkReplays();return send(res,{ok:true,state:publicState()})}
 if(url.pathname==='/api/input'){if(phase==='playing'){const input=b.input||{};p.input={dx:Math.max(-1,Math.min(1,Number(input.dx)||0)),dy:Math.max(-1,Math.min(1,Number(input.dy)||0)),aim:Math.max(-10000,Math.min(10000,Number(input.aim)||0)),shoot:!!input.shoot}}return send(res,publicState())}
 if(url.pathname==='/api/leave'){slots.delete(p.id);if(phase!=='lobby'&&![...slots.values()].some(x=>!x.bot))resetLobby();else if(phase==='intermission')checkReplays();return send(res,{ok:true})}
 }
 if(req.method==='GET'&&serve[url.pathname]){const contents=fs.readFileSync(path.join(__dirname,serve[url.pathname]));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});return res.end(contents)}res.writeHead(404);res.end('Not found')
 }catch(e){console.error(e);if(!res.headersSent)send(res,{error:'Serverfel'},500)}}).listen(PORT,'0.0.0.0',()=>console.log('Office Royale Online på port '+PORT));
