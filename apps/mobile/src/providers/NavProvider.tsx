import React, { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useSyncVersion } from './SyncProvider';
import { useAuth } from './AuthProvider';
import { useMode } from './ModeProvider';
import type { NavParams, ScreenName } from './navTypes';
import { OPEN_TO_ALL, OUTSIDE_APP, pathForStack, routeFromAddress, type WebRoute } from '../navigation/webAddress';
import { WebHistory, type HistoryHost } from '../navigation/webHistory';
import { getTask } from '../data/api';
import { roughPlace } from '../lib/place';
import { taskLinkTarget } from '../lib/taskLink';

export type { NavParams, ScreenName } from './navTypes';

/**
 * Lightweight screen navigator that mirrors the design's own tab-state model.
 * Keeps a simple stack so `back()` works. Screen names match the design.
 *
 * This is the web build's navigator (phones use NavProvider.native.tsx). On the website the stack and the browser's
 * history move together (navigation/webHistory.ts): each main screen has its address (navigation/webAddress.ts),
 * moving to a screen pushes a history entry, browser Back and Forward walk through the screens, a reload or a shared
 * link opens that screen, and the in-app back button and browser Back agree.
 */

type NavCtx = {
  screen: ScreenName;
  params: NavParams;
  go: (screen: ScreenName, params?: NavParams) => void;
  back: () => void;
  reset: (screen: ScreenName, params?: NavParams) => void;
  /** Swap the screen on top for another: Back skips the one that was replaced (a step that is over, like swipe-to-start). */
  replace: (screen: ScreenName, params?: NavParams) => void;
};

type Entry = { screen: ScreenName; params: NavParams };

const Ctx = createContext<NavCtx | null>(null);

const browser: (HistoryHost & Window) | null =
  Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.history?.pushState === 'function' ? window : null;
/** The address the page was opened at, read once before anything rewrites it. */
const arrival = browser ? { pathname: browser.location.pathname, search: browser.location.search } : null;

const outside = (s: ScreenName) => OUTSIDE_APP.includes(s);

/** A task's page from its id: read the task, then open it, or "That task is not available" (B148). */
async function taskEntry(taskId: string): Promise<Entry> {
  let task: Awaited<ReturnType<typeof getTask>> = null;
  try {
    task = await getTask(taskId);
  } catch {
    task = null;
  }
  const to = taskLinkTarget(task, roughPlace);
  // taskId keeps the address /task/<id>, also when the task is not available.
  return { screen: to.screen, params: { ...to.params, taskId } };
}

