import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { makeTheme, type Theme } from '../theme';

const FOCUS_STYLE_ID = 'taskdrop-focus-ring';

/**
 * On web, react-native-web renders TextInput as a real <input>/<textarea>, so
 * the browser paints its own focus ring — an amber box that has nothing to do
 * with our palette and reads as a mistake next to the green. Replace it with
 * the brand accent rather than removing it, so keyboard users keep a visible
 * focus indicator. No-op on native, which has no such ring.
 */
function useWebFocusRing(accent: string) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    let el = document.getElementById(FOCUS_STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = FOCUS_STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = `
      input:focus, textarea:focus, select:focus, [contenteditable]:focus {
        outline: 2px solid ${accent};
        outline-offset: 2px;
      }
      input:focus:not(:focus-visible), textarea:focus:not(:focus-visible) {
        outline-color: ${accent};
      }
    `;
  }, [accent]);
}

type ThemePref = 'system' | 'light' | 'dark';

type ThemeCtx = {
  theme: Theme;
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
  toggle: () => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [pref, setPref] = useState<ThemePref>('system');

  const isDark = pref === 'system' ? system === 'dark' : pref === 'dark';
  const theme = useMemo(() => makeTheme(isDark), [isDark]);
  useWebFocusRing(theme.colors.accent);

  const value = useMemo<ThemeCtx>(
    () => ({
      theme,
      pref,
      setPref,
      toggle: () => setPref(isDark ? 'light' : 'dark'),
    }),
    [theme, pref, isDark],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): Theme {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme must be used inside ThemeProvider');
  return c.theme;
}

export function useThemeControls() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useThemeControls must be used inside ThemeProvider');
  return c;
}
