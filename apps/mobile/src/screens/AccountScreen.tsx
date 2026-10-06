import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable } from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { Badge, ConfirmDialog, Field, PrimaryButton, SwipeTabs, TopBar, UnderlineTabs } from '../components/kit';
import { nameCarriesContact } from '../lib/mask';
import { tx } from '../components/primitives';
import { useTheme, useThemeControls } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { useMode } from '../providers/ModeProvider';
import { useSwitchMode } from '../lib/useSwitchMode';
import { getProfile, updateProfile, type Profile } from '../data/api';
import {
  accountDeletionCheck,
  deleteMyAccount,
  type DeletionBlocker,
  setPassword,
  updateProfileExtras,
  usernameAvailable,
  verificationState,
} from '../data/extras';

// Fees live on their own page (Help & support → How fees work), not in settings.
const TABS = ['You', 'Sign-in', 'App'];

/**
 * Account & settings: the handle and name people see, the password that makes
 * @username sign-in possible, what the account costs, and how the app looks.
 */
export function AccountScreen() {
  const t = useTheme();
  const { back, go, params } = useNav();
  const { flash, celebrate } = useActions();
  const { userId, signOut } = useAuth();
  const { reset } = useNav();
  const { pref, setPref } = useThemeControls();
  const { mode } = useMode();
  // Earn needs a worker profile first; this opens setup when it is missing.
  const switchMode = useSwitchMode();
  const [tab, setTab] = useState(typeof params.tab === 'number' ? params.tab : 0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [free, setFree] = useState<boolean | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [verify, setVerify] = useState<{ phone: boolean; email: boolean; google: boolean } | null>(null);
  // Account deletion: checked first, so what is in the way shows on the card.
  const [checkingDelete, setCheckingDelete] = useState(false);
  const [blockers, setBlockers] = useState<DeletionBlocker[] | null>(null);
  const [keepsRecords, setKeepsRecords] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void getProfile(userId).then((p) => {
      setProfile(p);
      setName(p?.display_name ?? '');
      setUsername(p?.username ?? '');
    });
    void verificationState().then(setVerify);
  }, [userId]);

  // Check the handle as it is typed, debounced.
  useEffect(() => {
    const handle = username.trim().toLowerCase();
    if (!handle || handle === profile?.username) {
      setFree(null);
      return;
    }
    const id = setTimeout(() => void usernameAvailable(handle).then(setFree), 350);
    return () => clearTimeout(id);
  }, [username, profile?.username]);

  const handleOk = /^[a-z0-9_]{3,20}$/.test(username.trim().toLowerCase());

  const saveProfile = async () => {
    if (!userId) return;
    if (!name.trim()) return flash('Add a display name');
    if (username.trim() && !handleOk) return flash('Usernames are 3–20 characters: a–z, 0–9 and _');
    if (nameCarriesContact(name) || nameCarriesContact(username)) {
      return flash('Names and usernames can’t contain a phone number or email. Contacts are shared once a task starts.');
    }
    setSavingProfile(true);
    try {
      await updateProfile(userId, { displayName: name.trim() });
      const p = await updateProfileExtras(userId, { username: username.trim() || null });
      setProfile(p);
      celebrate('Saved');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (!profile?.username) return flash('Pick a username first — it is what you sign in with');
    if (pw !== pw2) return flash('The two passwords do not match');
    setSavingPw(true);
    try {
      await setPassword(pw);
      setPw('');
      setPw2('');
      celebrate('Password set');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not set the password');
    } finally {
      setSavingPw(false);
    }
  };

  const startDelete = async () => {
    setCheckingDelete(true);
    try {
      const res = await accountDeletionCheck();
      setBlockers(res.blockers);
      setKeepsRecords(res.keepsRecords);
      if (res.blockers.length === 0) setConfirmDelete(true);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not check your account');
    } finally {
      setCheckingDelete(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteMyAccount();
      setConfirmDelete(false);
      reset('splash');
    } catch (e) {
      setConfirmDelete(false);
      flash(e instanceof Error ? e.message : 'Could not delete your account');
    } finally {
      setDeleting(false);
    }
  };

  const card = { backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 15, marginTop: 14 } as const;

  return (
    <Screen padded={false}>
      <TopBar title="Account & settings" onBack={back} />
      <UnderlineTabs tabs={TABS} active={tab} onPick={setTab} />
      <SwipeTabs index={tab} count={TABS.length} onChange={setTab}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        {tab === 0 ? (
          <>
            <View style={card}>
              <RNText style={tx('800', 15, t.colors.ink)}>Account information</RNText>
              <Field label="Display name" value={name} onChangeText={setName} style={{ marginTop: 14 }} maxLength={40} />
              <Field
                label="Username"
                value={username}
                onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase().slice(0, 20))}
                style={{ marginTop: 14 }}
                autoCapitalize="none"
                autoCorrect={false}
                left={<RNText style={tx('600', 15, t.colors.muted)}>@</RNText>}
                error={username && !handleOk ? '3–20 characters: a–z, 0–9 and _' : free === false ? 'That username is taken' : null}
                hint={free ? 'Available' : 'Your public handle, and how you sign in with a password'}
              />
              <PrimaryButton label="Save" onPress={() => void saveProfile()} busy={savingProfile} style={{ marginTop: 16 }} />
            </View>
            <View style={card}>
              <RNText style={tx('800', 15, t.colors.ink)}>More about you</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 18 })}>
                Bio, skills, languages and location live on your profile page.
              </RNText>
              <Pressable onPress={() => go('profileEdit')} style={{ marginTop: 12 }} accessibilityRole="button">
                <RNText style={tx('700', 13, t.colors.accentDeep)}>Edit profile ›</RNText>
              </Pressable>
            </View>
            <View style={card}>
              <RNText style={tx('800', 15, t.colors.ink)}>Identity verification</RNText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                <Badge label={verify?.phone ? 'Phone ✓' : 'Phone'} tone={verify?.phone ? 'accent' : 'neutral'} />
                <Badge label={verify?.email ? 'Email ✓' : 'Email'} tone={verify?.email ? 'accent' : 'neutral'} />
                <Badge label="ID · coming soon" tone="neutral" />
              </View>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 10, lineHeight: 18 })}>
                Level {(verify?.phone ? 1 : 0) + (verify?.email ? 1 : 0)}/3 · Verified accounts get more replies.
              </RNText>
            </View>
          </>
        ) : null}

        {tab === 1 ? (
          <>
            <View style={card}>
              <RNText style={tx('800', 15, t.colors.ink)}>Password sign-in</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 18 })}>
                {profile?.username
                  ? `Set a password to sign in as @${profile.username} without an SMS code.`
                  : 'Pick a username on the You tab first — you sign in with it.'}
              </RNText>
              <Field label="New password" value={pw} onChangeText={setPw} secureTextEntry style={{ marginTop: 14 }} autoCapitalize="none" />
              <Field
                label="Confirm password"
                value={pw2}
                onChangeText={setPw2}
                secureTextEntry
                style={{ marginTop: 14 }}
                autoCapitalize="none"
                error={pw2 && pw !== pw2 ? 'Does not match' : null}
                hint="At least 8 characters."
              />
              <PrimaryButton
                label="Set password"
                onPress={() => void savePassword()}
                busy={savingPw}
                disabled={!profile?.username || pw.length < 8 || pw !== pw2}
                style={{ marginTop: 16 }}
              />
            </View>
            <View style={card}>
              <RNText style={tx('800', 15, t.colors.ink)}>Sign-in methods</RNText>
              <View style={{ gap: 8, marginTop: 10 }}>
                <RNText style={tx('400', 13, t.colors.text)}>{verify?.phone ? '✓' : '–'} Mobile number (SMS code)</RNText>
                <RNText style={tx('400', 13, t.colors.text)}>{verify?.google ? '✓' : '–'} Google</RNText>
                <RNText style={tx('400', 13, t.colors.text)}>{profile?.username ? '✓' : '–'} Username and password</RNText>
              </View>
            </View>
            <Pressable
              onPress={() => setConfirmSignOut(true)}
              accessibilityRole="button"
              style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <Icon name="logout" size={18} color={t.colors.signal} />
              <RNText style={tx('700', 14, t.colors.signal)}>Sign out on this device</RNText>
            </Pressable>
            <View style={card}>
              <RNText style={tx('800', 15, t.colors.ink)}>Delete account</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 18 })}>
                Removes your name, username, photo, location, saved payout details and sign-in methods, and signs you out
                everywhere. Records of paid tasks and payments are kept, under “Deleted user”, because the law requires it.
                This can’t be undone.
              </RNText>
              {blockers && blockers.length > 0 ? (
                <View style={{ marginTop: 12, gap: 8 }} accessibilityLiveRegion="polite">
                  <RNText style={tx('700', 13, t.colors.ink)}>Before you can delete your account:</RNText>
                  {blockers.map((b) => (
                    <RNText key={b.code} style={tx('400', 13, t.colors.text, { lineHeight: 19 })}>
                      • {b.message}
                    </RNText>
                  ))}
                </View>
              ) : null}
              <Pressable
                onPress={() => void startDelete()}
                disabled={checkingDelete}
                accessibilityRole="button"
                accessibilityState={{ busy: checkingDelete }}
                style={({ pressed }) => ({ marginTop: 14, opacity: pressed || checkingDelete ? 0.6 : 1 })}
              >
                <RNText style={tx('700', 14, t.colors.signal)}>
                  {checkingDelete ? 'Checking…' : blockers && blockers.length > 0 ? 'Check again' : 'Delete my account…'}
                </RNText>
              </Pressable>
            </View>
          </>
        ) : null}

        {tab === 2 ? (
          <>
            <View style={card}>
              <RNText style={tx('800', 15, t.colors.ink)}>Theme</RNText>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                {(['system', 'light', 'dark'] as const).map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => setPref(p)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: pref === p }}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: pref === p ? t.colors.accent : t.colors.line,
                      backgroundColor: pref === p ? t.colors.accentSoft : 'transparent',
                      alignItems: 'center',
                    }}
                  >
                    <RNText style={tx('600', 13, pref === p ? t.colors.ink : t.colors.muted)}>
                      {p === 'system' ? 'System' : p === 'light' ? 'Light' : 'Dark'}
                    </RNText>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={card}>
              <RNText style={tx('800', 15, t.colors.ink)}>Mode</RNText>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                {(['poster', 'worker'] as const).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => void switchMode(m)}
                    accessibilityRole="button"
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: mode === m ? t.colors.accent : t.colors.line,
                      backgroundColor: mode === m ? t.colors.accentSoft : 'transparent',
                      alignItems: 'center',
                    }}
                  >
                    <RNText style={tx('600', 13, mode === m ? t.colors.ink : t.colors.muted)}>
                      {m === 'poster' ? 'Hire' : 'Earn'}
                    </RNText>
                  </Pressable>
                ))}
              </View>
            </View>
            {/* A customer's spending screens, kept here on purpose rather than on the
                profile, so they aren't in front of them on every visit. */}
            {mode !== 'worker' ? (
              <View style={card}>
                <RNText style={tx('800', 15, t.colors.ink)}>Spending</RNText>
                {(
                  [
                    ['My spending and requests', 'analytics'],
                    ['Spending insights', 'spending'],
                  ] as const
                ).map(([label, screen], i) => (
                  <Pressable
                    key={screen}
                    onPress={() => go(screen)}
                    accessibilityRole="button"
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 13,
                      marginTop: i === 0 ? 4 : 0,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: t.colors.line,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <RNText style={tx('600', 14, t.colors.ink)}>{label}</RNText>
                    <Icon name="chevronRight" size={16} color={t.colors.muted} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      </SwipeTabs>
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
          void signOut().finally(() => reset('splash'));
        }}
      />
      <ConfirmDialog
        visible={confirmDelete}
        danger
        busy={deleting}
        icon="close"
        title="Delete your account for good?"
        message={
          'Your profile, photo, username, location and sign-in methods are removed and you’re signed out on every device. ' +
          (keepsRecords
            ? 'Your past paid tasks, messages and payment records stay, shown as “Deleted user”. '
            : '') +
          'Signing in again with the same number or Google account starts a new, empty account.'
        }
        confirmLabel="Delete account"
        cancelLabel="Keep my account"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
      />
    </Screen>
  );
}
