import {
  analyzePolygon,
  mansardSection,
  solveSlope,
  angleFromSides,
  cornerAngle,
  GeometryError,
  polygonFromAngles,
  polygonFromDiagonals,
  roofSection,
  roomTotals,
  sideFromAngle,
  solveTriangle,
} from './geometry';

const close = (actual: number, expected: number, digits = 6) => expect(actual).toBeCloseTo(expected, digits);

describe('angleFromSides / cornerAngle', () => {
  it('3-4-5 gives a square corner', () => {
    close(angleFromSides(3, 4, 5), 90);
    const r = cornerAngle(3, 4, 5);
    close(r.angle, 90);
    close(r.deviationFromSquare, 0);
    close(r.squareDiagonal, 5);
    close(r.offsetOverB, 0);
  });

  it('equal sides give 60°', () => close(angleFromSides(1, 1, 1), 60));

  it('detects a corner that is not square', () => {
    // 1 m along both walls, 1.42 m between the marks: slightly wider than 90°.
    const r = cornerAngle(1, 1, 1.42);
    expect(r.angle).toBeGreaterThan(90);
    // acos((1 + 1 - 1.42²) / 2) = 90° + asin(0.0082)
    close(r.angle, 90 + (Math.asin(0.0082) * 180) / Math.PI, 9);
    expect(r.offsetOverB).toBeGreaterThan(0);
  });

  it('accepts a degenerate but measured straight line (180°)', () => close(angleFromSides(1, 1, 2), 180));

  it('rejects measurements that cannot form a triangle', () => {
    expect(() => angleFromSides(1, 1, 2.1)).toThrowError(GeometryError);
  });

  it('rejects zero and negative input', () => {
    expect(() => angleFromSides(0, 1, 1)).toThrowError(GeometryError);
    expect(() => angleFromSides(-1, 1, 1)).toThrowError(GeometryError);
    expect(() => angleFromSides(NaN, 1, 1)).toThrowError(GeometryError);
  });

  it('sideFromAngle is the inverse of angleFromSides', () => {
    const c = sideFromAngle(2.4, 3.1, 73.2);
    close(angleFromSides(2.4, 3.1, c), 73.2);
  });
});

describe('solveTriangle', () => {
  it('SSS', () => {
    const [t] = solveTriangle({ a: 3, b: 4, c: 5 });
    close(t.C, 90);
    close(t.area, 6);
    close(t.perimeter, 12);
    close(t.hc, 2.4);
  });

  it('SAS (angle between the known sides)', () => {
    const [t] = solveTriangle({ a: 3, b: 4, C: 90 });
    close(t.c, 5);
    close(t.A + t.B + t.C, 180);
  });

  it('ASA / AAS', () => {
    const [t] = solveTriangle({ c: 10, A: 30, B: 60 });
    close(t.C, 90);
    close(t.a, 5);
    close(t.b, Math.sqrt(75));
  });

  it('SSA with two solutions', () => {
    const solutions = solveTriangle({ a: 6, b: 8, A: 30 });
    expect(solutions.length).toBe(2);
    for (const t of solutions) {
      close(t.A, 30);
      close(t.a, 6);
      close(t.b, 8);
      close(t.A + t.B + t.C, 180);
    }
  });

  it('SSA with one right-angle solution', () => {
    const solutions = solveTriangle({ a: 4, b: 8, A: 30 });
    expect(solutions.length).toBe(1);
    close(solutions[0].B, 90);
  });

  it('SSA without solution', () => {
    expect(() => solveTriangle({ a: 2, b: 8, A: 30 })).toThrowError(GeometryError);
  });

  it('requires exactly three values with at least one side', () => {
    expect(() => solveTriangle({ A: 60, B: 60, C: 60 })).toThrowError(/zijde/);
    expect(() => solveTriangle({ a: 1, b: 1 })).toThrowError(GeometryError);
    expect(() => solveTriangle({ a: 1, b: 1, c: 1, A: 60 })).toThrowError(GeometryError);
  });

  it('rejects angles summing to 180° or more', () => {
    expect(() => solveTriangle({ a: 1, A: 100, B: 80 })).toThrowError(GeometryError);
  });
});

