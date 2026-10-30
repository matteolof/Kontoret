from pathlib import Path
p=Path('/mnt/data/afry_layout_edit/index.html')
s=p.read_text()
css='''
/* 2026-10-30: spellägen vänster, lobby mitt upptill, kompakt HUD ovanför föremålen. */
.lobbyMain{width:100%;max-width:none;margin:0;padding-top:clamp(12px,3vh,32px);display:grid;grid-template-columns:minmax(160px,215px) minmax(0,520px) minmax(0,215px);gap:12px 14px;justify-content:space-between;align-items:start}
.lobbyModes{grid-column:1;grid-row:1 / span 8;display:flex;flex-direction:column;gap:11px;width:100%;margin:0}
.modeTile{width:100%;min-height:78px;flex-direction:row;flex-wrap:wrap;gap:4px 9px;justify-content:flex-start;text-align:left;padding:12px 11px}
.modeTile .modeEmoji{font-size:23px}.modeTile small{width:100%;padding-left:32px}
#onlineSetup{grid-column:2;grid-row:1;width:100%;margin:0;justify-self:center}
#readyArea{grid-column:2;grid-row:2;width:100%;margin:0;justify-self:center;background:#10293aee;border:1px solid #42637a;border-radius:12px;padding:12px}
#postgame,#offlineResult{grid-column:2;grid-row:3;width:100%;margin:0;justify-self:center}
#hud{top:auto!important;left:50%!important;right:auto!important;bottom:calc(max(14px,env(safe-area-inset-bottom)) + 82px)!important;transform:translateX(-50%);width:336px;max-width:calc(100vw - 12px)!important;min-height:35px;display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:9px;padding:7px 10px;text-align:center;white-space:nowrap;overflow:hidden;border-color:#81c5df}
#hud span{display:inline!important;font-size:12px!important;line-height:1.2!important}
#hud #stage{overflow:hidden;text-overflow:ellipsis;min-width:0}
#hud #stats{flex-shrink:0}
#hud #equipment,#hud #power,#hud #weapon{display:none!important}
@media(pointer:coarse){#hud{width:266px;bottom:calc(max(8px,env(safe-area-inset-bottom)) + 72px)!important;padding:7px 8px;gap:5px}#hud span{font-size:11px!important}}
@media(max-width:760px){.lobbyMain{grid-template-columns:minmax(118px,155px) minmax(0,1fr);gap:9px}.lobbyModes{grid-column:1}.modeTile{min-height:67px;padding:8px 5px;font-size:12px;gap:3px 5px}.modeTile .modeEmoji{font-size:19px}.modeTile small{padding-left:0;font-size:9px}#onlineSetup,#readyArea,#postgame,#offlineResult{grid-column:2}#onlineSetup{padding:9px}#slots{grid-template-columns:1fr 1fr;gap:5px}.slot{padding:6px;font-size:11px}#panel{padding:12px 8px 18px}}
@media(max-width:420px){.lobbyMain{grid-template-columns:110px minmax(0,1fr);gap:7px}.modeTile{font-size:11px;min-height:61px}.modeTile small{font-size:8px}#onlineSetup .onlineSetupTop{flex-wrap:wrap}#onlineSetup #join,#onlineSetup #leave{padding:9px 7px;font-size:11px}}
'''
s=s.replace('</style></head>',css+'</style></head>',1)
needle="$('stats').textContent=me?'❤️ '+Math.ceil(me.hp)+' HP · ☠️ '+me.kills+' utslagna':'';"
assert needle in s
s=s.replace(needle,needle+"if(offlineMode){$('stage').textContent='Level '+(view.level||1)+' · '+view.players.filter(p=>p.bot&&p.hp>0).length+' kvar'}else if(view.phase==='playing'){$('stage').textContent=(view.matchMode==='duel'?'Duell':view.matchMode==='teams'?'Lagmatch':'Omgång '+(view.level||1))+' · '+view.players.filter(p=>p.hp>0).length+' kvar'}$('stats').textContent=me?'❤️ '+Math.ceil(me.hp)+' HP':'';",1)
p.write_text(s)
