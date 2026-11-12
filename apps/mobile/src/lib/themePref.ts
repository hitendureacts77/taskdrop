export type ThemePref = 'light' | 'dark' | 'system';

/** What was saved for the theme choice: only the three known words, anything else is System. */
export function parseThemePref(raw: unknown): ThemePref {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}