describe('analyzePolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];

  it('square, both orientations', () => {
    for (const pts of [square, [...square].reverse()]) {
      const r = analyzePolygon(pts);
      close(r.area, 4);
      close(r.perimeter, 8);
      r.angles.forEach((a) => close(a, 90));
      expect(r.convex).toBe(true);
    }
  });

  it('L-shape has one reflex corner and angles summing to (n-2)*180', () => {
    const L = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    for (const pts of [L, [...L].reverse()]) {
      const r = analyzePolygon(pts);
      close(r.area, 12);
      expect(r.convex).toBe(false);
      expect(r.angles.filter((a) => Math.abs(a - 270) < 1e-6).length).toBe(1);
      close(r.angles.reduce((p, q) => p + q, 0), 720);
    }
  });
});

describe('polygonFromDiagonals', () => {
  it('rectangle 4 x 3 with diagonal 5', () => {
    const r = polygonFromDiagonals([4, 3, 4, 3], [5]);
    close(r.area, 12);
    r.angles.forEach((a) => close(a, 90));
    close(r.sides[3], 3);
  });

  it('room that is not square (diagonal too long)', () => {
    const r = polygonFromDiagonals([4, 3, 4, 3], [5.05]);
    // Opposite corners deviate in opposite directions, total stays 360°.
    close(r.angles.reduce((p, q) => p + q, 0), 360);
    expect(r.angles[1]).toBeGreaterThan(90);
    expect(r.angles[0]).toBeLessThan(90);
  });

  it('reconstructs a random convex pentagon from its own measurements', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5.2, y: 0 },
      { x: 6.1, y: 3.3 },
      { x: 2.9, y: 5.4 },
      { x: -0.8, y: 2.7 },
    ];
    const original = analyzePolygon(pts);
    const d = (i: number) => Math.hypot(pts[i].x, pts[i].y);
    const r = polygonFromDiagonals(original.sides, [d(2), d(3)]);
    close(r.area, original.area);
    r.angles.forEach((a, i) => close(a, original.angles[i]));
  });

  it('L-shape needs no flip when corner 1 sees every corner', () => {
    const L = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    const original = analyzePolygon(L);
    const d = (i: number) => Math.hypot(L[i].x, L[i].y);
    const r = polygonFromDiagonals(original.sides, [d(2), d(3), d(4)]);
    close(r.area, 12);
    expect(r.convex).toBe(false);
  });

  it('handles a corner that falls back (flip)', () => {
    // Notch: corner 4 at (3,1) lies clockwise of the diagonal to corner 3.
    const notch = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 3, y: 1 },
      { x: 0, y: 4 },
    ];
    const original = analyzePolygon(notch);
    const d = (i: number) => Math.hypot(notch[i].x, notch[i].y);
    const diagonals = [d(2), d(3)];
    const plain = polygonFromDiagonals(original.sides, diagonals);
    expect(Math.abs(plain.area - original.area)).toBeGreaterThan(0.01); // wrong without flip
    const flipped = polygonFromDiagonals(original.sides, diagonals, [false, false, false, true]);
    close(flipped.area, original.area);
    flipped.angles.forEach((a, i) => close(a, original.angles[i]));
  });

  it('a triangle needs no diagonals', () => {
    const r = polygonFromDiagonals([3, 4, 5], []);
    close(r.area, 6);
  });

  it('asks for the right number of diagonals', () => {
    expect(() => polygonFromDiagonals([1, 1, 1, 1], [])).toThrowError(/1 diagonaal/);
  });

  it('names the corner that does not fit', () => {
    expect(() => polygonFromDiagonals([4, 3, 4, 3], [9])).toThrowError(/Hoekpunt 3/);
  });
});

