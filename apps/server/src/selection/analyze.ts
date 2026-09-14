import { analyzeImage, type ImageAnalysis } from '@bookbinder/scoring';
import sharp from 'sharp';

/** Long edge the preview is reduced to before measuring; sharpness thresholds are calibrated for it. */
export const ANALYZE_EDGE = 512;

/**
 * Decodes an image file with sharp (EXIF orientation applied, alpha dropped, sRGB), shrinks it to
 * ANALYZE_EDGE and hands the raw RGB buffer to the pure scoring package.
 */
export async function analyzeFile(path: string): Promise<ImageAnalysis> {
  const { data, info } = await sharp(path)
    .rotate()
    .resize(ANALYZE_EDGE, ANALYZE_EDGE, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels as 1 | 2 | 3 | 4;
  return analyzeImage({ data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height, channels });
}
