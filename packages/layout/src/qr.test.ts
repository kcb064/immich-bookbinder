import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { QR_QUIET_ZONE, addEccAndInterleave, alignmentPositions, dataCodewords, encodeQr, qrPath, rawDataModules, versionFor, type QrCode } from './qr.js';

/** Rasterises a code (with the quiet zone) so an independent decoder can read it back. */
function decode(code: QrCode, scale = 4): string | undefined {
  const side = (code.size + 2 * QR_QUIET_ZONE) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (!code.modules[y]![x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y + QR_QUIET_ZONE) * scale + dy) * side + (x + QR_QUIET_ZONE) * scale + dx;
          data[px * 4] = 0;
          data[px * 4 + 1] = 0;
          data[px * 4 + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, side, side)?.data;
}

describe('qr tables', () => {
  it('knows the standard capacities', () => {
    // Total codewords per version (ISO 18004 table 9): 26, 44, 70, 100, ... 3706.
    expect(Math.floor(rawDataModules(1) / 8)).toBe(26);
    expect(Math.floor(rawDataModules(2) / 8)).toBe(44);
    expect(Math.floor(rawDataModules(3) / 8)).toBe(70);
    expect(Math.floor(rawDataModules(10) / 8)).toBe(346);
    expect(Math.floor(rawDataModules(40) / 8)).toBe(3706);
    // Data codewords: 1-L 19, 1-M 16, 1-Q 13, 1-H 9; 40-L 2956.
    expect(dataCodewords(1, 'L')).toBe(19);
    expect(dataCodewords(1, 'M')).toBe(16);
    expect(dataCodewords(1, 'Q')).toBe(13);
    expect(dataCodewords(1, 'H')).toBe(9);
    expect(dataCodewords(40, 'L')).toBe(2956);
  });

  it('places alignment patterns where the standard does', () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });

  it('picks the smallest version that fits byte-mode data', () => {
    // 1-M holds 14 bytes, 1-L 17, 2-M 26.
    expect(versionFor(14, 'M')).toBe(1);
    expect(versionFor(15, 'M')).toBe(2);
    expect(versionFor(17, 'L')).toBe(1);
    expect(versionFor(26, 'M')).toBe(2);
    expect(versionFor(2953, 'L')).toBe(40);
    expect(versionFor(2954, 'L')).toBeUndefined();
  });

  it('computes the standard Reed-Solomon example (1-M, "01234567" data codewords)', () => {
    // ISO 18004 annex I: the 16 data codewords of the numeric example and their 10 EC codewords.
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    const ec = [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55];
    expect(addEccAndInterleave(data, 1, 'M')).toEqual([...data, ...ec]);
  });
});

describe('encodeQr', () => {
  it('builds a version 1 symbol that an independent decoder reads back', () => {
    const code = encodeQr('HELLO', 'M');
    expect(code.version).toBe(1);
    expect(code.size).toBe(21);
    expect(decode(code)).toBe('HELLO');
  });

  it('encodes share URLs (and UTF-8) at every level so the print and the screen agree', () => {
    const url = 'https://books.example.com/s/Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MEFCQ0RFRkdISUpLTE1O';
    for (const ecc of ['L', 'M', 'Q', 'H'] as const) {
      const code = encodeQr(url, ecc);
      expect(decode(code)).toBe(url);
      expect(encodeQr(url, ecc)).toEqual(code);
    }
    const text = 'Lisbon · Porto — 2026 ☀';
    expect(decode(encodeQr(text, 'M'))).toBe(text);
  });

  it('handles versions with several blocks and version information', () => {
    const long = 'x'.repeat(400);
    const code = encodeQr(long, 'M');
    expect(code.version).toBeGreaterThanOrEqual(7);
    expect(decode(code, 3)).toBe(long);
  });

  it('refuses text beyond version 40', () => {
    expect(() => encodeQr('y'.repeat(3000), 'L')).toThrow(/too long/);
  });

  it('draws one path segment per dark module', () => {
    const code = encodeQr('a', 'L');
    const dark = code.modules.flat().filter(Boolean).length;
    expect(qrPath(code).split('M').length - 1).toBe(dark);
    // Finder pattern corner is dark.
    expect(qrPath(code).startsWith('M0 0h1v1h-1z')).toBe(true);
  });
});
