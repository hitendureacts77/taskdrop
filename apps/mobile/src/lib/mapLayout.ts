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
 * The part of a pin that must never sit under another pin's: its price bubble (for a helper, the icon and price),
 * as a box round the pin's point (x and y are offsets from the point). The words under it step back instead
 * (mapLabels.ts). `spread` says whether the pin is one of a spread group or stands alone.
 */
export type PinBox = { x: number; y: number; w: number; h: number };

/** Clear space kept between two bubbles, in pixels, so their shadows never touch. */
export const BUBBLE_PAD = 4;
/** How far a bubble may move to find room; past this it keeps its ring spot (hundreds of pins on one spot). */
const SEARCH_MAX = 600;
/** Rows tried above and below a taken spot: 4 px apart close to it, then 15% further each row (a far move need not be exact). */
const ROW_STEP = 4;
/** Placed bubbles are kept in horizontal bands this tall, so a row only looks at its neighbours. */
const BAND = 32;

let rows: number[] | null = null;
function rowOffsets(): number[] {
  if (rows) return rows;
  rows = [0];
  for (let d = ROW_STEP; d <= SEARCH_MAX; d += Math.max(ROW_STEP, Math.round(d * 0.15))) rows.push(d, -d);
  return rows;
}

/**
 * The bubbles already placed, and the nearest spot to `want` where bubble `b` (plus BUBBLE_PAD all round) touches
 * none of them. Rows are tried outwards from `want` (0, +4, -4, +8 ... px); in each, the nearest free x is found
 * exactly from the blocked stretches, and the search stops once a row is further away than the best spot found.
 */
function bubbleField() {
  const bands = new Map<number, PinBox[]>();
  return {
    add(r: PinBox) {
      for (let k = Math.floor(r.y / BAND); k <= Math.floor((r.y + r.h) / BAND); k++) {
        const list = bands.get(k);
        if (list) list.push(r);
        else bands.set(k, [r]);
      }
    },
    nearestFree(want: { x: number; y: number }, b: PinBox): { x: number; y: number } | null {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const dy of rowOffsets()) {
        if (Math.abs(dy) >= bestD) break;
        const top = want.y + dy + b.y - BUBBLE_PAD;
        const bottom = top + b.h + 2 * BUBBLE_PAD;
        // Centre x values where this row's bubble would touch a placed one (open stretches: the ends are free).
        const blocked: [number, number][] = [];
        for (let band = Math.floor(top / BAND); band <= Math.floor(bottom / BAND); band++)
          for (const o of bands.get(band) ?? []) if (o.y < bottom && top < o.y + o.h) blocked.push([o.x - b.x - b.w - BUBBLE_PAD, o.x + o.w - b.x + BUBBLE_PAD]);
        // Join the stretches that run into each other (left to right); the joined one round want.x has the nearest free x at its ends.
        blocked.sort((p, q) => p[0] - q[0]);
        let x = want.x;
        let lo = -Infinity;
        let hi = -Infinity;
        for (let i = 0; i <= blocked.length; i++) {
          const s = blocked[i];
          if (s && s[0] < hi) {
            hi = Math.max(hi, s[1]);
            continue;
          }
          if (lo < want.x && want.x < hi) {
            x = want.x - lo <= hi - want.x ? lo : hi;
            break;
          }
          if (!s || s[0] >= want.x) break;
          [lo, hi] = s;
        }
        const d = Math.hypot(x - want.x, dy);
        if (Math.abs(x - want.x) <= SEARCH_MAX && d < bestD) {
          best = { x, y: want.y + dy };
          bestD = d;
          if (d === 0) break;
        }
      }
      return best;
    },
  };
}

/**
 * Takes the pins already grouped (groupPins in mapCluster.ts) and spreads every
 * group out once the map is zoomed in to `spreadZoom`. Order is kept: put the
 * first one to show (the best offer, or someone active now) first.
 *
 * Spread out, two neighbouring areas' rings can reach into each other (D33 follow-up: one area's "₹2,500"
 * bubble sat on another's). So the bubbles (`box`) are then placed in turn, every area's first pin before any
 * area's second: a pin whose ring spot is already taken moves to the nearest free spot. No pin is ever
 * dropped, and each area's soft circle grows to hold its own pins.
 */
export function layoutPins(
  groups: PinGroup[],
  opts: { zoom: number; gap: SpreadGap; spreadZoom?: number; box?: (id: string, spread: boolean) => PinBox },
): MapItem[] {
  const spread = opts.zoom >= (opts.spreadZoom ?? SPREAD_ZOOM);
  if (!spread) {
    return groups.map((g): MapItem => (g.ids.length === 1 ? { kind: 'one', id: g.ids[0]!, x: g.x, y: g.y, area: null } : { kind: 'group', ids: g.ids, x: g.x, y: g.y }));
  }

  const box = opts.box ?? (() => ({ x: -opts.gap.x * 0.36, y: -48, w: opts.gap.x * 0.72, h: 36 }));
  // Where each pin would sit on its area's ring (a lone pin on its own point).
  const at = groups.map((g) => {
    const spots = ringSpots(g.ids.length, opts.gap);
    return g.ids.map((_, i) => ({ x: g.x + spots[i]!.dx, y: g.y + spots[i]!.dy }));
  });
  const field = bubbleField();
  const longest = Math.max(0, ...groups.map((g) => g.ids.length));
  for (let k = 0; k < longest; k++) {
    groups.forEach((g, gi) => {
      if (k >= g.ids.length) return;
      const b = box(g.ids[k]!, g.ids.length > 1);
      // Nothing free within reach (hundreds of pins on one spot): keep the ring spot rather than lose the pin.
      const spot = field.nearestFree(at[gi]![k]!, b) ?? at[gi]![k]!;
      at[gi]![k] = spot;
      field.add({ x: spot.x + b.x, y: spot.y + b.y, w: b.w, h: b.h });
    });
  }

  const out: MapItem[] = [];
  groups.forEach((g, gi) => {
    const pts = at[gi]!;
    if (g.ids.length === 1) {
      out.push({ kind: 'one', id: g.ids[0]!, x: pts[0]!.x, y: pts[0]!.y, area: null });
      return;
    }
    const rx = Math.max(...pts.map((p) => Math.abs(p.x - g.x))) + opts.gap.x * 0.6;
    const ry = Math.max(...pts.map((p) => Math.abs(p.y - g.y))) + opts.gap.y * 0.6;
    const area = { x: g.x, y: g.y, rx, ry };
    g.ids.forEach((id, i) => out.push({ kind: 'one', id, x: pts[i]!.x, y: pts[i]!.y, area }));
  });
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
