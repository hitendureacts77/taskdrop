import type { PromotablePost } from '../data/api';

/**
 * Adds a freshly loaded page to what the picker already shows. A crew job is one task row per helper, so its
 * open slots would look like copies of one card: only the first of a crew is kept. Nothing is listed twice.
 */
export function mergePromotable(shown: PromotablePost[], incoming: PromotablePost[]): PromotablePost[] {
  const ids = new Set(shown.map((p) => p.id));
  const crews = new Set(shown.map((p) => p.crew_id).filter((c): c is string => Boolean(c)));
  const out = [...shown];
  for (const p of incoming) {
    if (ids.has(p.id)) continue;
    if (p.crew_id && crews.has(p.crew_id)) continue;
    ids.add(p.id);
    if (p.crew_id) crews.add(p.crew_id);
    out.push(p);
  }
  return out;
}

/** "1 of 5 workers", or "No worker yet" for a single-worker post (and "No helper yet" style words for a service). */
export function fillText(p: Pick<PromotablePost, 'filled' | 'wanted' | 'kind'>): string {
  if (p.kind === 'service') return 'Open for customers';
  if (p.wanted <= 1) return 'No worker yet';
  return `${p.filled} of ${p.wanted} workers`;
}

/** 0 to 1: how much of the crew is found, for the small fill bar. */
export function fillShare(p: Pick<PromotablePost, 'filled' | 'wanted'>): number {
  return p.wanted > 0 ? Math.max(0, Math.min(1, p.filled / p.wanted)) : 0;
}
