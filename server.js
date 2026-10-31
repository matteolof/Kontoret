'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {WebSocketServer,WebSocket}=require('ws');
const PORT=Number(process.env.PORT||10000);
const W=2000,H=1320,MAX=4;
// Rödmarkerade områden från användarens 1536x1024-bild är ENDA hindren.
// Samma mask används av spelare, AI, pickups och skott.
const starts=[[234,189],[1855,264],[255,1094],[1764,1094]];
const MASK_W=1536,MASK_H=1024;
const collisionMask=fs.readFileSync(path.join(__dirname,'collision-mask.bin'));
if(collisionMask.length!==MASK_W*MASK_H/8)throw Error('Fel storlek på collision-mask.bin');
function redAt(x,y){
 const px=Math.floor(x*MASK_W/W),py=Math.floor(y*MASK_H/H);
 if(px<0||py<0||px>=MASK_W||py>=MASK_H)return true;
 const k=py*MASK_W+px;
 return !!(collisionMask[k>>3]&(128>>(k&7)));
}
function blocked(x,y,r=0){
 if(redAt(x,y))return true;
 if(r<=0)return false;
 // Prova punkter runt spelarens/skottets cirkel; masken förblir osynlig.
 for(let i=0;i<16;i++){
  const a=i*Math.PI/8;
  if(redAt(x+Math.cos(a)*r,y+Math.sin(a)*r))return true;
 }
 return false;
}

const roomModes=['ffa','duel','teams'];
function createRoom(roomMode){
 const slots=new Map();
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
const types=['speed','armor','regen','ghost'];
const weapons={pistol10:{name:'Pistol',ammo:3,rate:.38,damage:22,speed:610},pistol20:{name:'Pistol XL',ammo:5,rate:.30,damage:19,speed:610}};
const lootTypes=['pistol10','pistol20','speed','armor','regen','ghost','missile','bomb'];
const MAX_ITEMS=5;
const baseItem=t=>String(t||'').replace(/\*$/,'');const starItem=t=>String(t||'').endsWith('*');
function giveItem(p,type){if(!p.inventory)p.inventory=[];if(p.inventory.length>=MAX_ITEMS)return false;p.inventory.push(type);return true}
function activateItem(p,index){if(p.bot||phase!=='playing'||p.hp<=0||p.power==='ghost')return false;index=Number(index);if(!Number.isInteger(index)||index<0||index>=p.inventory.length)return false;const item=p.inventory[index],type=baseItem(item),boost=starItem(item);if(type==='missile'||type==='bomb'){p.selectedItem=index;return true}p.inventory.splice(index,1);p.selectedItem=null;if(weapons[type]){p.weapon=type;p.ammo=weapons[type].ammo;p.shootClock=0}else if(type==='heal')p.hp=Math.min(100,p.hp+(boost?80:40));else{p.power=type;p.powerBoost=boost;p.powerLeft=type==='ghost'?10:(type==='armor'?9:8)*(boost?2:1)}return true}
let effects=[],explosions=[],effectId=0;
function specialTarget(p,x,y,targetId){if(phase!=='playing'||p.bot||p.hp<=0||!p.inventory)return false;const index=p.selectedItem,item=p.inventory[index],type=baseItem(item),boost=starItem(item);if(type!=='missile'&&type!=='bomb'||p.power==='ghost')return false;x=Number(x);y=Number(y);if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>W||y>H)return false;let target=null;if(type==='missile'){target=slots.get(String(targetId||''));if(!target||!enemies(p,target)||target.hp<=0||Math.hypot(target.x-x,target.y-y)>45)return false}p.inventory.splice(index,1);p.selectedItem=null;effects.push({id:++effectId,type,owner:p.id,x:p.x,y:p.y,targetId:target?.id||null,tx:x,ty:y,boost,life:type==='bomb'?.5:30,flight:type==='bomb'?.1:0});return true}
function dealEffectDamage(victim,damage,owner){if(victim.hp<=0)return;const attacker=slots.get(owner);if(attacker&&!enemies(attacker,victim))return;const before=victim.hp;victim.hp=Math.max(0,victim.hp-damage*(victim.power==='armor'?(victim.powerBoost?.2:.4):1));if(attacker&&victim.hp<before){attacker.hits=(attacker.hits||0)+1;victim.hitAt=Date.now();victim.hitBySlot=attacker.slot;}if(victim.hp===0&&attacker)attacker.kills++}
function updateEffects(dt){explosions=explosions.filter(e=>(e.life-=dt)>0);for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;if(e.type==='missile'){const target=slots.get(e.targetId);if(!target||target.hp<=0){effects.splice(i,1);continue}const d=Math.hypot(target.x-e.x,target.y-e.y),step=560*dt;if(d<=step+17){e.x=target.x;e.y=target.y;dealEffectDamage(target,e.boost?110:55,e.owner);effects.splice(i,1);continue}e.x+=(target.x-e.x)/d*step;e.y+=(target.y-e.y)/d*step;if(e.life<=0){effects.splice(i,1);continue}}else{const f=Math.min(1,dt/Math.max(.00001,e.flight));e.x+=(e.tx-e.x)*f;e.y+=(e.ty-e.y)*f;e.flight-=dt;if(e.life<=0){e.x=e.tx;e.y=e.ty;explosions.push({x:e.x,y:e.y,life:.28});for(const v of slots.values()){if(v.hp<=0||!enemies(slots.get(e.owner),v))continue;const d=Math.hypot(v.x-e.x,v.y-e.y);if(d<=360)dealEffectDamage(v,Math.round((5+75*(1-d/360))*(e.boost?2:1)),e.owner)}effects.splice(i,1);continue}}}}

