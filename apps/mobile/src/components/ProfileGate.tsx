import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text as RNText, View } from 'react-native';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { getProfile } from '../data/api';
import { messageOf } from '../lib/errors';
import { PrimaryButton } from './kit';
import { tx } from './primitives';

/** After this long without an answer, say it is slow instead of staying silent (L1-21; reads give up near 46 s). */
export const SLOW_PROFILE_MS = 8000;

/**
 * Between the providers and the app. A signed-in person's first profile read decides the avatar, the area and
 * the Hire/Earn content on Home. While it is slow or failing, a cover with a loading line and a "Try again"
 * button sits over the app, so a signed-in person never looks like a guest ("?" avatar, "Set your location"
 * -- L1-21, L2-12). The app stays mounted underneath, so navigation and sign-in state are never reset.
 */
export function ProfileGate({ children }: { children: ReactNode }) {
  const { ready, session } = useAuth();
  const t = useTheme();
  const userId = session?.user.id ?? null;
  // Which person's profile has been read once. After that the app is never covered again.
  const [readFor, setReadFor] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ready || !userId || readFor === userId) return;
    let alive = true;
    setFailed(null);
    setSlow(false);
    const timer = setTimeout(() => alive && setSlow(true), SLOW_PROFILE_MS);
    getProfile(userId, attempt > 0 ? { fresh: true } : {})
      .then(() => alive && setReadFor(userId))
      .catch((e) => alive && setFailed(messageOf(e, 'Could not load your profile.')))
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ready, userId, readFor, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const covered = ready && !!userId && readFor !== userId;

  return (
    <View style={{ flex: 1 }}>
      {children}
      {covered ? (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32, zIndex: 1000 }]}
          accessibilityLiveRegion="polite"
        >
          {failed ? (
            <>
              <RNText style={tx('700', 18, t.colors.ink, { textAlign: 'center' })}>Could not load your account</RNText>
              <RNText style={tx('400', 14, t.colors.muted, { textAlign: 'center', marginTop: 8, marginBottom: 20 })}>{failed}</RNText>
              <PrimaryButton label="Try again" onPress={retry} />
            </>
          ) : (
            <>
              <ActivityIndicator color={t.colors.accent} />
              <RNText style={tx('600', 15, t.colors.ink, { textAlign: 'center', marginTop: 16 })}>
                {slow ? 'Slow today, still trying' : 'Loading your account'}
              </RNText>
              {slow ? (
                <RNText style={tx('400', 13, t.colors.muted, { textAlign: 'center', marginTop: 6 })}>
                  Your tasks are safe. This can take a moment on a slow connection.
                </RNText>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}