describe('polygonFromAngles', () => {
  it('rectangle with measured closing side has no misclosure', () => {
    const r = polygonFromAngles([4, 3, 4, 3], [90, 90]);
    close(r.closingLength, 3);
    close(r.misclosure!, 0);
    close(r.area, 12);
  });

  it('computes the closing side when it was not measured', () => {
    const r = polygonFromAngles([4, 3, 4, null], [90, 90]);
    close(r.closingLength, 3);
    expect(r.misclosure).toBeNull();
  });

  it('agrees with polygonFromDiagonals for an irregular shape', () => {
    const viaDiag = polygonFromDiagonals([5, 3.2, 4.4, 2.9], [6.1]);
    const viaAngles = polygonFromAngles(
      [viaDiag.sides[0], viaDiag.sides[1], viaDiag.sides[2], viaDiag.sides[3]],
      [viaDiag.angles[1], viaDiag.angles[2]],
    );
    close(viaAngles.area, viaDiag.area);
    close(viaAngles.misclosure!, 0);
  });

  it('reflex angle (L-shape)', () => {
    const r = polygonFromAngles([4, 2, 2, 2, 2, 4], [90, 90, 270, 90]);
    close(r.area, 12);
    close(r.misclosure!, 0);
  });

  it('validates input', () => {
    expect(() => polygonFromAngles([4, 3, 4, 3], [90])).toThrowError(GeometryError);
    expect(() => polygonFromAngles([4, 3, 4, 3], [90, 360])).toThrowError(GeometryError);
  });

  it('allows a straight 180° corner (point under a ridge)', () => {
    const r = polygonFromAngles([2, 2, 3, 4, 3], [180, 90, 90]);
    close(r.area, 12);
    close(r.misclosure!, 0);
  });
});

