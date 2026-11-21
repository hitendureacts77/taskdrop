/**
 * The website's address and tab title for a screen (B171, B179). Pure, so it can be unit tested
 * (webAddress.test.ts); ScreenHost and PublicPageLink apply it on web.
 *
 * Only the four public pages have an address of their own: /terms, /privacy, /support and /copyright open
 * those pages on load (as ?page= always did), and the address follows them while they are open. Every other
 * screen keeps the plain address, as before: full history routing (Back through screens, a reload staying
 * put) is an owner decision, not built here. The address is only ever replaced, never pushed, so Back works
 * exactly as it did.
 */

export const PUBLIC_PAGES = ['copyright', 'terms', 'privacy', 'support'] as const;
export type PublicPage = (typeof PUBLIC_PAGES)[number];

const isPublic = (v: string): v is PublicPage => (PUBLIC_PAGES as readonly string[]).includes(v);

/** The public page an address asks for: /privacy (a trailing slash is fine) or ?page=privacy. Else null. */
export function pageFromAddress(pathname: string, search: string): PublicPage | null {
  const path = pathname.replace(/\/+$/, '').replace(/^\/+/, '').toLowerCase();
  if (isPublic(path)) return path;
  const q = new URLSearchParams(search).get('page');
  return q && isPublic(q) ? q : null;
}

/**
 * The path the address bar should show for a screen, or null to leave it alone. A public page shows its own
 * path; leaving one goes back to "/". Any other path (/get, a path the server answered) is left as it is.
 */
export function pathForScreen(screen: string, pathname: string): string | null {
  if (isPublic(screen)) return pathname === `/${screen}` ? null : `/${screen}`;
  const here = pathname.replace(/\/+$/, '').replace(/^\/+/, '').toLowerCase();
  return isPublic(here) ? '/' : null;
}

const TITLES: Record<string, string> = {
  home: 'Home',
  explore: 'Explore',
  nearMap: 'Map',
  myTasks: 'My tasks',
  wallet: 'Wallet',
  spending: 'Spending insights',
  profile: 'Profile',
  account: 'Account',
  inbox: 'Messages',
  chat: 'Chat',
  notifications: 'Notifications',
  taskDetail: 'Task',
  taskManage: 'Your task',
  aiPost: 'Post a task',
  search: 'Search',
  saved: 'Saved',
  orders: 'Orders',
  help: 'Help',
  support: 'Help and support',
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  copyright: 'Copyright',
  ideas: 'Ideas and feedback',
  welcome: 'Sign in',
  signup: 'Make your account',
  publicProfile: 'Profile',
  bigDay: 'Plan a big day',
  regulars: 'My regulars',
  promote: 'Promote a request',
  disputes: 'My complaints',
  profileEdit: 'Edit profile',
};

/** The browser tab's title for a screen: "Wallet · TaskDrop"; plain "TaskDrop" for one with no name here. */
export function titleForScreen(screen: string, mode: 'poster' | 'worker' = 'poster'): string {
  const name = screen === 'explore' && mode === 'worker' ? 'Find work' : screen === 'myTasks' && mode === 'worker' ? 'My work' : TITLES[screen];
  return name ? `${name} · TaskDrop` : 'TaskDrop';
}
