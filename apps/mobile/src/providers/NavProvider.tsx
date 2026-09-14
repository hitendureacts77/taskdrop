import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

/**
 * Lightweight screen navigator that mirrors the design's own tab-state model.
 * Keeps a simple stack so `back()` works. Screen names match the design.
 */
export type ScreenName =
  | 'splash'
  | 'welcome'
  | 'signup'
  | 'setup'
  | 'pro'
  | 'home'
  | 'search'
  | 'create'
  | 'postDetails'
  | 'taskDetail'
  | 'detailSheet'
  | 'compare'
  | 'myQuotes'
  | 'confirm'
  | 'escrow'
  | 'swipe'
  | 'active'
  | 'chat'
  | 'orders'
  | 'wallet'
  | 'withdraw'
  | 'promote'
  | 'review'
  | 'profile'
  | 'analytics';

export type NavParams = Record<string, unknown>;

type NavCtx = {
  screen: ScreenName;
  params: NavParams;
  go: (screen: ScreenName, params?: NavParams) => void;
  back: () => void;
  reset: (screen: ScreenName, params?: NavParams) => void;
};

const Ctx = createContext<NavCtx | null>(null);

export function NavProvider({
  children,
  initial = 'splash',
}: {
  children: React.ReactNode;
  initial?: ScreenName;
}) {
  const [stack, setStack] = useState<Array<{ screen: ScreenName; params: NavParams }>>([
    { screen: initial, params: {} },
  ]);

  const go = useCallback((screen: ScreenName, params: NavParams = {}) => {
    setStack((s) => [...s, { screen, params }]);
  }, []);
  const back = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  const reset = useCallback((screen: ScreenName, params: NavParams = {}) => {
    setStack([{ screen, params }]);
  }, []);

  const top = stack[stack.length - 1]!;
  const value = useMemo<NavCtx>(
    () => ({ screen: top.screen, params: top.params, go, back, reset }),
    [top, go, back, reset],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNav() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useNav must be used inside NavProvider');
  return c;
}
