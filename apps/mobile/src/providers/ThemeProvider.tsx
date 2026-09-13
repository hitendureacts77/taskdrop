import React, { createContext, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { makeTheme, type Theme } from '../theme';

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
