OFFICE ROYALE ONLINE – 2D / GITHUB + RENDER

FILER ATT LÄGGA PÅ GITHUB:
- server.js
- index.html
- package.json

RENDER (WEB SERVICE):
1. Skapa ett nytt GitHub-repository och ladda upp de tre filerna i roten.
2. På Render: New > Web Service > Connect GitHub-repository.
3. Runtime: Node. Build Command: npm install. Start Command: npm start.
4. Valfritt: Lägg till environment variable GAME_PASSWORD med ett gemensamt lösenord.
5. Öppna adressen Render visar, t.ex. https://ditt-spel.onrender.com
6. Låt fyra personer öppna länken, välja varsin plats och klicka Säkra min plats.
7. Varje person klickar sedan Redo. Spelet startar när alla fyra är redo.

TESTA LOKALT:
Installera Node.js 20+. Öppna terminal i mappen och kör: node server.js
Öppna http://localhost:10000 i flera flikar för att testa.

INFO:
- 2D, ingen 3D och inga externa spelbibliotek.
- Max fyra samtidiga spelare, alla måste vara redo för matchstart.
- Ledig plats frigörs när spelaren lämnar eller efter ca 18 sekunder utan anslutning.
- Servern bestämmer rörelse, skott, träffar, krafterna och krympande zon.
- Kraftpaket spawnar slumpmässigt under matchen och varar fem sekunder.
- Nivån stiger automatiskt efter varje runda och zonen krymper snabbare.
- Denna första onlineversion använder korta HTTP-anrop (polling) för enkel Render-drift.
- Vid hög latens kan den upplevas mindre följsam än ett WebSocket-spel.
- På kostnadsfri Render-plan kan servern somna vid inaktivitet; rummet nollställs vid omstart.
