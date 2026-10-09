import { Point, RoofSide } from '../geometry/geometry';
import { formatAngle, formatArea, formatLength, formatPercent, formatVolume } from '../geometry/units';
import { computeDak, computeDriehoek, computeHoek, computeMaten, computeVorm } from './compute';
import { Item, KIND_LABELS, Project } from './models';

export interface ExportFile {
  app: 'bouwplannen';
  version: 1;
  exported: string;
  projects: Project[];
}

export function toJson(projects: Project[]): string {
  const file: ExportFile = { app: 'bouwplannen', version: 1, exported: new Date().toISOString(), projects };
  return JSON.stringify(file, null, 2);
}

/** Read an export file (or a bare project / project list). Throws with a readable message. */
export function parseImport(text: string): Project[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Dit is geen geldig exportbestand (geen JSON).');
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && 'projects' in data
      ? (data as { projects: unknown }).projects
      : [data];
  if (!Array.isArray(list)) throw new Error('Geen projecten gevonden in dit bestand.');
  const valid = list.filter(
    (p): p is Project =>
      !!p && typeof p === 'object' && typeof (p as Project).id === 'string' && typeof (p as Project).name === 'string' && Array.isArray((p as Project).items),
  );
  if (valid.length === 0) throw new Error('Geen projecten gevonden in dit bestand.');
  return valid;
}

/** One line per result value, for a spreadsheet. Uses ; as separator and a decimal comma (Dutch Excel). */
export function projectToCsv(project: Project): string {
  const rows: string[][] = [['Onderdeel', 'Soort', 'Omschrijving', 'Waarde']];
  for (const item of project.items) {
    for (const [label, value] of summarize(item)) rows.push([item.name, KIND_LABELS[item.kind], label, value]);
  }
  return rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

function csvCell(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Human-readable key results of an item, as label/value pairs. */
export function summarize(item: Item): [string, string][] {
  switch (item.kind) {
    case 'hoek': {
      const r = computeHoek(item);
      if (r.status !== 'ok') return [['Status', r.message]];
      return [
        ['Hoek', formatAngle(r.value.angle, 2)],
        ['Afwijking van haaks', formatAngle(r.value.deviationFromSquare, 2)],
      ];
    }
    case 'driehoek': {
      const r = computeDriehoek(item);
      if (r.status !== 'ok') return [['Status', r.message]];
      const t = r.value[Math.min(item.solution, r.value.length - 1)];
      return [
        ['Zijde a', formatLength(t.a)],
        ['Zijde b', formatLength(t.b)],
        ['Zijde c', formatLength(t.c)],
        ['Hoek A', formatAngle(t.A, 2)],
        ['Hoek B', formatAngle(t.B, 2)],
        ['Hoek C', formatAngle(t.C, 2)],
        ['Oppervlakte', formatArea(t.area)],
      ];
    }
    case 'vorm': {
      const r = computeVorm(item);
      if (r.status !== 'ok') return [['Status', r.message]];
      const { shape, room } = r.value;
      const out: [string, string][] = [];
      shape.sides.forEach((s, i) => out.push([`Zijde ${i + 1}`, formatLength(s)]));
      shape.angles.forEach((a, i) => out.push([`Hoek ${i + 1}`, formatAngle(a, 2)]));
      out.push(['Oppervlakte', formatArea(shape.area)], ['Omtrek', formatLength(shape.perimeter)]);
      if (room) {
        out.push(['Inhoud', formatVolume(room.volume)], ['Wandoppervlak bruto', formatArea(room.wallArea)], ['Wandoppervlak netto', formatArea(room.netWallArea)]);
        room.walls.forEach((w, i) => out.push([`Wand ${i + 1}–${((i + 1) % room.walls.length) + 1} netto`, formatArea(w.netArea)]));
        if (room.sloped) out.push(['Plafond langs de helling', formatArea(room.ceilingArea)]);
      }
      return out;
    }
    case 'dak': {
      const r = computeDak(item);
      if (r.status !== 'ok') return [['Status', r.message]];
      const { roof, purlinLength, surfaceLeft, surfaceRight } = r.value;
      const slope = (label: string, sd: RoofSide): [string, string][] => [
        [`Helling ${label}`, `${formatAngle(sd.pitch, 2)} (${formatPercent(sd.pitchPercent)})`],
        [`Spar ${label}`, formatLength(sd.rafter)],
        [`Spar ${label} incl. overstek`, formatLength(sd.rafterWithOverhang)],
      ];
      const out: [string, string][] = [['Nokhoogte', formatLength(roof.rise)]];
      if (roof.upper && roof.knee) {
        out.push(['Knikhoogte', formatLength(roof.knee.y)], ...slope('onderdak', roof.left), ...slope('bovendak', roof.upper));
      } else if (roof.type === 'zadeldak' && roof.right) {
        out.push(['Nok vanaf muur links', formatLength(roof.ridge.x)], ...slope('links', roof.left), ...slope('rechts', roof.right));
      } else {
        out.push(...slope('', roof.left).map(([k, v]) => [k.replace('  ', ' ').trim(), v] as [string, string]));
      }
      if (purlinLength !== null) out.push(['Gordingen en nok', formatLength(purlinLength)]);
      out.push(['Gevelvlak', formatArea(roof.gableArea)]);
      if (surfaceLeft !== null) out.push(['Dakoppervlak', formatArea(surfaceLeft + (surfaceRight ?? 0))]);
      return out;
    }
    case 'maten': {
      const r = computeMaten(item);
      if (r.status !== 'ok') return [['Status', r.message]];
      return item.entries.map((e, i) => [e.label || `Maat ${i + 1}`, formatLength(r.value.values[i])]);
    }
  }
}

/** Outline of an item for drawing or CAD, in metres. */
export function outlineOf(item: Item): Point[] | null {
  if (item.kind === 'vorm') {
    const r = computeVorm(item);
    return r.status === 'ok' ? r.value.shape.points : null;
  }
  if (item.kind === 'dak') {
    const r = computeDak(item);
    return r.status === 'ok' ? r.value.roof.outline : null;
  }
  return null;
}

/** Minimal DXF (R12, ASCII) with the outline as LINE entities, in millimetres. Opens in AutoCAD, LibreCAD, FreeCAD. */
export function outlineToDxf(points: Point[], layer = 'BOUWPLANNEN'): string {
  const mm = (v: number) => (Math.round(v * 1e6) / 1e3).toString();
  const out: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    out.push('0', 'LINE', '8', layer, '10', mm(p.x), '20', mm(p.y), '30', '0', '11', mm(q.x), '21', mm(q.y), '31', '0');
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\r\n') + '\r\n';
}
