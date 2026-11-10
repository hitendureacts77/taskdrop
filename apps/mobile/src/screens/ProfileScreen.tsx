import React, { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Avatar, Screen, cardSurface } from '../components/ui';
import { useTheme, useThemeControls } from '../providers/ThemeProvider';
import { useNav, type ScreenName, useFocusTick } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useSwitchMode } from '../lib/useSwitchMode';
import { useAuth } from '../providers/AuthProvider';
import { getProfile, listReviewsAbout, myRegulars, type Profile, type Regular, type Review } from '../data/api';
import { verificationState } from '../data/extras';
import { imageSource, signedMediaUrl } from '../lib/media';
import { tx } from '../components/primitives';
import { Icon, type IconName } from '../components/Icon';
import { ConfirmDialog } from '../components/kit';
import { AppHeader } from '../components/AppHeader';
import { HeroBackground } from '../components/Hero';
import { Ripples } from '../components/Ripples';
import { GuestNote } from '../components/GuestBits';
import { startTour } from '../components/tour/tourStore';
import { TOUR_COPY } from '../lib/tour';
import { needAccount } from '../lib/guest';

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

// The account pages both sides share, grouped as one card. Anything already a
// tab (wallet, my tasks) or a header icon (messages, notifications) is not
// repeated here. Terms, Privacy and Sign out sit in a line of links below.
type MenuRow = { icon: IconName; label: string; go: ScreenName; act?: () => void };

const SHARED_ROWS: MenuRow[] = [
  { icon: 'edit' as IconName, label: 'Edit my profile', go: 'profileEdit' },
  { icon: 'gavel' as IconName, label: 'My complaints', go: 'disputes' },
  { icon: 'trending' as IconName, label: 'Ideas & feedback', go: 'ideas' },
  { icon: 'help' as IconName, label: 'Help & support', go: 'help' },
  { icon: 'settings' as IconName, label: 'Account & settings', go: 'account' },
];

const WORKER_ROWS: MenuRow[] = [
  { icon: 'briefcase' as IconName, label: 'Work for you', go: 'myQuotes' },
  { icon: 'trophy' as IconName, label: 'Streaks and badges', go: 'streaks' },
  { icon: 'bolt' as IconName, label: 'Promote my service', go: 'promote' },
  { icon: 'bookmark' as IconName, label: 'Saved tasks', go: 'saved' },
  ...SHARED_ROWS,
];

const POSTER_ROWS: MenuRow[] = [
  { icon: 'heart' as IconName, label: 'My regulars', go: 'regulars' },
  { icon: 'bolt' as IconName, label: 'Promote a request', go: 'promote' },
  ...SHARED_ROWS,
];

