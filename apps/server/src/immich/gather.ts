import type { BBox, BookAsset, SelectionRules, SelectionSource } from '@bookbinder/shared';
import type { ImmichAsset, ImmichClient, ImmichMetadataSearch } from './client.js';

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

function coord(v: number | null | undefined, limit: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit && v !== 0 ? v : undefined;
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
  if (width && height && exif?.exifImageWidth && swapsDimensions(exif.orientation))
    [width, height] = [height, width];
  const ratio = width && height ? width / height : 1.5;

  const takenAt = exif?.dateTimeOriginal ?? a.fileCreatedAt;
  const rating =
    typeof exif?.rating === 'number' && exif.rating >= 1 && exif.rating <= 5
      ? Math.round(exif.rating)
      : undefined;
  const people = (a.people ?? []).filter((p) => !p.isHidden).map((p) => ({ id: p.id, name: p.name ?? '' }));
  const lat = coord(exif?.latitude, 90);
  const lon = coord(exif?.longitude, 180);
  return {
    id: a.id,
    ...(takenAt ? { takenAt } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ratio,
    ...(clean(exif?.city) ? { city: clean(exif?.city)! } : {}),
    ...(clean(exif?.state) ? { state: clean(exif?.state)! } : {}),
    ...(clean(exif?.country) ? { country: clean(exif?.country)! } : {}),
    ...(lat !== undefined && lon !== undefined ? { lat, lon } : {}),
    ...(clean(exif?.description) ? { description: clean(exif?.description)! } : {}),
    isFavorite: a.isFavorite,
    ...(rating !== undefined ? { rating } : {}),
    people,
    ...(a.duplicateId ? { duplicateId: a.duplicateId } : {}),
    ...(a.originalFileName ? { fileName: a.originalFileName } : {}),
  };
}

/** Whether a point lies in a [west, south, east, north] box; boxes crossing the antimeridian wrap. */
export function inBBox(lat: number, lon: number, box: BBox): boolean {
  const [west, south, east, north] = box;
  if (lat < south || lat > north) return false;
  return west <= east ? lon >= west && lon <= east : lon >= west || lon <= east;
}

const BASE_SEARCH: ImmichMetadataSearch = {
  type: 'IMAGE',
  withExif: true,
  withPeople: true,
  withStacked: true,
  size: 1000,
};

async function fromSource(
  client: ImmichClient,
  source: SelectionSource,
  warnings: string[],
): Promise<ImmichAsset[]> {
  switch (source.kind) {
    case 'album':
      // Immich 3.2 dropped assets[] from GET /albums/:id; album contents come from the metadata search.
      return client.searchMetadataAll({ ...BASE_SEARCH, albumIds: [...source.albumIds] });
    case 'favorites':
      return client.searchMetadataAll({ ...BASE_SEARCH, isFavorite: true });
    case 'trip': {
      // The date range is filtered server-side; places are checked here against EXIF coordinates.
      const inRange = await client.searchMetadataAll({
        ...BASE_SEARCH,
        takenAfter: source.takenAfter,
        takenBefore: source.takenBefore,
      });
      if (source.places.length === 0) return inRange;
      let dropped = 0;
      const kept = inRange.filter((a) => {
        const lat = coord(a.exifInfo?.latitude, 90);
        const lon = coord(a.exifInfo?.longitude, 180);
        if (lat === undefined || lon === undefined) return source.includeUngeotagged;
        const inside = source.places.some((p) => inBBox(lat, lon, p.bbox));
        if (!inside) dropped++;
        return inside;
      });
      if (dropped > 0)
        warnings.push(
          `${dropped} photo${dropped === 1 ? '' : 's'} in the date range ${dropped === 1 ? 'was' : 'were'} taken outside the trip's places and left out.`,
        );
      return kept;
    }
    case 'people': {
      // personIds in Immich means "all of these people"; a person book wants any of them, so query per person.
      const out: ImmichAsset[] = [];
      for (const personId of source.personIds)
        out.push(...(await client.searchMetadataAll({ ...BASE_SEARCH, personIds: [personId] })));
      return out;
    }
    case 'smart': {
      const res = await client.searchSmart({
        query: source.query,
        ...(source.queryAssetId ? { queryAssetId: source.queryAssetId } : {}),
        size: source.limit,
        withExif: true,
        type: 'IMAGE',
      });
      const items = res.assets.items;
      if (items.length >= source.limit)
        warnings.push(
          `Smart search "${source.query}" stopped at its limit of ${source.limit} photos; raise the limit to consider more.`,
        );
      return items;
    }
    case 'pet': {
      // Text search plus one image-similarity search per example photo; each is capped, the union is not.
      const byId = new Map<string, ImmichAsset>();
      const add = (items: readonly ImmichAsset[]): void => {
        for (const a of items) if (!byId.has(a.id)) byId.set(a.id, a);
      };
      const text = await client.searchSmart({ query: source.query, size: source.limit, withExif: true, type: 'IMAGE' });
      add(text.assets.items);
      let failed = 0;
      for (const queryAssetId of source.exampleAssetIds) {
        try {
          const similar = await client.searchSmart({ queryAssetId, size: source.limit, withExif: true, type: 'IMAGE' });
          add(similar.assets.items);
        } catch {
          failed++;
        }
      }
      if (failed > 0) warnings.push(`${failed} example photo${failed === 1 ? '' : 's'} of ${source.name} could not be used for a similarity search (deleted, or not an image).`);
      if (text.assets.items.length >= source.limit)
        warnings.push(`The search for ${source.name} ("${source.query}") stopped at its limit of ${source.limit} photos; raise the limit to consider more.`);
      return [...byId.values()];
    }
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
