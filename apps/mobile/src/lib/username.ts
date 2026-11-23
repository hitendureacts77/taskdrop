/**
 * Plan 1.18 (decision 51): everyone who is signed in has a username. A guest (not signed in) has none and is never
 * asked; the rule starts once the guest makes an account. The rules here are the onboarding ones, shared by setup,
 * the "Pick a username" gate and Account. Pure, so it can be unit tested.
 */

/** 3 to 20 characters: a to z, 0 to 9 and _ (the database's profiles_username_format). */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** What the username box keeps of what was typed: lowercase letters, numbers and _, at most 20. */
export const cleanUsername = (v: string): string => v.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase().slice(0, 20);

export const usernameFormatOk = (u: string): boolean => USERNAME_RE.test(u);

type ProfileBits = { onboarded_at?: string | null; username?: string | null } | null | undefined;

export const hasUsername = (p: ProfileBits): boolean => typeof p?.username === 'string' && p.username.length > 0;

/** Where a person lands after signing in: setup on a first run, the username gate when setup ended without one. */
export type SignInRoute = 'home' | 'setup' | 'username';

export function signInRouteFor(p: ProfileBits): SignInRoute {
  if (!p?.onboarded_at) return 'setup';
  return hasUsername(p) ? 'home' : 'username';
}

/**
 * Screens the gate never covers: the sign-in pages, setup (it asks for the username itself), the gate, and the
 * public pages anyone may read.
 */
export const GATE_FREE_SCREENS: readonly string[] = [
  'splash',
  'intro',
  'welcome',
  'signup',
  'setup',
  'pickUsername',
  'terms',
  'privacy',
  'support',
  'copyright',
];

/**
 * Whether the "Pick a username" page must open over `screen`. Only a profile that was read and has no username
 * opens it: a profile that could not be read (null) never does, so a network blip does not lock anyone out.
 */
export function gateShouldOpen(screen: string, p: ProfileBits): boolean {
  if (GATE_FREE_SCREENS.includes(screen)) return false;
  return p != null && !hasUsername(p);
}
