import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  ScrollView,
  TextInput,
  Image,
  ActivityIndicator,
  type TextStyle,
} from 'react-native';
import { pickMedia, uploadMedia, signedMediaUrl } from '../lib/media';
import { Screen } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode, type Mode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { getProfile, updateProfile } from '../data/api';
import { LocationSheet } from '../components/LocationSheet';
import { tx } from '../components/primitives';

const SKILLS = ['Sourcing', 'Local intel', 'Carpentry', 'Delivery', 'Repairs', 'Photography', 'Research', 'Errands'];

const START_MODES: { key: Mode; label: string; sub: string }[] = [
  { key: 'poster', label: 'Post a Request', sub: 'Ask for something' },
  { key: 'worker', label: 'Find Work', sub: 'Browse and quote' },
];

export function SetupScreen() {
  const t = useTheme();
  const { reset, back } = useNav();
  const { mode, setMode } = useMode();
  const { celebrate, flash } = useApp();
  const { userId } = useAuth();
  const [skills, setSkills] = useState<number[]>([0, 1, 4]);
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const [showLoc, setShowLoc] = useState(false);
  // The photo: `avatarPath` is what gets saved (a path in the private bucket),
  // `avatarPreview` is only what is drawn — the local file while the upload
  // runs, a signed URL once it is stored.
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [coords, setCoords] = useState<{ lat: number | null; lng: number | null }>({
    lat: null,
    lng: null,
  });

  const worker = mode === 'worker';

  // Prefill from whatever is already saved, so re-opening setup edits rather
  // than silently overwrites. The fetch can land after the user has already
  // started typing, so anything they've touched is left alone — otherwise the
  // prefill lands in the middle of their input.
  const touched = useRef(false);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getProfile(userId)
      .then((p) => {
        if (!alive || !p || touched.current) return;
        setName(p.display_name ?? '');
        setPlace(p.loc_label ?? '');
        setCoords({ lat: p.loc_lat, lng: p.loc_lng });
        if (p.avatar_url) {
          setAvatarPath(p.avatar_url);
          // The bucket is private, so a stored path is not something an
          // <Image> can load; sign it for the life of this screen.
          void signedMediaUrl(p.avatar_url).then((url) => {
            if (alive && url) setAvatarPreview(url);
          });
        }
        const saved = (p.skills ?? []) as string[];
        if (saved.length > 0) {
          setSkills(saved.map((s) => SKILLS.indexOf(s)).filter((i) => i >= 0));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  const toggleSkill = (i: number) =>
    setSkills((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : prev.length >= 5 ? prev : [...prev, i],
    );

  // "Add a photo" was a plain View with a + in it — no handler, no picker, no
  // upload. It looked tappable and did nothing, which is why the picture never
  // arrived. Same pick-and-upload path task media already uses.
  const choosePhoto = async () => {
    if (photoBusy) return;
    try {
      const picked = await pickMedia('image');
      if (!picked) return; // cancelled
      touched.current = true;
      setAvatarPreview(picked.uri); // show it immediately, upload behind it
      setPhotoBusy(true);
      const stored = await uploadMedia(picked);
      setAvatarPath(stored.path);
    } catch (e) {
      // Put the old photo back rather than leaving a preview that was never saved.
      setAvatarPreview(null);
      setAvatarPath(null);
      flash(e instanceof Error ? e.message : 'Could not add that photo');
    } finally {
      setPhotoBusy(false);
    }
  };

  const finish = async () => {
    if (busy) return;
    const displayName = name.trim();
    if (!displayName) {
      flash('Add a display name first');
      return;
    }
    setBusy(true);
    try {
      if (userId) {
        await updateProfile(userId, {
          displayName,
          avatarUrl: avatarPath ?? undefined,
          skills: worker ? skills.map((i) => SKILLS[i]!).filter(Boolean) : undefined,
          locLabel: place.trim() || null,
          locLat: coords.lat,
          locLng: coords.lng,
          onboarded: true,
        });
      }
      reset('home');
      celebrate('Welcome to TaskDrop');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save your profile');
    } finally {
      setBusy(false);
    }
  };

  // Section headers were 400-weight in `muted`, which on the dark theme sat a
  // hair above the background and made the whole form read as switched off.
  const label = (s: string, extra?: TextStyle) => (
    <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.54, ...extra })}>{s}</RNText>
  );

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={back} hitSlop={10}>
          <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
        </Pressable>

        <RNText style={tx('800', 25, t.colors.ink, { letterSpacing: -0.75, marginTop: 20 })}>
          Set up your profile
        </RNText>

        <Pressable
          onPress={choosePhoto}
          disabled={photoBusy}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            marginTop: 20,
            padding: 14,
            borderRadius: 16,
            backgroundColor: t.colors.accentSoft,
            borderWidth: 1,
            borderColor: t.colors.accentBorder,
            transform: [{ scale: pressed ? 0.99 : 1 }],
          })}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 999,
              overflow: 'hidden',
              backgroundColor: t.colors.surface,
              borderWidth: 1,
              borderStyle: avatarPreview ? 'solid' : 'dashed',
              borderColor: t.colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {avatarPreview ? (
              <Image source={{ uri: avatarPreview }} style={{ width: 64, height: 64 }} />
            ) : (
              <RNText style={tx('400', 22, t.colors.accent)}>+</RNText>
            )}
            {photoBusy && (
              <View
                style={{
                  position: 'absolute',
                  inset: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(0,0,0,0.45)',
                }}
              >
                <ActivityIndicator color={t.colors.onAccent} />
              </View>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <RNText style={tx('700', 15, t.colors.ink)}>
              {photoBusy ? 'Adding your photo…' : avatarPreview ? 'Change photo' : 'Add a photo'}
            </RNText>
            <RNText style={tx('500', 12, t.colors.accentDeep, { marginTop: 3 })}>
              Profiles with photos get 3× more quotes
            </RNText>
          </View>
        </Pressable>

        {label('DISPLAY NAME', { marginTop: 22 })}
        <View
          style={{
            backgroundColor: t.colors.surface2,
            borderRadius: 12,
            // Bordered, like the code boxes on signup: without an edge these
            // read as flat patches rather than fields.
            borderWidth: 1,
            borderColor: name.trim() ? t.colors.accentBorder : t.colors.line,
            paddingVertical: 14,
            paddingHorizontal: 16,
            marginTop: 10,
          }}
        >
          <TextInput
            value={name}
            onChangeText={(v) => {
              touched.current = true;
              setName(v);
            }}
            placeholder="Your name"
            placeholderTextColor={t.colors.muted}
            style={tx('400', 15, t.colors.ink, { padding: 0 })}
          />
        </View>

        {label('LOCATION', { marginTop: 20 })}
        <View
          style={{
            backgroundColor: t.colors.surface2,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: place.trim() ? t.colors.accentBorder : t.colors.line,
            paddingVertical: 14,
            paddingHorizontal: 16,
            marginTop: 10,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <TextInput
            value={place}
            onChangeText={(v) => {
              touched.current = true;
              setPlace(v);
            }}
            placeholder="Where are you based?"
            placeholderTextColor={t.colors.muted}
            style={tx('400', 15, t.colors.ink, { flex: 1, padding: 0 })}
          />
          <Pressable onPress={() => setShowLoc(true)} hitSlop={8} accessibilityRole="button">
            <RNText style={tx('600', 13, t.colors.accentDeep)}>
              {place ? 'Change' : 'Find me'}
            </RNText>
          </Pressable>
        </View>

        {worker && (
          <>
            {label('SKILLS · PICK UP TO 5', { marginTop: 20 })}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11 }}>
              {SKILLS.map((s, i) => {
                const on = skills.includes(i);
                return (
                  <Pressable
                    key={s}
                    onPress={() => toggleSkill(i)}
                    style={({ pressed }) => ({
                      borderRadius: 999,
                      paddingVertical: 9,
                      paddingHorizontal: 15,
                      // Selected reads as a solid accent pill rather than a pale
                      // tint, so picked skills are obvious at a glance.
                      backgroundColor: on ? t.colors.accent : t.colors.surface2,
                      borderWidth: 1,
                      borderColor: on ? t.colors.accent : t.colors.line,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <RNText style={tx('600', 13, on ? t.colors.onAccent : t.colors.text)}>{s}</RNText>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {label('START IN', { marginTop: 22 })}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 11 }}>
          {START_MODES.map((m) => {
            const on = mode === m.key;
            return (
              <Pressable
                key={m.key}
                onPress={() => setMode(m.key)}
                style={({ pressed }) => ({
                  flex: 1,
                  borderRadius: 12,
                  padding: 15,
                  backgroundColor: on ? t.colors.accentSoft : t.colors.surface2,
                  borderWidth: 1,
                  borderColor: on ? t.colors.accent : t.colors.line,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                })}
              >
                <RNText style={tx('700', 15, on ? t.colors.accentDeep : t.colors.ink)}>
                  {m.label}
                </RNText>
                <RNText style={tx('400', 12, t.colors.text, { marginTop: 5 })}>{m.sub}</RNText>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={finish}
          style={({ pressed }) => ({
            marginTop: 24,
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
            shadowColor: t.colors.accent,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          <RNText style={tx('700', 16, t.colors.onAccent)}>
            {busy ? 'Saving…' : 'Finish setup'}
          </RNText>
        </Pressable>
      </ScrollView>

      <LocationSheet
        visible={showLoc}
        onCancel={() => setShowLoc(false)}
        onPick={(picked) => {
          touched.current = true;
          setPlace(picked.label);
          setCoords({ lat: picked.lat, lng: picked.lng });
          setShowLoc(false);
        }}
      />
    </Screen>
  );
}
