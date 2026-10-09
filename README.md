# Bouwplannen – frontend

Angular-app om op de bouwplaats maten vast te leggen en door te rekenen. Bedoeld voor tablet en telefoon, met een gewone laserafstandsmeter zonder Bluetooth: je leest de maat af en typt hem in. Werkt offline; met de [backend](https://github.com/hjeverts/bouwplannen_backend) synchroniseer je tussen apparaten.

## Wat kan het

| Onderdeel | Invoer | Uitkomst |
|---|---|---|
| **Hoek** | Drie maten vanaf de hoek: a langs muur 1, b langs muur 2, c tussen de strepen | Hoek, afwijking van haaks, wat c bij 90° zou zijn, uit-het-haaks in mm |
| **Vorm / ruimte** | Zijden + diagonalen vanaf hoekpunt 1, óf zijden + hoeken (laatste zijde = controlemaat; 180° mag, voor een punt onder de nok) | Hoeken, vloeroppervlak, omtrek, plattegrond op schaal |
| ↳ ruimte | Eén wandhoogte, of een hoogte per hoekpunt (schuin plafond, nok) | Inhoud, wandoppervlak bruto/netto, tabel per wand, plafond langs de helling, **draaibare 3D-weergave** |
| ↳ openingen | Deur/raam: wand, afstand vanaf de hoek, breedte, hoogte, borstwering | Netto oppervlak per wand; controle of hij past (lengte, hoogte op die plek, overlap) |
| **Dak & spant** | Zadeldak: overspanning, muurhoogte links/rechts, en **twee** van: helling links/rechts, spar links/rechts, nokhoogte, nokpositie. Lessenaarsdak: helling uit twee muurhoogtes of één waarde. Mansardekap: onderdak (2 waarden) + bovendak (1 waarde). Overstek goot en kopgevels, daklengte | Hellingen (° en %), sparlengtes met/zonder overstek, nokhoogte, lengte gordingen en nok, gevelvlak, dakoppervlak per dakvlak |
| **Driehoek** | Drie willekeurige waarden (minstens één zijde) | Alle zijden, hoeken, hoogte, oppervlakte; beide oplossingen als die er zijn |
| **Losse maten** | Lijst met label + maat | Opgeteld totaal |

Invoer accepteert `3,456`, `3.456`, `345,6 cm` en `3456 mm`. Export naar JSON (back-up), CSV (Excel, met `;` en decimale komma) en DXF (omtrek in mm voor CAD).

### Inhoud onder een schuin plafond of dak

Liggen alle hoogtes in één vlak (vlak plafond, lessenaarsdak), dan is de inhoud exact. Bij meerdere vlakken (nok, ook uit het midden) wordt het plafond behandeld als dakvorm: de triangulatie met de grootste inhoud, wat voor zadel- en schilddaken precies het dak is zolang elk nokuiteinde een hoekpunt is. De uitkomst staat dan als "Inhoud (dakvorm)".

## Synchroniseren

Onder **Projecten → Synchroniseren met server** vul je het adres van de backend en de API-sleutel in. Daarna:

- blijft alles ook lokaal staan; zonder verbinding werk je gewoon door;
- haalt de app eerst op wat elders is gewijzigd (`?since=`), en stuurt daarna de eigen wijzigingen met `If-Match`;
- wint bij een conflict per project de **meest recente bewerking**; verwijderen gaat ook mee, maar een bewerking elders na jouw verwijdering wint.

De backend moet de frontend-origin toestaan (`Cors__AllowedOrigins__0`). Draai beide achter HTTPS.

## Opbouw

```
src/app/
  geometry/   pure rekenkern (geen Angular): hoeken, driehoeken, vormen, daken, ruimtes
  model/      datamodel, berekeningen per onderdeel, opslag, export
  sync/       synchronisatie met de backend (offline first)
  drawing/    plattegrond/doorsnede (SVG) en 3D-weergave (SVG, geen extra bibliotheek)
  editors/    één component per soort onderdeel
  pages/      projectlijst en projectscherm
  ui/         invoerveld, resultaten, export
```

## Ontwikkelen

```bash
npm install --legacy-peer-deps   # npm 10 struikelt anders over een peer-dependency
npm start                        # http://localhost:4200
npm test -- --watch=false        # Vitest, 106 tests
npm run build                    # dist/bouwplannen-frontend/browser, statisch te hosten
```

Angular 21, standalone components, signals, zoneless. Node 22.12 of hoger.
