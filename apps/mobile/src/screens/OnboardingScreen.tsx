import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, Image, ActivityIndicator, Animated } from 'react-native';
import { Screen } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { Field, Pill, PrimaryButton } from '../components/kit';
import { LocationSheet } from '../components/LocationSheet';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { getProfile, updateProfile } from '../data/api';
import { applyReferralCode, platformFees, updateProfileExtras, usernameAvailable } from '../data/extras';
import { pickMedia, signedMediaUrl, uploadMedia } from '../lib/media';
import { LANGUAGES, SKILL_OPTIONS } from './ProfileEditScreen';

const STEPS = ['Welcome', 'Username', 'Your intent', 'Skills', 'About you', 'Done'] as const;
type Intent = 'post' | 'earn' | 'both';

/**
 * First run, one question at a time: a welcome (with an optional referral
 * code), a public @username, what the person came to do, their skills if they
 * will earn, and the basics people see on their profile. Every answer is saved
 * to the profile as it is given, so leaving halfway loses nothing.
 */
export function OnboardingScreen() {
  const t = useTheme();
  const { reset } = useNav();
  const { setMode } = useMode();
  const { flash, celebrate } = useActions();
  const { userId } = useAuth();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [aiDaily, setAiDaily] = useState(10);

  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [free, setFree] = useState<boolean | null>(null);
  const [intent, setIntent] = useState<Intent>('both');
  const [skills, setSkills] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [langs, setLangs] = useState<string[]>([]);
  const [place, setPlace] = useState<{ label: string; lat: number | null; lng: number | null } | null>(null);
  const [showLoc, setShowLoc] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    void platformFees().then((f) => setAiDaily(f.aiDaily));
    if (!userId) return;
    void getProfile(userId).then(async (p) => {
      if (!p) return;
      setName(p.display_name && !/^p\d{10}$/.test(p.display_name) ? p.display_name : '');
      setUsername(p.username ?? '');
      setSkills(p.skills ?? []);
      setBio(p.bio ?? '');
      setLangs(p.languages ?? []);
      if (p.intent === 'post' || p.intent === 'earn' || p.intent === 'both') setIntent(p.intent);
      if (p.loc_label) setPlace({ label: p.loc_label, lat: p.loc_lat, lng: p.loc_lng });
      if (p.avatar_url) {
        setAvatarPath(p.avatar_url);
        setAvatar(await signedMediaUrl(p.avatar_url));
      }
    });
  }, [userId]);

  useEffect(() => {
    const h = username.trim();
    if (!/^[a-z0-9_]{3,20}$/.test(h)) {
      setFree(null);
      return;
    }
    const id = setTimeout(() => void usernameAvailable(h).then(setFree), 350);
    return () => clearTimeout(id);
  }, [username]);

  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(progress, { toValue: (step + 1) / STEPS.length, duration: 280, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [step, progress]);

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + (s === 2 && intent === 'post' ? 2 : 1)));
  const prev = () => setStep((s) => Math.max(0, s - (s === 4 && intent === 'post' ? 2 : 1)));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      next();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const choosePhoto = async () => {
    if (photoBusy) return;
    try {
      const picked = await pickMedia('image');
      if (!picked) return;
      setAvatar(picked.uri);
      setPhotoBusy(true);
      const stored = await uploadMedia(picked);
      setAvatarPath(stored.path);
    } catch (e) {
      setAvatar(null);
      flash(e instanceof Error ? e.message : 'Could not add that photo');
    } finally {
      setPhotoBusy(false);
    }
  };

  const toggle = (list: string[], set: (v: string[]) => void, v: string, max: number) =>
    list.includes(v) ? set(list.filter((x) => x !== v)) : list.length < max ? set([...list, v]) : flash(`Pick up to ${max}`);

  const finish = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await updateProfile(userId, { onboarded: true });
      setMode(intent === 'earn' ? 'worker' : 'poster');
      reset('home');
      celebrate('Welcome to TaskDrop');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not finish setup');
    } finally {
      setBusy(false);
    }
  };

  const bigCard = (icon: IconName, title: string, sub: string, key?: Intent) => {
    const on = key ? intent === key : false;
    const Wrapper = key ? Pressable : View;
    return (
      <Wrapper
        key={title}
        {...(key ? { onPress: () => setIntent(key), accessibilityRole: 'button' as const, accessibilityState: { selected: on } } : {})}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 15,
          marginTop: 10,
          borderRadius: 14,
          borderWidth: 1.5,
          borderColor: on ? t.colors.accent : t.colors.line,
          backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
        }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} color={t.colors.accentDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <RNText style={tx('700', 15, t.colors.ink)}>{title}</RNText>
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3, lineHeight: 17 })}>{sub}</RNText>
        </View>
        {on ? <Icon name="check" size={18} color={t.colors.accentDeep} strokeWidth={2.4} /> : null}
      </Wrapper>
    );
  };

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (step === 0) {
    body = (
      <>
        <RNText style={tx('800', 26, t.colors.ink, { letterSpacing: -0.7 })}>Welcome to TaskDrop!</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21 })}>
          Your marketplace to get work done and earn money nearby. Let’s set you up in under a minute.
        </RNText>
        {bigCard('wallet', 'Earn money', 'Complete tasks near you and get paid through escrow')}
        {bigCard('briefcase', 'Hire help', 'Post a task in plain words — AI writes the post')}
        {bigCard('sparkle', 'Free AI credits', `${aiDaily} AI-written posts a day, on the free plan`)}
        <Field
          label="Have a referral code? (optional)"
          value={code}
          onChangeText={(v) => setCode(v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12))}
          autoCapitalize="characters"
          placeholder="E.g. 7F3A9C21"
          style={{ marginTop: 20 }}
          left={<Icon name="gift" size={17} color={t.colors.muted} />}
        />
      </>
    );
    footer = (
      <PrimaryButton
        label="Let’s go →"
        busy={busy}
        onPress={() => void run(async () => {
          if (code.trim()) await applyReferralCode(code.trim());
        })}
      />
    );
  }

  if (step === 1) {
    const ok = /^[a-z0-9_]{3,20}$/.test(username);
    body = (
      <>
        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.6 })}>Pick a username</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21 })}>
          It’s how people find you, and you can sign in with it once you set a password.
        </RNText>
        <Field
          value={username}
          onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase().slice(0, 20))}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          placeholder="yourname"
          left={<RNText style={tx('600', 16, t.colors.muted)}>@</RNText>}
          style={{ marginTop: 20 }}
          error={username && !ok ? '3–20 characters: a–z, 0–9 and _' : free === false ? 'That username is taken' : null}
          hint={free ? '✓ Available' : undefined}
        />
      </>
    );
    footer = (
      <>
        <PrimaryButton
          label="Continue"
          busy={busy}
          disabled={!ok || free === false}
          onPress={() => void run(async () => {
            if (userId) await updateProfileExtras(userId, { username });
          })}
        />
        <Pressable onPress={next} style={{ alignItems: 'center', paddingVertical: 12 }} accessibilityRole="button">
          <RNText style={tx('700', 13, t.colors.muted)}>Skip for now</RNText>
        </Pressable>
      </>
    );
  }

  if (step === 2) {
    body = (
      <>
        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.6 })}>What brings you here?</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8 })}>You can switch between posting and earning any time.</RNText>
        {bigCard('briefcase', 'Get things done', 'Post tasks and pick someone to do them', 'post')}
        {bigCard('wallet', 'Earn money', 'Find tasks near you and send quotes', 'earn')}
        {bigCard('users', 'Both', 'Post when I need help, earn when I’m free', 'both')}
      </>
    );
    footer = (
      <PrimaryButton
        label="Continue"
        busy={busy}
        onPress={() => void run(async () => {
          if (userId) await updateProfileExtras(userId, { intent });
        })}
      />
    );
  }

  if (step === 3) {
    body = (
      <>
        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.6 })}>What are you good at?</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8 })}>Pick up to 8 — we’ll recommend matching tasks.</RNText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
          {SKILL_OPTIONS.map((s) => (
            <Pill key={s} label={s} active={skills.includes(s)} onPress={() => toggle(skills, setSkills, s, 8)} />
          ))}
        </View>
      </>
    );
    footer = (
      <PrimaryButton
        label="Continue"
        busy={busy}
        onPress={() => void run(async () => {
          if (userId) await updateProfile(userId, { skills });
        })}
      />
    );
  }

  if (step === 4) {
    body = (
      <>
        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.6 })}>About you</RNText>
        <Pressable onPress={() => void choosePhoto()} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18 }} accessibilityRole="button">
          <View style={{ width: 64, height: 64, borderRadius: 999, overflow: 'hidden', backgroundColor: t.colors.surface2, borderWidth: 1, borderStyle: avatar ? 'solid' : 'dashed', borderColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            {avatar ? <Image source={{ uri: avatar }} style={{ width: 64, height: 64 }} /> : <Icon name="plus" size={22} color={t.colors.accent} />}
            {photoBusy ? (
              <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <RNText style={tx('700', 15, t.colors.ink)}>{avatar ? 'Change photo' : 'Add a photo'}</RNText>
            <RNText style={tx('500', 12, t.colors.accentDeep, { marginTop: 3 })}>Profiles with photos get more replies</RNText>
          </View>
        </Pressable>
        <Field label="Display name" value={name} onChangeText={setName} maxLength={40} style={{ marginTop: 18 }} placeholder="Your name" />
        <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3, marginTop: 16 })}>LOCATION</RNText>
        <Pressable
          onPress={() => setShowLoc(true)}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2 }}
        >
          <Icon name="pin" size={17} color={t.colors.accentDeep} />
          <RNText style={tx('400', 14, place ? t.colors.ink : t.colors.muted, { flex: 1 })} numberOfLines={2}>
            {place?.label ?? 'Where are you based?'}
          </RNText>
          <RNText style={tx('700', 13, t.colors.accentDeep)}>{place ? 'Change' : 'Find me'}</RNText>
        </Pressable>
        <Field label="Short bio (optional)" value={bio} onChangeText={setBio} multiline maxLength={500} style={{ marginTop: 16 }} placeholder="A line or two about you" />
        <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3, marginTop: 16 })}>LANGUAGES</RNText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
          {LANGUAGES.map((l) => (
            <Pill key={l} label={l} active={langs.includes(l)} onPress={() => toggle(langs, setLangs, l, 6)} />
          ))}
        </View>
      </>
    );
    footer = (
      <PrimaryButton
        label="Continue"
        busy={busy}
        disabled={!name.trim()}
        onPress={() => void run(async () => {
          if (!userId) return;
          await updateProfile(userId, {
            displayName: name.trim(),
            avatarUrl: avatarPath ?? undefined,
            locLabel: place?.label ?? null,
            locLat: place?.lat ?? null,
            locLng: place?.lng ?? null,
          });
          await updateProfileExtras(userId, { bio, languages: langs });
        })}
      />
    );
  }

  if (step === 5) {
    body = (
      <View style={{ alignItems: 'center', paddingTop: 30 }}>
        <View style={{ width: 84, height: 84, borderRadius: 999, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={40} color={t.colors.accentDeep} strokeWidth={2.4} />
        </View>
        <RNText style={tx('800', 24, t.colors.ink, { marginTop: 18, textAlign: 'center' })}>You’re all set{name ? `, ${name.split(' ')[0]}` : ''}!</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21, textAlign: 'center' })}>
          {intent === 'earn'
            ? 'Find a task near you and send your first quote.'
            : 'Tell us what you need done and AI will write the post for you.'}
        </RNText>
      </View>
    );
    footer = <PrimaryButton label="Go to TaskDrop" busy={busy} onPress={() => void finish()} />;
  }

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {step > 0 && step < STEPS.length - 1 ? (
            <Pressable onPress={prev} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
              <Icon name="back" size={22} color={t.colors.ink} />
            </Pressable>
          ) : null}
          <RNText style={tx('600', 13, t.colors.muted, { flex: 1 })}>
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </RNText>
        </View>
        <View style={{ height: 4, borderRadius: 999, backgroundColor: t.colors.line, marginTop: 12, overflow: 'hidden' }}>
          <Animated.View
            style={{
              height: 4,
              backgroundColor: t.colors.accent,
              width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            }}
          />
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>{footer}</View>
      <LocationSheet
        visible={showLoc}
        onCancel={() => setShowLoc(false)}
        onPick={(p) => {
          setPlace({ label: p.label, lat: p.lat, lng: p.lng });
          setShowLoc(false);
        }}
      />
    </Screen>
  );
}
