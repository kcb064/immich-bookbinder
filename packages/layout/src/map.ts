/**
 * Offline chapter maps (M7): the photos' coordinates become dots and a chronological route over a
 * plain graticule, projected into a box. No tiles, no network, no fonts: the same numbers give the
 * same SVG in the editor, the viewer PNGs and the print PDF.
 */

export interface MapPoint {
  lat: number;
  lon: number;
  /** ISO capture time; orders the route. Undated points end the route. */
  takenAt?: string | undefined;
}

export interface MapLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MapDrawing {
  width: number;
  height: number;
  /** Dots to draw, de-duplicated at `dotRadius` resolution, in route order. */
  dots: Array<{ x: number; y: number }>;
  /** Route through the points in capture order, as an SVG path `d` (empty for a single spot). */
  route: string;
  /** Meridians and parallels inside the box. */
  graticule: MapLine[];
  /** Degrees between graticule lines. */
  stepDeg: number;
  /** Geographic box the drawing shows: [west, south, east, north]. */
  bbox: [number, number, number, number];
}

export interface MapOptions {
  /** Fraction of the box kept clear around the points (default 0.12). */
  padding?: number;
  /** Dots closer than this (in box units) collapse into one (default 2.5). */
  dotRadius?: number;
  /** Route vertices are thinned to at most this many (default 240). */
  maxRouteVertices?: number;
}

const STEPS_DEG = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 45];

const hasCoords = (p: MapPoint): boolean => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** Chronological copy of the points (undated last, stable otherwise). */
function inCaptureOrder(points: readonly MapPoint[]): MapPoint[] {
  return points
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const ta = a.p.takenAt ?? '￿';
      const tb = b.p.takenAt ?? '￿';
      return ta < tb ? -1 : ta > tb ? 1 : a.i - b.i;
    })
    .map((x) => x.p);
}

/** Graticule step that puts roughly three to six lines across the wider span. */
export function graticuleStep(spanDeg: number): number {
  for (const s of STEPS_DEG) if (spanDeg / s <= 6) return s;
  return STEPS_DEG[STEPS_DEG.length - 1]!;
}

/**
 * Lays the points out in a `width` × `height` box. Equirectangular projection centred on the
 * points (longitude scaled by cos of the mid-latitude, so shapes are not squashed), fitted with
 * padding and a floor on the span so one spot still gets a sensible frame. Undefined when no
 * point has coordinates.
 */
export function planMap(points: readonly MapPoint[], width: number, height: number, opts: MapOptions = {}): MapDrawing | undefined {
  const valid = inCaptureOrder(points.filter(hasCoords));
  if (valid.length === 0 || width <= 0 || height <= 0) return undefined;
  const padding = opts.padding ?? 0.12;
  const dotRadius = opts.dotRadius ?? 2.5;
  const maxVertices = opts.maxRouteVertices ?? 240;

  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const p of valid) {
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  // Points on both sides of the antimeridian (Fiji, a Pacific crossing) span the globe when read
  // as raw longitudes; unwrap the western ones by 360 degrees so the box goes the short way round.
  const wrap = east - west > 180;
  const lonOf = (p: MapPoint): number => (wrap && p.lon < 0 ? p.lon + 360 : p.lon);
  if (wrap) {
    west = Number.POSITIVE_INFINITY;
    east = Number.NEGATIVE_INFINITY;
    for (const p of valid) {
      west = Math.min(west, lonOf(p));
      east = Math.max(east, lonOf(p));
    }
  }
  const midLat = (south + north) / 2;
  const kx = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  // Floor the span so a single spot or a tight cluster still reads as a place (about 2 km).
  const minSpan = 0.02;
  let lonSpan = Math.max(minSpan / kx, east - west);
  let latSpan = Math.max(minSpan, north - south);
  const innerW = width * (1 - 2 * padding);
  const innerH = height * (1 - 2 * padding);
  // Scale in box units per degree, the same for both axes (after the cos correction).
  const scale = Math.min(innerW / (lonSpan * kx), innerH / latSpan);
  // Widen the shorter side so the box is filled and the bbox is what the graticule spans.
  lonSpan = width / (scale * kx);
  latSpan = height / scale;
  const cx = (west + east) / 2;
  const cy = midLat;
  const bbox: [number, number, number, number] = [cx - lonSpan / 2, cy - latSpan / 2, cx + lonSpan / 2, cy + latSpan / 2];
  const project = (p: MapPoint): { x: number; y: number } => ({
    x: round2(width / 2 + (lonOf(p) - cx) * kx * scale),
    y: round2(height / 2 - (p.lat - cy) * scale),
  });

  const projected = valid.map(project);
  const dots: Array<{ x: number; y: number }> = [];
  for (const q of projected) {
    if (!dots.some((d) => (d.x - q.x) ** 2 + (d.y - q.y) ** 2 <= dotRadius ** 2)) dots.push(q);
  }

  // Route: consecutive points that moved at least a dot radius, thinned to a vertex budget.
  const vertices: Array<{ x: number; y: number }> = [];
  for (const q of projected) {
    const last = vertices[vertices.length - 1];
    if (!last || (last.x - q.x) ** 2 + (last.y - q.y) ** 2 > dotRadius ** 2) vertices.push(q);
  }
  const thin = vertices.length > maxVertices ? vertices.filter((_, i) => i % Math.ceil(vertices.length / maxVertices) === 0 || i === vertices.length - 1) : vertices;
  const route = thin.length > 1 ? thin.map((v, i) => `${i === 0 ? 'M' : 'L'}${v.x} ${v.y}`).join('') : '';

  const stepDeg = graticuleStep(Math.max(lonSpan, latSpan));
  const graticule: MapLine[] = [];
  for (let lon = Math.ceil(bbox[0] / stepDeg) * stepDeg; lon <= bbox[2] + 1e-9; lon += stepDeg) {
    const x = project({ lat: cy, lon }).x;
    graticule.push({ x1: x, y1: 0, x2: x, y2: height });
  }
  for (let lat = Math.ceil(bbox[1] / stepDeg) * stepDeg; lat <= bbox[3] + 1e-9; lat += stepDeg) {
    const y = project({ lat, lon: cx }).y;
    graticule.push({ x1: 0, y1: y, x2: width, y2: y });
  }

  return { width, height, dots, route, graticule, stepDeg, bbox: bbox.map(round4) as [number, number, number, number] };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
