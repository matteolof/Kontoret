AFRY PAINTBALL ARENA – ONLINE + OFFLINE, RYGGSÄCK OCH SPECIALVAPEN

Starta online på Render/GitHub:
1. Lägg upp index.html, server.js, package.json, arena.png, gubbar.png och collision-mask.bin.
2. Node.js: npm install och npm start. Render startkommando: npm start.
3. Öppna sidan och välj offline eller online.

Offline: Öppna index.html lokalt eller via server. Allt körs i webbläsaren.

NYTT I DENNA VERSION:
- Musen siktar. Vänster musknapp skjuter (om du har aktiverat en pistol).
- iPad/iPhone: styrspak för rörelse; tryck på spelplanen för att skjuta. Ingen skjutknapp.
- Samla upp till FEM föremål i raden längst ner. Föremålen används inte automatiskt.
- Klicka på pistol för att utrusta den, sköld/turbo/hälsa för att aktivera.
- Målsökande robot: välj robotikonen och klicka på en levande motståndare.
  Roboten följer målet genom hinder och ger 55 skada när den träffar.
- Bomb: välj bombikonen och klicka på valfri plats på banan.
  Flyger över hinder på 0,1 s och exploderar efter totalt 0,5 s.
  Radie 360 spelenheter (~5 gubblängder), från 80 skada i centrum till 5 vid kanten.
- Mystiska bonuslådor ger föremål i ryggsäcken för mänskliga spelare.
- AI hittar fortfarande och använder pistoler automatiskt.
- Boss var femte level, AI jagar bara spelaren offline.
- Benlösa sprites, två pistoler (3/5 skott), INGA automatvapen.
- Servern kontrollerar föremål, ammunition, missilmål och bombskada online.

För att uppdatera ett befintligt onlinespel måste BÅDE index.html OCH server.js ersättas.
Bilderna kan också ersättas för säkerhets skull.

NY STARTSIDA: AFRY-loggan med fyra paintballtraeffar. Filer att uppdatera: index.html, server.js, afry-startlogga.png.

NYTT: ONLINE-LÄGEN OCH ÅSKÅDARE
- På startsidan kan man välja Alla mot alla, En mot en (duell) eller Lagmatch.
- Duell: exakt två mänskliga spelare på plats 1 och 2, inga AI.
- Lagmatch: blått lag (plats 1 och 3) mot rött lag (plats 2 och 4). Minst två mänskliga spelare, AI kan fylla övriga platser. Vänskaplig eld är avstängd för skott, robotar och bomber.
- När alla spelare i ett lag är utslagna vinner det andra laget.
- Knappen "Spel pågår – gå in och titta" visas för den som inte deltar medan en onlinematch pågår. Åskådare kan se spelet live och panorera med WASD/piltangenter, men inte påverka matchen eller ta en spelarplats.
- Offline med levels och bossar är kvar, liksom inventory, bomb, missil och AFRY-startloggan.
- En server hanterar fortfarande en onlinematch åt gången (gemensam arena).


TRE SAMTIDIGA ONLINERUM (2026-10-30)
- Rum 1: Alla mot alla (ffa), max fyra spelare.
- Rum 2: 1 mot 1 (duel), exakt två spelare.
- Rum 3: Lagmatch (teams), max fyra spelare.
- Alla tre körs parallellt och har helt separata spelare, AI, vapen, föremål, skott, missiler, bomber och stormringar.
- På startsidan kan man välja rum och se lediga platser och pågående matcher. Välj rum och tryck på åskådarlänken för att titta.
- Offlineläget fungerar som tidigare och belastar inte servern.
- Render: ersätt index.html och server.js, publicera om. Övriga filer ingår i ZIP-filen för full installation.

NY STARTSIDA: Fyra stora knappar i samma rad (Alla mot alla, 1 mot 1, Lagmatch, Offline). AFRY-loggan är bakgrund. Onlineinställningar visas först efter att man valt läge.

NYTT: Varje offlinelevel har tre vanliga AI följt av en boss (200 HP, 50 % större). Stormringarna återställs vid bossens ankomst. AI och boss får 20 % högre rörelsehastighet per level. Träffsannolikheten börjar på 40 % och multipliceras med 1,2 per level (max 100 %). Online oförändrat.
