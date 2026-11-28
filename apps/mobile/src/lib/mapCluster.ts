/** A job pin placed on the screen, in pixels. */
export type ScreenPin = { id: string; x: number; y: number };

export type PinGroup = { x: number; y: number; ids: string[] };

/**
 * Joins pins that sit closer than `radius` pixels into one group, so a busy
 * street shows "3" instead of three price tags on top of each other. Greedy and
 * order-stable: each pin joins the nearest group within reach, and the group
 * stands at the average of its members.
 *
 * A group's average moves as pins join, so two groups could end up closer than
 * `radius` and their pins drawn on top of each other (Ideas board: "Map pins
 * overlap in Kondapur"). Such groups are then merged until every two groups are
 * at least `radius` apart. The first group keeps its place in the order.
 */
export function groupPins(pins: ScreenPin[], radius: number): PinGroup[] {
  const groups: { sx: number; sy: number; ids: string[] }[] = [];
  const dist = (q: { sx: number; sy: number; ids: string[] }, x: number, y: number) => Math.hypot(q.sx / q.ids.length - x, q.sy / q.ids.length - y);
  for (const p of pins) {
    let g: (typeof groups)[number] | undefined;
    let best = radius;
    for (const q of groups) {
      const d = dist(q, p.x, p.y);
      if (d < best) {
        best = d;
        g = q;
      }
    }
    if (g) {
      g.sx += p.x;
      g.sy += p.y;
      g.ids.push(p.id);
    } else {
      groups.push({ sx: p.x, sy: p.y, ids: [p.id] });
    }
  }
  // Merge any two groups whose centres drifted within reach of each other.
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i]!;
        const b = groups[j]!;
        if (dist(a, b.sx / b.ids.length, b.sy / b.ids.length) < radius) {
          a.sx += b.sx;
          a.sy += b.sy;
          a.ids.push(...b.ids);
          groups.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  return groups.map((g) => ({ x: g.sx / g.ids.length, y: g.sy / g.ids.length, ids: g.ids }));
}

/** Ground metres per screen pixel at this latitude and zoom (256 px tiles). */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
