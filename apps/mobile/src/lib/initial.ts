/** The first whole character of a name, upper-cased, for a round initial. `charAt(0)` splits an emoji in half (S6-15). */
export function initialOf(name: string | null | undefined, fallback = '?'): string {
  const first = Array.from((name ?? '').trim())[0];
  return first ? first.toUpperCase() : fallback;
}
