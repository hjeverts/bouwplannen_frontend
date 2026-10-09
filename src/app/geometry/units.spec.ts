import { formatAngle, formatArea, formatLength, formatMm, parseAngle, parseLength } from './units';

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
