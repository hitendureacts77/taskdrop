/**
 * Keeps the words on the map readable (P1-14). A price pin has its price bubble above the area's point and
 * the area's name ("Narsingi · 10 jobs") in a tag under it. Nearby pins, the "You" marker and the map's own
 * buttons used to sit on top of those tags. Here every price bubble keeps its place (it is what you tap),
 * a pin that would sit under the zoom buttons is nudged clear of them, and an area's name is hidden when
 * it would overlap something more important. Better offers win: their names are placed first.
 *
 * Pure numbers only, so it runs in Node tests. Sizes follow MapMarkers' PRICE_PIN (anchor 46: the bubble
 * is the 34 px above the pointer; the tag starts 7 px below the point).
 */

export type Rect = { x: number; y: number; w: number; h: number };

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * How wide a price reads in the pins' 15 px bold tabular figures: "₹" and commas are not as wide as a digit
 * (measured on the web map, 26 Nov: "₹4,250" is 49.5 px).
 */
export function priceWidth(price: string): number {
  let w = 0;
  for (const ch of price) w += ch === '₹' ? 10.5 : ch === ',' || ch === '.' ? 4.5 : ch === ' ' ? 4 : 8.5;
  return w;
}

/** The price bubble of a pin whose point is at (x, y). `best` adds the trending icon the best offer carries. */
export function bubbleRect(x: number, y: number, price: string, best = false): Rect {
  const w = Math.min(168, 28 + 8.5 * price.length + (best ? 18 : 0));
  return { x: x - w / 2, y: y - 46, w, h: 34 };
}

/** The name tag under a pin whose point is at (x, y). */
export function tagRect(x: number, y: number, text: string): Rect {
  const w = Math.min(168, 18 + 6.3 * text.length);
  return { x: x - w / 2, y: y + 7, w, h: 20 };
}

export type LabelItem = {
  id: string;
  x: number;
  y: number;
  price: string;
  /** The tag's words; null when the pin has none. */
  tag: string | null;
  /** Higher is placed first (the biggest offer, the picked pin). */
  rank: number;
};

export type LabelPlan = { dx: number; showTag: boolean };

/**
 * Where each pin's words go. `avoid` are places nothing may cover (the "You" marker); `controls` is the
 * column of map buttons: a bubble under it moves left until it is clear.
 */
export function planLabels(items: readonly LabelItem[], opts: { avoid?: readonly Rect[]; controls?: Rect | null } = {}): Map<string, LabelPlan> {
  const out = new Map<string, LabelPlan>();
  const ctl = opts.controls ?? null;
  const placed = items.map((it) => {
    let dx = 0;
    if (ctl) {
      const b = bubbleRect(it.x, it.y, it.price);
      if (overlaps(b, ctl)) dx = ctl.x - 4 - (b.x + b.w);
    }
    return { ...it, x: it.x + dx, dx };
  });
  // Bubbles always show; the tags go round them.
  const taken: Rect[] = [...(opts.avoid ?? []), ...(ctl ? [ctl] : [])];
  const bubbles = placed.map((it) => ({ id: it.id, r: bubbleRect(it.x, it.y, it.price) }));
  const order = placed.map((it, i) => ({ it, i })).sort((a, b) => b.it.rank - a.it.rank || a.i - b.i);
  for (const { it } of order) {
    let showTag = false;
    if (it.tag !== null) {
      const r = tagRect(it.x, it.y, it.tag);
      const blocked = taken.some((o) => overlaps(r, o)) || bubbles.some((b) => b.id !== it.id && overlaps(r, b.r));
      if (!blocked) {
        taken.push(r);
        showTag = true;
      }
    }
    out.set(it.id, { dx: it.dx, showTag });
  }
  return out;
}

/**
 * The "you" marker: its dot, and the pill under it. A live position says "You" (short); a typed or saved
 * area says "Your area" on the tile map (`wide`), so that box carries the longer pill.
 */
export function youRect(x: number, y: number, live: boolean, wide = false): Rect {
  if (wide) return { x: x - 40, y: y - 22, w: 80, h: 56 };
  return live ? { x: x - 22, y: y - 22, w: 44, h: 56 } : { x: x - 22, y: y - 22, w: 44, h: 44 };
}