describe('roofSection', () => {
  it('symmetric gable from rise', () => {
    const r = roofSection({ type: 'zadeldak', span: 8, rise: 3 });
    close(r.left.run, 4);
    close(r.left.rafter, 5);
    close(r.right!.rafter, 5);
    close(r.left.pitch, 36.869898, 5);
    close(r.left.pitchPercent, 75);
    close(r.gableArea, 12);
  });

  it('gable from pitch, with overhang', () => {
    const r = roofSection({ type: 'zadeldak', span: 8, pitch: 45, overhang: 0.5 });
    close(r.rise, 4);
    close(r.left.rafter, 4 * Math.SQRT2);
    close(r.left.rafterWithOverhang, 4.5 * Math.SQRT2);
  });

  it('gable from rafter length', () => {
    const r = roofSection({ type: 'zadeldak', span: 8, rafter: 5 });
    close(r.rise, 3);
  });

  it('asymmetric ridge gives two different pitches', () => {
    const r = roofSection({ type: 'zadeldak', span: 10, rise: 3, ridgeOffset: 4 });
    close(r.left.rafter, 5);
    close(r.right!.rafter, Math.hypot(6, 3));
    expect(r.left.pitch).toBeGreaterThan(r.right!.pitch);
  });

  it('lean-to (lessenaarsdak) uses the full span', () => {
    const r = roofSection({ type: 'lessenaarsdak', span: 4, pitch: 15 });
    expect(r.right).toBeNull();
    close(r.rise, 4 * Math.tan((15 * Math.PI) / 180));
  });

  it('validates input', () => {
    expect(() => roofSection({ type: 'zadeldak', span: 8 })).toThrowError(/twee waarden/);
    expect(() => roofSection({ type: 'zadeldak', span: 8, rise: 3, pitch: 30, rafter: 5 })).toThrowError(/precies twee/);
    expect(() => roofSection({ type: 'zadeldak', span: 8, rafter: 3 })).toThrowError(/spar is te kort/);
    expect(() => roofSection({ type: 'zadeldak', span: 8, pitch: 90 })).toThrowError(GeometryError);
    expect(() => roofSection({ type: 'zadeldak', span: 8, rise: 3, ridgeOffset: 9 })).toThrowError(GeometryError);
    expect(() => roofSection({ type: 'lessenaarsdak', span: 4 })).toThrowError(/één van deze/);
  });

  it('two pitches place the ridge themselves', () => {
    // 8 m span, 45° left, atan(0,5) right: ridge where x = (8 − x) / 2 → x = 8/3.
    const pR = (Math.atan(0.5) * 180) / Math.PI;
    const r = roofSection({ type: 'zadeldak', span: 8, pitch: 45, pitchRight: pR });
    close(r.ridge.x, 8 / 3, 6);
    close(r.rise, 8 / 3, 6);
    close(r.left.pitch, 45, 6);
    close(r.right!.pitch, pR, 6);
    expect(r.ridgeAssumedCentre).toBe(false);
  });

  it('shed with a higher front wall: walls 3,0 and 2,4, both pitches', () => {
    const r = roofSection({ type: 'zadeldak', span: 6, wallLeft: 3, wallRight: 2.4, pitch: 40, pitchRight: 25 });
    const tl = Math.tan((40 * Math.PI) / 180);
    const tr = Math.tan((25 * Math.PI) / 180);
    const x = (2.4 - 3 + 6 * tr) / (tl + tr);
    close(r.ridge.x, x, 6);
    close(r.rise, 3 + x * tl, 6);
    close(r.left.rise, x * tl, 6);
    close(r.right!.rise, 3 + x * tl - 2.4, 6);
    expect(r.fromFloor).toBe(true);
    // Gable from the floor: 5-sided outline.
    expect(r.outline.length).toBe(5);
    close(r.gableArea, x * 3 + ((6 - x) * 2.4) + (x * (r.rise - 3)) / 2 + ((6 - x) * (r.rise - 2.4)) / 2 - (0), 6);
  });

  it('ridge height plus one pitch, and rafter pairs', () => {
    const a = roofSection({ type: 'zadeldak', span: 8, rise: 3, pitch: Math.atan(3 / 4) * (180 / Math.PI) });
    close(a.ridge.x, 4, 6);
    const b = roofSection({ type: 'zadeldak', span: 8, rafter: 5, rafterRight: 5 });
    close(b.ridge.x, 4, 6);
    close(b.rise, 3, 6);
    const c = roofSection({ type: 'zadeldak', span: 10, rafter: 5, rise: 3 });
    close(c.ridge.x, 4, 6);
  });

  it('one value with unequal walls is not enough', () => {
    expect(() => roofSection({ type: 'zadeldak', span: 6, wallLeft: 3, wallRight: 2.4, pitch: 35 })).toThrowError(/twee waarden/);
    expect(() => roofSection({ type: 'zadeldak', span: 6, wallLeft: 3, wallRight: 2.4, pitch: 10, rise: 2 })).toThrowError(/komen de dakvlakken niet/);
    // They meet, but below the higher (right) wall plate.
    expect(() => roofSection({ type: 'zadeldak', span: 6, wallLeft: 2.4, wallRight: 3, pitch: 10, rise: 2.6 })).toThrowError(/hoger liggen/);
  });

  it('lean-to between two wall heights', () => {
    const r = roofSection({ type: 'lessenaarsdak', span: 4, wallLeft: 2.2, wallRight: 3 });
    close(r.left.rise, 0.8, 9);
    close(r.rise, 3, 9);
    close(r.gableArea, 4 * 2.6, 9);
    expect(() => roofSection({ type: 'lessenaarsdak', span: 4, wallLeft: 2.2, wallRight: 3, pitch: 10 })).toThrowError(/muurhoogtes/);
    const down = roofSection({ type: 'lessenaarsdak', span: 4, wallLeft: 3, wallRight: 2.2 });
    close(down.ridge.x, 0, 9);
  });
});

