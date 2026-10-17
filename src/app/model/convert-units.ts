/**
 * Change the unit of a project: every length typed without a unit is rewritten in the new unit
 * ("3,456" in metres becomes "3456" in mm), so nothing changes size. Lengths typed with their own
 * unit ("345 cm"), angles and other values stay as they are.
 */
import { lengthInput, LengthUnit, UNIT_FACTOR } from '../geometry/units';
import { Item } from './models';

const PLAIN = /^\s*(-?\d+(?:[.,]\d+)?)\s*$/;

export function convertLength(text: string | undefined, from: LengthUnit, to: LengthUnit): string | undefined {
  if (text === undefined) return undefined;
  const m = PLAIN.exec(text);
  if (!m) return text; // empty, with its own unit, or not a number
  const metres = Number(m[1].replace(',', '.')) * UNIT_FACTOR[from];
  return lengthInput(metres, to);
}

/** The same item with all its lengths in another unit. */
export function convertItem(item: Item, from: LengthUnit, to: LengthUnit): Item {
  if (from === to) return item;
  const c = (t: string | undefined) => convertLength(t, from, to);
  const cs = (arr: string[] | undefined) => arr?.map((t) => c(t)!) ;
  switch (item.kind) {
    case 'hoek':
      return { ...item, a: c(item.a)!, b: c(item.b)!, c: c(item.c)! };
    case 'driehoek':
      return { ...item, a: c(item.a)!, b: c(item.b)!, c: c(item.c)! };
    case 'vorm':
      return {
        ...item,
        sides: cs(item.sides)!,
        diagonals: cs(item.diagonals)!,
        height: c(item.height)!,
        heights: cs(item.heights),
        openings: item.openings.map((o) => ({ ...o, width: c(o.width)!, height: c(o.height)!, offset: c(o.offset), sill: c(o.sill) })),
      };
    case 'dak':
      return {
        ...item,
        span: c(item.span)!,
        rise: c(item.rise)!,
        rafter: c(item.rafter)!,
        lowerRun: c(item.lowerRun),
        lowerRise: c(item.lowerRise),
        lowerRafter: c(item.lowerRafter),
        ridgeOffset: c(item.ridgeOffset)!,
        rafterRight: c(item.rafterRight),
        wallLeft: c(item.wallLeft),
        wallRight: c(item.wallRight),
        overhang: c(item.overhang)!,
        gableOverhang: c(item.gableOverhang),
        overhangRight: c(item.overhangRight),
        gableOverhangEnd: c(item.gableOverhangEnd),
        buildup: item.buildup && {
          ...item.buildup,
          rafter: c(item.buildup.rafter)!,
          deck: c(item.buildup.deck)!,
          counter: c(item.buildup.counter)!,
          batten: c(item.buildup.batten)!,
          tile: c(item.buildup.tile)!,
        },
        tiles: item.tiles && {
          ...item.tiles,
          width: c(item.tiles.width)!,
          length: c(item.tiles.length)!,
          gauge: c(item.tiles.gauge)!,
          gaugeMin: c(item.tiles.gaugeMin)!,
          cover: c(item.tiles.cover)!,
          ridgeGap: c(item.tiles.ridgeGap)!,
          eavesGap: c(item.tiles.eavesGap)!,
          counterSpacing: c(item.tiles.counterSpacing)!,
          vergeStart: c(item.tiles.vergeStart)!,
          vergeEnd: c(item.tiles.vergeEnd)!,
        },
        length: c(item.length)!,
      };
    case 'afdak':
      return {
        ...item,
        width: c(item.width)!,
        depth: c(item.depth)!,
        wallOffset: c(item.wallOffset)!,
        postWidth: c(item.postWidth)!,
        postDepth: c(item.postDepth)!,
        overhangSide: c(item.overhangSide)!,
        overhangFront: c(item.overhangFront)!,
        overhangBack: c(item.overhangBack)!,
        footing: c(item.footing)!,
        wallThickness: c(item.wallThickness)!,
        roof: item.roof && {
          ...item.roof,
          frontHeight: c(item.roof.frontHeight)!,
          backHeight: c(item.roof.backHeight)!,
          beamWidth: c(item.roof.beamWidth)!,
          beamHeight: c(item.roof.beamHeight)!,
          backWidth: c(item.roof.backWidth)!,
          rafterWidth: c(item.roof.rafterWidth)!,
          rafterHeight: c(item.roof.rafterHeight)!,
          rafterSpacing: c(item.roof.rafterSpacing)!,
          backOffset: c(item.roof.backOffset),
          backBeamHeight: c(item.roof.backBeamHeight),
        },
      };
    case 'maten':
      return { ...item, entries: item.entries.map((e) => ({ ...e, value: c(e.value)! })) };
    case 'plattegrond':
      return {
        ...item,
        outerWall: c(item.outerWall)!,
        measuredWidth: c(item.measuredWidth)!,
        measuredDepth: c(item.measuredDepth)!,
        plateHeight: c(item.plateHeight)!,
        floorThickness: c(item.floorThickness)!,
        floorHeight: c(item.floorHeight),
        flatThickness: c(item.flatThickness),
        shiftX: c(item.shiftX)!,
        shiftY: c(item.shiftY)!,
        rooms: item.rooms.map((r) => ({ ...r, thickness: c(r.thickness), offset: c(r.offset), distance: c(r.distance) })),
        voids: item.voids?.map((v) => ({ ...v, offset: c(v.offset)!, distance: c(v.distance)!, width: c(v.width)!, length: c(v.length)! })),
        roofs: item.roofs?.map((r) => ({
          ...r,
          plateHeight: c(r.plateHeight)!,
          dormers: r.dormers.map((d) => ({
            ...d,
            offset: c(d.offset)!,
            width: c(d.width)!,
            frontHeight: c(d.frontHeight)!,
            setback: c(d.setback)!,
            windowWidth: c(d.windowWidth)!,
            windowHeight: c(d.windowHeight)!,
          })),
          windows: r.windows.map((w) => ({ ...w, offset: c(w.offset)!, up: c(w.up)!, width: c(w.width)!, length: c(w.length)! })),
        })),
      };
  }
}
