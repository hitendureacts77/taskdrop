import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, Image, ActivityIndicator } from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { Badge, Field, Pill, PrimaryButton, TopBar, UnderlineTabs } from '../components/kit';
import { LocationSheet } from '../components/LocationSheet';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { useMode } from '../providers/ModeProvider';
import { getProfile, listReviewsAbout, updateProfile, type Profile } from '../data/api';
import { updateProfileExtras, verificationState } from '../data/extras';
import { PresenceDot } from '../components/PresenceDot';
import { pickMedia, signedMediaUrl, uploadMedia } from '../lib/media';
import { levelFor, profileStrength } from '../lib/levels';

export const SKILL_OPTIONS = [
  'Repairs', 'Delivery', 'Errands', 'Sourcing', 'Local intel', 'Cleaning', 'Carpentry', 'Painting',
  'Photography', 'Video editing', 'Graphic design', 'Content writing', 'Data entry', 'Tutoring',
  'Web development', 'Career coaching', 'Event planning', 'Translation', 'Research',
];

export const LANGUAGES = [
  'English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Punjabi', 'Urdu', 'Odia',
];


/**
 * My profile: the parts other people read, with a strength meter that says
 * exactly what is missing. Photo, bio, location, languages, skills and "go
 * live" availability all save to the profile row.
 */
