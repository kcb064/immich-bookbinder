import { FORMAT_PRESETS, LuluProduct } from '@bookbinder/shared';
import { describe, expect, it } from 'vitest';
import { coverGeometry } from './cover.js';

const square = FORMAT_PRESETS['lulu-square-8.5']!;

describe('coverGeometry', () => {
  it('estimates a casewrap spine from the caliper plus board, with a 0.75 in wrap', () => {
    const g = coverGeometry(square, LuluProduct.parse({}), 48);
    expect(g.source).toBe('estimate');
    expect(g.spineIn).toBeCloseTo(48 * 0.002252 + 0.25, 4);
    expect(g.wrapIn).toBe(0.75);
    expect(g.widthIn).toBeCloseTo(1.5 + 17 + g.spineIn, 4);
    expect(g.heightIn).toBeCloseTo(10, 4);
    expect(g.frontLeftIn).toBeCloseTo(0.75 + 8.5 + g.spineIn, 4);
  });

  it('gives a perfect-bound book no board and only the bleed around the trim', () => {
    const g = coverGeometry(square, LuluProduct.parse({ binding: 'PB', paper: '060UW444' }), 100);
    expect(g.spineIn).toBeCloseTo(0.25, 4);
    expect(g.wrapIn).toBe(0.125);
    expect(g.widthIn).toBeCloseTo(0.25 + 17 + 0.25, 4);
    expect(g.heightIn).toBeCloseTo(8.75, 4);
  });

  it('grows the spine with the page count', () => {
    const a = coverGeometry(square, LuluProduct.parse({}), 24);
    const b = coverGeometry(square, LuluProduct.parse({}), 240);
    expect(b.spineIn - a.spineIn).toBeCloseTo(216 * 0.002252, 3);
  });

  it('takes Lulu dimensions as given and derives the wrap from them', () => {
    const g = coverGeometry(square, LuluProduct.parse({}), 48, { widthIn: 18.9, heightIn: 10.2, spineIn: 0.4 });
    expect(g.source).toBe('lulu');
    expect(g.widthIn).toBe(18.9);
    expect(g.spineIn).toBe(0.4);
    expect(g.wrapIn).toBeCloseTo((18.9 - 17 - 0.4) / 2, 4);
    expect(g.frontLeftIn).toBeCloseTo(g.wrapIn + 8.5 + 0.4, 4);
  });
});
