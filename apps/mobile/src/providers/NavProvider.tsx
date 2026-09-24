import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Lightweight screen navigator that mirrors the design's own tab-state model.
 * Keeps a simple stack so `back()` works. Screen names match the design.
 */
export type ScreenName =
  | 'splash'
  | 'welcome'
  | 'signup'
  | 'setup'
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
  | 'analytics'
  // Second wave: AI posting, explore, my tasks and the account surfaces.
  | 'aiPost'
  | 'explore'
  | 'myTasks'
  | 'taskManage'
  | 'notifications'
  | 'inbox'
  | 'account'
  | 'help'
  | 'ticket'
  | 'pricing'
  | 'disputes'
  | 'profileEdit'
  | 'publicProfile'
  | 'saved';

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

  // Android hardware/gesture back button: pop our own stack like any native
  // screen would, and only let the OS handle it (close the app) once we're
  // at the root screen. Native-only — BackHandler.addEventListener is a
  // no-op on web/iOS.
  const stackLength = stack.length;
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stackLength > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stackLength, back]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNav() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useNav must be used inside NavProvider');
  return c;
}
