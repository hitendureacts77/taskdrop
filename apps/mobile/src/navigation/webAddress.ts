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
};

/** A screen's plain name ("Wallet", "Find work" in Earn mode), or null for one with no name here. */
export function nameForScreen(screen: string, mode: 'poster' | 'worker' = 'poster'): string | null {
  return (screen === 'explore' && mode === 'worker' ? 'Find work' : screen === 'myTasks' && mode === 'worker' ? 'My work' : TITLES[screen]) ?? null;
}

/**
 * Browser-tab names for the screens that draw their own header (a TopBar, a sign-in step), so the desktop page
 * header (DesktopPage, nameForScreen) must not add a second one. Plan 3.6, T13 point 5: no tab says "TaskDrop" alone.
 */
const TAB_ONLY_TITLES: Record<string, string> = {
  intro: 'How TaskDrop works',
  setup: 'Set up your account',
  pickUsername: 'Pick a username',
  detailSheet: 'Task details',
  create: 'Post a task',
  postDetails: 'Post a task',
  compare: 'Compare offers',
  myQuotes: 'My offers',
  confirm: 'Confirm the work',
  escrow: 'Lock the price',
  swipe: 'Start the work',
  active: 'Task in progress',
  review: 'Ratings and review',
  withdraw: 'Withdraw',
  analytics: 'Analytics',
  promote: 'Promote',
  promotions: 'Promotions',
  pricing: 'How fees work',
  disputes: 'My complaints',
  profileEdit: 'Edit profile',
  workerSetup: 'Start earning',
  listing: 'Edit service',
  crew: 'Crew',
  regulars: 'My regulars',
  streaks: 'Streaks and badges',
  ideaDetail: 'Idea',
  bigDay: 'Plan a big day',
  ticket: 'Support ticket',
};

/** The site's own title: the splash, and any screen with no name. Same as dist/index.html (scripts/web-route-pages.mjs). */
export const SITE_TITLE = 'TaskDrop · Ask for anything. Someone gets it done for you.';

/** The browser tab's title on the "Page not found" page (components/NotFound.tsx and dist/404.html). */
export const NOT_FOUND_TITLE = 'Page not found · TaskDrop';

/** The browser tab's title for a screen: "Wallet · TaskDrop"; the site's own title for one with no name (never bare "TaskDrop"). */
export function titleForScreen(screen: string, mode: 'poster' | 'worker' = 'poster'): string {
  const name = nameForScreen(screen, mode) ?? TAB_ONLY_TITLES[screen] ?? null;
  return name ? `${name} · TaskDrop` : SITE_TITLE;
}

/**
 * Every address the website answers (plan 3.6, T13 point 8). Anything else is "Page not found": the app shows
 * NotFound, and Cloudflare sends dist/404.html with status 404. Must match ROUTE_PAGES in
 * apps/mobile/scripts/web-route-pages.mjs (web-route-pages.test.mjs checks).
 */
export const KNOWN_PATHS: readonly string[] = ['/', '/get', ...PUBLIC_PAGES.map((p) => `/${p}`)];

/** True for an address the website answers: "/", "/index.html", /get and the public pages, with or without a trailing slash. Case counts, as on Cloudflare (/Terms is a 404 there too). */
export function isKnownPath(pathname: string | null | undefined): boolean {
  const path = `/${(pathname ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return path === '/index.html' || KNOWN_PATHS.includes(path);
}