export function NavProvider({
  children,
  initial = 'splash',
}: {
  children: React.ReactNode;
  initial?: ScreenName;
}) {
  const { session, guest } = useAuth();
  const { mode, setMode } = useMode();
  const inAppRef = useRef(false);
  inAppRef.current = Boolean(session) || guest;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const [stack, setStackState] = useState<Entry[]>(() => [{ screen: initial, params: {} }]);
  const stackRef = useRef(stack);
  // A link to a screen that needs someone inside the app, opened signed out: it opens once they are in.
  const waiting = useRef<WebRoute | null>(null);
  // Made during the first render, before any screen can move: the page's own entry becomes the first screen's.
  const hist = useRef<WebHistory<Entry> | null>(null);
  if (browser && !hist.current) {
    hist.current = new WebHistory<Entry>(browser, (s) => pathForStack(s, modeRef.current));
    hist.current.start(stackRef.current);
  }

  const commit = useCallback((next: Entry[], how: 'push' | 'replace' | 'none') => {
    stackRef.current = next;
    setStackState(next);
    if (how !== 'none') hist.current?.[how](next);
  }, []);

  /**
   * Open the screen an address asks for, on top of `base`, as a new history entry ('push') or in the current one
   * ('replace'). A task is read first, so it opens a moment later.
   */
  const openRoute = useCallback(
    (route: WebRoute, base: Entry[], how: 'push' | 'replace') => {
      if (route.mode) setMode(route.mode);
      if (route.screen === 'taskDetail' && route.params.taskId) {
        void taskEntry(route.params.taskId).then((e) => {
          // Not over a screen someone has moved to meanwhile (the splash moving on to sign-in is fine).
          const now = stackRef.current;
          if (now === base || outside(now[now.length - 1]!.screen)) commit([...now, e], how);
        });
        return;
      }
      const e: Entry = { screen: route.screen as ScreenName, params: route.params };
      commit(route.screen === 'home' ? [e] : [...base, e], how);
    },
    [commit, setMode],
  );

  // The address the page opened at: its screen opens over Home (so Back goes Home), or over the splash for a page
  // anyone may read. A screen that needs an account waits until the visitor is in (reset below).
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !arrival) return;
    arrived.current = true;
    const route = routeFromAddress(arrival.pathname, arrival.search);
    const base = stackRef.current;
    // A reload rebuilds its screen in the same entry; a fresh visit adds the screen as a step over Home.
    const how = hist.current?.reloaded ? 'replace' : 'push';
    if (!route || route.screen === 'home') {
      if (how === 'replace') commit(base, 'replace');
      return;
    }
    if (outside(base[base.length - 1]!.screen) && !OPEN_TO_ALL.includes(route.screen)) {
      waiting.current = route;
      if (how === 'replace') commit(base, 'replace');
      return;
    }
    openRoute(route, base, how);
  }, [commit, openRoute]);

  // Browser Back and Forward.
  useEffect(() => {
    const host = browser;
    if (!host) return;
    const onPop = (ev: PopStateEvent) => {
      const h = hist.current;
      if (!h) return;
      const r = h.onPop(ev.state);
      if (r === 'ignore') return;
      if (r !== 'unknown') {
        commit([...r.stack], 'none');
        return;
      }
      // An entry from before a reload, or from before signing out: rebuilt from its address.
      const route = routeFromAddress(host.location.pathname, '');
      // The entry keeps its place in the browser's list (Forward still works): it is replaced, never pushed.
      const home: Entry = { screen: inAppRef.current ? 'home' : 'splash', params: {} };
      if (!route || route.screen === 'home' || (!inAppRef.current && !OPEN_TO_ALL.includes(route.screen))) {
        if (route && route.screen !== 'home') waiting.current = route;
        commit([home], 'replace');
        return;
      }
      commit([home], 'none');
      openRoute(route, stackRef.current, 'replace');
    };
    host.addEventListener('popstate', onPop);
    return () => host.removeEventListener('popstate', onPop);
  }, [commit, openRoute]);

  // Earn and Hire name a screen differently (/find-work, /explore): the address follows the switch.
  useEffect(() => {
    hist.current?.retitle(stackRef.current);
  }, [mode]);

  const go = useCallback(
    (screen: ScreenName, params: NavParams = {}) => {
      commit([...stackRef.current, { screen, params }], 'push');
    },
    [commit],
  );
  const back = useCallback(() => {
    const s = stackRef.current;
    if (s.length <= 1) return;
    const target = s.slice(0, -1);
    commit(target, 'none');
    hist.current?.back(target);
  }, [commit]);
  const reset = useCallback(
    (screen: ScreenName, params: NavParams = {}) => {
      const s = stackRef.current;
      const from = s[s.length - 1]!.screen;
      const next: Entry[] = [{ screen, params }];
      if (outside(screen)) {
        // Signing out or starting over: Back must not bring back a signed-in screen as it was.
        commit(next, 'replace');
        hist.current?.forget();
      } else if (outside(from)) {
        // Just in (signed in, a guest, set up): no Back step into the sign-in pages. A link that waited opens now.
        commit(next, 'replace');
        const w = waiting.current;
        waiting.current = null;
        if (w && w.screen !== screen) openRoute(w, next, 'push');
      } else {
        // A tab or Home from the menu: a step of its own, so browser Back returns to where they were.
        commit(next, 'push');
      }
    },
    [commit, openRoute],
  );
  const replace = useCallback(
    (screen: ScreenName, params: NavParams = {}) => {
      commit([...stackRef.current.slice(0, -1), { screen, params }], 'replace');
    },
    [commit],
  );

  const top = stack[stack.length - 1]!;
  const value = useMemo<NavCtx>(
    () => ({ screen: top.screen, params: top.params, go, back, reset, replace }),
    [top, go, back, reset, replace],
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

const FocusCtx = createContext(0);

/**
 * A kept-alive tab sees its own last params, not whichever screen is on top.
 * Tabs stay mounted while hidden (so coming back is instant, not a reload);
 * without this, the home feed would read the explore screen's search query.
 * `focus` counts how many times this tab has come back into view.
 */
export function ScreenScope({
  params,
  focus = 0,
  children,
}: {
  params: NavParams;
  focus?: number;
  /** Used by the phone build only (NavProvider.native.tsx); here ScreenHost counts each tab's focus. */
  name?: ScreenName;
  children: React.ReactNode;
}) {
  const outer = useContext(Ctx);
  if (!outer) throw new Error('ScreenScope must be used inside NavProvider');
  const value = useMemo<NavCtx>(() => ({ ...outer, params }), [outer, params]);
  return (
    <Ctx.Provider value={value}>
      <FocusCtx.Provider value={focus}>{children}</FocusCtx.Provider>
    </Ctx.Provider>
  );
}

/**
 * Goes up by one each time this tab comes back into view, and each time the
 * server reports a change for the signed-in person (SyncProvider). Put it in a
 * load effect's dependencies to refresh quietly on return or on a live change.
 * 0 outside a tab. Both parts only ever increase, so the sum changes on any bump.
 */
export function useFocusTick(): number {
  return useContext(FocusCtx) + useSyncVersion();
}

export function useNav() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useNav must be used inside NavProvider');
  return c;
}
