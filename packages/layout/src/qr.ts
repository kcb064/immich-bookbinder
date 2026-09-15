/**
 * QR code encoder (ISO/IEC 18004), byte mode, all 40 versions and four error-correction levels.
 * Pure TypeScript, no dependencies: the colophon page (M7) encodes the share URL and the same
 * modules are drawn by the editor, the viewer PNGs and the print PDF, so the output must be
 * identical everywhere. Tables follow the standard (as tabulated in Nayuki's qrcodegen).
 */

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export interface QrCode {
  version: number;
  /** Modules per side (17 + 4 × version). */
  size: number;
  ecc: QrEcc;
  mask: number;
  /** Row-major; true = dark module. */
  modules: boolean[][];
}

const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };
const ECC_INDEX: Record<QrEcc, number> = { L: 0, M: 1, Q: 2, H: 3 };

// Indexed [ecc][version]; index 0 is unused.
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/** Number of data modules (raw bits) available in a version, before error correction. */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Number of data codewords a version holds at an error-correction level. */
export function dataCodewords(version: number, ecc: QrEcc): number {
  const e = ECC_INDEX[ecc];
  return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[e]![version]! * NUM_ERROR_CORRECTION_BLOCKS[e]![version]!;
}

/** Positions of the alignment pattern centres along one axis. */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const size = 17 + 4 * version;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/* ---------- Reed-Solomon over GF(256) with the QR polynomial 0x11D ---------- */

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i]! ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

/** Splits the data codewords into blocks, appends error correction, and interleaves (standard order). */
export function addEccAndInterleave(data: readonly number[], version: number, ecc: QrEcc): number[] {
  const e = ECC_INDEX[ecc];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[e]![version]!;
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[e]![version]!;
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  if (data.length !== dataCodewords(version, ecc)) throw new Error('addEccAndInterleave: wrong data length');

  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const rem = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(rem));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      // Skip the padding byte in short blocks.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

/* ---------- Symbol construction ---------- */

class Matrix {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(version: number) {
    this.size = 17 + 4 * version;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  setFunction(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.isFunction[y]![x] = true;
  }

  drawFinder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.setFunction(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }

  drawAlignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  /** Format information (ecc level + mask) with its BCH code, drawn twice. */
  drawFormatBits(ecc: QrEcc, mask: number): void {
    const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(i));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.setFunction(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFunction(8, this.size - 15 + i, bit(i));
    this.setFunction(8, this.size - 8, true);
  }

  drawVersion(version: number): void {
    if (version < 7) return;
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  drawFunctionPatterns(version: number, ecc: QrEcc): void {
    for (let i = 0; i < this.size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const align = alignmentPositions(version);
    const n = align.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlignment(align[i]!, align[j]!);
      }
    }
    this.drawFormatBits(ecc, 0);
    this.drawVersion(version);
  }

  /** Places the codewords in the zigzag order the standard prescribes. */
  drawCodewords(data: readonly number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y]![x] && i < data.length * 8) {
            this.modules[y]![x] = ((data[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!this.isFunction[y]![x] && invert) this.modules[y]![x] = !this.modules[y]![x];
      }
    }
  }

  /** Penalty score of the current modules (lower is better), per the standard's four rules. */
  penalty(): number {
    let result = 0;
    const n = this.size;
    for (let y = 0; y < n; y++) {
      let runColor = false;
      let runX = 0;
      const runHistory = new Array<number>(7).fill(0);
      for (let x = 0; x < n; x++) {
        if (this.modules[y]![x] === runColor) {
          runX++;
          if (runX === 5) result += 3;
          else if (runX > 5) result++;
        } else {
          finderPenaltyAddHistory(runX, runHistory, n);
          if (!runColor) result += finderPenaltyCountPatterns(runHistory) * 40;
          runColor = this.modules[y]![x]!;
          runX = 1;
        }
      }
      result += finderPenaltyTerminateAndCount(runColor, runX, runHistory, n) * 40;
    }
    for (let x = 0; x < n; x++) {
      let runColor = false;
      let runY = 0;
      const runHistory = new Array<number>(7).fill(0);
      for (let y = 0; y < n; y++) {
        if (this.modules[y]![x] === runColor) {
          runY++;
          if (runY === 5) result += 3;
          else if (runY > 5) result++;
        } else {
          finderPenaltyAddHistory(runY, runHistory, n);
          if (!runColor) result += finderPenaltyCountPatterns(runHistory) * 40;
          runColor = this.modules[y]![x]!;
          runY = 1;
        }
      }
      result += finderPenaltyTerminateAndCount(runColor, runY, runHistory, n) * 40;
    }
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = this.modules[y]![x];
        if (c === this.modules[y]![x + 1] && c === this.modules[y + 1]![x] && c === this.modules[y + 1]![x + 1]) result += 3;
      }
    }
    let dark = 0;
    for (const row of this.modules) for (const m of row) if (m) dark++;
    const total = n * n;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * 10;
    return result;
  }
}

