import type { BookAsset, Crop, RenderKind } from '@bookbinder/shared';
import { coverCrop } from '@bookbinder/layout';
import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { ImmichApiError, type ImmichClient, type ImmichMediaSize } from '../immich/client.js';

/** Pixels per inch each render kind targets; sources are never upscaled past their own resolution. */
export const RENDER_PPI: Record<RenderKind, number> = { proof: 110, print: 300 };
export const JPEG_QUALITY: Record<RenderKind, number> = { proof: 80, print: 92 };

export interface SourceImage {
  path: string;
  width: number;
  height: number;
  /** Which Immich variant the file came from. */
  variant: 'original' | 'fullsize' | 'preview';
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
 * Originals sharp cannot decode (HEIC on most builds) fall back to Immich's `fullsize` JPEG.
 */
export class ImageStore {
  private readonly limit = pLimit(4);
  private readonly inflight = new Map<string, Promise<SourceImage>>();

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
      if (!m.width || !m.height) return undefined;
      const swap = (m.orientation ?? 1) >= 5;
      return swap ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
    } catch {
      return undefined;
    }
  }

  /** The best decodable source for a render kind: print wants originals, proof is happy with previews. */
  source(asset: BookAsset, kind: RenderKind): Promise<SourceImage> {
    const key = `${kind}:${asset.id}`;
    let p = this.inflight.get(key);
    if (!p) {
      p = this.limit(() => this.resolveSource(asset, kind)).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  private async resolveSource(asset: BookAsset, kind: RenderKind): Promise<SourceImage> {
    const order: SourceImage['variant'][] = kind === 'print' ? ['original', 'fullsize', 'preview'] : ['preview'];
    let lastError: unknown;
    for (const variant of order) {
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
   */
  async slotImage(asset: BookAsset, kind: RenderKind, wPx: number, hPx: number, crop?: Crop): Promise<Buffer> {
    const src = await this.source(asset, kind);
    const region = coverCrop(src.width, src.height, wPx, hPx, crop);
    const targetW = Math.min(wPx, region.w);
    const targetH = Math.min(hPx, region.h);
    return sharp(await readFile(src.path))
      .rotate()
      .extract({ left: region.x, top: region.y, width: region.w, height: region.h })
      .resize({ width: targetW, height: targetH, fit: 'fill', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY[kind], mozjpeg: true })
      .toBuffer();
  }
}
