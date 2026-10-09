import { analyzePolygon, GeometryError, Point } from './geometry';
import { analyzeRoom, isPlanar, OpeningInput, roofTriangulation, triangulate, wallHeightAt } from './room';

const close = (actual: number, expected: number, digits = 6) => expect(actual).toBeCloseTo(expected, digits);
const rect = (w: number, l: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: l },
  { x: 0, y: l },
];
const opening = (o: Partial<OpeningInput>): OpeningInput => ({ name: '', wall: null, offset: null, width: 1, height: 1, sill: null, ...o });

describe('analyzeRoom: even height', () => {
  const room = analyzeRoom(analyzePolygon(rect(4, 3)), [2.5]);

  it('floor, walls and volume', () => {
    close(room.floorArea, 12);
    close(room.volume, 30);
    close(room.wallArea, 35);
    expect(room.sloped).toBe(false);
    expect(room.ceiling).toBe('vlak');
    close(room.ceilingArea, 12);
    expect(room.walls.map((w) => w.grossArea)).toEqual([10, 7.5, 10, 7.5]);
  });
});

describe('analyzeRoom: lean-to shed (higher front wall)', () => {
  // Front wall (corner 1–2, y = 0) 3,00 m high, back wall (y = 4) 2,40 m.
  const room = analyzeRoom(analyzePolygon(rect(6, 4)), [3, 3, 2.4, 2.4]);

  it('walls are trapezoids, front and back rectangles', () => {
    close(room.walls[0].grossArea, 18); // front 6 × 3
    close(room.walls[1].grossArea, 4 * 2.7); // side, trapezoid
    close(room.walls[2].grossArea, 6 * 2.4); // back
    close(room.walls[3].grossArea, 4 * 2.7);
  });

  it('volume and ceiling along the slope are exact (one plane)', () => {
    expect(room.sloped).toBe(true);
    expect(room.ceiling).toBe('vlak');
    close(room.volume, 24 * 2.7);
    close(room.ceilingArea, 6 * Math.hypot(4, 0.6));
    close(room.minHeight, 2.4);
    close(room.maxHeight, 3);
  });
});

describe('analyzeRoom: gable shed with ridge points on the gable walls', () => {
  // 6 m wide, 8 m deep. Ridge runs front to back at x = r, eaves 2,5 m, ridge 4,5 m.
  const gable = (r: number) => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: r, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 8 },
      { x: r, y: 8 },
      { x: 0, y: 8 },
    ];
    return analyzeRoom(analyzePolygon(pts), [2.5, 4.5, 2.5, 2.5, 4.5, 2.5]);
  };

  it('centred ridge: exact roof volume and gable wall area', () => {
    const room = gable(3);
    expect(room.ceiling).toBe('dakvorm');
    // Cross-section: rectangle 6 × 2,5 + triangle 6 × 2 / 2 = 21 m², times 8 m.
    close(room.volume, 21 * 8);
    close(room.walls[0].grossArea + room.walls[1].grossArea, 21);
    close(room.ceilingArea, 2 * 8 * Math.hypot(3, 2));
  });

  it('off-centre ridge (steeper front slope) is just as exact', () => {
    const room = gable(2);
    close(room.volume, 21 * 8);
    close(room.ceilingArea, 8 * (Math.hypot(2, 2) + Math.hypot(4, 2)));
  });
});

describe('analyzeRoom: openings', () => {
  const shape = analyzePolygon(rect(4, 3));

  it('placed openings reduce their own wall only', () => {
    const room = analyzeRoom(shape, [2.5], [
      opening({ name: 'deur', wall: 0, offset: 0.5, width: 0.9, height: 2.1, sill: 0 }),
      opening({ name: 'raam', wall: 1, offset: 1, width: 1.2, height: 1, sill: 0.9 }),
      opening({ name: 'los', wall: null, width: 0.5, height: 0.5 }),
    ]);
    close(room.walls[0].netArea, 10 - 1.89);
    close(room.walls[1].netArea, 7.5 - 1.2);
    close(room.walls[2].netArea, 10);
    close(room.openingsArea, 1.89 + 1.2 + 0.25);
    close(room.netWallArea, 35 - 3.34);
    expect(room.walls[0].openings[0].name).toBe('deur');
  });

  it('rejects an opening that runs past the end of the wall', () => {
    expect(() => analyzeRoom(shape, [2.5], [opening({ name: 'deur', wall: 1, offset: 2.5, width: 0.9, height: 2 })])).toThrowError(/past niet op wand 2–3/);
  });

  it('rejects an opening higher than the wall at that spot (sloped wall)', () => {
    // Side wall 2–3 slopes from 3,0 down to 2,4; a 2,6 m door near the low end does not fit.
    const lean = analyzePolygon(rect(6, 4));
    const ok = analyzeRoom(lean, [3, 3, 2.4, 2.4], [opening({ wall: 1, offset: 0.2, width: 0.9, height: 2.6, sill: 0 })]);
    expect(ok.walls[1].openings.length).toBe(1);
    expect(() => analyzeRoom(lean, [3, 3, 2.4, 2.4], [opening({ name: 'deur', wall: 1, offset: 3, width: 0.9, height: 2.6, sill: 0 })])).toThrowError(/te hoog/);
  });

  it('rejects overlapping openings on the same wall, allows them on different walls', () => {
    const a = opening({ name: 'a', wall: 0, offset: 0.5, width: 1, height: 1, sill: 1 });
    expect(() => analyzeRoom(shape, [2.5], [a, opening({ name: 'b', wall: 0, offset: 1.2, width: 1, height: 1, sill: 1.5 })])).toThrowError(/overlapt/);
    expect(() => analyzeRoom(shape, [2.5], [a, opening({ name: 'b', wall: 0, offset: 1.5, width: 1, height: 1, sill: 1 })])).not.toThrow();
    expect(() => analyzeRoom(shape, [2.5], [a, opening({ name: 'b', wall: 2, offset: 0.5, width: 1, height: 1, sill: 1 })])).not.toThrow();
  });

  it('validates heights and wall numbers', () => {
    expect(() => analyzeRoom(shape, [2.5, 2.5])).toThrowError(GeometryError);
    expect(() => analyzeRoom(shape, [2.5, 0, 2.5, 2.5])).toThrowError(/hoekpunt 2/);
    expect(() => analyzeRoom(shape, [2.5], [opening({ wall: 7 })])).toThrowError(/bestaat niet/);
  });
});

describe('helpers', () => {
  it('wallHeightAt interpolates along the wall', () => {
    close(wallHeightAt({ length: 4, heightFrom: 3, heightTo: 2 }, 1), 2.75);
    close(wallHeightAt({ length: 4, heightFrom: 3, heightTo: 2 }, 9), 2);
  });

  it('isPlanar', () => {
    expect(isPlanar(rect(6, 4), [3, 3, 2.4, 2.4])).toBe(true);
    expect(isPlanar(rect(6, 4), [3, 2, 3, 2])).toBe(false);
  });

  it('triangulations cover the area of an L-shape', () => {
    const L = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    const area = (t: [number, number, number][]) =>
      t.reduce((s, [a, b, c]) => s + Math.abs((L[b].x - L[a].x) * (L[c].y - L[a].y) - (L[c].x - L[a].x) * (L[b].y - L[a].y)) / 2, 0);
    close(area(triangulate(L)), 12);
    close(area(roofTriangulation(L, [1, 1, 1, 1, 1, 1])!), 12);
    expect(triangulate(L).length).toBe(4);
  });
});
