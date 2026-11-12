/**
 * Merging a fetched page of rows into what the screen already holds.
 *
 * A screen that fetches once and also listens live (chat messages, the
 * notifications list) can get a live row before the fetch returns. Replacing
 * the list with the fetched page would wipe that row, so the two lists are
 * merged by id instead: nothing is dropped, nothing is shown twice.
 * Pure, tested in Node (mergeById.test.ts).
 */

/**
 * Every row from both lists, once each, ordered by the time `timeOf` gives
 * (ISO text). `oldestFirst` is a chat; `newestFirst` is the notifications
 * list. For a row both lists have, the fetched copy wins. Rows whose time is
 * missing or unreadable keep the order they arrived in.
 */
export function mergeById<T extends { id: string }>(
  prev: readonly T[],
  fetched: readonly T[],
  timeOf: (row: T) => string | null | undefined,
  order: 'oldestFirst' | 'newestFirst' = 'oldestFirst',
): T[] {
  const byId = new Map<string, T>();
  for (const row of prev) byId.set(row.id, row);
  for (const row of fetched) byId.set(row.id, row);
  const sign = order === 'oldestFirst' ? 1 : -1;
  const time = (row: T) => {
    const raw = timeOf(row);
    const n = raw ? Date.parse(raw) : NaN;
    return Number.isNaN(n) ? null : n;
  };
  return [...byId.values()]
    .map((row, i) => ({ row, i, n: time(row) }))
    .sort((a, b) => (a.n !== null && b.n !== null && a.n !== b.n ? sign * (a.n - b.n) : a.i - b.i))
    .map((x) => x.row);
}
