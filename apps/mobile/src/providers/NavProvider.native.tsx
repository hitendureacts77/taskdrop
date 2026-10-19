import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { useIsFocused, usePathname, useRouter } from 'expo-router';
import { useSyncVersion } from './SyncProvider';
import type { NavParams, ScreenName } from './navTypes';
import { TAB_ROUTE, isNativeTab, tabForPath } from '../navigation/nativeTabs';
import { clearParams, putParams, setTabParams } from '../navigation/navParams';

export type { NavParams, ScreenName } from './navTypes';

/**
 * The iOS and Android build of the navigator (NavProvider.tsx is the web's).
 * Same useNav() as ever -- screen, params, go, back, reset -- but every screen
 * is a real Expo Router route now: the five tabs are the system's native tabs
 * and everything else is a native stack over them, with the system's own
 * transitions and back gestures. Screens do not change.
 */

/** Nothing to hold any more: the router keeps the stack. Kept so the app's tree reads the same on both. */
export function NavProvider({ children }: { children: React.ReactNode; initial?: ScreenName }) {
  return <>{children}</>;
}

/** Which screen is in front, from the address the router is at. */
function screenForPath(pathname: string): ScreenName {
  const tab = tabForPath(pathname);
  if (tab) return tab;
  const m = /^\/screen\/([^/?#]+)/.exec(pathname);
  return m ? (decodeURIComponent(m[1]!) as ScreenName) : 'home';
}

type Scope = { params: NavParams; focus: number };
const ScopeCtx = createContext<Scope | null>(null);
const EMPTY: NavParams = {};

/**
 * Wraps one route's screen: gives it its own params and counts how many times
 * it has come back into view (useFocusTick), which is how a list under a
 * screen that was opened on top of it knows to refresh when that one closes.
 */
export function ScreenScope({
  params,
  focus,
  children,
}: {
  params: NavParams;
  /** Ignored here; the route counts its own focus. */
  focus?: number;
  children: React.ReactNode;
}) {
  void focus;
  const focused = useIsFocused();
  const count = useRef(0);
  const was = useRef(focused);
  if (focused && !was.current) count.current += 1;
  was.current = focused;
  const value = useMemo<Scope>(() => ({ params, focus: count.current }), [params, focused]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ScopeCtx.Provider value={value}>{children}</ScopeCtx.Provider>;
}

/**
 * Goes up by one each time this screen comes back into view, and each time the
 * server reports a change for the signed-in person (SyncProvider). Put it in a
 * load effect's dependencies to refresh quietly on return or on a live change.
 */
export function useFocusTick(): number {
  const scope = useContext(ScopeCtx);
  return (scope?.focus ?? 0) + useSyncVersion();
}

export function useNav() {
  const router = useRouter();
  const pathname = usePathname();
  const scope = useContext(ScopeCtx);
  const screen = screenForPath(pathname);

  const go = useCallback(
    (to: ScreenName, params: NavParams = EMPTY) => {
      if (isNativeTab(to)) {
        // A tab is a place to land, not a screen to stack: close whatever is open over the tabs, then show it.
        setTabParams(to, params);
        if (router.canDismiss()) router.dismissAll();
        router.navigate(TAB_ROUTE[to].path);
        return;
      }
      const k = putParams(params);
      router.push({ pathname: '/screen/[name]', params: k ? { name: to, k } : { name: to } });
    },
    [router],
  );

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const reset = useCallback(
    (to: ScreenName, params: NavParams = EMPTY) => {
      // Back to the start (signed out): nothing from the last person carries over.
      if (to === 'splash') clearParams();
      if (router.canDismiss()) router.dismissAll();
      if (isNativeTab(to)) {
        setTabParams(to, params);
        router.replace(TAB_ROUTE[to].path);
        return;
      }
      const k = putParams(params);
      router.replace({ pathname: '/screen/[name]', params: k ? { name: to, k } : { name: to } });
    },
    [router],
  );

  return useMemo(
    () => ({ screen, params: scope?.params ?? EMPTY, go, back, reset }),
    [screen, scope, go, back, reset],
  );
}
