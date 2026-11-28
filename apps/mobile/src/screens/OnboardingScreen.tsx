import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, ActivityIndicator, Animated } from 'react-native';
import { Image } from 'expo-image';
import { Screen } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { Field, IconButton, Pill, PrimaryButton } from '../components/kit';
import { Ripples } from '../components/Ripples';
import { LocationSheet } from '../components/LocationSheet';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { releaseAccountHold, runPendingAfterSignIn } from '../lib/guest';
import { ownerMatches, resumable } from '../lib/postWizard';
import { loadWizard } from '../lib/postWizardStore';
import { getProfile, updateProfile } from '../data/api';
import { applyReferralCode, updateProfileExtras, type EarnGoal } from '../data/extras';
import { UsernameField, useUsernameCheck } from '../components/UsernameField';
import { isEarnGoal } from '../components/EarnGoalPicker';
import { imageSource, pickMedia, pickedFromFile, signedMediaUrl, uploadMedia, type PickedMedia } from '../lib/media';
import { useFileDrop } from '../lib/useFileDrop';
import { LANGUAGES } from './ProfileEditScreen';
import { isPlaceholderName } from '../lib/placeholderName';
import { SkillPicker } from '../components/SkillPicker';
import { ActionBar, ActionBarContext, FormPage } from '../components/FormPage';
import { StepList } from '../components/StepList';
import { useLayout } from '../lib/layout';

// "Why you earn" is no longer asked here (owner, 28 Nov: nice, but not needed first): it is an optional question in
// Start earning (WorkerSetupScreen).
const STEPS = ['Welcome', 'Username', 'Your intent', 'Skills', 'About you', 'Done'] as const;
type Intent = 'post' | 'earn' | 'both';
// Step numbers used below. The skills step is skipped for someone who only posts.
const USERNAME = 1;
const SKILLS = 3;
const ABOUT = 4;
const DONE = 5;

/**
 * First run, one question at a time: a welcome (with an optional referral
 * code), a public @username, what the person came to do, their skills
 * if they will earn, and the basics people see on their profile.
 * Every answer is saved to the profile as it is given, so leaving halfway
 * loses nothing.
 */
