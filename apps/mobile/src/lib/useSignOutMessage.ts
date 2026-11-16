import { useEffect, useState } from 'react';
import { verificationState } from '../data/extras';
import { signOutMessage, type SignInMethods } from './signOutText';

/** The sign-out dialog's words, read when the dialog opens (W2-16). `username`: the profile's, if it has one. */
export function useSignOutMessage(open: boolean, username: string | null | undefined): string {
  const [methods, setMethods] = useState<SignInMethods | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void verificationState()
      .then((v) => alive && setMethods({ phone: v.phone, google: v.google, username: Boolean(username) }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, username]);
  return signOutMessage(methods);
}
