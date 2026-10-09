# Bouwplannen – frontend

Angular-app om op de bouwplaats maten vast te leggen en door te rekenen. Bedoeld voor tablet en telefoon, met een gewone laserafstandsmeter zonder Bluetooth: je leest de maat af en typt hem in. Werkt offline; met de [backend](https://github.com/hjeverts/bouwplannen_backend) synchroniseer je tussen apparaten.

## Wat kan het

| Onderdeel | Invoer | Uitkomst |
|---|---|---|
| **Hoek** | Drie maten vanaf de hoek: a langs muur 1, b langs muur 2, c tussen de strepen | Hoek, afwijking van haaks, wat c bij 90° zou zijn, uit-het-haaks in mm |
| **Vorm / ruimte** | Zijden + diagonalen vanaf hoekpunt 1, óf zijden + hoeken (laatste zijde = controlemaat; 180° mag, voor een punt onder de nok) | Hoeken, vloeroppervlak, omtrek, plattegrond op schaal |
| ↳ ruimte | Eén wandhoogte, of een hoogte per hoekpunt (schuin plafond, nok) | Inhoud, wandoppervlak bruto/netto, tabel per wand, plafond langs de helling, **draaibare 3D-weergave** |
| ↳ openingen | Deur/raam/roldeur/schuifpui: wand, afstand vanaf de hoek, breedte, hoogte, borstwering; bij een draaideur naar binnen of buiten en DIN-links/rechts | Netto oppervlak per wand; controle of hij past (lengte, hoogte op die plek, overlap) |
| **Dak & spant** | Zadeldak: overspanning, muurhoogte links/rechts, en **twee** van: helling links/rechts, spar links/rechts, nokhoogte, nokpositie. Lessenaarsdak: helling uit twee muurhoogtes of één waarde. Mansardekap: onderdak (2 waarden) + bovendak (1 waarde). Overstek goot en kopgevels, daklengte | Hellingen (° en %), sparlengtes met/zonder overstek, nokhoogte, lengte gordingen en nok, gevelvlak, dakoppervlak per dakvlak |
| **Driehoek** | Drie willekeurige waarden (minstens één zijde) | Alle zijden, hoeken, hoogte, oppervlakte; beide oplossingen als die er zijn |
| **Plattegrond** | Ruimtes tegen elkaar, muurdiktes, trapgat, verdieping, kappen (ook over een uitbouw), dakkapellen, dakramen | Plattegrond, 3D, gevels met maten, buitenmaat-controle, A4-print |
| **Losse maten** | Lijst met label + maat | Opgeteld totaal |

Invoer accepteert `3,456`, `3.456`, `345,6 cm` en `3456 mm`. Export naar JSON (back-up), CSV (Excel, met `;` en decimale komma) en DXF (omtrek in mm voor CAD).

### Plattegrond, verdiepingen en kap

Met **Plattegrond** voeg je de gemeten ruimtes samen tot één verdieping:

- De eerste ruimte is het uitgangspunt. Elke volgende ruimte leg je **tegen een wand van een andere ruimte**, met de **muurdikte** ertussen en een **verschuiving** langs die muur. Ruimtes die met de klok mee genummerd zijn, kun je spiegelen.
- Een deur of raam in een muur tussen twee ruimtes zet je maar in één van de twee; hij komt vanzelf in beide (plattegrond, 3D, netto wandoppervlak).
- **Buitenmaat-controle**: met de dikte van de buitenmuur rekent de app de buitenmaat uit en vergelijkt die met je gemeten breedte en diepte. Klopt het niet, dan zie je het verschil en hoe dik de buitenmuur dan zou zijn.
- **Trapgat**: een gat in de vloer, gemeten in een ruimte vanaf een wand. Op die verdieping gekruist met maten, op de verdieping eronder gestippeld ("trap ↑"), in 3D als gat in de vloer.
- **Verdiepingen**: geef aan op welke plattegrond een verdieping staat, met de vloerdikte en eventueel een verschuiving.
- **Kappen**: een verdieping kan meerdere kappen hebben (elk een Dak & spant), over de hele verdieping of over de ruimtes die je aanvinkt, met de nok evenwijdig aan of haaks op de voorgevel. Zo krijgt een **uitbouw** een eigen lessenaarsdak; ruimtes zonder kap en zonder verdieping erboven krijgen een plat dak op hun eigen hoogte. Steekt een ruimte boven een lagere uit, dan komt het stuk muur erboven vanzelf in 3D en de gevels.
- **Dakkapellen** (dakvlak, afstand vanaf de kopgevel, breedte, hoogte voorkant, terugligging vanaf de muurplaat, raam) en **dakramen** (dakvlak, afstand vanaf de kopgevel, afstand langs de helling vanaf de muurplaat, breedte, lengte). Met een waarschuwing als iets niet op het dakvlak past.
- **Weergave**: plattegrond met muren, deuren (draairichting), ramen, kettingmaten en kap-omtrek; 3D van buiten (hele gebouw) of van binnen (verdieping opengewerkt); de vier **gevels** met maatvoering (kettingmaat per verdieping, peilmaten, goot en nok).
- **Printen** op A4 liggend op schaal (1:50, 1:100, 1:200 …) met titelblok: de plattegrond, een gevel, of het **A4-overzicht** met 3D, plattegrond en alle gevels op één schaal. Kies in het printvenster "Opslaan als PDF" voor een bestand. De plattegrond gaat ook als DXF (lagen per soort) naar CAD.

### Inhoud onder een schuin plafond of dak

Liggen alle hoogtes in één vlak (vlak plafond, lessenaarsdak), dan is de inhoud exact. Bij meerdere vlakken (nok, ook uit het midden) wordt het plafond behandeld als dakvorm: de triangulatie met de grootste inhoud, wat voor zadel- en schilddaken precies het dak is zolang elk nokuiteinde een hoekpunt is. De uitkomst staat dan als "Inhoud (dakvorm)".

## Inloggen, groepen en synchroniseren

Draait de app via de eigen server (zie de deploy-repo), dan log je in met een account dat de beheerder op de server aanmaakt. Daarna:

- Elk project hoort bij een **groep**: je **privégroep** (alleen jij) of een gedeelde groep. Bij een nieuw project kies je de groep; in het project kun je het later naar een andere groep verplaatsen.
- Onder **Groepen** maak je groepen aan, voeg je leden toe op gebruikersnaam, maak je iemand beheerder van de groep, of verlaat je een groep.
- Alles blijft ook op het apparaat staan; zonder verbinding werk je gewoon door. De app haalt eerst op wat in je groepen veranderde (`?since=`) en stuurt dan je eigen wijzigingen met `If-Match`. Bij een conflict wint per project de meest recente bewerking.
- Projecten die alleen op het apparaat staan (bijvoorbeeld van vóór het inloggen) krijgen de melding **Kies een groep om te delen**.
- Inloggen gebeurt één keer per apparaat; de login (een cookie die scripts niet kunnen lezen) blijft 90 dagen geldig zolang je de app gebruikt. Onder **Account** wijzig je je wachtwoord of log je overal uit.
- Zonder server (bijvoorbeeld als los bestand geopend) werkt alles op het apparaat zelf.

### Installeren als app

De app heeft een web-app-manifest, iconen tot 512 px (ook *maskable* voor Android) en een service worker. In Chrome op Android kies je **Toevoegen aan startscherm** of **App installeren**; op een iPad of iPhone in Safari **Zet op beginscherm**. De app opent dan zonder adresbalk en start ook zonder verbinding.

## Opbouw

```
src/app/
  geometry/   pure rekenkern (geen Angular): hoeken, driehoeken, vormen, daken, ruimtes, plattegrond, gebouw in 3D
  model/      datamodel, berekeningen per onderdeel, opslag, export
  api/        API-client, inloggen, groepen
  account/    loginscherm, account, groepen, groepkeuze
  sync/       synchronisatie met de backend (offline first, per gebruiker)
  drawing/    schetsen, 3D-weergave, plattegrond/gevels als vectortekening, A4-tekenbladen op schaal
  editors/    één component per soort onderdeel
  pages/      projectlijst en projectscherm
  ui/         invoerveld, resultaten, export
```

## Ontwikkelen

```bash
npm install --legacy-peer-deps   # npm 10 struikelt anders over een peer-dependency
npm start                        # http://localhost:4200, /api gaat naar de backend op :5094
npm test -- --watch=false        # Vitest, 155 tests
npm run build                    # dist/bouwplannen-frontend/browser, statisch te hosten
```

Angular 21, standalone components, signals, zoneless. Node 22.12 of hoger.