let mysteryClock=10;
let matchMode=roomMode;
const teamOf=p=>p&&((p.slot===1||p.slot===3)?'blue':'red');
const enemies=(a,b)=>a&&b&&a.id!==b.id&&(matchMode!=='teams'||teamOf(a)!==teamOf(b));
let phase='lobby',level=1,roundEnd=0,countdownEnd=0,zone={x:1000,y:660,r:1250},zoneNext=null,zoneStage=0,zoneClock=0,zoneFrom=null,zoneMode='wait',pickups=[],shots=[],bulletId=0,pickupClock=3,now=Date.now();
function roster(){return [...slots.values()].sort((a,b)=>a.slot-b.slot).map(p=>({slot:p.slot,id:p.id,name:p.name,bot:!!p.bot,hp:p.hp,alive:p.hp>0,x:p.x,y:p.y,aim:p.aim,power:p.power,powerBoost:!!p.powerBoost,powerLeft:p.powerLeft,kills:p.kills,hits:p.hits||0,lastBonus:p.lastBonus||null,bonusUntil:p.bonusUntil||0,weapon:p.weapon,ammo:p.ammo||0,weaponLeft:p.weaponLeft||0,team:teamOf(p),inventory:p.bot?[]:(p.inventory||[]),selectedItem:p.selectedItem??null,mysteryChoices:p.bot?null:(p.mysteryChoices||null),replay:!!p.replay,hitAt:p.hitAt||0,hitBySlot:p.hitBySlot||0}))}
function publicState(){return {room:roomMode,phase,matchMode,level,players:roster(),zone,zoneNext,zoneMode,zoneClock,zoneStage,pickups,shots:shots.map(({id,x,y,owner})=>({id,x,y,slot:slots.get(owner)?.slot||0})),effects:effects.map(e=>({id:e.id,type:e.type,x:e.x,y:e.y,tx:e.tx,ty:e.ty})),explosions,serverTime:Date.now(),roundEnd,countdownEnd,required:1,max:4}}
function resetRound(){phase='playing';roundEnd=0;countdownEnd=0;shots=[];effects=[];explosions=[];pickups=[];pickupClock=.6;mysteryClock=9;zone={x:1000,y:660,r:1250};zoneNext=null;zoneStage=0;zoneClock=0;zoneFrom=null;zoneMode='wait';prepareNextZone();for(const p of slots.values()){const [x,y]=starts[p.slot-1];Object.assign(p,{path:[],pathClock:0,x,y,hp:100,aim:0,shootClock:0,power:null,powerBoost:false,powerLeft:0,weapon:null,ammo:0,weaponLeft:0,inventory:[],selectedItem:null,mysteryChoices:null,hits:0,replay:false,hitAt:0,hitBySlot:0,regenClock:0,input:{dx:0,dy:0,shoot:false,aim:0}})}for(let i=0;i<7;i++)pickupSpawn()}
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
function resetLobby(){phase='lobby';matchMode=roomMode;level=1;countdownEnd=0;shots=[];effects=[];explosions=[];pickups=[];for(const [id,p] of slots)if(p.bot)slots.delete(id)}
function startMatch(fillBots=true,mode=roomMode){if(phase!=='lobby')return false;mode=roomMode;
 if(!['ffa','duel','teams'].includes(mode))return false;
 const humanCount=[...slots.values()].filter(p=>!p.bot).length;
 if(mode==='duel'&&(humanCount!==2||[...slots.values()].some(p=>!p.bot&&p.slot>2)))return false;
 if(mode==='teams'&&humanCount<2)return false;
 matchMode=mode;if(mode==='duel')fillBots=false;
 const humans=[...slots.values()].filter(p=>!p.bot);
 if(!humans.length)return false;
 for(let slot=1;slot<=4;slot++)if(fillBots&&!humans.some(p=>p.slot===slot)){
   const [x,y]=starts[slot-1],id='bot-'+slot;
   slots.set(id,{id,name:'Dator '+slot,slot,bot:true,x,y,hp:100,aim:0,kills:0,hits:0,power:null,powerBoost:false,powerLeft:0,weapon:null,ammo:0,weaponLeft:0,inventory:[],selectedItem:null,seen:Date.now(),input:{},path:[],pathClock:0,strafe:slot%2?1:-1});
 }
 level=1;for(const p of slots.values()){p.kills=0;p.hits=0;p.replay=false;}phase='countdown';countdownEnd=Date.now()+4000;return true;
}
function cleanup(){const t=Date.now();let removed=false;for(const [id,p] of slots)if(!p.bot&&t-p.seen>18000){slots.delete(id);removed=true}if(removed&&phase!=='lobby'&&![...slots.values()].some(p=>!p.bot))resetLobby();else if(removed&&phase==='intermission')checkReplays()}
function checkReplays(){if(phase!=='intermission')return;const humans=[...slots.values()].filter(p=>!p.bot);if(humans.length&&humans.every(p=>p.replay)){level++;phase='countdown';countdownEnd=Date.now()+4000;}}
function mysterySpawn(){if(pickups.some(p=>p.type==='mystery'))return;for(let k=0;k<100;k++){const x=70+Math.random()*(W-140),y=70+Math.random()*(H-140);if(!blocked(x,y,26)&&!pickups.some(p=>Math.hypot(p.x-x,p.y-y)<100)&&![...slots.values()].some(p=>Math.hypot(p.x-x,p.y-y)<80)){pickups.push({id:crypto.randomUUID(),x,y,type:'mystery',life:17});return}}}
const mysteryRewards=['heal','armor','speed','damage','ghost','missile','bomb'];
function awardMystery(p){if(!p.bot){if((p.inventory||[]).length>=MAX_ITEMS)return false;const reward=mysteryRewards[Math.floor(Math.random()*mysteryRewards.length)];if(!giveItem(p,reward+'*'))return false;p.lastBonus=reward;p.bonusUntil=Date.now()+2700;return true}const reward=mysteryRewards[Math.floor(Math.random()*mysteryRewards.length)];if(reward==='heal')p.hp=Math.min(100,p.hp+40);else if(reward!=='missile'&&reward!=='bomb'){p.power=reward;p.powerLeft=reward==='ghost'?10:reward==='armor'?9:8}return true}
function chooseMystery(p,reward){if(phase!=='playing'||p.bot||p.hp<=0||!p.mysteryChoices?.includes(reward))return false;if(!giveItem(p,reward+'*'))return false;p.mysteryChoices=null;p.lastBonus=reward;p.bonusUntil=Date.now()+2700;return true} 
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
// Bara AI som faktiskt står stilla får en kort, ihållande undanmanöver.
function botEscape(bot,target,dt){
 const input=bot.input||{};
 const moved=bot.escapePrev?Math.hypot(bot.x-bot.escapePrev.x,bot.y-bot.escapePrev.y):999;
 bot.escapePrev={x:bot.x,y:bot.y};
 const walking=Math.hypot(input.dx||0,input.dy||0)>.35;
 bot.escapeStill=(!walking||moved>Math.max(1.1,dt*12))?0:(bot.escapeStill||0)+dt;
 if(bot.escapeTimer>0){
  bot.escapeTimer-=dt;
  const pt=bot.escapePoint,d=Math.hypot(pt.x-bot.x,pt.y-bot.y);
  if(d>13&&!blocked(bot.x+(pt.x-bot.x)/d*12,bot.y+(pt.y-bot.y)/d*12,15)){
   input.dx=(pt.x-bot.x)/d;input.dy=(pt.y-bot.y)/d;return;
  }
  bot.escapeTimer=0;bot.pathClock=0;
 }
 if(bot.escapeStill<.65||!target)return;
 bot.escapeStill=0;
 const direct=Math.atan2(target.y-bot.y,target.x-bot.x),side=bot.escapeSide||1;
 const offsets=[side*Math.PI/2,-side*Math.PI/2,side*Math.PI*.75,-side*Math.PI*.75,Math.PI,side*Math.PI/4,-side*Math.PI/4,0];
 let best=null,bestScore=-Infinity;
 for(const delta of offsets){
  const a=direct+delta,ux=Math.cos(a),uy=Math.sin(a);
  let clear=true;
  for(let step=16;step<=112;step+=16){if(blocked(bot.x+ux*step,bot.y+uy*step,15)){clear=false;break}}
  if(!clear)continue;
  const x=bot.x+ux*112,y=bot.y+uy*112,score=-Math.hypot(x-target.x,y-target.y)-Math.abs(delta)*6;
  if(score>bestScore){bestScore=score;best={x,y}}
 }
 if(best){bot.escapePoint=best;bot.escapeTimer=1.15;bot.escapeSide=-side;bot.pathClock=0;
  const d=Math.hypot(best.x-bot.x,best.y-bot.y);input.dx=(best.x-bot.x)/d;input.dy=(best.y-bot.y)/d;
 }
}
function botInput(bot,people,dt){
 // AI utan fungerande vapen söker prickar i stället för att jaga eller skjuta.
 // Pistoler kräver ammunition.
 const armed=!!(bot.weapon&&weapons[bot.weapon]&&
   (bot.ammo||0)>0);
 if(!armed){
  if(bot.weapon){bot.weapon=null;bot.ammo=0;bot.weaponLeft=0}
  bot.input={dx:0,dy:0,shoot:false,aim:bot.aim};
  // Alla prickar ser likadana ut för spelaren, men AI prioriterar vapen.
  // Om inget vapen finns väljer den en annan prick och fortsätter leta.
  const candidates=pickups.filter(p=>p.type!=='missile'&&p.type!=='bomb').sort((a,b)=>{
   const aw=weapons[a.type]?0:1,bw=weapons[b.type]?0:1;
   return aw-bw||Math.hypot(a.x-bot.x,a.y-bot.y)-Math.hypot(b.x-bot.x,b.y-bot.y);
  });
  bot.pathClock=(bot.pathClock||0)-dt;
  let loot=candidates.find(p=>p.id===bot.lootTarget);
  if(!loot||bot.pathClock<=0||!bot.path?.length){
   loot=null;
   for(const item of candidates){
    // Kontrollera att vägen faktiskt är framkomlig.
    const route=navigate(bot,item);
    if(route.length||Math.hypot(item.x-bot.x,item.y-bot.y)<30){
     loot=item;bot.path=route;bot.lootTarget=item.id;break;
    }
   }
   bot.pathClock=.75;
  }
  if(!loot){bot.lootTarget=null;bot.path=[];return}
  while(bot.path?.length&&Math.hypot(bot.path[0].x-bot.x,bot.path[0].y-bot.y)<21)bot.path.shift();
  const next=bot.path?.[0]||loot,d=Math.hypot(next.x-bot.x,next.y-bot.y);
  bot.input={dx:d>5?(next.x-bot.x)/d:0,dy:d>5?(next.y-bot.y)/d:0,
    shoot:false,aim:d>5?Math.atan2(next.y-bot.y,next.x-bot.x):bot.aim};
  botEscape(bot,loot,dt);
  return;
 }
 bot.lootTarget=null;
 const others=people.filter(p=>enemies(bot,p)&&p.hp>0&&p.power!=='ghost');if(!others.length){bot.input={dx:0,dy:0,shoot:false,aim:0};return}
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
 botEscape(bot,target,dt);
}
let last=Date.now();setInterval(()=>{const t=Date.now(),dt=Math.min(.08,(t-last)/1000);last=t;cleanup();if(phase==='countdown'){if(t>=countdownEnd){if(level>1){ /* keep previous score */ }resetRound()}return}if(phase!=='playing')return;
 updateZone(dt);updateEffects(dt);pickupClock-=dt;if(pickupClock<=0){if(pickups.length<12)pickupSpawn();pickupClock=1.8+Math.random()*2.2}pickups=pickups.filter(p=>(p.life-=dt)>0);mysteryClock-=dt;if(mysteryClock<=0){mysterySpawn();mysteryClock=15+Math.random()*8}
 const people=[...slots.values()];for(const p of people){if(p.bot&&p.hp>0)botInput(p,people,dt);if(p.hp<=0)continue;p.shootClock-=dt;
 
 p.powerLeft=Math.max(0,p.powerLeft-dt);if(!p.powerLeft){p.power=null;p.powerBoost=false;}const inp=p.input||{};let dx=Number(inp.dx)||0,dy=Number(inp.dy)||0,n=Math.hypot(dx,dy);if(n>1){dx/=n;dy/=n}const speed=(p.power==='speed'?(p.powerBoost?570:285):(p.weapon?205:238))*(p.bot?.78:1);move(p,dx*speed*dt,dy*speed*dt);if(p.bot){p.aim=Number.isFinite(+inp.aim)?+inp.aim:p.aim}else if(Number.isFinite(+inp.aim)){p.aim=+inp.aim}
 if(inp.shoot&&p.power!=='ghost'&&p.shootClock<=0&&p.weapon&&weapons[p.weapon]&&p.ammo>0){
 const gun=weapons[p.weapon];p.shootClock=p.bot?Math.max(.42,gun.rate*2):gun.rate;
 p.ammo--;if(p.ammo<=0){p.weapon=null;p.ammo=0}
 let sp=gun.speed;// Kulor måste födas framför spelaren utan att överlappa en vägg eller möbel.
 const sx=p.x+Math.cos(p.aim)*20,sy=p.y+Math.sin(p.aim)*20;
 if(!blocked(sx,sy,5)&&clearShot(p,{x:sx,y:sy}))shots.push({id:++bulletId,owner:p.id,x:sx,y:sy,vx:Math.cos(p.aim)*sp,vy:Math.sin(p.aim)*sp,damage:(p.bot?Math.round(gun.damage*.7):gun.damage)*(p.power==='damage'?(p.powerBoost?4:2):1),life:1.9})}
 for(let i=pickups.length-1;i>=0;i--)if(Math.hypot(p.x-pickups[i].x,p.y-pickups[i].y)<29){const loot=pickups[i].type;
 if(!p.bot){if(loot==='mystery'){if(!awardMystery(p))continue}else if(!giveItem(p,loot))continue}else if(loot==='mystery'){awardMystery(p)}else if(weapons[loot]){p.weapon=loot;p.ammo=weapons[loot].ammo;p.shootClock=0}else if(loot==='missile'||loot==='bomb'){continue}else{p.power=loot;p.powerLeft=loot==='ghost'?10:5}
 pickups.splice(i,1)}
 if(p.power==='regen')p.hp=Math.min(100,p.hp+(p.powerBoost?20:10)*dt);
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
    if(victim.hp<=0||!enemies(slots.get(shot.owner),victim))continue;
    if(Math.hypot(victim.x-shot.x,victim.y-shot.y)<19){
     const attacker=slots.get(shot.owner);
     if(attacker)attacker.hits=(attacker.hits||0)+1;
     victim.hitAt=Date.now();victim.hitBySlot=attacker?.slot||0;
     victim.hp=Math.max(0,victim.hp-shot.damage*(victim.power==='armor'?(victim.powerBoost?.2:.4):1));
     if(victim.hp===0&&attacker)attacker.kills++;
     gone=true;break;
    }
   }
  }
  if(gone)shots.splice(i,1);
 }
 const alive=people.filter(p=>p.hp>0);const teamsAlive=new Set(alive.map(teamOf));if((matchMode==='teams'?teamsAlive.size<=1:alive.length<=1)){phase='intermission';roundEnd=Date.now();for(const p of people)if(p.bot)p.replay=true;checkReplays();}
},33);