/** How much of the profile is filled in, and the one next thing missing (only fields the profile already has). */
function profileProgress(
  p: Profile,
  worker: boolean,
): { done: number; total: number; next: { label: string; hint: string } | null } {
  const steps = [
    { ok: !!p.avatar_url, label: 'Add a photo', hint: 'A face helps people trust you.' },
    { ok: !!p.loc_label, label: 'Add your area', hint: 'Shows tasks and people close to you.' },
    {
      ok: !!(worker ? p.worker_bio : p.bio)?.trim(),
      label: 'Write a line about you',
      hint: worker ? 'Customers read this before they pick you.' : 'Helpers read this before they send an offer.',
    },
    ...(worker ? [{ ok: (p.skills ?? []).length > 0, label: 'Add your skills', hint: 'So the right tasks find you.' }] : []),
  ];
  return { done: steps.filter((x) => x.ok).length, total: steps.length, next: steps.find((x) => !x.ok) ?? null };
}

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
  // The header band takes the side's colour (the hero gradient): blue for
  // earning, jade for posting.
  const band = t.colors.heroMid;

  const { userId, guest, signOut } = useAuth();
  const focusTick = useFocusTick();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  // The bucket is private, so the stored path has to be signed before an
  // <Image> can load it. Null just means we fall back to the initial.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [regulars, setRegulars] = useState<Regular[]>([]);
  const [verified, setVerified] = useState<{ phone: boolean; email: boolean } | null>(null);

  // A worker sees their earnings here. A customer's spending is deliberately
  // not on the profile, where it would be in front of them every visit: it
  // lives under Account & settings → App, for whoever goes looking.
  const memberRows: MenuRow[] = worker
    ? [{ icon: 'trending' as IconName, label: 'My earnings and jobs', go: 'analytics' as ScreenName }, ...WORKER_ROWS]
    : POSTER_ROWS;
  // A guest keeps Help, the tour and feedback; the rest is about an account they do not have yet.
  const guestRows: MenuRow[] = [
    { icon: 'edit', label: 'Edit my profile', go: 'profileEdit', act: () => needAccount('profile') },
    { icon: 'sparkle', label: TOUR_COPY.menuLabel, go: 'profile', act: () => startTour(worker ? 'earn' : 'hire') },
    { icon: 'trending', label: 'Ideas & feedback', go: 'ideas' },
    { icon: 'help', label: 'Help & support', go: 'help' },
  ];
  const rows: MenuRow[] = guest ? guestRows : memberRows;

  // Poster and worker reputations are separate, so re-fetch when the mode flips.
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setReviews([]);
      return;
    }
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
          const url = await signedMediaUrl(p.avatar_url, 'card');
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

  // The regulars row is the poster's; the check chips say what is verified today.
  useEffect(() => {
    if (!userId || guest) return;
    let alive = true;
    void myRegulars()
      .then((r) => alive && setRegulars(r))
      .catch(() => {});
    void verificationState()
      .then((v) => alive && setVerified(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, guest, focusTick]);

  const displayName = guest ? 'Guest' : (profile?.display_name ?? 'Your profile');
  const ratingAvg = worker ? profile?.worker_rating_avg : profile?.poster_rating_avg;
  const ratingCount = worker ? profile?.worker_rating_count : profile?.poster_rating_count;
  const initial = displayName.trim().charAt(0).toUpperCase() || '?';

  // The rating for the side you are on, as others see it. A brand-new account
  // has none yet: say so rather than showing 0.0.
  const hasRating = !!ratingCount && ratingCount > 0;
  const ratingLine = guest
    ? 'Looking around'
    : hasRating
      ? '★ ' + Number(ratingAvg ?? 0).toFixed(1) + (worker ? ' as a helper' : ' as a poster')
      : worker
        ? 'New helper · no reviews yet'
        : 'New poster · no reviews yet';
  const doneLine =
    !guest && hasRating
      ? ratingCount + (ratingCount === 1 ? ' review' : ' reviews')
      : null;
  const progress = profile && !guest ? profileProgress(profile, worker) : null;
  const themeNote =
    pref === 'system' ? `Following your device · currently ${t.isDark ? 'dark' : 'light'}` : 'Set by you';

  const chips: string[] = [];
  if (!guest) {
    if (verified?.phone) chips.push('Phone checked');
    if (profile?.loc_label) chips.push(profile.loc_label);
  }

  const sectionLabel = (text: string, extra?: object) => (
    <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, ...extra })}>{text}</RNText>
  );

  return (
    <Screen padded={false}>
      <AppHeader />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* Band header: you as others see you */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 22,
            borderBottomLeftRadius: 28,
            borderBottomRightRadius: 28,
            overflow: 'hidden',
          }}
        >
          <HeroBackground radius={0} />
          <View pointerEvents="none" style={{ position: 'absolute', right: -30, top: -40, width: 180, height: 180, alignItems: 'center', justifyContent: 'center' }}>
            <Ripples color="rgba(255,255,255,0.35)" size={180} count={2} duration={4200} />
          </View>
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
                <Image source={imageSource(avatarUrl)} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <RNText style={tx('800', 23, '#FFFFFF')}>{initial}</RNText>
              )}
            </View>
            {/* You have the app open, so you're active -- shown the way others see it. */}
            <View style={{ position: 'absolute', left: 50, top: 48, width: 15, height: 15, borderRadius: 999, backgroundColor: '#4ADE9A', borderWidth: 2.5, borderColor: band }} />
            <View style={{ flex: 1 }}>
              <RNText style={tx('800', 22, '#FFFFFF', { letterSpacing: -0.5 })} numberOfLines={1}>
                {displayName}
              </RNText>
              <RNText style={tx('600', 13, 'rgba(255,255,255,0.88)', { marginTop: 4 })}>
                {ratingLine}
                {doneLine ? ' · ' + doneLine : ''}
              </RNText>
              <RNText style={tx('600', 12, '#86EFAC', { marginTop: 4 })}>● Active now</RNText>
            </View>
          </View>
          {chips.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {chips.map((c) => (
                <View
                  key={c}
                  style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' }}
                >
                  <RNText style={tx('700', 11.5, '#FFFFFF')}>{c}</RNText>
                </View>
              ))}
            </View>
          ) : null}
          {userId && !guest ? (
            <Pressable
              onPress={() => go('publicProfile', { userId, role: worker ? 'worker' : 'poster' })}
              accessibilityRole="link"
              accessibilityLabel="See your profile as others see it"
              hitSlop={8}
              style={{ alignSelf: 'flex-start', marginTop: 14 }}
            >
              <RNText style={tx('700', 13, '#FFFFFF')}>See as others ›</RNText>
            </Pressable>
          ) : null}
        </View>

        {guest ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
            <GuestNote />
          </View>
        ) : null}

        <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 }}>
          {sectionLabel('MODE')}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 11 }}>
            {(['poster', 'worker'] as const).map((m) => {
              const on = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => void switchMode(m)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: 18,
                    paddingVertical: 16,
                    paddingHorizontal: 12,
                    backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
                    borderWidth: 2,
                    borderColor: on ? t.colors.accent : t.colors.line,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  })}
                >
                  <RNText style={tx('800', 15, on ? t.colors.accentDeep : t.colors.ink, { textAlign: 'center' })}>
                    {m === 'poster' ? 'Getting things done' : 'Earning money'}
                  </RNText>
                  <RNText style={tx('700', 12, on ? t.colors.accentDeep : t.colors.muted, { textAlign: 'center', marginTop: 3 })}>
                    {m === 'poster' ? 'Hire' : 'Earn'}
                  </RNText>
                </Pressable>
              );
            })}
          </View>
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 9, lineHeight: 18 })}>
            {worker ? 'You browse tasks and send offers.' : 'You post requests and pick a worker.'}
          </RNText>

          {progress && progress.next ? (
            <View style={{ ...cardSurface(t, 18), padding: 16, marginTop: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <RNText style={tx('800', 15, t.colors.ink)}>Finish your profile</RNText>
                <RNText style={tx('700', 12, t.colors.muted)}>
                  {progress.done} of {progress.total}
                </RNText>
              </View>
              <View style={{ height: 6, borderRadius: 999, backgroundColor: t.colors.surface2, marginTop: 10, overflow: 'hidden' }}>
                <View
                  style={{
                    height: '100%',
                    width: `${Math.round((progress.done / progress.total) * 100)}%`,
                    backgroundColor: t.colors.accent,
                    borderRadius: 999,
                  }}
                />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 }}>
                <View style={{ flex: 1 }}>
                  <RNText style={tx('700', 14, t.colors.ink)}>{progress.next.label}</RNText>
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2, lineHeight: 17 })}>{progress.next.hint}</RNText>
                </View>
                <Pressable
                  onPress={() => go('profileEdit')}
                  accessibilityRole="button"
                  accessibilityLabel={progress.next.label}
                  style={({ pressed }) => ({
                    paddingHorizontal: 18,
                    height: 38,
                    borderRadius: 999,
                    backgroundColor: t.colors.btn,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <RNText style={tx('800', 13, t.colors.onBtn)}>Add</RNText>
                </Pressable>
              </View>
            </View>
          ) : null}

          {!worker && !guest && regulars.length > 0 ? (
            <View style={{ marginTop: 28 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                {sectionLabel('MY REGULARS')}
                <Pressable onPress={() => go('regulars')} hitSlop={8} accessibilityRole="link">
                  <RNText style={tx('700', 12, t.colors.accentDeep)}>See all ›</RNText>
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingTop: 12 }}>
                {regulars.map((r) => (
                  <Pressable
                    key={r.profile.id}
                    onPress={() => go('aiPost', { preferWorker: { id: r.profile.id, name: r.profile.display_name } })}
                    accessibilityRole="button"
                    accessibilityLabel={`Book ${r.profile.display_name} again`}
                    style={({ pressed }) => ({ width: 64, alignItems: 'center', opacity: pressed ? 0.8 : 1 })}
                  >
                    <Avatar name={r.profile.display_name} size={52} />
                    <RNText style={tx('600', 12, t.colors.ink, { marginTop: 6, textAlign: 'center' })} numberOfLines={1}>
                      {r.profile.display_name.split(' ')[0]}
                    </RNText>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={{ ...cardSurface(t, 18), marginTop: 28, paddingHorizontal: 14 }}>
            {rows.map((r, i) => (
              <Pressable
                key={r.label}
                onPress={() => (r.act ? r.act() : go(r.go))}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 15,
                  paddingVertical: 14,
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1,
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
                    backgroundColor: t.colors.surface2,
                  }}
                >
                  <Icon name={r.icon} size={18} color={t.colors.ink} strokeWidth={1.8} />
                </View>
                <RNText style={tx('600', 15.5, t.colors.ink, { flex: 1 })}>{r.label}</RNText>
                <Icon name="chevronRight" size={16} color={t.colors.muted} />
              </Pressable>
            ))}
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginTop: 28,
            }}
          >
            {sectionLabel('THEME')}
            <RNText style={tx('400', 12, t.colors.muted)}>{themeNote}</RNText>
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
                    borderRadius: 999,
                    paddingVertical: 10,
                    backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
                    borderWidth: 1.5,
                    borderColor: on ? t.colors.accent : t.colors.line,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  })}
                >
                  <RNText
                    style={tx(on ? '700' : '600', 13, on ? t.colors.accentDeep : t.colors.text, { textAlign: 'center' })}
                  >
                    {p === 'system' ? 'System' : p === 'light' ? 'Light' : 'Dark'}
                  </RNText>
                </Pressable>
              );
            })}
          </View>

          {guest ? null : sectionLabel(worker ? 'WORKER REVIEWS' : 'CUSTOMER REVIEWS', { marginTop: 32 })}
          {!guest && reviews.length === 0 && (
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

          {/* Terms, Privacy and Sign out: one small line of links. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 18, marginTop: 32, paddingVertical: 8 }}>
            <Pressable onPress={() => go('terms')} hitSlop={8} accessibilityRole="link">
              <RNText style={tx('600', 12.5, t.colors.muted)}>Terms</RNText>
            </Pressable>
            <Pressable onPress={() => go('privacy')} hitSlop={8} accessibilityRole="link">
              <RNText style={tx('600', 12.5, t.colors.muted)}>Privacy</RNText>
            </Pressable>
            {guest ? null : (
              <Pressable onPress={() => setConfirmSignOut(true)} hitSlop={8} accessibilityRole="button">
                <RNText style={tx('700', 12.5, t.colors.signalDeep)}>Sign out</RNText>
              </Pressable>
            )}
          </View>
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
