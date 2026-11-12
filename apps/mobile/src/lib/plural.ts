/** "1 review" / "3 reviews": a count with its noun, singular only for exactly one. */
export function countOf(n: number, singular: string, plural = singular + 's'): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
