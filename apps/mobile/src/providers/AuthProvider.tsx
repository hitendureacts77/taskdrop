import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { postSignInRoute } from '../data/api';

/**
 * Real Supabase auth: phone OTP via the phone-auth Edge Function, or Google
 * OAuth straight through Supabase.
 *
 * The OTP code arrives by SMS (MSG91, sent server-side). `devCode` comes back
 * only for numbers on the server's TEST_PHONES allowlist, or for every number
 * while the server's development switch is on and SMS is not configured. Verifying swaps a one-time token for a
 * genuine session, which supabase-js then persists and refreshes on its own.
 */

type AuthCtx = {
  session: Session | null;
  userId: string | null;
  ready: boolean;
  /**
   * Set once, right when a Google sign-in completes on web -- the redirect
   * back is a full page load, so nothing in SignupScreen survives it to route
   * onward the way verifyCode's caller does. Consumed once by Routes(); a
   * restored session on a normal cold start leaves this null.
   */
  postAuthRoute: 'home' | 'setup' | null;
  /**
   * Ask for a code. `mode` lets the server stop at the wrong door before any
   * code is made: 'signup' with a number that has an account, or 'signin'
   * with one that has none, rejects with an AuthError saying which. Hands a
   * code back only in development (see phone-auth).
   */
  requestCode: (phone: string, mode?: 'signin' | 'signup') => Promise<{ devCode?: string }>;
  /**
   * Verify the code and start a session. `mode` decides whether an unknown
   * number may be registered: 'signup' creates, 'signin' refuses. Resolves
   * with whether the account was created just now.
   */
  verifyCode: (
    phone: string,
    code: string,
    mode?: 'signin' | 'signup',
  ) => Promise<{ isNew: boolean }>;
  /** Start Google sign-in. Resolves on native once a session exists; on web
   *  the page navigates away and this never resolves. `intent` is which
   *  door was used: from "Create account", an account that already existed
   *  is signed in with a notice saying so. */
  signInWithGoogle: (intent?: 'signin' | 'signup') => Promise<void>;
  /** A one-off message for the person, e.g. "account already exists". */
  notice: string | null;
  clearNotice: () => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/phone-auth`;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** A phone-auth refusal, with which wrong door it was. */
export class AuthError extends Error {
  accountExists: boolean;
  noAccount: boolean;
  constructor(message: string, flags: { accountExists?: unknown; noAccount?: unknown }) {
    super(message);
    this.accountExists = flags.accountExists === true;
    this.noAccount = flags.noAccount === true;
  }
}

async function callFn(body: Record<string, unknown>) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new AuthError(String(json.error ?? 'Something went wrong'), json);
  return json;
}

const GOOGLE_INTENT_KEY = 'td:google-intent';
const EXISTING_GOOGLE =
  'You already have a TaskDrop account with this Google ID, so we signed you in.';

/** Made more than a minute ago: an account that existed before this sign-in. */
function existedBefore(createdAt: string | undefined): boolean {
  return Boolean(createdAt) && Date.now() - new Date(createdAt!).getTime() > 60_000;
}

WebBrowser.maybeCompleteAuthSession();

/**
 * exchangeCodeForSession, with a couple of retries kept as a defensive
 * margin against a `flow_state_not_found` 404.
 *
 * The actual bug that produced this error on every attempt was passing the
 * whole page URL as the auth code instead of just the `?code=` value --
 * exchangeCodeForSession posts its argument to GoTrue as `auth_code`
 * verbatim, it does not parse a URL, so the lookup was for a flow_state row
 * that could never exist. Fixed at both call sites. This retry stays as
 * cheap insurance against a genuine transient miss, not the primary fix.
 */
async function exchangeCodeForSessionWithRetry(code: string, attempts = 3, delayMs = 600) {
  let last: Awaited<ReturnType<typeof supabase.auth.exchangeCodeForSession>>;
  for (let i = 0; i < attempts; i++) {
    last = await supabase.auth.exchangeCodeForSession(code);
    if (!last.error || last.error.code !== 'flow_state_not_found') return last;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return last!;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [postAuthRoute, setPostAuthRoute] = useState<'home' | 'setup' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Google lands back here on the web with a one-time `?code=` in the
      // URL -- detectSessionInUrl is off (see createBrowserClient, which
      // otherwise has no URL to detect on native), so it has to be picked up
      // by hand. Scrubbed from the URL immediately after, or a page refresh
      // or a "back" tap would try to redeem the same code twice and fail.
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const oauthError = params.get('error_description') ?? params.get('error');
        if (oauthError || code) {
          // Strip the code from the URL before awaiting anything below. A
          // GoTrue authorization code is single-use -- a second effect firing
          // (React 18/19 double-invoke Google's redirect back into in dev
          // mode, a duplicate provider left behind by Fast Refresh) must find
          // nothing left to resend, or its retry 404s with
          // flow_state_not_found and races the real exchange. This runs
          // synchronously, before the first `await` below, so it always wins
          // that race.
          window.history.replaceState({}, '', window.location.pathname);
        }
        if (oauthError) {
          // GoTrue redirects errors back as query params rather than raising
          // in the client -- there is nothing here to catch, so this is the
          // only place that ever sees a rejected redirect_to, a cancelled
          // consent, or a provider-side failure.
          console.error('[auth] Google sign-in returned an error:', oauthError);
        } else if (code) {
          // exchangeCodeForSession posts this argument as-is as `auth_code`
          // -- it does not parse a URL, so this must be the bare code, not
          // the page's href. Passing the full URL here (an earlier bug) sent
          // GoTrue a lookup for a flow_state whose auth_code was literally
          // the whole "http://localhost:.../?code=..." string, which could
          // never match any row -- every attempt failed with
          // flow_state_not_found for this reason alone, not a timing issue.
          const { error } = await exchangeCodeForSessionWithRetry(code);
          if (error) {
            console.error('[auth] exchangeCodeForSession failed:', error.code, error.message);
          } else if (alive) {
            const { data } = await supabase.auth.getUser();
            let intent: string | null = null;
            try {
              intent = window.sessionStorage.getItem(GOOGLE_INTENT_KEY);
              window.sessionStorage.removeItem(GOOGLE_INTENT_KEY);
            } catch {
              /* storage blocked: no notice, still signed in */
            }
            if (intent === 'signup' && existedBefore(data.user?.created_at)) setNotice(EXISTING_GOOGLE);
            setPostAuthRoute(await postSignInRoute(data.user?.id ?? ''));
          }
        }
      }
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setSession(data.session);
      setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const requestCode = useCallback(async (phone: string, mode?: 'signin' | 'signup') => {
    const out = await callFn({ action: 'send', phone, mode });
    return { devCode: typeof out.devCode === 'string' ? out.devCode : undefined };
  }, []);

  const verifyCode = useCallback<AuthCtx['verifyCode']>(async (phone, code, mode = 'signup') => {
    // The mode matters server-side: only 'signup' is allowed to create an
    // account, so verifying in 'signin' mode against an unknown number fails
    // with "No account found" instead of silently registering it.
    const out = await callFn({ action: 'verify', phone, code, mode });
    const tokenHash = String(out.token_hash ?? '');
    if (!tokenHash) throw new Error('Could not start a session');
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
    if (error) throw new Error(error.message);
    return { isNew: out.isNew === true };
  }, []);

  const signInWithGoogle = useCallback(async (intent: 'signin' | 'signup' = 'signin') => {
    const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';
    const redirectTo = isWeb ? window.location.origin : Linking.createURL('auth-callback');

    if (isWeb) {
      // The page reloads on the way back, so the door used is carried over.
      try {
        window.sessionStorage.setItem(GOOGLE_INTENT_KEY, intent);
      } catch {
        /* storage blocked: no notice later, sign-in still works */
      }
      // A same-tab redirect to Google and back, same as any "Continue with
      // Google" button -- this app reloads from scratch when it lands.
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (error) throw new Error(error.message);
      return;
    }

    // Native has no browser chrome to redirect within, so the OAuth page
    // opens in a system browser tab that hands control back via `redirectTo`
    // once Google is done -- the app itself never navigates away.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw new Error(error.message);
    if (!data?.url) throw new Error('Could not start Google sign-in');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !('url' in result)) {
      throw new Error('Sign-in was cancelled');
    }
    // Same bare-code requirement as the web path above.
    const returnedCode = new URL(result.url).searchParams.get('code');
    if (!returnedCode) throw new Error('Google did not return a code');
    const { data: exchanged, error: exchangeError } = await exchangeCodeForSessionWithRetry(returnedCode);
    if (exchangeError) throw new Error(exchangeError.message);
    if (intent === 'signup' && existedBefore(exchanged.user?.created_at)) setNotice(EXISTING_GOOGLE);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      userId: session?.user?.id ?? null,
      ready,
      postAuthRoute,
      requestCode,
      verifyCode,
      signInWithGoogle,
      signOut,
      notice,
      clearNotice,
    }),
    [session, ready, postAuthRoute, requestCode, verifyCode, signInWithGoogle, signOut, notice, clearNotice],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside AuthProvider');
  return c;
}
