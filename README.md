# Bouwplannen – frontend

Angular-app om op de bouwplaats maten vast te leggen en door te rekenen. Bedoeld voor tablet en telefoon, met een gewone laserafstandsmeter zonder Bluetooth: je leest de maat af en typt hem in.

## Wat kan het

| Onderdeel | Invoer | Uitkomst |
|---|---|---|
| **Hoek** | Drie maten vanaf de hoek: a langs muur 1, b langs muur 2, c tussen de strepen | Hoek, afwijking van haaks, wat c bij 90° zou zijn, uit-het-haaks in mm |
| **Vorm** | Zijden + diagonalen vanaf hoekpunt 1, óf zijden + hoeken | Alle hoeken, oppervlakte, omtrek, schets op schaal; met hoogte en openingen ook inhoud en (netto) wandoppervlak. Bij de hoekenmethode is de laatste zijde een controlemaat. |
| **Dak & spant** | Overspanning + één van nokhoogte / dakhelling / sparlengte; optioneel nokpositie, overstek, daklengte | Helling (° en %), sparlengtes met en zonder overstek, gevelvlak, dakoppervlak. Zadeldak (ook scheef) en lessenaarsdak. |
| **Driehoek** | Drie willekeurige waarden (minstens één zijde) | Alle zijden, hoeken, hoogte, oppervlakte. Geeft beide oplossingen als de invoer dat toelaat. |
| **Losse maten** | Lijst met label + maat | Opgeteld totaal |

Invoer accepteert `3,456`, `3.456`, `345,6 cm` en `3456 mm`. Alles wordt in de browser opgeslagen (localStorage), export naar JSON (back-up), CSV (Excel, met `;` en decimale komma) en DXF (omtrek in mm voor CAD).

## Opbouw

```
src/app/
  geometry/   pure rekenkern (geen Angular), volledig getest
  model/      datamodel, berekeningen per onderdeel, opslag, export
  drawing/    schaaltekening (SVG)
  editors/    één component per soort onderdeel
  pages/      projectlijst en projectscherm
  ui/         invoerveld, resultaten, export
```

Opslag loopt via de `PROJECT_STORAGE`-token (`model/storage.ts`). Voor de .NET-backend komt daar een HTTP-implementatie naast; de rest van de app hoeft dan niet te veranderen.

## Ontwikkelen

```bash
npm install --legacy-peer-deps   # npm 10 struikelt anders over een peer-dependency
npm start                        # http://localhost:4200
npm test -- --watch=false        # Vitest, 57 tests
npm run build                    # dist/bouwplannen-frontend/browser
```

Angular 21, standalone components, signals, zoneless. Node 22.12 of hoger.
