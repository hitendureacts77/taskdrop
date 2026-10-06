import React, { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated, ScrollView, Image } from 'react-native';
import { Screen } from '../components/ui';
import { useTheme, useThemeControls } from '../providers/ThemeProvider';
import { useNav, type ScreenName, useFocusTick } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useSwitchMode } from '../lib/useSwitchMode';
import { useAuth } from '../providers/AuthProvider';
import { getProfile, listReviewsAbout, type Profile, type Review } from '../data/api';
import { signedMediaUrl } from '../lib/media';
import { tx } from '../components/primitives';
import { Icon, type IconName } from '../components/Icon';
import { ConfirmDialog } from '../components/kit';

function SlideIn({ delay, children }: { delay: number; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(v, { toValue: 1, duration: 340, delay, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [v, delay]);
  return (
    <Animated.View
      style={{
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

// The account pages both sides share. Anything already a tab (wallet, my
// tasks) or a header icon (messages, notifications) is not repeated here.
const SHARED_ROWS: { icon: IconName; label: string; go: ScreenName }[] = [
  { icon: 'edit' as IconName, label: 'Edit my profile', go: 'profileEdit' },
  { icon: 'gavel' as IconName, label: 'My complaints', go: 'disputes' },
  { icon: 'settings' as IconName, label: 'Account & settings', go: 'account' },
  { icon: 'help' as IconName, label: 'Help & support', go: 'help' },
];

const WORKER_ROWS: { icon: IconName; label: string; go: ScreenName }[] = [
  { icon: 'briefcase' as IconName, label: 'Work for you', go: 'myQuotes' },
  { icon: 'bolt' as IconName, label: 'Promote my service', go: 'promote' },
  { icon: 'bookmark' as IconName, label: 'Saved tasks', go: 'saved' },
  ...SHARED_ROWS,
  { icon: 'logout' as IconName, label: 'Sign out', go: 'splash' },
];

const POSTER_ROWS: { icon: IconName; label: string; go: ScreenName }[] = [
  { icon: 'bolt' as IconName, label: 'Promote a request', go: 'promote' },
  ...SHARED_ROWS,
  { icon: 'logout' as IconName, label: 'Sign out', go: 'splash' },
];


/** '3 Sep' — the short form the design's review rows use. */
function formatReviewDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function ProfileScreen() {
  const t = useTheme();
  const { pref, setPref } = useThemeControls();
  const { go, reset } = useNav();
  const { mode } = useMode();
  // Earn needs a worker profile first; this opens setup when it is missing.
  const switchMode = useSwitchMode();

  const worker = mode === 'worker';
  // The header band takes the side's colour: deep blue for earning, deep green for posting.
  const band = worker ? (t.isDark ? '#0C1A4D' : '#1E3A8A') : t.isDark ? '#062B1E' : '#0B3D2C';

  // Mode slider: "Post a Request" left, "Find Work" right.
  const slide = useRef(new Animated.Value(worker ? 1 : 0)).current;
  useEffect(() => {
    const anim = Animated.timing(slide, {
      toValue: worker ? 1 : 0,
      duration: 320,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [worker, slide]);

  const { userId, signOut } = useAuth();
  const focusTick = useFocusTick();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  // The bucket is private, so the stored path has to be signed before an
  // <Image> can load it. Null just means we fall back to the initial.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  // A worker sees their earnings here. A customer's spending is deliberately
  // not on the profile, where it would be in front of them every visit: it
  // lives under Account & settings → App, for whoever goes looking.
  const rows = worker
    ? [{ icon: 'trending' as IconName, label: 'My earnings and jobs', go: 'analytics' as ScreenName }, ...WORKER_ROWS]
    : POSTER_ROWS;

  // Poster and worker reputations are separate, so re-fetch when the mode flips.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void (async () => {
      try {
        const [p, r] = await Promise.all([
          getProfile(userId),
          listReviewsAbout(userId, worker ? 'worker' : 'poster'),
        ]);
        if (!alive) return;
        setProfile(p);
        setReviews(r);
        if (p?.avatar_url) {
          const url = await signedMediaUrl(p.avatar_url);
          if (alive) setAvatarUrl(url);
        } else {
          setAvatarUrl(null);
        }
      } catch {
        /* leave the header on its placeholders */
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId, worker, focusTick]);

  const displayName = profile?.display_name ?? 'Your profile';
  const ratingAvg = worker ? profile?.worker_rating_avg : profile?.poster_rating_avg;
  const ratingCount = worker ? profile?.worker_rating_count : profile?.poster_rating_count;
  const initial = displayName.trim().charAt(0).toUpperCase() || '?';

  // A brand-new account has no rating yet — say so rather than showing 0.0.
  const roleLine =
    ratingCount && ratingCount > 0
      ? '★ ' + Number(ratingAvg ?? 0).toFixed(1) + (worker ? ' worker · ' : ' customer · ') + ratingCount +
        (worker ? (ratingCount === 1 ? ' job done' : ' jobs done') : (ratingCount === 1 ? ' request' : ' requests'))
      : worker
        ? 'New worker · no reviews yet'
        : 'New customer · no reviews yet';
  const themeNote =
    pref === 'system' ? `Following your device · currently ${t.isDark ? 'dark' : 'light'}` : 'Set by you';

  return (
    <Screen padded={false}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* Band header */}
        <View style={{ backgroundColor: band, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 26 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 999,
                backgroundColor: 'rgba(255,255,255,0.12)',
                borderWidth: 2,
                borderColor: 'rgba(255,255,255,0.18)',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={{ width: '100%', height: '100%' }} />
              ) : (
                <RNText style={tx('800', 23, '#FFFFFF')}>{initial}</RNText>
              )}
            </View>
            {/* You have the app open, so you're active -- shown the way others see it. */}
            <View style={{ position: 'absolute', left: 50, top: 48, width: 15, height: 15, borderRadius: 999, backgroundColor: '#22C55E', borderWidth: 2.5, borderColor: band }} />
            <View>
              <RNText style={tx('800', 21, '#FFFFFF', { letterSpacing: -0.42 })} numberOfLines={1}>
                {displayName}
              </RNText>
              <RNText style={tx('400', 13, 'rgba(255,255,255,0.78)', { marginTop: 4 })}>
                {roleLine}
              </RNText>
              <RNText style={tx('600', 12, '#86EFAC', { marginTop: 4 })}>● Active now</RNText>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 }}>
          <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54 })}>MODE</RNText>
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              marginTop: 11,
              backgroundColor: t.colors.surface2,
              borderRadius: 12,
              padding: 4,
              position: 'relative',
            }}
          >
            <Animated.View
              style={{
                position: 'absolute',
                top: 4,
                bottom: 4,
                width: '50%',
                left: slide.interpolate({ inputRange: [0, 1], outputRange: ['0%', '50%'] }),
                backgroundColor: t.colors.bg,
                borderRadius: 9,
              }}
            />
            {(['poster', 'worker'] as const).map((m) => {
              const on = mode === m;
              return (
                <Pressable key={m} onPress={() => void switchMode(m)} style={{ flex: 1, paddingVertical: 11 }}>
                  <RNText
                    style={tx('700', 14, on ? t.colors.ink : t.colors.muted, { textAlign: 'center' })}
                  >
                    {m === 'poster' ? 'Post a Request' : 'Find Work'}
                  </RNText>
                </Pressable>
              );
            })}
          </View>
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 9, lineHeight: 18 })}>
            {worker ? 'You browse tasks and send offers.' : 'You post requests and pick a worker.'}
          </RNText>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginTop: 22,
            }}
          >
            <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54 })}>THEME</RNText>
            <RNText style={tx('400', 11, t.colors.muted)}>{themeNote}</RNText>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 11 }}>
            {(['system', 'light', 'dark'] as const).map((p) => {
              const on = pref === p;
              return (
                <Pressable
                  key={p}
                  onPress={() => setPref(p)}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: 10,
                    paddingVertical: 10,
                    backgroundColor: on ? t.colors.accentSoft : 'transparent',
                    borderWidth: 1,
                    borderColor: on ? t.colors.accent : t.colors.line,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  })}
                >
                  <RNText
                    style={tx('600', 13, on ? t.colors.ink : t.colors.muted, { textAlign: 'center' })}
                  >
                    {p === 'system' ? 'System' : p === 'light' ? 'Light' : 'Dark'}
                  </RNText>
                </Pressable>
              );
            })}
          </View>

          <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 22 })}>
            MY TASKDROP
          </RNText>
          {rows.map((r) => (
            <Pressable
              key={r.label}
              onPress={() => {
                if (r.go !== 'splash') return go(r.go);
                setConfirmSignOut(true);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 15,
                paddingVertical: 15,
                borderBottomWidth: 1,
                borderBottomColor: t.colors.line,
                transform: [{ scale: pressed ? 0.985 : 1 }],
              })}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 11,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: r.go === 'splash' ? t.colors.signalSoft : t.colors.surface2,
                }}
              >
                <Icon name={r.icon} size={18} color={r.go === 'splash' ? t.colors.signal : t.colors.ink} strokeWidth={1.8} />
              </View>
              <RNText
                style={tx('600', 16, r.go === 'splash' ? t.colors.signal : t.colors.ink, { flex: 1 })}
              >
                {r.label}
              </RNText>
              <Icon name="chevronRight" size={16} color={t.colors.muted} />
            </Pressable>
          ))}

          <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 22 })}>
            {worker ? 'WORKER REVIEWS' : 'CUSTOMER REVIEWS'}
          </RNText>
          {reviews.length === 0 && (
            <RNText style={tx('400', 13, t.colors.muted, { marginTop: 12, lineHeight: 19.5 })}>
              {worker
                ? 'Finish a job and the customer’s review shows up here.'
                : 'Post a request and the worker’s review shows up here.'}
            </RNText>
          )}
          {reviews.map((r, i) => (
            <SlideIn key={r.id} delay={i * 80}>
              <View
                style={{
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: t.colors.line,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <RNText style={tx('700', 13, t.colors.ink)}>{r.author?.display_name ?? 'Someone'}</RNText>
                  <RNText style={tx('400', 12, t.colors.accentDeep)}>★ {r.rating.toFixed(1)}</RNText>
                  <RNText style={tx('400', 11, t.colors.muted, { marginLeft: 'auto' })}>
                    {formatReviewDate(r.created_at)}
                  </RNText>
                </View>
                {r.comment ? (
                  <RNText style={tx('400', 13, t.colors.muted, { marginTop: 6, lineHeight: 19.5 })}>
                    {r.comment}
                  </RNText>
                ) : null}
              </View>
            </SlideIn>
          ))}
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={confirmSignOut}
        danger
        icon="logout"
        title="Sign out of TaskDrop?"
        message="You’ll need your phone number or Google account to sign back in. Your tasks and wallet stay safe."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          // Actually end the session, not just go back to the splash screen.
          void signOut()
            .catch(() => {})
            .finally(() => reset('splash'));
        }}
      />
    </Screen>
  );
}
