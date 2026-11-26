/**
 * The map's look on every engine: OpenFreeMap's free vector styles (plan D21).
 * Positron is light and quiet, Dark is its night version. The web map
 * (GlMap.web.tsx) and the phone map (JobsMap.native.tsx, plan 1.20 / D33)
 * use the same two, so both maps look the same. No key, no account.
 */
export function glStyleUrl(isDark: boolean): string {
  return isDark ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/positron';
}
