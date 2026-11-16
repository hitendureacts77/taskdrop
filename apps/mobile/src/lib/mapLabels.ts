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

/** The price bubble of a pin whose point is at (x, y). */
export function bubbleRect(x: number, y: number, price: string): Rect {
  const w = Math.min(168, 28 + 8.5 * price.length);
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

/** The "you" marker: its dot, and the "You" pill under it when it is a live position. */
export function youRect(x: number, y: number, live: boolean): Rect {
  return live ? { x: x - 22, y: y - 22, w: 44, h: 56 } : { x: x - 22, y: y - 22, w: 44, h: 44 };
}
