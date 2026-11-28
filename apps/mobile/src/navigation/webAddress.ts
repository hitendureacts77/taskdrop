/**
 * The website's addresses and tab titles (B171, B179, board fix "Back, refresh and links"). Pure, so it can be
 * unit tested (webAddress.test.ts); NavProvider.tsx (web) applies it through navigation/webHistory.ts.
 *
 * The main screens have readable addresses: /task/<id>, /profile/<id>, /my-tasks, /find-work, /wallet and the rest
 * (APP_PATHS below). Moving to a screen pushes a browser history entry, so Back and Forward walk through screens
 * in the app, a reload stays on the screen, and a task link can be shared. Only ids go in an address: never a
 * phone number, a place, a search or anything else personal. A screen with no address of its own (a form step,
 * a chat) keeps the address of the screen under it.
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
 * The app screens with a fixed address. Explore is /find-work in Earn mode and /explore in Hire mode; opening
 * /find-work switches to Earn. My work (the Earn orders list) is /my-work. Must match APP_ROUTES in
 * apps/mobile/scripts/web-route-pages.mjs, which serves them on Cloudflare (web-route-pages.test.mjs checks).
 */
export const APP_PATHS: readonly { path: string; screen: string; mode?: 'worker' }[] = [
  { path: '/find-work', screen: 'explore', mode: 'worker' },
  { path: '/explore', screen: 'explore' },
  { path: '/map', screen: 'nearMap' },
  { path: '/my-tasks', screen: 'myTasks' },
  { path: '/my-work', screen: 'orders' },
  { path: '/wallet', screen: 'wallet' },
  { path: '/messages', screen: 'inbox' },
  { path: '/notifications', screen: 'notifications' },
  { path: '/profile', screen: 'profile' },
  { path: '/account', screen: 'account' },
  { path: '/post', screen: 'aiPost' },
  { path: '/saved', screen: 'saved' },
  { path: '/help', screen: 'help' },
  { path: '/ideas', screen: 'ideas' },
];

/** Addresses that carry one id: a task (/task/<id>) and a person's public profile (/profile/<id>). */
export const ID_PATHS = { task: '/task/', profile: '/profile/' } as const;

/** Every address pattern the app answers beyond the files in KNOWN_PATHS, as Cloudflare `_redirects` sources. */
export const APP_ROUTE_PATTERNS: readonly string[] = [...APP_PATHS.map((r) => r.path), `${ID_PATHS.task}*`, `${ID_PATHS.profile}*`];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** A screen an address opens. `params` holds only ids (taskId, userId); `mode` is set for /find-work. */
export type WebRoute = { screen: string; params: Record<string, string>; mode?: 'worker' };

const clean = (pathname: string) => `/${(pathname ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;

/**
 * The screen an address opens, or null for one the app does not answer (Page not found). "/" is Home. Case
 * counts, as on Cloudflare. The old links still work: ?task=<id> opens the task, ?page=terms the page.
 */
export function routeFromAddress(pathname: string, search = ''): WebRoute | null {
  const path = clean(pathname);
  const q = new URLSearchParams(search);
  if (path === '/' || path === '/index.html') {
    const task = q.get('task');
    if (isId(task)) return { screen: 'taskDetail', params: { taskId: task } };
    const page = q.get('page');
    if (page && isPublic(page)) return { screen: page, params: {} };
    return { screen: 'home', params: {} };
  }
  if (isPublic(path.slice(1))) return { screen: path.slice(1), params: {} };
  const fixed = APP_PATHS.find((r) => r.path === path);
  if (fixed) return fixed.mode ? { screen: fixed.screen, params: {}, mode: fixed.mode } : { screen: fixed.screen, params: {} };
  if (path.startsWith(ID_PATHS.task)) {
    const id = path.slice(ID_PATHS.task.length);
    return isId(id) ? { screen: 'taskDetail', params: { taskId: id.toLowerCase() } } : null;
  }
  if (path.startsWith(ID_PATHS.profile)) {
    const id = path.slice(ID_PATHS.profile.length);
    return isId(id) ? { screen: 'publicProfile', params: { userId: id.toLowerCase() } } : null;
  }
  return null;
}

/**
 * The address of one screen, or null for a screen with no address of its own. A task needs its real id (a feed
 * row's id, or the taskId a link carried); a profile needs the person's id.
 */
export function pathForEntry(screen: string, params: Record<string, unknown>, mode: 'poster' | 'worker' = 'poster'): string | null {
  if (screen === 'home') return '/';
  if (isPublic(screen)) return `/${screen}`;
  if (screen === 'explore') return mode === 'worker' ? '/find-work' : '/explore';
  if (screen === 'taskDetail') {
    const rowId = (params.row as { id?: unknown } | undefined)?.id;
    const id = isId(rowId) ? rowId : isId(params.taskId) ? params.taskId : null;
    return id ? `${ID_PATHS.task}${id}` : null;
  }
  if (screen === 'publicProfile') return isId(params.userId) ? `${ID_PATHS.profile}${params.userId}` : null;
  return APP_PATHS.find((r) => r.screen === screen && !r.mode)?.path ?? null;
}

/** The address for a whole stack: the top screen's, else the nearest screen under it that has one, else "/". */
export function pathForStack(stack: readonly { screen: string; params: Record<string, unknown> }[], mode: 'poster' | 'worker' = 'poster'): string {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const p = pathForEntry(stack[i]!.screen, stack[i]!.params, mode);
    if (p) return p;
  }
  return '/';
}

/** Screens shown before the app (sign-in, onboarding). Arriving at them never adds a Back step into the app. */
export const OUTSIDE_APP: readonly string[] = ['splash', 'intro', 'welcome', 'signup', 'setup', 'pickUsername'];

/**
 * Screens someone with no account and no guest choice may open straight from a link: the public pages, a task, a
 * person's profile and the ideas board (all public reads, supabase/functions/api/guest.ts). Any other address waits
 * until they are in (signed in or a guest), then opens.
 */
export const OPEN_TO_ALL: readonly string[] = [...PUBLIC_PAGES, 'taskDetail', 'publicProfile', 'ideas'];

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
  orders: 'My Work',
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
 * The addresses the website serves as files of their own (plan 3.6, T13 point 8): Home, /get and the public pages.
 * Must match ROUTE_PAGES in apps/mobile/scripts/web-route-pages.mjs (web-route-pages.test.mjs checks). The app
 * screens (APP_ROUTE_PATTERNS) get index.html through a Cloudflare _redirects rule. Anything else is "Page not
 * found": the app shows NotFound, and Cloudflare sends dist/404.html with status 404.
 */
export const KNOWN_PATHS: readonly string[] = ['/', '/get', ...PUBLIC_PAGES.map((p) => `/${p}`)];

/**
 * True for an address the website answers: the files above (with or without a trailing slash, or /index.html) and
 * every app address (routeFromAddress). Case counts, as on Cloudflare (/Terms is a 404 there too).
 */
export function isKnownPath(pathname: string | null | undefined): boolean {
  const path = clean(pathname ?? '');
  return path === '/index.html' || KNOWN_PATHS.includes(path) || routeFromAddress(path) !== null;
}
