import { AfdakResult, computeAfdak, computeRafters, Rafter } from '../geometry/afdak';
import { parseAngle, parseLength } from '../geometry/units';
import { AfdakEntry } from './models';
import type { Outcome } from './compute';

export interface AfdakOutcome {
  plan: AfdakResult;
  rafters: Rafter | null;
  /** Why the rafters cannot be worked out yet; null when they can, or no roof is entered. */
  roofMessage: string | null;
  /** Sizes used for the rafters (for the drawings). */
  rafterWidth: number | null;
  rafterHeight: number | null;
  beamHeight: number | null;
  notch: '3' | '4';
  /** Rafters fixed against the wall beam: its height (if given) and the rafter top above it. */
  backBeamHeight: number | null;
  backOffset: number;
  /** Where the beams lie on their posts. */
  beamAlign: 'midden' | 'voor' | 'achter';
}

class Missing extends Error {}

function len(text: string | undefined, label: string, fallback: number | null = null): number | null {
  const v = parseLength(text ?? '');
  if (v === null) return fallback;
  if (Number.isNaN(v)) throw new Missing(`${label}: "${text}" is geen maat. Gebruik bijvoorbeeld 3,456 of 150 mm.`);
  if (v < 0) throw new Missing(`${label} kan niet negatief zijn.`);
  return v;
}

function need(v: number | null, label: string): number {
  if (v === null) throw new Missing(`Vul ${label} in.`);
  return v;
}

function count(text: string, label: string): number {
  const v = Number((text ?? '').trim());
  if (!Number.isInteger(v) || v < 1) throw new Missing(`${label}: vul een aantal in (1 of meer).`);
  return v;
}

export function computeAfdakEntry(item: AfdakEntry): Outcome<AfdakOutcome> {
  let plan: AfdakResult;
  try {
    const width = len(item.width, 'Breedte');
    const depth = len(item.depth, 'Diepte');
    if (width === null || depth === null) return { status: 'incomplete', message: 'Vul de breedte en de diepte van het afdak in.' };
    const pw = need(len(item.postWidth, 'Staander'), 'de maat van de staanders');
    plan = computeAfdak({
      width,
      depth,
      attached: item.attached,
      wallOffset: item.attached ? len(item.wallOffset, 'Vanaf hoek gebouw') : null,
      postWidth: pw,
      postDepth: len(item.postDepth, 'Staander diepte', pw)!,
      postsFront: count(item.postsFront, 'Staanders voor'),
      postsBack: item.attached ? 1 : count(item.postsBack, 'Staanders achter'),
      overhangSide: len(item.overhangSide, 'Overstek zijkant', 0)!,
      overhangFront: len(item.overhangFront, 'Overstek voor', 0)!,
      overhangBack: item.attached ? 0 : len(item.overhangBack, 'Overstek achter', 0)!,
      footing: len(item.footing, 'Poer'),
      walls: item.walls ?? [],
      wallThickness: len(item.wallThickness, 'Wanddikte', 0.1)!,
    });
  } catch (e) {
    if (e instanceof Missing || e instanceof RangeError) return { status: e instanceof Missing ? 'incomplete' : 'error', message: e.message };
    throw e;
  }
  let rafters: Rafter | null = null;
  let roofMessage: string | null = null;
  const r = item.roof;
  const sizes = { rafterWidth: null as number | null, rafterHeight: null as number | null, beamHeight: null as number | null, backBeamHeight: null as number | null, backOffset: 0 };
  if (r && Object.entries(r).some(([k, v]) => k !== 'notch' && String(v ?? '').trim())) {
    try {
      const pitch = parseAngle(r.pitch);
      if (pitch !== null && Number.isNaN(pitch)) throw new Missing(`Dakhelling: "${r.pitch}" is geen hoek.`);
      const filled = [pitch, len(r.frontHeight, 'Hoogte voorligger'), len(r.backHeight, 'Hoogte achter')].filter((v) => v !== null).length;
      if (filled < 2) throw new Missing('Vul twee van deze drie in: dakhelling, hoogte voorligger en hoogte achter.');
      sizes.rafterWidth = len(r.rafterWidth, 'Breedte spoor');
      sizes.rafterHeight = len(r.rafterHeight, 'Hoogte spoor');
      sizes.beamHeight = len(r.beamHeight, 'Hoogte voorligger (balk)');
      const against = item.attached && r.backFix === 'tegen';
      // The offset may be negative (rafter lower than the beam): read it without the sign check.
      const offText = (r.backOffset ?? '').trim();
      const off = offText ? parseLength(offText.replace(/^-/, '')) : 0;
      if (off !== null && Number.isNaN(off)) throw new Missing(`Bovenkant spoor t.o.v. ligger: "${offText}" is geen maat.`);
      sizes.backOffset = against ? (offText.startsWith('-') ? -(off ?? 0) : (off ?? 0)) : 0;
      sizes.backBeamHeight = against ? len(r.backBeamHeight, 'Hoogte ligger tegen gebouw') : null;
      rafters = computeRafters(plan, {
        pitch,
        frontHeight: len(r.frontHeight, 'Hoogte voorligger'),
        backHeight: len(r.backHeight, 'Hoogte achter'),
        beamWidth: len(r.beamWidth, 'Breedte voorligger', plan.postDepth)!,
        beamHeight: need(len(r.beamHeight, 'Hoogte voorligger (balk)'), 'de hoogte van de voorligger (balk)'),
        backWidth: need(len(r.backWidth, 'Breedte ligger achter', plan.attached ? null : plan.postDepth), plan.attached ? 'de breedte van de ligger tegen het gebouw' : 'de breedte van de achterligger'),
        rafterWidth: need(len(r.rafterWidth, 'Breedte spoor'), 'de breedte van de sporen'),
        rafterHeight: need(len(r.rafterHeight, 'Hoogte spoor'), 'de hoogte van de sporen'),
        rafterSpacing: len(r.rafterSpacing, 'Sporen h.o.h.', 0.6)!,
        notchFraction: r.notch === '4' ? 0.25 : 1 / 3,
        backFix: item.attached && r.backFix === 'tegen' ? 'tegen' : 'op',
        backOffset: sizes.backOffset,
        backBeamHeight: sizes.backBeamHeight,
        beamAlign: r.beamAlign ?? 'midden',
      });
    } catch (e) {
      if (!(e instanceof Missing || e instanceof RangeError)) throw e;
      roofMessage = e.message;
    }
  }
  return { status: 'ok', value: { plan, rafters, roofMessage, ...sizes, notch: r?.notch === '4' ? '4' : '3', beamAlign: r?.beamAlign ?? 'midden' } };
}
