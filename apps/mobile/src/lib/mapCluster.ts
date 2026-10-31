/** A job pin placed on the screen, in pixels. */
export type ScreenPin = { id: string; x: number; y: number };

export type PinGroup = { x: number; y: number; ids: string[] };

/**
 * Joins pins that sit closer than `radius` pixels into one group, so a busy
 * street shows "3" instead of three price tags on top of each other. Greedy and
 * order-stable: each pin joins the first group within reach, and the group
 * stands at the average of its members.
 */
export function groupPins(pins: ScreenPin[], radius: number): PinGroup[] {
  const groups: { sx: number; sy: number; ids: string[] }[] = [];
  for (const p of pins) {
    const g = groups.find((q) => Math.hypot(q.sx / q.ids.length - p.x, q.sy / q.ids.length - p.y) < radius);
    if (g) {
      g.sx += p.x;
      g.sy += p.y;
      g.ids.push(p.id);
    } else {
      groups.push({ sx: p.x, sy: p.y, ids: [p.id] });
    }
  }
  return groups.map((g) => ({ x: g.sx / g.ids.length, y: g.sy / g.ids.length, ids: g.ids }));
}

/** Ground metres per screen pixel at this latitude and zoom (256 px tiles). */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
