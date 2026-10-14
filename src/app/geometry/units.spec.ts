import { convertItem, convertLength } from '../model/convert-units';
import { formatAngle, formatArea, formatInUnit, formatLength, formatMm, lengthInput, parseAngle, parseLength, unitOf, withLengthUnit } from './units';

describe('parseLength', () => {
  it('reads metres with comma or dot', () => {
    expect(parseLength('3,456')).toBeCloseTo(3.456, 9);
    expect(parseLength('3.456')).toBeCloseTo(3.456, 9);
    expect(parseLength(' 3,456 m ')).toBeCloseTo(3.456, 9);
    expect(parseLength('12')).toBe(12);
  });

  it('converts cm and mm', () => {
    expect(parseLength('345,6 cm')).toBeCloseTo(3.456, 9);
    expect(parseLength('3456mm')).toBeCloseTo(3.456, 9);
    expect(parseLength('3456 MM')).toBeCloseTo(3.456, 9);
  });

  it('empty is null, rubbish is NaN', () => {
    expect(parseLength('')).toBeNull();
    expect(parseLength('   ')).toBeNull();
    expect(parseLength(null)).toBeNull();
    expect(parseLength('3,4,5')).toBeNaN();
    expect(parseLength('abc')).toBeNaN();
  });
});

describe('parseAngle', () => {
  it('reads degrees with or without the symbol', () => {
    expect(parseAngle('90')).toBe(90);
    expect(parseAngle('37,5°')).toBe(37.5);
    expect(parseAngle('')).toBeNull();
    expect(parseAngle('x')).toBeNaN();
  });
});

describe('formatting (Dutch)', () => {
  it('uses a decimal comma', () => {
    expect(formatLength(3.4567)).toBe('3,457 m');
    expect(formatMm(3.4567)).toBe('3.457 mm');
    expect(formatAngle(36.8699)).toBe('36,9°');
    expect(formatArea(12)).toBe('12,00 m²');
    expect(formatLength(null)).toBe('–');
  });
});

describe('project unit', () => {
  it('reads numbers without a unit in the project unit, with a unit as typed', () => {
    withLengthUnit('mm', () => {
      expect(parseLength('3456')).toBeCloseTo(3.456, 9);
      expect(parseLength('3,456 m')).toBeCloseTo(3.456, 9);
      expect(parseLength('345,6 cm')).toBeCloseTo(3.456, 9);
      expect(formatLength(3.456)).toBe('3456 mm');
      expect(formatLength(11.3)).toBe('11300 mm'); // no thousands separator
      expect(formatInUnit(2.45, 2)).toBe('2450');
      expect(lengthInput(0.1)).toBe('100');
    });
    withLengthUnit('cm', () => {
      expect(parseLength('345,6')).toBeCloseTo(3.456, 9);
      expect(formatLength(3.456)).toBe('345,6 cm');
    });
    expect(parseLength('3,456')).toBeCloseTo(3.456, 9);
    expect(formatLength(3.456)).toBe('3,456 m');
    expect(formatArea(12)).toBe('12,00 m²');
    expect(unitOf('345 cm')).toBe('cm');
    expect(unitOf('345')).toBeNull();
    expect(lengthInput(0.1, 'm')).toBe('0,100');
  });
});

describe('converting a project to another unit', () => {
  it('rewrites lengths without a unit and leaves angles and typed units alone', () => {
    expect(convertLength('3,456', 'm', 'mm')).toBe('3456');
    expect(convertLength('345,6', 'cm', 'm')).toBe('3,456');
    expect(convertLength('2,5', 'm', 'cm')).toBe('250');
    expect(convertLength('', 'm', 'mm')).toBe('');
    expect(convertLength('80 cm', 'm', 'mm')).toBe('80 cm');
    const item = {
      id: 'd',
      kind: 'dak',
      name: 'Kap',
      notes: '',
      updated: '',
      roofType: 'zadeldak',
      span: '8',
      rise: '',
      pitch: '45',
      rafter: '',
      ridgeOffset: '',
      overhang: '0,3',
      length: '10 m',
    } as const;
    const mm = convertItem(item as never, 'm', 'mm') as unknown as typeof item;
    expect(mm.span).toBe('8000');
    expect(mm.overhang).toBe('300');
    expect(mm.pitch).toBe('45');
    expect(mm.length).toBe('10 m');
  });
});