const connections=new Map();
function broadcast(){if(!connections.size)return;const payload=JSON.stringify({type:'state',state:publicState()});for(const ws of connections.keys())if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<100000)ws.send(payload)}
function onConnection(ws){connections.set(ws,null);ws.on('message',buf=>{let msg;try{msg=JSON.parse(buf.toString())}catch{return}if(!msg||typeof msg!=='object')return;
 if(msg.type==='spectate'){connections.set(ws,'spectator');ws.send(JSON.stringify({type:'state',state:publicState()}));return}
 if(msg.type==='hello'){const id=String(msg.id||'').slice(0,100),p=slots.get(id);if(!p||p.bot){ws.send(JSON.stringify({type:'error',error:'Anslut till en spelarplats först'}));return}connections.set(ws,id);p.seen=Date.now();ws.send(JSON.stringify({type:'state',state:publicState()}));return}
 const id=connections.get(ws),p=id&&slots.get(id);if(!p||p.bot)return;p.seen=Date.now();if(msg.type==='mysteryChoice'){chooseMystery(p,msg.reward);return}if(msg.type==='item'){activateItem(p,msg.index);return}if(msg.type==='special'){specialTarget(p,msg.x,msg.y,msg.targetId);return}if(msg.type==='input'&&phase==='playing'){const inp=msg.input||{},finite=v=>Number.isFinite(Number(v))?Number(v):0;p.input={dx:Math.max(-1,Math.min(1,finite(inp.dx))),dy:Math.max(-1,Math.min(1,finite(inp.dy))),shoot:!!inp.shoot,aim:finite(inp.aim)}}
 });ws.on('close',()=>connections.delete(ws));ws.on('error',()=>connections.delete(ws))}
