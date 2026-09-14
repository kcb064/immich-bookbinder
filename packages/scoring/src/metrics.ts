import type { ImageMetrics } from '@bookbinder/shared';
import { phashFrom32 } from './phash.js';

/** Interleaved 8-bit pixels, row-major, as sharp's `.raw()` produces them. */
export interface RawImage {
  data: Uint8Array;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
}

/** Rec. 601 luma (0.299 R + 0.587 G + 0.114 B) in integer arithmetic. Single-channel input is returned as is. */
export function toGray(img: RawImage): Uint8Array {
  const { data, width, height, channels } = img;
  const n = width * height;
  const out = new Uint8Array(n);
  if (channels < 3) {
    for (let i = 0; i < n; i++) out[i] = data[i * channels] ?? 0;
    return out;
  }
  for (let i = 0, p = 0; i < n; i++, p += channels) {
    out[i] = ((data[p] ?? 0) * 77 + (data[p + 1] ?? 0) * 150 + (data[p + 2] ?? 0) * 29 + 128) >> 8;
  }
  return out;
}

/**
 * Variance of the 3x3 Laplacian (4-neighbour kernel) over interior pixels. Blur removes high
 * frequencies, so blurry images score low; sharp detail scores in the hundreds at 512 px.
 */
export function laplacianVariance(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const v = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - width]! - gray[i + width]!;
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

export interface LumaStats {
  mean: number;
  stdev: number;
  clipDark: number;
  clipBright: number;
}

/** Mean, standard deviation and the clipped fractions (below 8, above 247) of a greyscale image. */
export function lumaStats(gray: Uint8Array): LumaStats {
  const n = gray.length;
  if (n === 0) return { mean: 0, stdev: 0, clipDark: 0, clipBright: 0 };
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]!]!++;
  let sum = 0;
  let sumSq = 0;
  let dark = 0;
  let bright = 0;
  for (let v = 0; v < 256; v++) {
    const c = hist[v]!;
    sum += c * v;
    sumSq += c * v * v;
    if (v < 8) dark += c;
    if (v > 247) bright += c;
  }
  const mean = sum / n;
  return { mean, stdev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), clipDark: dark / n, clipBright: bright / n };
}

/**
 * Hasler & Suesstrunk (2003) colourfulness: opponent axes rg = R - G and yb = (R + G) / 2 - B,
 * combined as sqrt(sd_rg^2 + sd_yb^2) + 0.3 sqrt(mean_rg^2 + mean_yb^2). Zero for greyscale input.
 */
export function colorfulness(img: RawImage): number {
  const { data, width, height, channels } = img;
  if (channels < 3) return 0;
  const n = width * height;
  if (n === 0) return 0;
  let sRg = 0;
  let sRg2 = 0;
  let sYb = 0;
  let sYb2 = 0;
  for (let i = 0, p = 0; i < n; i++, p += channels) {
    const r = data[p] ?? 0;
    const g = data[p + 1] ?? 0;
    const b = data[p + 2] ?? 0;
    const rg = r - g;
    const yb = (r + g) / 2 - b;
    sRg += rg;
    sRg2 += rg * rg;
    sYb += yb;
    sYb2 += yb * yb;
  }
  const mRg = sRg / n;
  const mYb = sYb / n;
  const vRg = Math.max(0, sRg2 / n - mRg * mRg);
  const vYb = Math.max(0, sYb2 / n - mYb * mYb);
  return Math.sqrt(vRg + vYb) + 0.3 * Math.sqrt(mRg * mRg + mYb * mYb);
}

/**
 * Share of gradient energy inside four windows (each a quarter of the width and height) centred on
 * the rule-of-thirds points. The windows cover a quarter of the frame, so a uniformly busy image
 * scores about 0.25; a subject sitting on a thirds point scores higher.
 */
export function thirdsEnergy(gray: Uint8Array, width: number, height: number): number {
  if (width < 4 || height < 4) return 0;
  const halfW = width / 8;
  const halfH = height / 8;
  const centres = [
    [width / 3, height / 3],
    [(2 * width) / 3, height / 3],
    [width / 3, (2 * height) / 3],
    [(2 * width) / 3, (2 * height) / 3],
  ] as const;
  const inWindow = (x: number, y: number): boolean => {
    for (const [cx, cy] of centres) if (Math.abs(x - cx) <= halfW && Math.abs(y - cy) <= halfH) return true;
    return false;
  };
  let total = 0;
  let inside = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const e = Math.abs(gray[i + 1]! - gray[i - 1]!) + Math.abs(gray[i + width]! - gray[i - width]!);
      total += e;
      if (e > 0 && inWindow(x, y)) inside += e;
    }
  }
  return total > 0 ? inside / total : 0;
}

/** Box-filter resample of a greyscale image to `tw` x `th` (used for the 32x32 pHash input). */
export function boxDownsample(gray: Uint8Array, width: number, height: number, tw: number, th: number): Float64Array {
  const out = new Float64Array(tw * th);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * height) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * width) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / tw));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        const row = y * width;
        for (let x = x0; x < x1 && x < width; x++) {
          sum += gray[row + x]!;
          count++;
        }
      }
      out[ty * tw + tx] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

export interface ImageAnalysis extends ImageMetrics {
  phash: string;
}

/** Every metric the selection engine needs from one decoded preview (about 512 px on the long edge). */
export function analyzeImage(img: RawImage): ImageAnalysis {
  const gray = toGray(img);
  const stats = lumaStats(gray);
  return {
    laplacianVar: laplacianVariance(gray, img.width, img.height),
    meanLuma: stats.mean,
    stdevLuma: stats.stdev,
    clipDark: stats.clipDark,
    clipBright: stats.clipBright,
    colorfulness: colorfulness(img),
    thirds: thirdsEnergy(gray, img.width, img.height),
    phash: phashFrom32(boxDownsample(gray, img.width, img.height, 32, 32)),
  };
}
