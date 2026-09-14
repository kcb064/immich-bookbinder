import { hamming } from './phash.js';

export interface ClusterInput {
  id: string;
  takenAt?: string | undefined;
  /** 16-hex pHash; photos without one only cluster through `duplicateId`. */
  phash?: string | undefined;
  /** Immich duplicate group. */
  duplicateId?: string | undefined;
}

export interface ClusterOptions {
  /** Hashes this close are the same picture whatever the timestamps say (default 5). */
  tightHamming?: number;
  /** Hashes this close taken within `maxGapSeconds` of each other are a burst (default 12). */
  maxHamming?: number;
  maxGapSeconds?: number;
  /** How many earlier photos (in time order) each photo is compared with (default 12). */
  lookback?: number;
}

const DEFAULTS: Required<ClusterOptions> = { tightHamming: 5, maxHamming: 12, maxGapSeconds: 90, lookback: 12 };

class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r]!;
    while (this.parent[i] !== r) {
      const next = this.parent[i]!;
      this.parent[i] = r;
      i = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function seconds(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t / 1000 : undefined;
}

/**
 * Groups near-duplicates: Immich duplicate groups first, then perceptual-hash matches among
 * photos close in time. Returns cluster id -> member ids for every group of two or more; the
 * cluster id is the lexicographically smallest member id, so it is stable across runs.
 */
export function clusterNearDuplicates(items: readonly ClusterInput[], options: ClusterOptions = {}): Map<string, string[]> {
  const o = { ...DEFAULTS, ...options };
  const uf = new UnionFind(items.length);

  const byDuplicate = new Map<string, number>();
  items.forEach((it, i) => {
    if (!it.duplicateId) return;
    const first = byDuplicate.get(it.duplicateId);
    if (first === undefined) byDuplicate.set(it.duplicateId, i);
    else uf.union(first, i);
  });

  // Time order; undated photos go last and only match on tight hashes.
  const order = items
    .map((it, i) => ({ i, t: seconds(it.takenAt) }))
    .sort((a, b) => (a.t ?? Number.POSITIVE_INFINITY) - (b.t ?? Number.POSITIVE_INFINITY) || items[a.i]!.id.localeCompare(items[b.i]!.id));

  for (let k = 0; k < order.length; k++) {
    const cur = order[k]!;
    const hash = items[cur.i]!.phash;
    if (!hash) continue;
    for (let j = k - 1; j >= 0 && j >= k - o.lookback; j--) {
      const prev = order[j]!;
      const other = items[prev.i]!.phash;
      if (!other) continue;
      const gap = cur.t !== undefined && prev.t !== undefined ? Math.abs(cur.t - prev.t) : undefined;
      const d = hamming(hash, other);
      if (d <= o.tightHamming || (gap !== undefined && gap <= o.maxGapSeconds && d <= o.maxHamming)) uf.union(prev.i, cur.i);
    }
  }

  const groups = new Map<number, string[]>();
  items.forEach((it, i) => {
    const root = uf.find(i);
    const g = groups.get(root);
    if (g) g.push(it.id);
    else groups.set(root, [it.id]);
  });
  const out = new Map<string, string[]>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort();
    out.set(members[0]!, members);
  }
  return out;
}
