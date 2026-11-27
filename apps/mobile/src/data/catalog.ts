import { callApi } from '../lib/gateway';
import { CATEGORIES } from '../lib/taskBrief';
import { SKILL_OPTIONS, type CatalogItem } from '../lib/catalogPick';

/**
 * The shared, ranked lists of skills and categories (task 1.19 row E).
 * Server side: supabase/functions/api group `catalog`. If a call fails (guest, old server,
 * offline) the picker still works from the built-in lists.
 */

export type CatalogKind = 'skill' | 'category';
export type CatalogTerm = { id: string; label: string; uses: number };
export type CheckResult =
  | { result: 'exact'; term: CatalogTerm }
  | { result: 'covered'; via: 'phrase' | 'spelling' | 'meaning'; term: CatalogTerm; canForce: boolean }
  | { result: 'refused'; reason: string; message?: string }
  | { result: 'new'; label: string };
export type AddResult =
  | { result: 'exact'; term: CatalogTerm }
  | { result: 'covered'; via: 'phrase' | 'spelling' | 'meaning'; term: CatalogTerm; canForce: boolean }
  | { result: 'refused'; reason: string; message?: string }
  | { result: 'added'; term: CatalogTerm };

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<CatalogKind, { at: number; items: CatalogItem[] }>();

const builtin = (kind: CatalogKind): CatalogItem[] =>
  (kind === 'skill' ? SKILL_OPTIONS : [...CATEGORIES]).map((label, i) => ({ id: `builtin:${i}`, label, uses: 0, source: 'builtin' }));

export const forgetCatalog = () => cache.clear();

export async function listCatalog(kind: CatalogKind): Promise<CatalogItem[]> {
  const hit = cache.get(kind);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;
  try {
    const rows = await callApi<CatalogItem[]>('listCatalog', { kind });
    if (!Array.isArray(rows) || rows.length === 0) return builtin(kind);
    cache.set(kind, { at: Date.now(), items: rows });
    return rows;
  } catch {
    return builtin(kind);
  }
}

export const checkCatalogTerm = (kind: CatalogKind, text: string) =>
  callApi<CheckResult>('checkCatalogTerm', { kind, text });

export async function addCatalogTerm(kind: CatalogKind, text: string, force = false): Promise<AddResult> {
  const r = await callApi<AddResult>('addCatalogTerm', { kind, text, force });
  cache.delete(kind);
  return r;
}
