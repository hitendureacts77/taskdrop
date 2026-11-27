import { useEffect, useState } from 'react';
import { BackHandler, Text as RNText, View } from 'react-native';
import { Screen } from '../components/ui';
import { PrimaryButton } from '../components/kit';
import { tx } from '../components/primitives';
import { ActionBar, ActionBarContext, FormPage } from '../components/FormPage';
import { UsernameField, useUsernameCheck } from '../components/UsernameField';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { updateProfileExtras } from '../data/extras';
import { runPendingAfterSignIn } from '../lib/guest';
import { markUsernameSet } from '../components/UsernameGate';
import { useLayout } from '../lib/layout';

/**
 * Plan 1.18 (decision 51): a signed-in account with no username sees only this page until it picks one. It cannot
 * be closed or backed out of; signing out is the only other way off it. Once saved, the person carries on where
 * they were going: the screen underneath, and a guest's half-done post or offer finishes by itself.
 */
export function PickUsernameScreen() {
  const t = useTheme();
  const { desktop } = useLayout();
  const { back, reset } = useNav();
  const { flash } = useActions();
  const { userId, signOut } = useAuth();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const check = useUsernameCheck(username);

  // Android's back button does nothing here.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  // Saved, but nothing underneath to go back to (the page was the first one shown): Home.
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => reset('home'), 400);
    return () => clearTimeout(id);
  }, [saved, reset]);

  const save = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await updateProfileExtras(userId, { username });
      markUsernameSet(userId);
      setSaved(true);
      back();
      runPendingAfterSignIn();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save your username');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded={false}>
      <FormPage
        phoneActions="pinned"
        scrollProps={{ style: { flex: 1 }, contentContainerStyle: { paddingHorizontal: 20, paddingTop: 30, paddingBottom: 20 }, keyboardShouldPersistTaps: 'handled' }}
        actions={
          <ActionBar
            hint={
              <ActionBarContext.Provider value={desktop}>
                <View style={desktop ? undefined : { paddingHorizontal: 20, paddingBottom: 16 }}>
                  <PrimaryButton label="Sign out" tone="quiet" onPress={() => void signOut()} style={desktop ? { alignSelf: 'flex-start' } : { marginTop: 8 }} />
                </View>
              </ActionBarContext.Provider>
            }
          >
            <View style={desktop ? undefined : { paddingHorizontal: 20 }}>
              <PrimaryButton
                label="Continue"
                busy={busy}
                disabled={!check.ok || check.free === false || saved}
                onPress={() => void save()}
              />
            </View>
          </ActionBar>
        }
      >
        <RNText style={tx('800', 26, t.colors.ink, { letterSpacing: -0.7 })}>Pick a username</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21 })}>
          Every TaskDrop account has one. It’s how people find you, and you can sign in with it once you set a password.
        </RNText>
        <UsernameField value={username} onChangeText={setUsername} check={check} style={{ marginTop: 20 }} />
      </FormPage>
    </Screen>
  );
}
