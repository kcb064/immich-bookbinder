import type { BookAsset, SelectionRules, SelectionSource } from '@bookbinder/shared';
import type { ImmichAsset, ImmichClient } from './client.js';

export interface GatherResult {
  /** Chronological, de-duplicated, images only. */
  assets: BookAsset[];
  warnings: string[];
}

/** EXIF orientations 5–8 rotate the image by 90°, swapping the displayed width and height. */
function swapsDimensions(orientation: string | null | undefined): boolean {
  const n = Number(orientation);
  return n >= 5 && n <= 8;
}

function clean(s: string | null | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

/** Maps an Immich asset to the cached subset a book needs; undefined when the asset should be skipped. */
export function toBookAsset(a: ImmichAsset): BookAsset | undefined {
  if (a.type !== 'IMAGE') return undefined;
  if (a.isTrashed) return undefined;
  if (a.visibility && a.visibility !== 'timeline') return undefined;
  // Bursts and edits stacked in Immich: only the primary member goes in the book.
  if (a.stack && a.stack.primaryAssetId !== a.id) return undefined;

  const exif = a.exifInfo;
  let width = exif?.exifImageWidth ?? a.width ?? undefined;
  let height = exif?.exifImageHeight ?? a.height ?? undefined;
  if (width && height && exif?.exifImageWidth && swapsDimensions(exif.orientation)) [width, height] = [height, width];
  const ratio = width && height ? width / height : 1.5;

  const takenAt = exif?.dateTimeOriginal ?? a.fileCreatedAt;
  return {
    id: a.id,
    ...(takenAt ? { takenAt } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ratio,
    ...(clean(exif?.city) ? { city: clean(exif?.city)! } : {}),
    ...(clean(exif?.country) ? { country: clean(exif?.country)! } : {}),
    ...(clean(exif?.description) ? { description: clean(exif?.description)! } : {}),
    isFavorite: a.isFavorite,
    ...(a.originalFileName ? { fileName: a.originalFileName } : {}),
  };
}

async function fromSource(client: ImmichClient, source: SelectionSource, warnings: string[]): Promise<ImmichAsset[]> {
  switch (source.kind) {
    case 'album':
      // Immich 3.2 dropped assets[] from GET /albums/:id; album contents come from the metadata search.
      return client.searchMetadataAll({ albumIds: [...source.albumIds], type: 'IMAGE', withExif: true, withStacked: true, size: 1000 });
    case 'favorites':
      return client.searchMetadataAll({ isFavorite: true, type: 'IMAGE', withExif: true, withStacked: true, size: 1000 });
    case 'trip':
    case 'people':
    case 'smart':
      warnings.push(`Source "${source.kind}" is not supported yet (planned for M3); it was skipped.`);
      return [];
  }
}

/** Collects the photos a book's rules describe. Union of sources, chronological order. */
export async function gatherAssets(client: ImmichClient, rules: SelectionRules): Promise<GatherResult> {
  const warnings: string[] = [];
  const byId = new Map<string, BookAsset>();
  for (const source of rules.sources) {
    for (const raw of await fromSource(client, source, warnings)) {
      const asset = toBookAsset(raw);
      if (asset && !byId.has(asset.id)) byId.set(asset.id, asset);
    }
  }
  const assets = [...byId.values()].sort((a, b) => {
    const ta = a.takenAt ?? '';
    const tb = b.takenAt ?? '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return (a.fileName ?? a.id).localeCompare(b.fileName ?? b.id);
  });
  if (assets.length === 0) warnings.push('No photos were found for these sources.');
  return { assets, warnings };
}
