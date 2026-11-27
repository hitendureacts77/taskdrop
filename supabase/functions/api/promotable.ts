/**
 * Which of a poster's posts can be promoted, and how a page of them is cut (task 1.21 row D).
 * Pure functions, so the rules are tested without a database. The server still decides: `start_promotion`
 * (migration 203) refuses anything that is not the caller's own open post.
 */

export type PromotableRow = {
  id: string;
  title: string;
  category: string | null;
  kind: "request" | "service";
  benchmark_minor: number;
  status: string;
  crew_id: string | null;
  crew_size: number | null;
  crew_slot: number | null;
};

export type PromotableTask = {
  id: string;
  title: string;
  category: string | null;
  kind: "request" | "service";
  benchmark_minor: number;
  status: string;
  quotes: number;
  crew_id: string | null;
  /** Workers already on the job and workers wanted. A single-worker post is 0 of 1. */
  filled: number;
  wanted: number;
};

/** A crew job is one task row per helper. Slots that are taken (past OPEN, not cancelled) count as filled. */
export function crewFilled(crewRows: { crew_id: string | null; status: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of crewRows) {
    if (!r.crew_id || r.status === "OPEN" || r.status === "CANCELLED") continue;
    out[r.crew_id] = (out[r.crew_id] ?? 0) + 1;
  }
  return out;
}

/** Open, and the workers wanted are not all found yet. A post nobody has accepted is 0 of 1, so it always passes. */
export function isPromotable(row: PromotableRow, filled: Record<string, number>): boolean {
  if (row.status !== "OPEN") return false;
  const wanted = row.crew_size ?? 1;
  const have = row.crew_id ? (filled[row.crew_id] ?? 0) : 0;
  return have < wanted;
}

export function toPromotable(row: PromotableRow, quotes: Record<string, number>, filled: Record<string, number>): PromotableTask {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    kind: row.kind,
    benchmark_minor: row.benchmark_minor,
    status: row.status,
    quotes: quotes[row.id] ?? 0,
    crew_id: row.crew_id,
    filled: row.crew_id ? Math.min(filled[row.crew_id] ?? 0, row.crew_size ?? 1) : 0,
    wanted: row.crew_size ?? 1,
  };
}

/** One extra row is read to know whether there is a next page, then dropped. */
export function pageOf<T>(fetched: T[], n: number): { items: T[]; hasMore: boolean } {
  return { items: fetched.slice(0, n), hasMore: fetched.length > n };
}
