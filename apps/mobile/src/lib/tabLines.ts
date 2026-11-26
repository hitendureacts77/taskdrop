/** The one live line under each tab's name (components/TabTitle.tsx). Plain words, real counts only. */

const num = (n: number) => String(n);

/** My tasks: what needs the poster, what is running, what is done. "Loading…" until the tasks are read. */
export function myTasksLine(c: { loaded: boolean; need: number; active: number; done: number }): string {
  if (!c.loaded) return 'Loading…';
  const parts = [...(c.need > 0 ? [`${num(c.need)} need you`] : []), `${num(c.active)} active`, `${num(c.done)} done`];
  return parts.join(' · ');
}

/** My work: earned, done, running, and the success rate when there is one ('–' or '' leaves it out). */
export function myWorkLine(c: { earned: string | null; done: number | null; active: number | null; success: string }): string {
  if (c.earned === null || c.done === null || c.active === null) return 'Loading…';
  const parts = [`${c.earned} earned`, `${num(c.done)} done`, `${num(c.active)} active`];
  if (c.success && c.success !== '–') parts.push(c.success);
  return parts.join(' · ');
}

/** Wallet: the money held safely, with the amount when there is some. */
export function walletLine(c: { loaded: boolean; held: string; heldMinor: number; available?: string }): string {
  if (!c.loaded) return 'Loading…';
  const held = c.heldMinor > 0 ? `${c.held} held safely` : 'Nothing held right now';
  return c.available ? `${c.available} available · ${held}` : held;
}

/** Explore / Find work on the map: the map's own count words, then the place. */
export function mapLine(countWords: string, place: string, tail = ''): string {
  return place ? `${countWords} · ${place}${tail}` : `${countWords}${tail}`;
}