/**
 * Spread pins (D33, FEATURES 16): a spread task pin carries a face, name, task and price (TASK_PIN), a spread
 * helper an icon with a service + price tag. When that full tag would overlap a better-ranked pin's box, it
 * steps back to the compact form (the price bubble alone; for a helper the icon and its price). The pin is
 * still there and taps the same way: nothing disappears.
 */
export type SpreadItem = {
  id: string;
  /** Box of the full pin and of the compact one (the same object when the pin has no tag). */
  full: Rect;
  compact: Rect;
  /** Higher is placed first (best offer, active helpers first). */
  rank: number;
  /** The picked pin always keeps its full tag. */
  keep?: boolean;
};

/** A spread task pin at point (x, y): bubble (with the poster's face) over a name + task tag (MapMarkers TASK_PIN, anchor 48). */
export function taskPinRects(x: number, y: number, price: string, who: string | null | undefined, title: string | null | undefined, face: boolean): { full: Rect; compact: Rect } {
  // TaskPin's bubble: 2 px border each side, 12 px padding right, and on the left either the 26 px face (4 px in, 7 px gap) or 12 px.
  const bw = (face ? 53 : 28) + priceWidth(price);
  const text = Math.max(who?.length ?? 0, title?.length ?? 0);
  const compact = { x: x - bw / 2, y: y - 48, w: bw, h: 36 };
  if (!text) return { full: compact, compact };
  const w = Math.max(bw, Math.min(176, 16 + 6.3 * text));
  const h = (who ? 15 : 0) + (title ? 14 : 0) + 6;
  return { full: { x: x - w / 2, y: y - 48, w, h: 55 + h }, compact };
}

/** A spread helper at point (x, y): the 48 px icon disc over a service + price tag (FACE_PIN, anchor 30). */
export function helperPinRects(x: number, y: number, what: string, price: string | null | undefined): { full: Rect; compact: Rect } {
  const disc: Rect = { x: x - 24, y: y - 24, w: 48, h: 48 };
  const withTag = (chars: number): Rect => {
    const w = Math.max(48, Math.min(152, 24 + 6.2 * chars));
    return { x: x - w / 2, y: y - 24, w, h: 73 };
  };
  const full = withTag(what.length + (price ? price.length + 1 : 0));
  return { full, compact: price ? withTag(price.length) : disc };
}

/**
 * A stack of helpers at point (x, y): up to three 36 px faces and "+N" in a white pill, the area's name under it
 * (MapMarkers FACE_STACK, anchor 25). Compact is the pill alone: the name steps back, the faces and count stay.
 */
export function stackRects(x: number, y: number, faces: number, extra: number, label: string): { full: Rect; compact: Rect } {
  const more = extra > 0 ? Math.max(36, 18 + 7.5 * (String(extra).length + 1)) - 9 : 0;
  const pill = 6 + 36 + Math.max(0, faces - 1) * 25 + more;
  const compact = { x: x - pill / 2, y: y - 21, w: pill, h: 42 };
  const w = Math.max(pill, Math.min(176, 16 + 6.3 * label.length));
  return { full: { x: x - w / 2, y: y - 21, w, h: 66 }, compact };
}

/** The ids that step back to compact. Better-ranked pins are placed first; every compact box counts as taken. */
export function planSpread(items: readonly SpreadItem[], opts: { avoid?: readonly Rect[] } = {}): Set<string> {
  const compactIds = new Set<string>();
  const taken: Rect[] = [...(opts.avoid ?? [])];
  const order = items.map((it, i) => ({ it, i })).sort((a, b) => Number(!!b.it.keep) - Number(!!a.it.keep) || b.it.rank - a.it.rank || a.i - b.i);
  for (const { it } of order) {
    const hasTag = it.full !== it.compact;
    const blocked = hasTag && !it.keep && (taken.some((o) => overlaps(it.full, o)) || items.some((o) => o.id !== it.id && overlaps(it.full, o.compact)));
    if (blocked) {
      compactIds.add(it.id);
      taken.push(it.compact);
    } else {
      taken.push(it.full);
    }
  }
  return compactIds;
}