async function handle(req,res,url,b){
if(req.method==='POST'){if(url.pathname==='/api/join'){let id=String(b.id||'').slice(0,100),name=String(b.name||'Spelare').trim().slice(0,20)||'Spelare',slot=Number(b.slot);if(!Number.isInteger(slot)||slot<1||slot>4)return send(res,{error:'Välj en plats 1–4'},400);let existing=slots.get(id);if(existing&&existing.bot)return send(res,{error:'Reserverad datorplats'},409);if(existing&&existing.slot!==slot)return send(res,{error:'Du har redan en plats'},409);if([...slots.values()].some(p=>p.slot===slot&&p.id!==id))return send(res,{error:'Platsen är upptagen'},409);if(!existing){if(phase!=='lobby')return send(res,{error:'Match pågår. Försök efter matchen.'},409);id=id||crypto.randomUUID();const [x,y]=starts[slot-1];existing={id,name,slot,ready:false,x,y,hp:100,aim:0,seen:Date.now(),power:null,powerBoost:false,powerLeft:0,weapon:null,ammo:0,weaponLeft:0,inventory:[],selectedItem:null,kills:0,input:{}};slots.set(id,existing)}existing.name=name;existing.seen=Date.now();return send(res,{ok:true,id,slot,state:publicState()})}
 const p=slots.get(String(b.id||''));if(!p)return send(res,{error:'Din plats har gått ut, anslut igen'},403);p.seen=Date.now();if(url.pathname==='/api/start'){if(phase!=='lobby')return send(res,{error:'Matchen är redan igång'},409);const humans=[...slots.values()].filter(x=>!x.bot).sort((a,b)=>a.slot-b.slot);if(humans[0]?.id!==p.id)return send(res,{error:'Den som först reserverade en plats (lägsta platsnummer) startar matchen'},403);if(!startMatch(b.fillBots!==false,roomMode))return send(res,{error:'Ogiltigt spelläge. Duell kräver exakt två spelare på plats 1 och 2. Lag kräver minst två spelare.'},400);return send(res,{ok:true,state:publicState()})}
 if(url.pathname==='/api/mystery-choice'){chooseMystery(p,b.reward);return send(res,{ok:true,state:publicState()})}
 if(url.pathname==='/api/item'){activateItem(p,b.index);return send(res,{ok:true,state:publicState()})}
 if(url.pathname==='/api/special'){specialTarget(p,b.x,b.y,b.targetId);return send(res,{ok:true,state:publicState()})}
 if(url.pathname==='/api/replay'){if(p.bot)return send(res,{error:'Datorn kan inte rösta'},403);if(phase!=='intermission')return send(res,{error:'Vänta tills rundan är slut'},409);p.replay=true;checkReplays();return send(res,{ok:true,state:publicState()})}
 if(url.pathname==='/api/input'){if(phase==='playing'){const input=b.input||{};p.input={dx:Math.max(-1,Math.min(1,Number(input.dx)||0)),dy:Math.max(-1,Math.min(1,Number(input.dy)||0)),aim:Math.max(-10000,Math.min(10000,Number(input.aim)||0)),shoot:!!input.shoot}}return send(res,publicState())}
 if(url.pathname==='/api/leave'){slots.delete(p.id);if(phase!=='lobby'&&![...slots.values()].some(x=>!x.bot))resetLobby();else if(phase==='intermission')checkReplays();return send(res,{ok:true})}
 }

return send(res,{error:'Okänd spelåtgärd'},404)
}
setInterval(broadcast,50);
return {publicState,handle,onConnection,summary:()=>({room:roomMode,phase,players:[...slots.values()].filter(p=>!p.bot).length,capacity:roomMode==='duel'?2:4,spectators:[...connections.values()].filter(x=>x==='spectator').length})};

}
const rooms=new Map(roomModes.map(mode=>[mode,createRoom(mode)]));
function send(res,obj,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});res.end(JSON.stringify(obj))}
function getBody(req){return new Promise((resolve,reject)=>{let s='';req.on('data',x=>{s+=x;if(s.length>15000){reject(new Error('För stor begäran'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch{resolve({})}});req.on('error',reject)})}
const serve={'/':'index.html','/index.html':'index.html','/arena.png':'arena.png','/collision-mask.bin':'collision-mask.bin','/gubbar.png':'gubbar.png','/afry-startlogga.png':'afry-startlogga.png'};
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&url.pathname==='/api/rooms')return send(res,[...rooms.values()].map(room=>room.summary()));
 const b=req.method==='POST'?await getBody(req):{};
 const roomName=String(req.method==='POST'?(b.room||'ffa'):(url.searchParams.get('room')||'ffa'));
 const room=rooms.get(roomName);
 if(url.pathname.startsWith('/api/')){if(!room)return send(res,{error:'Ogiltigt spelrum'},400);if(req.method==='GET'&&url.pathname==='/api/status')return send(res,room.publicState());return room.handle(req,res,url,b)}
 if(req.method==='GET'&&serve[url.pathname]){const contents=fs.readFileSync(path.join(__dirname,serve[url.pathname]));res.writeHead(200,{'content-type':(url.pathname==='/arena.png'||url.pathname==='/gubbar.png'||url.pathname==='/afry-startlogga.png')?'image/png':url.pathname==='/collision-mask.bin'?'application/octet-stream':'text/html; charset=utf-8','cache-control':'no-cache'});return res.end(contents)}res.writeHead(404);res.end('Not found')
 }catch(e){console.error(e);if(!res.headersSent)send(res,{error:'Serverfel'},500)}});
const wss=new WebSocketServer({server,path:'/ws',maxPayload:2048});
wss.on('connection',(ws,req)=>{const url=new URL(req.url,'http://localhost'),room=rooms.get(url.searchParams.get('room')||'ffa');if(!room){ws.close(1008,'Ogiltigt spelrum');return}room.onConnection(ws)});
server.listen(PORT,'0.0.0.0',()=>console.log('AFRY Paintball Arena: tre samtidiga spelrum på port '+PORT));
