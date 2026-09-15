import type { BookAsset, Crop, RenderKind } from '@bookbinder/shared';
import { coverCrop } from '@bookbinder/layout';
import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { ImmichApiError, type ImmichClient, type ImmichMediaSize } from '../immich/client.js';

/** Pixels per inch each render kind targets; sources are never upscaled past their own resolution. */
export const RENDER_PPI: Record<RenderKind, number> = { proof: 110, print: 300, cover: 300, preview: 180 };
export const JPEG_QUALITY: Record<RenderKind, number> = { proof: 80, print: 92, cover: 92, preview: 85 };
/** Which Immich variants a render kind may draw from: print work wants originals, screen work is happy with previews. */
const SOURCE_VARIANTS: Record<RenderKind, SourceImage['variant'][]> = {
  proof: ['preview'],
  preview: ['preview'],
  print: ['original', 'fullsize', 'preview'],
  cover: ['original', 'fullsize', 'preview'],
};

/**
 * sharp's prebuilt libvips ships libheif with an AV1 decoder only (HEVC is patent-encumbered), so
 * iPhone/Samsung HEIC originals open (`metadata()` reads the container) but fail at pixel decode
 * with "Decoder plugin generated an error". libvips lists `.heic` as an input suffix only when a
 * HEVC decoder is compiled in.
 */
const HEVC_DECODABLE = (sharp.format.heif?.input.fileSuffix ?? []).some((s) => s === '.heic' || s === '.heif');

/** Whether this build can turn the probed file into pixels, judged from metadata alone (no decode). */
export function decodableMetadata(m: Pick<Metadata, 'format' | 'compression'>, hevc = HEVC_DECODABLE): boolean {
  if (m.format === 'heif' && m.compression === 'hevc' && !hevc) return false;
  return true;
}

export interface SourceImage {
  path: string;
  width: number;
  height: number;
  /** Which Immich variant the file came from. */
  variant: 'original' | 'fullsize' | 'preview' | 'thumbnail';
}

export class ImageError extends Error {
  constructor(
    message: string,
    public readonly assetId: string,
  ) {
    super(message);
    this.name = 'ImageError';
  }
}

/**
 * Fetches Immich originals/previews into DATA_DIR/cache and cuts slot-sized JPEGs from them with
 * sharp: cover-fit around the focal point, resized to the slot's pixel size at the render's ppi.
 * Originals sharp cannot decode (HEVC HEIC on the prebuilt binaries) fall back to Immich's `fullsize` JPEG.
 */
export class ImageStore {
  private readonly limit = pLimit(4);
  private readonly inflight = new Map<string, Promise<SourceImage>>();
  /** `assetId:variant` pairs whose file opened but would not decode; `resolveSource` skips them. */
  private readonly undecodable = new Set<string>();

  constructor(
    private readonly cacheDir: string,
    private readonly client: ImmichClient,
  ) {}

  private variantPath(assetId: string, variant: SourceImage['variant']): string {
    const safe = createHash('sha1').update(assetId).digest('hex');
    return join(this.cacheDir, 'immich', variant, `${safe.slice(0, 2)}`, `${safe}.bin`);
  }

  private async download(assetId: string, variant: SourceImage['variant']): Promise<string> {
    const target = this.variantPath(assetId, variant);
    try {
      if ((await stat(target)).size > 0) return target;
    } catch {
      // not cached yet
    }
    await mkdir(join(target, '..'), { recursive: true });
    const res =
      variant === 'original'
        ? await this.client.getOriginal(assetId)
        : await this.client.getThumbnail(assetId, variant as ImmichMediaSize);
    const buf = await res.buffer();
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, buf);
    await rename(tmp, target);
    return target;
  }

  private async probe(path: string): Promise<{ width: number; height: number } | undefined> {
    try {
      const m = await sharp(path).metadata();
      if (!m.width || !m.height || !decodableMetadata(m)) return undefined;
      const swap = (m.orientation ?? 1) >= 5;
      return swap ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
    } catch {
      return undefined;
    }
  }

  /**
   * A small JPEG (long edge at most `longEdge` px, default 320) for the Claude features (M7): cut
   * from Immich's `thumbnail` variant, so nothing larger than a thumbnail ever leaves the server.
   */
  async aiThumbnail(assetId: string, longEdge = 320): Promise<Buffer> {
    const path = await this.limit(() => this.download(assetId, 'thumbnail'));
    return sharp(await readFile(path))
      .rotate()
      .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
  }

  /** Path of the cached Immich `preview` JPEG (downloaded on first use); the selection engine scores from it. */
  preview(assetId: string): Promise<string> {
    return this.limit(() => this.download(assetId, 'preview'));
  }

  /** The best decodable source for a render kind: print and cover want originals, proof and preview take previews. */
  source(asset: BookAsset, kind: RenderKind): Promise<SourceImage> {
    const key = `${SOURCE_VARIANTS[kind].join(',')}:${asset.id}`;
    let p = this.inflight.get(key);
    if (!p) {
      p = this.limit(() => this.resolveSource(asset, kind)).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  private async resolveSource(asset: BookAsset, kind: RenderKind): Promise<SourceImage> {
    const order = SOURCE_VARIANTS[kind];
    let lastError: unknown;
    for (const variant of order) {
      if (this.undecodable.has(`${asset.id}:${variant}`)) continue;
      try {
        const path = await this.download(asset.id, variant);
        const dims = await this.probe(path);
        if (dims) return { path, variant, ...dims };
        lastError = new Error(`${variant} is not a decodable image`);
      } catch (err) {
        lastError = err;
        if (err instanceof ImmichApiError && err.status !== 404 && err.status !== 400) throw new ImageError(`Immich ${err.message}`, asset.id);
      }
    }
    throw new ImageError(`No usable image for ${asset.fileName ?? asset.id}: ${lastError instanceof Error ? lastError.message : String(lastError)}`, asset.id);
  }

  /**
   * A JPEG exactly filling `wPx × hPx` (or smaller when the source lacks the pixels), cropped around
   * the focal point. EXIF orientation is applied first so crops match what Immich shows.
   * A source that opened but fails to decode (a codec `probe` could not foresee, a truncated file)
   * is marked undecodable and the next variant in the kind's order is tried.
   */
  async slotImage(asset: BookAsset, kind: RenderKind, wPx: number, hPx: number, crop?: Crop): Promise<Buffer> {
    for (;;) {
      const src = await this.source(asset, kind);
      const region = coverCrop(src.width, src.height, wPx, hPx, crop);
      const targetW = Math.min(wPx, region.w);
      const targetH = Math.min(hPx, region.h);
      try {
        return await sharp(await readFile(src.path))
          .rotate()
          .extract({ left: region.x, top: region.y, width: region.w, height: region.h })
          .resize({ width: targetW, height: targetH, fit: 'fill', withoutEnlargement: true })
          .jpeg({ quality: JPEG_QUALITY[kind], mozjpeg: true })
          .toBuffer();
      } catch (err) {
        const order = SOURCE_VARIANTS[kind];
        if (src.variant === order[order.length - 1]) throw err;
        this.undecodable.add(`${asset.id}:${src.variant}`);
      }
    }
  }
}
