import type { ScreenName } from '../providers/navTypes';

/**
 * The five bottom tabs of the phone apps, which are the system's native tabs
 * (iOS and Android; the web keeps its own tab bar and side menu). `route` is
 * the file under src/app/ that holds the tab.
 */
export const NATIVE_TABS = ['home', 'explore', 'myTasks', 'wallet', 'profile'] as const;
export type NativeTab = (typeof NATIVE_TABS)[number];

export const TAB_ROUTE: Record<NativeTab, { name: string; path: '/' | '/explore' | '/my-tasks' | '/wallet' | '/profile' }> = {
  home: { name: 'index', path: '/' },
  explore: { name: 'explore', path: '/explore' },
  myTasks: { name: 'my-tasks', path: '/my-tasks' },
  wallet: { name: 'wallet', path: '/wallet' },
  profile: { name: 'profile', path: '/profile' },
};

export function isNativeTab(screen: ScreenName): screen is NativeTab {
  return (NATIVE_TABS as readonly string[]).includes(screen);
}

export function tabForPath(path: string): NativeTab | null {
  for (const tab of NATIVE_TABS) if (TAB_ROUTE[tab].path === path) return tab;
  return null;
}
