import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { Field, Pill, PrimaryButton, TopBar } from '../components/kit';
import { LocationSheet } from '../components/LocationSheet';
import { SelectField } from '../components/SelectField';
import { RoleTheme, useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useAuth } from '../providers/AuthProvider';
import { isNeedsAccount, needAccount } from '../lib/guest';
import { useActions } from '../providers/AppStateProvider';
import { getProfile, updateProfile } from '../data/api';
import { updateProfileExtras, type EarnGoal } from '../data/extras';
import { isEarnGoal } from '../components/EarnGoalPicker';
import { findContactIssue, profileIssueMessage } from '../lib/mask';
import { SKILL_OPTIONS, LANGUAGES } from './ProfileEditScreen';
import { tx } from '../components/primitives';
import { ActionBar, FieldRow, FormPage, FormSection } from '../components/FormPage';
import { WorkerPreviewCard } from '../components/WorkerPreviewCard';
import { useLayout } from '../lib/layout';

const MAX_SKILLS = 8;

/** "painting" -> "Painting", so typed skills match the suggestions. */
const tidy = (s: string) => {
  const v = s.trim().replace(/\s+/g, ' ');
  return v.charAt(0).toUpperCase() + v.slice(1);
};

/**
 * The worker side of an account, set up once, kept as short as it can be.
 *
 * Posting needs nothing more than a sign-in; earning needs posters to know a
 * little about who they would hire. So the first switch to Earn lands here:
 * type a skill, pick a language, say where you are. Every box is optional --
 * a long form here makes people give up before they ever earn -- and all of it
 * can be changed later in Profile. Same account and @username.
 */
export function WorkerSetupScreen() {
  return (
    // Earn is blue, even while the rest of the app is still on Post.
    <RoleTheme worker>
      <Setup />
    </RoleTheme>
  );
}

