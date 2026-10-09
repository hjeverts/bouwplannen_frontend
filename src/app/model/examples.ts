import { DakItem, OpeningEntry, PlattegrondItem, Project, VormItem } from './models';

const nl = (v: number) => v.toFixed(3).replace('.', ',');

function rectRoom(id: string, name: string, w: number, d: number, height: number, openings: Partial<OpeningEntry>[]): VormItem {
  return {
    id,
    kind: 'vorm',
    name,
    notes: '',
    updated: new Date().toISOString(),
    // Square corners measured with the 3-4-5 method; the fourth side is the check measurement.
    method: 'hoeken',
    sides: [nl(w), nl(d), nl(w), nl(d)],
    diagonals: [''],
    flips: [false, false, false, false],
    angles: ['90', '90'],
    height: nl(height),
    heightMode: 'gelijk',
    heights: ['', '', '', ''],
    openings: openings.map((o) => ({ name: '', width: '', height: '', wall: '', offset: '', sill: '0', ...o })),
  };
}

function floor(id: string, name: string, patch: Partial<PlattegrondItem>): PlattegrondItem {
  return {
    id,
    kind: 'plattegrond',
    name,
    notes: '',
    updated: new Date().toISOString(),
    rooms: [],
    outerWall: '0,300',
    measuredWidth: '',
    measuredDepth: '',
    turn: 0,
    roofId: '',
    ridge: 'x',
    roofFlip: false,
    plateHeight: '',
    below: '',
    floorThickness: '0,300',
    shiftX: '',
    shiftY: '',
    ...patch,
  };
}

/**
 * A small two-storey house: ground floor with living room, hall, kitchen and an extension with a
 * lean-to roof, first floor with two bedrooms, landing and bathroom, and a gable roof with a
 * dormer at the back and a roof window at the front. Shows how rooms, walls, floors and the
 * roof come together.
 */
export function exampleHouse(): Project {
  const now = new Date().toISOString();
  const o = (name: string, wall: number, offset: number, width: number, height: number, sill = 0): Partial<OpeningEntry> => ({
    name,
    wall: String(wall),
    offset: nl(offset),
    width: nl(width),
    height: nl(height),
    sill: nl(sill),
  });
  const woon = rectRoom('vw-woon', 'Woonkamer', 5, 7.4, 2.6, [o('raam voor', 0, 1, 2.4, 1.5, 0.8), o('schuifpui', 2, 0.8, 3, 2.2)]);
  const hal = rectRoom('vw-hal', 'Hal', 3.1, 3.7, 2.6, [o('voordeur', 0, 1.1, 1, 2.3), o('deur woonkamer', 3, 0.8, 0.93, 2.115), o('deur keuken', 2, 0.4, 0.83, 2.115)]);
  const keuken = rectRoom('vw-keuken', 'Keuken', 3.1, 3.6, 2.6, [o('raam keuken', 2, 0.8, 1.5, 1.2, 1)]);
  const slk1 = rectRoom('vw-slk1', 'Slaapkamer 1', 4.6, 3.65, 2.5, [o('raam', 0, 1.4, 1.8, 1.3, 0.9)]);
  const slk2 = rectRoom('vw-slk2', 'Slaapkamer 2', 4.6, 3.65, 2.5, [o('raam', 2, 1.4, 1.8, 1.3, 0.9), o('deur', 1, 0.3, 0.83, 2.115)]);
  const overloop = rectRoom('vw-overloop', 'Overloop', 3.5, 2.4, 2.5, [o('raam', 0, 1.2, 1, 1, 1.1), o('deur slaapkamer', 3, 0.4, 0.83, 2.115), o('deur badkamer', 2, 1.2, 0.73, 2.115)]);
  const bad = rectRoom('vw-bad', 'Badkamer', 3.5, 4.9, 2.5, [o('raam', 2, 1.3, 0.8, 0.8, 1.4)]);
  // Extension behind the living room, against the old back wall, with a lean-to roof.
  const uitbouw = rectRoom('vw-uitbouw', 'Uitbouw', 5, 3, 2.6, [o('schuifpui', 2, 1, 3, 2.2), o('raam', 3, 0.8, 1.2, 1.2, 0.9)]);

  const roof: DakItem = {
    id: 'vw-kap',
    kind: 'dak',
    name: 'Kap',
    notes: '',
    updated: now,
    roofType: 'zadeldak',
    span: '8,000',
    rise: '',
    pitch: '45',
    rafter: '',
    lowerRun: '',
    lowerRise: '',
    lowerPitch: '',
    lowerRafter: '',
    ridgeOffset: '',
    pitchRight: '',
    rafterRight: '',
    wallLeft: '',
    wallRight: '',
    overhang: '0,400',
    gableOverhang: '0,200',
    length: '8,800',
  };

  const leanTo: DakItem = {
    ...roof,
    id: 'vw-kap-uitbouw',
    name: 'Lessenaarsdak uitbouw',
    roofType: 'lessenaarsdak',
    span: '3,600',
    pitch: '10',
    overhang: '0,300',
    gableOverhang: '0,100',
    length: '5,600',
  };

  const ground = floor('vw-bg', 'Begane grond', {
    measuredWidth: '8,810',
    measuredDepth: '11,300',
    // The lean-to rises towards the house: flipped, so its high side is at the front of the extension.
    roofs: [{ roofId: leanTo.id, rooms: [uitbouw.id], ridge: 'x', flip: true, plateHeight: '', dormers: [], windows: [] }],
    rooms: [
      { roomId: woon.id },
      { roomId: hal.id, to: woon.id, wall: '3', toWall: '1', thickness: '0,100', offset: '0' },
      { roomId: keuken.id, to: hal.id, wall: '0', toWall: '2', thickness: '0,100', offset: '0' },
      { roomId: uitbouw.id, to: woon.id, wall: '0', toWall: '2', thickness: '0,300', offset: '0' },
    ],
  });
  const first = floor('vw-1', 'Verdieping', {
    below: ground.id,
    floorThickness: '0,300',
    roofs: [
      {
        roofId: roof.id,
        rooms: [],
        ridge: 'x',
        flip: false,
        plateHeight: '',
        dormers: [
          { name: 'dakkapel', plane: '1', offset: '1,200', width: '2,600', frontHeight: '1,500', setback: '0,800', windowWidth: '2,000', windowHeight: '1,000' },
        ],
        windows: [{ name: 'dakraam', plane: '0', offset: '5,600', up: '1,000', width: '0,780', length: '1,180' }],
      },
    ],
    rooms: [
      { roomId: slk1.id },
      { roomId: slk2.id, to: slk1.id, wall: '0', toWall: '2', thickness: '0,100', offset: '0' },
      { roomId: overloop.id, to: slk1.id, wall: '3', toWall: '1', thickness: '0,100', offset: '0' },
      { roomId: bad.id, to: overloop.id, wall: '0', toWall: '2', thickness: '0,100', offset: '0' },
    ],
    // Straight stair along the right outer wall, up from the hall.
    voids: [{ name: 'trapgat', roomId: overloop.id, wall: '1', offset: '0', distance: '0', width: '2,400', length: '0,950' }],
  });

  return {
    id: 'voorbeeld-woning',
    name: 'Voorbeeld: woning',
    created: now,
    updated: now,
    items: [ground, first, woon, hal, keuken, uitbouw, slk1, slk2, overloop, bad, roof, leanTo],
  };
}
