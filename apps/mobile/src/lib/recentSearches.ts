import AsyncStorage from '@react-native-async-storage/async-storage';
import { addRecent, parseRecent } from './smartSearch';

/**
 * The last five things searched for, kept on this device only (a convenience, not profile data), one list per
 * side so Earn and Hire do not mix. Storage can fail (private window, full disk): then the list is just empty.
 */
/** Same text as RECENT_SEARCH_KEYS in placeMemory.ts, which forgets them at sign-out. */
const KEY = (side: 'earn' | 'hire') => `taskdrop.recentSearches.${side}.v1`;

export async function loadRecentSearches(side: 'earn' | 'hire'): Promise<string[]> {
  try {
    return parseRecent(await AsyncStorage.getItem(KEY(side)));
  } catch {
    return [];
  }
}

/** Remember one search; returns the new list (also when saving fails). */
export async function rememberSearch(side: 'earn' | 'hire', q: string): Promise<string[]> {
  const next = addRecent(await loadRecentSearches(side), q);
  try {
    await AsyncStorage.setItem(KEY(side), JSON.stringify(next));
  } catch {
    /* kept for this visit only */
  }
  return next;
}
