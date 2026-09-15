import { FORMAT_PRESETS, LuluProduct } from '@bookbinder/shared';
import { describe, expect, it } from 'vitest';
import { coverFrameIn, coverGeometry, coverSlotIn } from './cover.js';

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
    const g = coverGeometry(square, LuluProduct.parse({ binding: 'PB', paper: '060UW444' }), 111);
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

  it('derives wrap and spine from a width/height-only Lulu answer', () => {
    // Lulu's /cover-dimensions/ example: 6 x 9 in perfect bound, 210 pages -> 920 x 666 pt.
    const six = { ...square, trimWidthIn: 6, trimHeightIn: 9 };
    const g = coverGeometry(six, LuluProduct.parse({ binding: 'PB', paper: '060UW444' }), 210, { widthIn: 920 / 72, heightIn: 666 / 72 });
    expect(g.source).toBe('lulu');
    expect(g.wrapIn).toBeCloseTo(0.125, 3);
    expect(g.spineIn).toBeCloseTo(12.7778 - 12 - 0.25, 3);
    expect(g.frontLeftIn).toBeCloseTo(0.125 + 6 + g.spineIn, 3);
  });

  it('uses the same 1/444 in caliper for every paper', () => {
    const coated = coverGeometry(square, LuluProduct.parse({ paper: '080CW444' }), 200);
    const uncoated = coverGeometry(square, LuluProduct.parse({ paper: '060UW444' }), 200);
    expect(uncoated.spineIn).toBe(coated.spineIn);
    expect(coated.spineIn).toBeCloseTo(200 / 444 + 0.25, 4);
  });
});

describe('coverFrameIn', () => {
  const g = coverGeometry(square, LuluProduct.parse({}), 48);

  it('maps a hand-placed frame linearly: its own size, the corner by the back/front convention', () => {
    // Straddling the spine from the back cover: the corner is on the back, the width is the frame's own.
    const across = coverFrameIn({ x: -0.3, y: 0.4, w: 0.6, h: 0.2 }, square, g);
    expect(across.x).toBeCloseTo(g.wrapIn + 0.7 * 8.5, 4);
    expect(across.w).toBeCloseTo(0.6 * 8.5, 4);
    expect(across.h).toBeCloseTo(0.2 * 8.5, 4);
    // The clamping slot map would have inserted the spine into the width.
    expect(coverSlotIn({ id: 'title', x: -0.3, y: 0.4, w: 0.6, h: 0.2 }, square, g).w).toBeCloseTo(0.6 * 8.5 + g.spineIn, 4);
    // Above the trim: the box keeps its height instead of being stretched from the sheet edge.
    const high = coverFrameIn({ x: 0.1, y: -0.05, w: 0.3, h: 0.1 }, square, g);
    expect(high.y).toBeCloseTo(g.wrapIn - 0.05 * 8.5, 4);
    expect(high.h).toBeCloseTo(0.1 * 8.5, 4);
    expect(coverSlotIn({ id: 'title', x: 0.1, y: -0.05, w: 0.3, h: 0.1 }, square, g).y).toBe(0);
    // Front cover: x = 0 is the front's left trim edge, past the spine.
    expect(coverFrameIn({ x: 0, y: 0, w: 0.5, h: 0.5 }, square, g).x).toBeCloseTo(g.frontLeftIn, 4);
  });
});
