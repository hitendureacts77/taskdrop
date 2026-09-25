import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable } from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { Field, Pill, PrimaryButton, TopBar } from '../components/kit';
import { LocationSheet } from '../components/LocationSheet';
import { RoleTheme, useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useAuth } from '../providers/AuthProvider';
import { useActions } from '../providers/AppStateProvider';
import { getProfile, updateProfile } from '../data/api';
import { updateProfileExtras } from '../data/extras';
import { maskContacts } from '../lib/mask';
import { SKILL_OPTIONS, LANGUAGES } from './ProfileEditScreen';
import { tx } from '../components/primitives';

/**
 * The worker side of an account, set up once.
 *
 * Posting needs nothing more than a sign-in; earning needs posters to know
 * who they would be hiring. So the first switch to Earn lands here: what you
 * do, your skills, the languages you work in and where you are. Same account
 * and @username -- this only adds the worker profile.
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
  const { userId } = useAuth();
  const { flash, celebrate } = useActions();
  const [bio, setBio] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [langs, setLangs] = useState<string[]>([]);
  const [place, setPlace] = useState<{ label: string; lat: number | null; lng: number | null } | null>(null);
  const [showLoc, setShowLoc] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void getProfile(userId).then((p) => {
      if (!p) return;
      setSkills(p.skills ?? []);
      setLangs(p.languages ?? []);
      setBio(p.worker_bio ?? '');
      if (p.loc_label) setPlace({ label: p.loc_label, lat: p.loc_lat, lng: p.loc_lng });
    });
  }, [userId]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string, max: number) =>
    list.includes(v) ? set(list.filter((x) => x !== v)) : list.length < max ? set([...list, v]) : flash(`Pick up to ${max}`);

  const bioOk = bio.trim().length >= 20;
  const ready = bioOk && skills.length > 0 && langs.length > 0;

  const finish = async () => {
    if (!userId || !ready) return;
    setBusy(true);
    try {
      await updateProfile(userId, {
        skills,
        ...(place ? { locLabel: place.label, locLat: place.lat, locLng: place.lng } : {}),
      });
      await updateProfileExtras(userId, {
        workerBio: maskContacts(bio).text,
        languages: langs,
        workerOnboarded: true,
      });
      setMode('worker');
      reset('home');
      celebrate('You’re set up to earn');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save your worker profile');
    } finally {
      setBusy(false);
    }
  };

  const label = (s: string, top = 20) => (
    <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3, marginTop: top })}>{s}</RNText>
  );

  return (
    <Screen padded={false}>
      <TopBar title="Set up your worker profile" onBack={back} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: 10, backgroundColor: t.colors.accentSoft, borderRadius: 14, padding: 14 }}>
          <Icon name="briefcase" size={18} color={t.colors.accentDeep} />
          <RNText style={tx('500', 13, t.colors.accentDeep, { flex: 1, lineHeight: 19 })}>
            Same account and @username — this adds the profile posters see before they hire you. Takes a minute.
          </RNText>
        </View>

        <Field
          label="What you do"
          value={bio}
          onChangeText={setBio}
          multiline
          maxLength={500}
          placeholder="E.g. I write blogs and product copy in English and Hindi. 3 years, quick turnaround."
          style={{ marginTop: 18 }}
          error={bio.trim() && !bioOk ? 'A sentence or two, at least 20 characters' : null}
          hint="Shown on your worker profile. Your poster profile keeps its own bio."
        />

        {label('YOUR SKILLS · PICK UP TO 8')}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
          {SKILL_OPTIONS.map((s) => (
            <Pill key={s} label={s} active={skills.includes(s)} onPress={() => toggle(skills, setSkills, s, 8)} />
          ))}
        </View>

        {label('LANGUAGES YOU WORK IN')}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
          {LANGUAGES.map((l) => (
            <Pill key={l} label={l} active={langs.includes(l)} onPress={() => toggle(langs, setLangs, l, 6)} />
          ))}
        </View>

        {label('WHERE YOU WORK FROM')}
        <Pressable
          onPress={() => setShowLoc(true)}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2 }}
        >
          <Icon name="pin" size={17} color={t.colors.accentDeep} />
          <RNText style={tx('400', 14, place ? t.colors.ink : t.colors.muted, { flex: 1 })} numberOfLines={2}>
            {place?.label ?? 'Your area, for jobs near you (optional)'}
          </RNText>
          <RNText style={tx('700', 13, t.colors.accentDeep)}>{place ? 'Change' : 'Set'}</RNText>
        </Pressable>

        <PrimaryButton label="Start earning" onPress={() => void finish()} busy={busy} disabled={!ready} style={{ marginTop: 24 }} />
        {!ready ? (
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 8, textAlign: 'center' })}>
            Add what you do, at least one skill and a language.
          </RNText>
        ) : null}
      </ScrollView>
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