export function ProfileEditScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { flash, celebrate } = useActions();
  const { userId } = useAuth();
  // One account, two profiles: this screen edits the side you're on.
  const { mode } = useMode();
  const worker = mode === 'worker';
  const [tab, setTab] = useState(0);
  const [p, setP] = useState<Profile | null>(null);
  const [bio, setBio] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [langs, setLangs] = useState<string[]>([]);
  const [customSkill, setCustomSkill] = useState('');
  const [place, setPlace] = useState<{ label: string; lat: number | null; lng: number | null } | null>(null);
  const [showLoc, setShowLoc] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verify, setVerify] = useState({ phone: false, email: false });
  const [reviews, setReviews] = useState(0);
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void (async () => {
      const [profile, v, r] = await Promise.all([
        getProfile(userId),
        verificationState(),
        listReviewsAbout(userId, worker ? 'worker' : 'poster').catch(() => []),
      ]);
      if (!alive || !profile) return;
      setP(profile);
      setBio((worker ? profile.worker_bio : profile.bio) ?? '');
      setSkills(profile.skills ?? []);
      setLangs(profile.languages ?? []);
      setPlace(profile.loc_label ? { label: profile.loc_label, lat: profile.loc_lat, lng: profile.loc_lng } : null);
      setVerify(v);
      setReviews(r.length);
      setLastSeen(profile.last_seen_at);
      if (profile.avatar_url) {
        const url = await signedMediaUrl(profile.avatar_url);
        if (alive) setAvatar(url);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId, worker]);

  const draft: Profile | null = p
    ? { ...p, bio, worker_bio: bio, skills, languages: langs, loc_label: place?.label ?? null }
    : null;
  const strength = profileStrength(draft, verify, reviews, worker ? 'worker' : 'poster');
  const level = levelFor(p?.worker_rating_count ?? 0, Number(p?.worker_rating_avg ?? 0));
  // Posters have no Skills tab: their second tab is Status.
  const view = worker ? tab : tab === 1 ? 2 : 0;
  const words = bio.trim().split(/\s+/).filter(Boolean).length;

  const choosePhoto = async () => {
    if (!userId || photoBusy) return;
    try {
      const picked = await pickMedia('image');
      if (!picked) return;
      setAvatar(picked.uri);
      setPhotoBusy(true);
      const stored = await uploadMedia(picked);
      const next = await updateProfile(userId, { avatarUrl: stored.path });
      setP(next);
      celebrate('Photo updated');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not add that photo');
    } finally {
      setPhotoBusy(false);
    }
  };

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      await updateProfile(userId, {
        ...(worker ? { skills } : {}),
        locLabel: place?.label ?? null,
        locLat: place?.lat ?? null,
        locLng: place?.lng ?? null,
      });
      const next = await updateProfileExtras(userId, worker ? { workerBio: bio, languages: langs } : { bio, languages: langs });
      setP(next);
      celebrate('Profile saved');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  };


  const toggle = (list: string[], set: (v: string[]) => void, value: string, max: number) => {
    if (list.includes(value)) set(list.filter((x) => x !== value));
    else if (list.length < max) set([...list, value]);
    else flash(`Pick up to ${max}`);
  };

  const card = { backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 15, marginTop: 14 } as const;
  const barColor = strength.score >= 80 ? t.colors.accent : strength.score >= 50 ? t.colors.gold : t.colors.signal;

  return (
    <Screen padded={false}>
      <TopBar
        title={worker ? 'My worker profile' : 'My poster profile'}
        onBack={back}
        right={
          <Pressable onPress={() => go('publicProfile', { userId, role: worker ? 'worker' : 'poster' })} hitSlop={8} accessibilityRole="button">
            <RNText style={tx('700', 13, t.colors.accentDeep)}>Preview</RNText>
          </Pressable>
        }
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 20 }}>
          <View style={{ ...card, marginTop: 0, alignItems: 'center' }}>
            <Pressable onPress={() => void choosePhoto()} accessibilityRole="button" accessibilityLabel="Change photo">
              <View style={{ width: 84, height: 84, borderRadius: 999, overflow: 'hidden', backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                {avatar ? (
                  <Image source={{ uri: avatar }} style={{ width: 84, height: 84 }} />
                ) : (
                  <RNText style={tx('800', 32, '#FFFFFF')}>{(p?.display_name ?? '?').charAt(0).toUpperCase()}</RNText>
                )}
                {photoBusy ? (
                  <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
                    <ActivityIndicator color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
              <View style={{ position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: 999, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="edit" size={14} color={t.colors.ink} />
              </View>
            </Pressable>
            <RNText style={tx('800', 18, t.colors.ink, { marginTop: 10 })}>{p?.display_name ?? ''}</RNText>
            {p?.username ? <RNText style={tx('500', 13, t.colors.muted, { marginTop: 2 })}>@{p.username}</RNText> : null}
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
              {verify.phone || verify.email ? <Badge label="Verified" /> : null}
              <Badge label={`Lvl ${level.index} · ${level.name}`} tone="gold" />
            </View>
            {!p?.username ? (
              <Pressable onPress={() => go('account')} style={{ marginTop: 10 }} accessibilityRole="button">
                <RNText style={tx('700', 13, t.colors.accentDeep)}>Pick a username ›</RNText>
              </Pressable>
            ) : null}
          </View>

          <View style={card}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <RNText style={tx('800', 15, t.colors.ink, { flex: 1 })}>Profile score</RNText>
              <RNText style={tx('800', 15, barColor)}>{strength.score}%</RNText>
            </View>
            <View style={{ height: 6, borderRadius: 999, backgroundColor: t.colors.line, marginTop: 10, overflow: 'hidden' }}>
              <View style={{ height: 6, width: `${strength.score}%`, backgroundColor: barColor }} />
            </View>
            {strength.sections.map((s) => (
              <View key={s.label} style={{ flexDirection: 'row', marginTop: 9 }}>
                <RNText style={tx('400', 12, t.colors.muted, { flex: 1 })}>{s.label}</RNText>
                <RNText style={tx('600', 12, t.colors.ink)}>{s.got}/{s.max}</RNText>
              </View>
            ))}
            {strength.todo.length > 0 ? (
              <>
                <RNText style={tx('600', 12, t.colors.ink, { marginTop: 12 })}>To reach 100%</RNText>
                {strength.todo.map((x) => (
                  <View key={x.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 }}>
                    <Icon name="flag" size={13} color={t.colors.gold} />
                    <RNText style={tx('400', 12, t.colors.text, { flex: 1 })}>{x.label}</RNText>
                    <RNText style={tx('600', 11, t.colors.muted)}>+{x.points}</RNText>
                  </View>
                ))}
              </>
            ) : null}
          </View>
        </View>

        <View style={{ marginTop: 16 }}>
          <UnderlineTabs tabs={worker ? ['About', 'Skills', 'Status'] : ['About', 'Status']} active={tab} onPick={setTab} />
        </View>

        <View style={{ paddingHorizontal: 20 }}>
          {view === 0 ? (
            <>
              <Field
                label={worker ? 'About your work' : 'About you'}
                value={bio}
                onChangeText={setBio}
                multiline
                maxLength={500}
                placeholder={
                  worker
                    ? 'What you do, your experience, and why posters can count on you'
                    : 'Who you are and the kind of tasks you usually post'
                }
                style={{ marginTop: 16 }}
                hint={
                  worker
                    ? `${bio.length}/500 characters · ${words} words${words < 50 ? ' (50+ recommended)' : ''} · shown to posters`
                    : `${bio.length}/500 characters · shown to workers who quote on your tasks`
                }
              />
              <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3, marginTop: 18 })}>LOCATION</RNText>
              <Pressable
                onPress={() => setShowLoc(true)}
                accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2 }}
              >
                <Icon name="pin" size={17} color={t.colors.accentDeep} />
                <RNText style={tx('400', 14, place ? t.colors.ink : t.colors.muted, { flex: 1 })} numberOfLines={2}>
                  {place?.label ?? 'Where are you based?'}
                </RNText>
                <RNText style={tx('700', 13, t.colors.accentDeep)}>{place ? 'Change' : 'Set'}</RNText>
              </Pressable>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6 })}>This helps match you with local tasks.</RNText>
              <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3, marginTop: 18 })}>LANGUAGES</RNText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
                {LANGUAGES.map((l) => (
                  <Pill key={l} label={l} active={langs.includes(l)} onPress={() => toggle(langs, setLangs, l, 6)} />
                ))}
              </View>
            </>
          ) : null}

          {view === 1 ? (
            <>
              <RNText style={tx('400', 13, t.colors.muted, { marginTop: 16, lineHeight: 19 })}>
                Pick up to 8. We use these to recommend tasks to you and to show you on the explore page.
              </RNText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {[...new Set([...SKILL_OPTIONS, ...skills])].map((s) => (
                  <Pill key={s} label={s} active={skills.includes(s)} onPress={() => toggle(skills, setSkills, s, 8)} />
                ))}
              </View>
              <Field
                style={{ marginTop: 14 }}
                value={customSkill}
                onChangeText={setCustomSkill}
                placeholder="Add another skill"
                maxLength={30}
                returnKeyType="done"
                onSubmitEditing={() => {
                  const s = customSkill.trim();
                  if (s) toggle(skills, setSkills, s.charAt(0).toUpperCase() + s.slice(1), 8);
                  setCustomSkill('');
                }}
                right={
                  <Pressable
                    onPress={() => {
                      const s = customSkill.trim();
                      if (s) toggle(skills, setSkills, s.charAt(0).toUpperCase() + s.slice(1), 8);
                      setCustomSkill('');
                    }}
                    hitSlop={8}
                  >
                    <RNText style={tx('700', 13, t.colors.accentDeep)}>Add</RNText>
                  </Pressable>
                }
              />
            </>
          ) : null}

          {view === 2 ? (
            <View style={card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <RNText style={tx('800', 15, t.colors.ink, { flex: 1 })}>Your status</RNText>
                <PresenceDot lastSeen={new Date().toISOString()} />
              </View>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6, lineHeight: 18 })}>
                Automatic, like a chat app. While you have TaskDrop open, posters see a green dot and
                “Active now” next to your name. When you close it, they see how long you’ve been away —
                “Away · 20 min”. Nothing to switch on or off.
              </RNText>
              {lastSeen ? (
                <RNText style={tx('400', 11, t.colors.muted, { marginTop: 10 })}>
                  Before this visit you were last active {new Date(lastSeen).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.
                </RNText>
              ) : null}
            </View>
          ) : null}

          {view !== 2 ? <PrimaryButton label="Save profile" onPress={() => void save()} busy={saving} style={{ marginTop: 20 }} /> : null}
        </View>
      </ScrollView>
      <LocationSheet
        visible={showLoc}
        onCancel={() => setShowLoc(false)}
        onPick={(picked) => {
          setPlace({ label: picked.label, lat: picked.lat, lng: picked.lng });
          setShowLoc(false);
        }}
      />
    </Screen>
  );
}
