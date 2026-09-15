import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import type { BinaryResponse, ImmichClient } from '../immich/client.js';
import { decodableMetadata, ImageStore } from './images.js';

const asset = { id: 'asset-1', fileName: 'IMG_1.HEIC', width: 600, height: 400, orientation: 1 } as never;

async function jpeg(w: number, h: number, label: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#c60"/><text x="10" y="40" font-size="30">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

function binary(buf: Buffer): BinaryResponse {
  return { status: 200, contentType: 'image/jpeg', contentLength: buf.length, body: null, buffer: async () => buf } as BinaryResponse;
}

describe('decodableMetadata', () => {
  it('rejects HEVC-compressed HEIF only when the build lacks an HEVC decoder', () => {
    expect(decodableMetadata({ format: 'heif', compression: 'hevc' }, false)).toBe(false);
    expect(decodableMetadata({ format: 'heif', compression: 'hevc' }, true)).toBe(true);
    expect(decodableMetadata({ format: 'heif', compression: 'av1' }, false)).toBe(true);
    expect(decodableMetadata({ format: 'jpeg' }, false)).toBe(true);
  });
});

describe('ImageStore source fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-images-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('falls back to fullsize when the original opens but does not decode', async () => {
    // A JPEG cut short: the header (so metadata) is intact, the scan is not, so decoding fails.
    const full = await jpeg(600, 400, 'original');
    const truncated = full.subarray(0, Math.floor(full.length * 0.5));
    const fullsize = await jpeg(300, 200, 'fullsize');
    const calls: string[] = [];
    const client = {
      getOriginal: async (id: string) => (calls.push(`original:${id}`), binary(truncated)),
      getThumbnail: async (id: string, size: string) => (calls.push(`${size}:${id}`), binary(fullsize)),
    } as unknown as ImmichClient;
    const store = new ImageStore(dir, client);

    const first = await store.source(asset, 'print');
    expect(first.variant).toBe('original');

    const out = await store.slotImage(asset, 'print', 120, 80);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([120, 80]);
    expect(calls).toEqual(['original:asset-1', 'fullsize:asset-1']);

    // The failed variant stays skipped for later slots on the same asset.
    const again = await store.source(asset, 'print');
    expect(again.variant).toBe('fullsize');
    expect(calls).toHaveLength(2);
  });
});
