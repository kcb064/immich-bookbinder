/**
 * DCT perceptual hash (the classic "pHash"): a 32x32 greyscale image is transformed with a 2-D
 * DCT-II, the 8x8 lowest-frequency block is compared against its median, and the resulting 64 bits
 * are the hash. Near-identical photos (bursts, small crops, re-encodes) differ in a few bits;
 * unrelated photos differ in about 32.
 */
const N = 32;
const K = 8;

/** cos(((2x + 1) u pi) / 2N) for x in 0..N-1, u in 0..K-1, indexed [u * N + x]. */
const COS = (() => {
  const t = new Float64Array(K * N);
  for (let u = 0; u < K; u++) for (let x = 0; x < N; x++) t[u * N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
  return t;
})();

/** The K x K low-frequency DCT coefficients of a 32x32 image (row-major, unnormalised). */
export function dctLowFreq(pixels: Float64Array): Float64Array {
  if (pixels.length !== N * N) throw new Error(`phash expects ${N * N} pixels, got ${pixels.length}`);
  // Rows first: rows[y * K + u]
  const rows = new Float64Array(N * K);
  for (let y = 0; y < N; y++) {
    const off = y * N;
    for (let u = 0; u < K; u++) {
      let s = 0;
      const c = u * N;
      for (let x = 0; x < N; x++) s += pixels[off + x]! * COS[c + x]!;
      rows[y * K + u] = s;
    }
  }
  // Then columns: out[v * K + u]
  const out = new Float64Array(K * K);
  for (let v = 0; v < K; v++) {
    const c = v * N;
    for (let u = 0; u < K; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += rows[y * K + u]! * COS[c + y]!;
      out[v * K + u] = s;
    }
  }
  return out;
}

/** 64-bit hash of a 32x32 greyscale image as 16 lowercase hex characters. */
export function phashFrom32(pixels: Float64Array): string {
  const coef = dctLowFreq(pixels);
  // Median of the AC coefficients (the DC term would dominate and carries no structure).
  const ac = Array.from(coef.subarray(1)).sort((a, b) => a - b);
  const median = ac.length % 2 === 1 ? ac[(ac.length - 1) / 2]! : (ac[ac.length / 2 - 1]! + ac[ac.length / 2]!) / 2;
  let hex = '';
  for (let nibble = 0; nibble < 16; nibble++) {
    let v = 0;
    for (let b = 0; b < 4; b++) {
      const i = nibble * 4 + b;
      v = (v << 1) | (coef[i]! > median ? 1 : 0);
    }
    hex += v.toString(16);
  }
  return hex;
}

const POPCOUNT_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4] as const;

/** Number of differing bits between two hex hashes of equal length (64 for pHash). */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) throw new Error('hamming: hashes differ in length');
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    if (Number.isNaN(x)) throw new Error('hamming: not a hex hash');
    d += POPCOUNT_NIBBLE[x & 15]!;
  }
  return d;
}
