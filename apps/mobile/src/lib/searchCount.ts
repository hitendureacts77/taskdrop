/** How many results the live search count asks for; a count that reaches it means "at least this many". */
export const SEARCH_COUNT_LIMIT = 60;

/**
 * The button under the search filters. `count` is null while searching; `failed`
 * means the count could not be read, which says nothing about how many tasks
 * match, so the label stays neutral instead of claiming zero.
 */
export function searchCtaLabel(count: number | null, failed: boolean, limit = SEARCH_COUNT_LIMIT): string {
  if (failed) return 'Show tasks';
  if (count === null) return 'Searching…';
  if (count === 1) return 'Show 1 task';
  if (count >= limit) return `Show ${limit}+ tasks`;
  return `Show ${count} tasks`;
}
