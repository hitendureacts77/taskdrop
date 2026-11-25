import { pickPromotedTop, type PromotedCandidate } from '@taskdrop/rules';

/** The part of a live promotion row the screens need (see `PromotedLive` in data/api.ts). */
export type PromoRow = {
  task_id: string;
  poster_id: string;
  top_today: number;
  my_top_today: number;
  starts_at: string | null;
};

export type PromotedPick<T> = {
  /** The promoted items that win a top spot, in order (at most `slots`). */
  top: T[];
  /** Keys of every promoted item in the list (top or not): they all show the PROMOTED pill. */
  badged: Set<string>;
  /** Item key -> the promoted post's task id (for services this is the service task, not the helper). */
  taskIds: Map<string, string>;
};

/**
 * Splits a screen's items into the promoted ones that go on top and the ones that only carry the badge.
 * `items` is whatever the screen already shows; `matches` is the screen's own filter (distance, remote, price,
 * query), so a promoted post that the viewer filtered out never takes a top spot. `by` says which id of the live
 * row the item's key is: 'task_id' for tasks and services, 'poster_id' for helper lists.
 */
export function pickPromotedItems<T>(args: {
  items: readonly T[];
  live: readonly PromoRow[];
  keyOf: (item: T) => string;
  by?: 'task_id' | 'poster_id';
  matches?: (item: T) => boolean;
  kmOf?: (item: T) => number | null;
  slots?: number;
  perViewer?: number;
}): PromotedPick<T> {
  const { items, live, keyOf, matches, kmOf, slots, perViewer } = args;
  const by = args.by ?? 'task_id';
  const byKey = new Map<string, PromoRow>();
  for (const row of live) if (!byKey.has(row[by])) byKey.set(row[by], row);

  const badged = new Set<string>();
  const taskIds = new Map<string, string>();
  const candidates: PromotedCandidate[] = [];
  const itemOf = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    const row = byKey.get(key);
    if (!row || itemOf.has(key)) continue;
    badged.add(key);
    taskIds.set(key, row.task_id);
    itemOf.set(key, item);
    if (matches && !matches(item)) continue;
    candidates.push({
      taskId: key,
      topToday: row.top_today,
      myTopToday: row.my_top_today,
      km: kmOf ? kmOf(item) : null,
      startsAt: row.starts_at,
    });
  }
  const top = pickPromotedTop(candidates, slots, perViewer).map((c) => itemOf.get(c.taskId) as T);
  return { top, badged, taskIds };
}

/** The list with the winners first (in their order) and everything else in its normal order. */
export function liftPromoted<T>(items: readonly T[], top: readonly T[]): T[] {
  if (top.length === 0) return items.slice();
  const lifted = new Set<T>(top);
  return [...top, ...items.filter((x) => !lifted.has(x))];
}

export const FAIR_RULES_TASKS =
  'At most 2 promoted tasks on top, taking turns when there are more. Only ones that match your filters (distance, remote, price). Everything below stays newest first.';
export const FAIR_RULES_HELPERS =
  'At most 2 promoted helpers on top, taking turns. Only ones that match your search and distance. Everything below keeps the normal order.';
