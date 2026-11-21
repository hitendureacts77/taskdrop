/**
 * A short line under a box saying what is missing while its button is off (W3-16). Disabled buttons used
 * to give no reason. Returns null once the box has enough, so the line disappears by itself. Pure, tested
 * in Node (fieldHint.test.ts).
 */
export function lengthHint(text: string, min: number, what: string): string | null {
  const have = text.trim().length;
  if (have >= min) return null;
  if (have === 0) return `Write ${what} to continue (at least ${min} characters).`;
  const more = min - have;
  return `${more} more character${more === 1 ? '' : 's'} needed to continue.`;
}
