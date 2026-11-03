import type { PinGroup } from './mapCluster';

/**
 * Where each thing on the map is drawn (the redesigned map, plan D12). Zoomed
 * out, things that sit close together become one group: a stack of faces for
 * helpers, one price pin with the area's biggest offer for tasks. From
 * SPREAD_ZOOM in, the things in one group spread out round the group's centre,
 * each with its own pin, so everyone in an area can be seen. Published
 * coordinates are rounded to about a kilometre, so many share the same point:
 * the spread is a tidy ring round the area, never where anyone is.
 *
 * Pure numbers only, so it runs in Node tests.
 */

/** From this zoom in, a group spreads out instead of stacking. */
export const SPREAD_ZOOM = 14;

/** How far apart spread pins sit, in pixels: across, and up and down (labels make pins tall). */
export type SpreadGap = { x: number; y: number };

export type MapItem =
  | { kind: 'group'; ids: string[]; x: number; y: number }
  | { kind: 'one'; id: string; x: number; y: number; area: { x: number; y: number; rx: number; ry: number } | null };

/**
 * Offsets round a centre for `n` things. Up to six sit on one ring (two side
 * by side, three or more starting at the top); more than six put one in the
 * middle and fill rings of 6, 12, 18... outwards. Neighbours on a ring are at
 * least one gap apart.
 */
export function ringSpots(n: number, gap: SpreadGap): { dx: number; dy: number }[] {
  if (n <= 0) return [];
  if (n === 1) return [{ dx: 0, dy: 0 }];
  const squash = gap.y / gap.x;
  const ring = (count: number, r: number, start: number) =>
    Array.from({ length: count }, (_, i) => {
      const a = start + (2 * Math.PI * i) / count;
      return { dx: r * Math.cos(a), dy: r * Math.sin(a) * squash };
    });
  if (n <= 6) {
    const r = Math.max(gap.x * 0.5, gap.x / (2 * Math.sin(Math.PI / n)));
    return ring(n, r, n === 2 ? Math.PI : -Math.PI / 2);
  }
  const out = [{ dx: 0, dy: 0 }];
  for (let k = 1; out.length < n; k++) {
    const count = Math.min(6 * k, n - out.length);
    out.push(...ring(count, gap.x * k, -Math.PI / 2));
  }
  return out;
}

/**
 * Takes the pins already grouped (groupPins in mapCluster.ts) and spreads every
 * group out once the map is zoomed in to `spreadZoom`. Order is kept: put the
 * first one to show (the best offer, or someone active now) first.
 */
export function layoutPins(groups: PinGroup[], opts: { zoom: number; gap: SpreadGap; spreadZoom?: number }): MapItem[] {
  const spread = opts.zoom >= (opts.spreadZoom ?? SPREAD_ZOOM);
  const out: MapItem[] = [];
  for (const g of groups) {
    if (g.ids.length === 1) {
      out.push({ kind: 'one', id: g.ids[0]!, x: g.x, y: g.y, area: null });
    } else if (!spread) {
      out.push({ kind: 'group', ids: g.ids, x: g.x, y: g.y });
    } else {
      const spots = ringSpots(g.ids.length, opts.gap);
      const rx = Math.max(...spots.map((s) => Math.abs(s.dx))) + opts.gap.x * 0.6;
      const ry = Math.max(...spots.map((s) => Math.abs(s.dy))) + opts.gap.y * 0.6;
      const area = { x: g.x, y: g.y, rx, ry };
      g.ids.forEach((id, i) => out.push({ kind: 'one', id, x: g.x + spots[i]!.dx, y: g.y + spots[i]!.dy, area }));
    }
  }
  return out;
}

/** The highest of a group's offers; the map shows one number per area. */
export function topAmount(ids: string[], amountOf: (id: string) => number | undefined): number | null {
  let best: number | null = null;
  for (const id of ids) {
    const a = amountOf(id);
    if (a !== undefined && (best === null || a > best)) best = a;
  }
  return best;
}