describe('solveSlope', () => {
  const base = { run: 3, rise: 4, pitch: (Math.atan2(4, 3) * 180) / Math.PI, length: 5 };
  const pairs: [keyof typeof base, keyof typeof base][] = [
    ['run', 'rise'],
    ['run', 'pitch'],
    ['run', 'length'],
    ['rise', 'pitch'],
    ['rise', 'length'],
    ['pitch', 'length'],
  ];
  for (const [p, q] of pairs) {
    it(`from ${p} + ${q}`, () => {
      const r = solveSlope({ [p]: base[p], [q]: base[q] });
      close(r.run, 3);
      close(r.rise, 4);
      close(r.length, 5);
      close(r.pitch, base.pitch);
    });
  }

  it('requires exactly two values', () => {
    expect(() => solveSlope({ run: 3 })).toThrowError(/precies twee/);
    expect(() => solveSlope({ run: 3, rise: 4, length: 5 })).toThrowError(/precies twee/);
  });

  it('rejects a length shorter than run or rise', () => {
    expect(() => solveSlope({ run: 3, length: 2 })).toThrowError(GeometryError);
    expect(() => solveSlope({ rise: 3, length: 3 })).toThrowError(GeometryError);
  });
});

describe('mansardSection', () => {
  // 8 m span, knee 1 m in and 2,5 m up, ridge 1,5 m above the knee.
  const r = mansardSection({ span: 8, lower: { run: 1, rise: 2.5 }, upper: { rise: 1.5 }, overhang: 0.3 });

  it('solves both slopes', () => {
    close(r.rise, 4);
    close(r.left.pitch, (Math.atan2(2.5, 1) * 180) / Math.PI);
    close(r.left.rafter, Math.hypot(1, 2.5));
    close(r.upper!.run, 3);
    close(r.upper!.rafter, Math.hypot(3, 1.5));
    close(r.upper!.pitch, (Math.atan2(1.5, 3) * 180) / Math.PI);
    expect(r.knee).toEqual({ x: 1, y: 2.5 });
  });

  it('overhang extends the lower rafter only', () => {
    close(r.left.rafterWithOverhang, Math.hypot(1, 2.5) + 0.3 / Math.cos(Math.atan2(2.5, 1)));
    close(r.upper!.rafterWithOverhang, r.upper!.rafter);
  });

  it('gable area = rectangle-ish lower band + triangle on top', () => {
    // Lower trapezoid: (8 + 6) / 2 * 2,5 = 17,5; upper triangle: 6 * 1,5 / 2 = 4,5
    close(r.gableArea, 22);
    expect(r.outline.length).toBe(5);
  });

  it('lower part from pitch and length, upper from pitch', () => {
    const m = mansardSection({ span: 9, lower: { pitch: 70, length: 3 }, upper: { pitch: 25 } });
    close(m.left.pitch, 70);
    close(m.left.rafter, 3);
    close(m.upper!.pitch, 25);
    close(m.rise, 3 * Math.sin((70 * Math.PI) / 180) + (4.5 - 3 * Math.cos((70 * Math.PI) / 180)) * Math.tan((25 * Math.PI) / 180));
  });

  it('validates input', () => {
    expect(() => mansardSection({ span: 8, lower: { run: 4, rise: 2 }, upper: { rise: 1 } })).toThrowError(/voorbij het midden/);
    expect(() => mansardSection({ span: 8, lower: { run: 1, rise: 2.5 }, upper: {} })).toThrowError(/precies één/);
    expect(() => mansardSection({ span: 8, lower: { run: 1, rise: 2.5 }, upper: { rise: 1, pitch: 20 } })).toThrowError(/precies één/);
    expect(() => mansardSection({ span: 8, lower: { run: 2, rise: 1 }, upper: { pitch: 60 } })).toThrowError(/flauwer/);
  });
});

describe('roomTotals', () => {
  const room = polygonFromDiagonals([4, 3, 4, 3], [5]);

  it('without height only gives floor area', () => {
    const t = roomTotals(room, null);
    close(t.floorArea, 12);
    expect(t.volume).toBeNull();
  });

  it('with height and openings', () => {
    const t = roomTotals(room, 2.5, [
      { width: 0.9, height: 2.1 },
      { width: 1.2, height: 1.0 },
    ]);
    close(t.volume!, 30);
    close(t.wallArea!, 35);
    close(t.openingsArea, 3.09);
    close(t.netWallArea!, 31.91);
  });
});