function finderPenaltyCountPatterns(h: readonly number[]): number {
  const n = h[1]!;
  const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
  return (core && h[0]! >= n * 4 && h[6]! >= n ? 1 : 0) + (core && h[6]! >= n * 4 && h[0]! >= n ? 1 : 0);
}

function finderPenaltyTerminateAndCount(currentRunColor: boolean, currentRunLength: number, h: number[], size: number): number {
  let len = currentRunLength;
  if (currentRunColor) {
    finderPenaltyAddHistory(len, h, size);
    len = 0;
  }
  len += size;
  finderPenaltyAddHistory(len, h, size);
  return finderPenaltyCountPatterns(h);
}

function finderPenaltyAddHistory(currentRunLength: number, h: number[], size: number): void {
  let len = currentRunLength;
  if (h[0] === 0) len += size;
  h.pop();
  h.unshift(len);
}

/** Smallest version whose data capacity holds `byteLength` bytes in byte mode at `ecc`, or undefined. */
export function versionFor(byteLength: number, ecc: QrEcc, minVersion = 1, maxVersion = 40): number | undefined {
  for (let v = minVersion; v <= maxVersion; v++) {
    const lengthBits = v < 10 ? 8 : 16;
    const needed = 4 + lengthBits + byteLength * 8;
    if (needed <= dataCodewords(v, ecc) * 8) return v;
  }
  return undefined;
}

/**
 * Encodes `text` (UTF-8, byte mode) at the given error-correction level, choosing the smallest
 * version that fits and the mask with the lowest penalty. Throws when the text is too long (2953
 * bytes at level L).
 */
export function encodeQr(text: string, ecc: QrEcc = 'M'): QrCode {
  const bytes = [...new TextEncoder().encode(text)];
  const version = versionFor(bytes.length, ecc);
  if (version === undefined) throw new Error(`Text is too long for a QR code at level ${ecc} (${bytes.length} bytes)`);

  // Bit stream: mode 0100, length, data, terminator, pad to bytes, pad codewords.
  const bits: number[] = [];
  const append = (value: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(4, 4);
  append(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) append(b, 8);
  const capacity = dataCodewords(version, ecc) * 8;
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]!;
    data.push(b);
  }

  const m = new Matrix(version);
  m.drawFunctionPatterns(version, ecc);
  m.drawCodewords(addEccAndInterleave(data, version, ecc));
  let best = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    m.applyMask(mask);
    m.drawFormatBits(ecc, mask);
    const p = m.penalty();
    if (p < bestPenalty) {
      bestPenalty = p;
      best = mask;
    }
    m.applyMask(mask); // undo (XOR is its own inverse)
  }
  m.applyMask(best);
  m.drawFormatBits(ecc, best);
  return { version, size: m.size, ecc, mask: best, modules: m.modules.map((row) => [...row]) };
}

/**
 * The code as one SVG path (`M x y h1 v1 h-1 z` per dark module) in a `size` × `size` unit box;
 * the caller scales it and adds the quiet zone. A path keeps the print PDF small.
 */
export function qrPath(code: QrCode): string {
  const parts: string[] = [];
  for (let y = 0; y < code.size; y++) for (let x = 0; x < code.size; x++) if (code.modules[y]![x]) parts.push(`M${x} ${y}h1v1h-1z`);
  return parts.join('');
}

/** Standard 4-module quiet zone. */
export const QR_QUIET_ZONE = 4;