function Setup() {
  const t = useTheme();
  const { back, reset } = useNav();
  const { setMode } = useMode();
  const { userId, guest } = useAuth();
  const { desktop } = useLayout();
  const finishRef = useRef<() => Promise<void>>(async () => {});
  const { flash, celebrate } = useActions();
  // Answered in first-run setup (not asked again here); kept so saving this screen never wipes it.
  const [earnGoal, setEarnGoal] = useState<EarnGoal | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [langs, setLangs] = useState<string[]>([]);
  const [place, setPlace] = useState<{ label: string; lat: number | null; lng: number | null } | null>(null);
  const [showLoc, setShowLoc] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void getProfile(userId).then((p) => {
      if (!p) return;
      setName(p.display_name ?? '');
      setSkills(p.skills ?? []);
      setLangs(p.languages ?? []);
      setBio(p.worker_bio ?? '');
      if (isEarnGoal(p.earn_goal)) setEarnGoal(p.earn_goal);
      if (p.loc_label) setPlace({ label: p.loc_label, lat: p.loc_lat, lng: p.loc_lng });
    });
  }, [userId]);

  // W2-21: the same refusal as the customer bio, not a silent mask that swallows the words around a number.
  const bioIssue = findContactIssue(bio);

  /** Adds what is typed (commas allowed: "Painting, Tiling") and returns the new list. */
  const addTyped = (from: string[] = skills): string[] => {
    const parts = typed.split(',').map(tidy).filter(Boolean);
    setTyped('');
    if (!parts.length) return from;
    for (const part of parts) {
      const issue = findContactIssue(part);
      if (issue) {
        flash(profileIssueMessage(issue));
        return from;
      }
    }
    const next = [...from];
    for (const part of parts) {
      if (next.some((x) => x.toLowerCase() === part.toLowerCase())) continue;
      if (next.length >= MAX_SKILLS) {
        flash(`Pick up to ${MAX_SKILLS}`);
        break;
      }
      next.push(part);
    }
    setSkills(next);
    return next;
  };

  const needle = typed.trim().toLowerCase();
  const suggestions = needle
    ? SKILL_OPTIONS.filter((s) => s.toLowerCase().includes(needle) && !skills.includes(s)).slice(0, 5)
    : [];

  const language = langs[0] ?? '';
  // Pick one main language; any others saved earlier (edited in Profile) stay.
  const pickLanguage = (v: string) => setLangs(v ? [v, ...langs.slice(1).filter((x) => x !== v)] : langs.slice(1));

  const finish = async () => {
    if (bioIssue || busy) return;
    if (guest) return needAccount('profile', () => finishRef.current());
    if (!userId) return;
    setBusy(true);
    try {
      const finalSkills = addTyped();
      await updateProfile(userId, {
        skills: finalSkills,
        ...(place ? { locLabel: place.label, locLat: place.lat, locLng: place.lng } : {}),
      });
      await updateProfileExtras(userId, {
        ...(earnGoal ? { earnGoal } : {}),
        workerBio: bio.trim() || null,
        languages: langs,
        workerOnboarded: true,
      });
      setMode('worker');
      reset('home');
      celebrate('You’re set up to earn');
    } catch (e) {
      if (isNeedsAccount(e)) return;
      flash(e instanceof Error ? e.message : 'Could not save your worker profile');
    } finally {
      setBusy(false);
    }
  };
  finishRef.current = () => finish();

  // Phone: a small caps label above each box, as before. Desktop: the FormSection titles replace them.
  const label = (s: string, top = 22) => (
    <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, marginTop: top })}>{s}</RNText>
  );
  // Desktop only: a field label above one of two side-by-side boxes.
  const fieldLabel = (s: string) => (
    <RNText style={tx('600', 13, t.colors.ink, { marginBottom: 8 })}>{s}</RNText>
  );
  // The phone gaps (set under each phone label); on a desktop the sections space themselves.
  const gap = (phone: number, desk = 0) => (desktop ? desk : phone);

  return (
    <Screen padded={false}>
      <TopBar title="Start earning" onBack={back} />
      <FormPage
        scrollProps={{ hugContent: true, style: { flex: 1 }, contentContainerStyle: { paddingHorizontal: 20, paddingBottom: 28 }, keyboardShouldPersistTaps: 'handled' }}
        aside={<WorkerPreviewCard name={name} skills={skills} language={language} area={place?.label} bio={bio} />}
        actions={
          <ActionBar hint={desktop ? 'Everything here is optional.' : undefined}>
            <PrimaryButton label="Start earning" onPress={() => void finish()} busy={busy} disabled={Boolean(bioIssue)} style={{ marginTop: gap(26) }} />
          </ActionBar>
        }
      >
        {desktop ? null : (
          <RNText style={tx('500', 14, t.colors.muted, { lineHeight: 20 })}>
            Everything here is optional. Add what you like now, change it any time in Profile.
          </RNText>
        )}

        <FormSection first title="Skills" hint="Add what you like now, change it any time in Profile.">
          {desktop ? null : label('YOUR SKILLS')}
          {skills.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: gap(9) }}>
              {skills.map((s) => (
                <Pill key={s} label={s} active icon="close" onPress={() => setSkills(skills.filter((x) => x !== s))} />
              ))}
            </View>
          ) : null}
          <Field
            style={{ marginTop: desktop && !skills.length ? 0 : 10 }}
            value={typed}
            onChangeText={setTyped}
            placeholder="Type a skill, e.g. Painting"
            maxLength={60}
            returnKeyType="done"
            autoCapitalize="sentences"
            onSubmitEditing={() => addTyped()}
            right={
              typed.trim() ? (
                <Pressable onPress={() => addTyped()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add skill">
                  <RNText style={tx('700', 13, t.colors.accentDeep)}>Add</RNText>
                </Pressable>
              ) : undefined
            }
          />
          {suggestions.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {suggestions.map((s) => (
                <Pill
                  key={s}
                  label={s}
                  onPress={() => {
                    setTyped('');
                    if (skills.length >= MAX_SKILLS) return flash(`Pick up to ${MAX_SKILLS}`);
                    setSkills([...skills, s]);
                  }}
                />
              ))}
            </View>
          ) : null}
        </FormSection>

        <FormSection title="Language and location">
          <FieldRow>
            <>
              {desktop ? fieldLabel('Language') : label('LANGUAGE')}
              <SelectField value={language} options={LANGUAGES} onChange={pickLanguage} placeholder={desktop ? 'Choose one' : 'Choose a language'} style={{ marginTop: gap(9) }} />
            </>
            <>
              {desktop ? fieldLabel('Where you work from') : label('WHERE YOU WORK FROM')}
              <Pressable
                onPress={() => setShowLoc(true)}
                accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: gap(8), padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: t.colors.line, backgroundColor: t.colors.surface }}
              >
                {desktop ? (
                  <View style={{ flexShrink: 0 }}>
                    <Icon name="pin" size={17} color={t.colors.accentDeep} />
                  </View>
                ) : (
                  <Icon name="pin" size={17} color={t.colors.accentDeep} />
                )}
                <RNText style={tx('400', 14, place ? t.colors.ink : t.colors.muted, { flex: 1 })} numberOfLines={2}>
                  {place?.label ?? 'Your area, for jobs near you'}
                </RNText>
                <RNText style={tx('700', 13, t.colors.accentDeep)}>{place ? 'Change' : 'Set'}</RNText>
              </Pressable>
            </>
          </FieldRow>
        </FormSection>

        <FormSection title="About you">
          {desktop ? null : label('ABOUT YOU')}
          <Field
            style={{ marginTop: gap(9) }}
            value={bio}
            onChangeText={setBio}
            multiline
            minHeight={64}
            maxLength={500}
            placeholder={earnGoal === 'business' ? 'What your business does (optional)' : 'A line about what you do (optional)'}
            error={bioIssue ? profileIssueMessage(bioIssue) : null}
          />
        </FormSection>
      </FormPage>
      <LocationSheet
        visible={showLoc}
        askForDetails={false}
        onCancel={() => setShowLoc(false)}
        onPick={(picked) => {
          setPlace({ label: picked.area || picked.label, lat: picked.lat, lng: picked.lng });
          setShowLoc(false);
        }}
      />
    </Screen>
  );
}