export function OnboardingScreen() {
  const t = useTheme();
  const { desktop } = useLayout();
  const { reset, back, go, params } = useNav();
  const { setMode } = useMode();
  const { flash, celebrate } = useActions();
  const { userId } = useAuth();
  // From guest mode only the username and "About you" are asked now; the rest is offered at a later sign-in
  // (decision 21). The username is compulsory for every account (decision 51, plan 1.18).
  const quick = Boolean(params.quick);
  // A guest who backs out of the quick finish gets their open sheet back.
  useEffect(() => (quick ? releaseAccountHold : undefined), [quick]);
  const [step, setStep] = useState(quick ? USERNAME : 0);
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [intent, setIntent] = useState<Intent>('both');
  // Answered later, if at all, in Start earning; read here only to word the last card.
  const [earnGoal, setEarnGoal] = useState<EarnGoal | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [langs, setLangs] = useState<string[]>([]);
  const [place, setPlace] = useState<{ label: string; lat: number | null; lng: number | null } | null>(null);
  const [showLoc, setShowLoc] = useState(false);
  // A new sign-up with no area is asked for one when they reach the step that holds it (About you), never
  // over the Welcome step (W2-19: the map picker opened on top of Step 1 before Let’s go was tapped).
  const [askArea, setAskArea] = useState(false);
  useEffect(() => {
    if (askArea && step === ABOUT) {
      setAskArea(false);
      setShowLoc(true);
    }
  }, [askArea, step]);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void getProfile(userId).then(async (p) => {
      if (!p) return;
      // A phone account's placeholder name, or an email (an Apple "Hide my email" relay), is not a name to offer.
      setName(
        isPlaceholderName(p.display_name) ? '' : (p.display_name ?? ''),
      );
      setUsername(p.username ?? '');
      // The quick finish skips the username step for an account that already has one.
      if (quick && p.username) setStep((s) => (s === USERNAME ? ABOUT : s));
      setSkills(p.skills ?? []);
      setBio(p.bio ?? '');
      setLangs(p.languages ?? []);
      if (p.intent === 'post' || p.intent === 'earn' || p.intent === 'both') setIntent(p.intent);
      if (isEarnGoal(p.earn_goal)) setEarnGoal(p.earn_goal);
      if (p.loc_label) setPlace({ label: p.loc_label, lat: p.loc_lat, lng: p.loc_lng });
      // New sign-ups are asked for their area on the About you step. Setup only opens
      // for an account that has not finished it, so returning members never see this.
      else setAskArea(true);
      if (p.avatar_url) {
        setAvatarPath(p.avatar_url);
        setAvatar(await signedMediaUrl(p.avatar_url, 'thumb'));
      }
    });
  }, [userId, quick]);

  const check = useUsernameCheck(username);

  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(progress, { toValue: (step + 1) / STEPS.length, duration: 280, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [step, progress]);

  // Someone who only posts is never asked what they are good at.
  const skipped = (s: number) => intent === 'post' && s === SKILLS;
  const next = () =>
    setStep((s) => {
      // The quick finish asks only the username and About you.
      if (quick && s === USERNAME) return ABOUT;
      let n = s + 1;
      while (skipped(n)) n += 1;
      return Math.min(DONE, n);
    });
  const prev = () =>
    setStep((s) => {
      let n = s - 1;
      while (n > 0 && skipped(n)) n -= 1;
      return Math.max(0, n);
    });

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

  // The picker, or (on web) a photo dropped onto the photo row.
  const choosePhoto = async (pick: () => Promise<PickedMedia | null> = () => pickMedia('image')) => {
    if (photoBusy) return;
    try {
      const picked = await pick();
      if (!picked) return;
      setAvatar(picked.uri);
      setPhotoBusy(true);
      const stored = await uploadMedia(picked, 'avatar');
      setAvatarPath(stored.path);
    } catch (e) {
      setAvatar(null);
      flash(e instanceof Error ? e.message : 'Could not add that photo');
    } finally {
      setPhotoBusy(false);
    }
  };

  const { ref: dropRef, over: dropOver } = useFileDrop({
    enabled: !photoBusy,
    onFile: (file) => void choosePhoto(() => pickedFromFile(file, 'image')),
  });

  const toggle = (list: string[], set: (v: string[]) => void, v: string, max: number) =>
    list.includes(v) ? set(list.filter((x) => x !== v)) : list.length < max ? set([...list, v]) : flash(`Pick up to ${max}`);

  // Saves what "About you" saves. Shared by the normal Continue and the guest's quick finish.
  const saveAbout = async () => {
    if (!userId) return;
    await updateProfile(userId, {
      displayName: name.trim(),
      avatarUrl: avatarPath ?? undefined,
      locLabel: place?.label ?? null,
      locLat: place?.lat ?? null,
      locLng: place?.lng ?? null,
    });
    // Earning-only sign-ups write their worker bio; everyone else starts
    // with the poster one. Each side can be edited later.
    await updateProfileExtras(userId, intent === 'earn' ? { workerBio: bio, languages: langs } : { bio, languages: langs });
  };

  // Guest's quick finish: not marked onboarded, so the full setup is offered later. Pops setup and the sign-in
  // page, back to the screen the guest was on, then finishes what they were doing.
  const finishQuick = async () => {
    setBusy(true);
    try {
      await saveAbout();
      back();
      back();
      runPendingAfterSignIn();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await updateProfile(userId, { onboarded: true });
      // Chose to earn and picked skills: the worker profile is done here, no
      // second setup when they switch to Earn.
      if (intent !== 'post' && skills.length > 0) {
        await updateProfileExtras(userId, { workerOnboarded: true, ...(intent === 'both' && bio.trim() ? { workerBio: bio } : {}) });
      }
      setMode(intent === 'earn' ? 'worker' : 'poster');
      reset('home');
      celebrate('Welcome to TaskDrop');
      // "Post my request" was pressed as a guest just before this account was made (a new Google
      // account lands here after the reload): back to that post, on Review, with everything put back.
      const kept = await loadWizard();
      if (kept && resumable(kept) && ownerMatches(kept, userId)) go('aiPost', { resume: true });
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
          padding: 16,
          marginTop: 10,
          borderRadius: 18,
          borderWidth: 1.5,
          borderColor: on ? t.colors.accent : t.colors.line,
          backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
        }}
      >
        <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: on ? t.colors.surface : t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} color={t.colors.accentDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <RNText style={tx('800', 15, t.colors.ink)}>{title}</RNText>
          <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 3, lineHeight: 17 })}>{sub}</RNText>
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
          Ask for anything. Someone gets it done for you.
        </RNText>
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

  if (step === USERNAME) {
    body = (
      <>
        <RNText style={tx('800', 26, t.colors.ink, { letterSpacing: -0.7 })}>Pick a username</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21 })}>
          It’s how people find you, and you can sign in with it once you set a password.
        </RNText>
        <UsernameField value={username} onChangeText={setUsername} check={check} style={{ marginTop: 20 }} />
      </>
    );
    footer = (
      <PrimaryButton
        label="Continue"
        busy={busy}
        disabled={!check.ok || check.free === false}
        onPress={() => void run(async () => {
          if (userId) await updateProfileExtras(userId, { username });
        })}
      />
    );
  }

  if (step === 2) {
    body = (
      <>
        <RNText style={tx('800', 26, t.colors.ink, { letterSpacing: -0.7 })}>What brings you here?</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8 })}>You can switch between posting and earning any time.</RNText>
        {bigCard('briefcase', 'Get things done', 'Post tasks and pick someone to do them', 'post')}
        {bigCard('wallet', 'Earn money', 'Find tasks near you and send offers', 'earn')}
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

  if (step === SKILLS) {
    body = (
      <>
        <RNText style={tx('800', 26, t.colors.ink, { letterSpacing: -0.7 })}>What are you good at?</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8 })}>Pick up to 8 — we’ll recommend matching tasks.</RNText>
        <View style={{ marginTop: 18 }}>
          <SkillPicker kind="skill" value={skills} onChange={setSkills} max={8} />
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

  if (step === ABOUT) {
    body = (
      <>
        <RNText style={tx('800', 26, t.colors.ink, { letterSpacing: -0.7 })}>About you</RNText>
        <Pressable ref={dropRef} onPress={() => void choosePhoto()} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18, padding: 6, marginHorizontal: -6, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: dropOver ? t.colors.accent : 'transparent', backgroundColor: dropOver ? t.colors.accentSoft : 'transparent' }} accessibilityRole="button">
          <View style={{ width: 64, height: 64, borderRadius: 999, overflow: 'hidden', backgroundColor: t.colors.surface2, borderWidth: 1, borderStyle: avatar ? 'solid' : 'dashed', borderColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            {avatar ? <Image source={imageSource(avatar)} style={{ width: 64, height: 64 }} contentFit="cover" /> : <Icon name="plus" size={22} color={t.colors.accent} />}
            {photoBusy ? (
              <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <RNText style={tx('800', 15, t.colors.ink)}>{avatar ? 'Change photo' : 'Add a photo'}</RNText>
            <RNText style={tx('500', 12, t.colors.accentDeep, { marginTop: 3 })}>Profiles with photos get more replies</RNText>
          </View>
        </Pressable>
        <Field label="Display name" value={name} onChangeText={setName} maxLength={40} style={{ marginTop: 18 }} placeholder="Your name" />
        <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, marginTop: 16 })}>LOCATION</RNText>
        <Pressable
          onPress={() => setShowLoc(true)}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: t.colors.line, backgroundColor: t.colors.surface }}
        >
          <Icon name="pin" size={17} color={t.colors.accentDeep} />
          <RNText style={tx('400', 14, place ? t.colors.ink : t.colors.muted, { flex: 1 })} numberOfLines={2}>
            {place?.label ?? 'Where are you based?'}
          </RNText>
          <RNText style={tx('700', 13, t.colors.accentDeep)}>{place ? 'Change' : 'Find me'}</RNText>
        </Pressable>
        <Field label="Short bio (optional)" value={bio} onChangeText={setBio} multiline maxLength={500} style={{ marginTop: 16 }} placeholder="A line or two about you" />
        <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, marginTop: 16 })}>LANGUAGES</RNText>
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
        onPress={() => (quick ? void finishQuick() : void run(saveAbout))}
      />
    );
  }

  if (step === DONE) {
    body = (
      <View style={{ alignItems: 'center', paddingTop: 30 }}>
        {/* The one celebration: a check with ripples going out from it. */}
        <View style={{ width: 120, height: 120, alignItems: 'center', justifyContent: 'center' }}>
          <Ripples color={t.colors.accent} size={160} count={3} duration={2600} />
          <View style={{ width: 96, height: 96, borderRadius: 999, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={38} color={t.colors.accentDeep} strokeWidth={2.4} />
          </View>
        </View>
        <RNText style={tx('800', 26, t.colors.ink, { marginTop: 18, textAlign: 'center', letterSpacing: -0.7 })}>You’re all set{name ? `, ${name.split(' ')[0]}` : ''}!</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21, textAlign: 'center' })}>
          {intent === 'earn'
            ? earnGoal === 'business'
              ? 'Find people who need what your business does and send your first offer.'
              : 'Find a task near you and send your first offer.'
            : 'Tell us what you need done and we’ll write the post for you.'}
        </RNText>
      </View>
    );
    footer = <PrimaryButton label="Go to TaskDrop" busy={busy} onPress={() => void finish()} />;
  }

  // Desktop: Back sits at the left of the action bar and the aside lists every step, so the phone's
  // "Step n of N" row and bar are not drawn. The skills step is left out for someone who only posts.
  const showBack = !quick && step > 0 && step < STEPS.length - 1;
  const aside = quick ? undefined : (
    <StepList
      steps={STEPS.map((label, i) => ({ label, i }))
        .filter(({ i }) => !skipped(i))
        .map(({ label, i }) => ({ label, state: i < step ? 'done' : i === step ? 'current' : 'next' }))}
    />
  );

  return (
    <Screen padded={false}>
      {desktop ? null : (
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {showBack ? <IconButton icon="back" label="Back" onPress={prev} /> : null}
            <RNText style={tx('600', 13, t.colors.muted, { flex: 1 })}>
              {quick ? STEPS[step] : `Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`}
            </RNText>
          </View>
          {quick ? null : (
            <View style={{ height: 4, borderRadius: 999, backgroundColor: t.colors.surface2, marginTop: 12, overflow: 'hidden' }}>
              <Animated.View
                style={{
                  height: 4,
                  backgroundColor: t.colors.accent,
                  width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                }}
              />
            </View>
          )}
        </View>
      )}
      <FormPage
        phoneActions="pinned"
        scrollProps={{ style: { flex: 1 }, contentContainerStyle: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20 }, keyboardShouldPersistTaps: 'handled' }}
        aside={aside}
        actions={
          <ActionBar
            hint={
              desktop && showBack ? (
                <ActionBarContext.Provider value={true}>
                  <PrimaryButton label="Back" tone="quiet" onPress={prev} style={{ alignSelf: 'flex-start' }} />
                </ActionBarContext.Provider>
              ) : undefined
            }
          >
            <View style={desktop ? undefined : { paddingHorizontal: 20, paddingBottom: 16 }}>{footer}</View>
          </ActionBar>
        }
      >
        {body}
      </FormPage>
      <LocationSheet
        visible={showLoc}
        // A profile shows an area, never a door: it is public.
        askForDetails={false}
        onCancel={() => setShowLoc(false)}
        onPick={(p) => {
          setPlace({ label: p.label, lat: p.lat, lng: p.lng });
          setShowLoc(false);
        }}
      />
    </Screen>
  );
}
