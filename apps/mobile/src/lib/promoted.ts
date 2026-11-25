import { PROMOTE_DEFAULTS } from '@taskdrop/rules';

/** The part of a live promotion row the screens need (see `PromotedLive` in data/api.ts). */
export type PromoRow = {
  task_id: string;
  poster_id: string;
  /** Won one of the top places in this auction. */
  top: boolean;
  /** 1 or 2 for a winner, null for a promoted post that was not on top. */
  place: number | null;
};

export type PromotedPick<T> = {
  /** The auction winners that are in this list, in the server's place order (at most TOP_SLOTS). */
  top: T[];
  /** Keys of every promoted item in the list (top or not): they all show the PROMOTED pill. */
  badged: Set<string>;
  /** Item key -> the promoted post's task id (for services this is the service task, not the helper). */
  taskIds: Map<string, string>;
};

/**
 * Reads the server's auction answer for a screen's items. The server decides who is on top (`top`, `place`); the
 * app only badges every live promoted item and lifts the winners. `items` is what the screen shows after the
 * viewer's own filters (the same ids the call was made with). `by` says which id of the live row the item's key
 * is: 'task_id' for tasks and services, 'poster_id' for helper lists.
 */
export function pickPromotedItems<T>(args: {
  items: readonly T[];
  live: readonly PromoRow[];
  keyOf: (item: T) => string;
  by?: 'task_id' | 'poster_id';
}): PromotedPick<T> {
  const { items, live, keyOf } = args;
  const by = args.by ?? 'task_id';
  const byKey = new Map<string, PromoRow>();
  for (const row of live) {
    const prev = byKey.get(row[by]);
    // A helper can have several promoted services: keep the one that won.
    if (!prev || (row.top && !prev.top)) byKey.set(row[by], row);
  }

  const badged = new Set<string>();
  const taskIds = new Map<string, string>();
  const winners: { item: T; place: number }[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const row = byKey.get(key);
    if (!row || badged.has(key)) continue;
    badged.add(key);
    taskIds.set(key, row.task_id);
    if (row.top) winners.push({ item, place: row.place ?? Number.MAX_SAFE_INTEGER });
  }
  winners.sort((a, b) => a.place - b.place);
  const top = winners.slice(0, PROMOTE_DEFAULTS.TOP_SLOTS).map((w) => w.item);
  return { top, badged, taskIds };
}

/** The list with the winners first (in their order) and everything else in its normal order. */
export function liftPromoted<T>(items: readonly T[], top: readonly T[]): T[] {
  if (top.length === 0) return items.slice();
  const lifted = new Set<T>(top);
  return [...top, ...items.filter((x) => !lifted.has(x))];
}

/** The ids a list sends to the auction: unique and non-empty, in list order. */
export function auctionIds(ids: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const id of ids) if (id) seen.add(id);
  return [...seen];
}

export const FAIR_RULES_TASKS =
  'Posters paid to promote these. At most 2 on top, only ones that suit you, and the same one at most 3 times a day. Everything below stays newest first.';
export const FAIR_RULES_HELPERS =
  'Promoted helpers paid to be shown first. At most 2, only ones that match your search. Everything below keeps its normal order.';
