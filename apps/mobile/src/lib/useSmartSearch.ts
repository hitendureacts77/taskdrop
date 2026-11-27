import { useCallback, useEffect, useState } from 'react';
import { searchSuggest, type SearchSuggestResult, type SearchSuggestion } from '../data/api';
import { loadRecentSearches, rememberSearch } from './recentSearches';
import { roleKind, type SearchRole } from './smartSearch';

type Near = { lat: number; lng: number; radiusKm: number } | null | undefined;

const EMPTY: SearchSuggestResult = { corrected: null, chips: [], suggestions: [] };

/**
 * What the search understood for the words that were searched: the pills, the spelling fix. Counts are not
 * asked for (nothing here shows them). A failed read just shows no pills; the results still come.
 */
export function useSearchUnderstood(opts: { q: string; role: SearchRole; near?: Near; drop: string[]; exact: boolean }) {
  const { q, role, near, drop, exact } = opts;
  const [data, setData] = useState<SearchSuggestResult>(EMPTY);
  const key = `${q}|${role}|${near ? `${near.lat},${near.lng},${near.radiusKm}` : '-'}|${drop.join(',')}|${exact}`;
  useEffect(() => {
    const word = q.trim();
    if (!word) {
      setData(EMPTY);
      return;
    }
    let alive = true;
    searchSuggest({ q: word, kind: roleKind(role), near: near ?? undefined, drop, exact, counts: false })
      .then((r) => alive && setData(r))
      .catch(() => alive && setData(EMPTY));
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return q.trim() ? data : EMPTY;
}

/**
 * "Looks like you mean" while typing: a quick answer without counts on every pause, the counts a moment later
 * (about 350 ms). Out-of-order answers are dropped.
 */
export function useTypingSuggestions(text: string, active: boolean, role: SearchRole, near?: Near): SearchSuggestion[] {
  const [list, setList] = useState<SearchSuggestion[]>([]);
  const nearKey = near ? `${near.lat},${near.lng},${near.radiusKm}` : '-';
  useEffect(() => {
    const word = text.trim();
    if (!active || word.length < 2) {
      setList([]);
      return;
    }
    let alive = true;
    const ask = (counts: boolean) =>
      searchSuggest({ q: word, kind: roleKind(role), near: near ?? undefined, counts })
        .then((r) => alive && setList(r.suggestions))
        .catch(() => {});
    const quick = setTimeout(() => void ask(false), 120);
    const full = setTimeout(() => void ask(true), 350);
    return () => {
      alive = false;
      clearTimeout(quick);
      clearTimeout(full);
    };
  }, [text, active, role, nearKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}

/** The last five searches on this device, and a way to add one. */
export function useRecentSearches(role: SearchRole) {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void loadRecentSearches(role).then((r) => alive && setRecent(r));
    return () => {
      alive = false;
    };
  }, [role]);
  const remember = useCallback(
    (q: string) => {
      void rememberSearch(role, q).then(setRecent);
    },
    [role],
  );
  return { recent, remember };
}
