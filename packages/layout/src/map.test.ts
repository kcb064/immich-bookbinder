import { describe, expect, it } from 'vitest';
import { graticuleStep, planMap } from './map.js';

const lisbon = { lat: 38.7223, lon: -9.1393 };
const porto = { lat: 41.1579, lon: -8.6291 };
const coimbra = { lat: 40.2033, lon: -8.4103 };

describe('planMap', () => {
  it('returns nothing without coordinates', () => {
    expect(planMap([], 320, 200)).toBeUndefined();
    expect(planMap([{ lat: Number.NaN, lon: 1 }], 320, 200)).toBeUndefined();
    expect(planMap([lisbon], 0, 200)).toBeUndefined();
  });

  it('frames one spot with a sensible box and no route', () => {
    const m = planMap([lisbon], 320, 200)!;
    expect(m.dots).toEqual([{ x: 160, y: 100 }]);
    expect(m.route).toBe('');
    expect(m.bbox[2] - m.bbox[0]).toBeGreaterThan(0.02);
    expect(m.graticule.length).toBeGreaterThan(2);
    expect(m.stepDeg).toBeLessThanOrEqual(0.05);
  });

  it('fits several places with padding, north up and east right, and draws the route in capture order', () => {
    const m = planMap(
      [
        { ...porto, takenAt: '2026-05-14T10:00:00Z' },
        { ...lisbon, takenAt: '2026-05-12T10:00:00Z' },
        { ...coimbra, takenAt: '2026-05-13T10:00:00Z' },
      ],
      320,
      200,
    )!;
    expect(m.dots).toHaveLength(3);
    const [l, c, p] = m.dots;
    // Lisbon is south-west of Porto: lower on the page and to the left.
    expect(l!.y).toBeGreaterThan(p!.y);
    expect(l!.x).toBeLessThan(p!.x);
    expect(m.route).toBe(`M${l!.x} ${l!.y}L${c!.x} ${c!.y}L${p!.x} ${p!.y}`);
    for (const d of m.dots) {
      expect(d.x).toBeGreaterThanOrEqual(320 * 0.12 - 0.01);
      expect(d.x).toBeLessThanOrEqual(320 * 0.88 + 0.01);
      expect(d.y).toBeGreaterThanOrEqual(200 * 0.12 - 0.01);
      expect(d.y).toBeLessThanOrEqual(200 * 0.88 + 0.01);
    }
    // Deterministic.
    expect(planMap([porto, lisbon, coimbra].map((q, i) => ({ ...q, takenAt: ['2026-05-14', '2026-05-12', '2026-05-13'][i]! })), 320, 200)).toEqual(m);
  });

  it('collapses dots that sit on top of each other and thins long routes', () => {
    const jitter = Array.from({ length: 500 }, (_, i) => ({ lat: lisbon.lat + (i % 5) * 0.00001, lon: lisbon.lon + i * 0.0004, takenAt: `2026-05-12T10:${String(i % 60).padStart(2, '0')}:${String(Math.floor(i / 60)).padStart(2, '0')}Z` }));
    const m = planMap(jitter, 320, 200, { maxRouteVertices: 50 })!;
    expect(m.dots.length).toBeLessThan(120);
    expect(m.route.split('L').length).toBeLessThanOrEqual(51);
  });

  it('keeps the graticule inside the box at a step that gives a few lines', () => {
    expect(graticuleStep(0.03)).toBe(0.005);
    expect(graticuleStep(2.6)).toBe(0.5);
    expect(graticuleStep(40)).toBe(10);
    const m = planMap([lisbon, porto], 320, 200)!;
    for (const g of m.graticule) {
      expect(g.x1).toBeGreaterThanOrEqual(0);
      expect(g.x2).toBeLessThanOrEqual(320);
      expect(g.y1).toBeGreaterThanOrEqual(0);
      expect(g.y2).toBeLessThanOrEqual(200);
    }
  });
});
