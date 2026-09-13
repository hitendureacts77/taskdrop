import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * Real Supabase auth, driven by the phone-auth Edge Function.
 *
 * The project has no SMS gateway, so the function returns the code it generated
 * (`devCode`) and the Signup screen's Autofill button fills it in. Verifying
 * swaps a one-time token for a genuine session, which supabase-js then persists
 * and refreshes on its own.
 */

type AuthCtx = {
  session: Session | null;
  userId: string | null;
  ready: boolean;
  /** Ask for a code. Returns the code while there's no SMS provider. */
  requestCode: (phone: string) => Promise<{ devCode?: string }>;
  /** Verify the code and start a session. */
  verifyCode: (phone: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/phone-auth`;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

async function callFn(body: Record<string, unknown>) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(json.error ?? 'Something went wrong'));
  return json;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const requestCode = useCallback(async (phone: string) => {
    const out = await callFn({ action: 'send', phone });
    return { devCode: typeof out.devCode === 'string' ? out.devCode : undefined };
  }, []);

  const verifyCode = useCallback(async (phone: string, code: string) => {
    const out = await callFn({ action: 'verify', phone, code });
    const tokenHash = String(out.token_hash ?? '');
    if (!tokenHash) throw new Error('Could not start a session');
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      userId: session?.user?.id ?? null,
      ready,
      requestCode,
      verifyCode,
      signOut,
    }),
    [session, ready, requestCode, verifyCode, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside AuthProvider');
  return c;
}
