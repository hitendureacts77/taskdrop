import { useEffect, useState } from 'react';
import { Pressable, Text as RNText, View, type ViewStyle } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useActions } from '../providers/AppStateProvider';
import { getMapSharing } from '../data/extras';
import { messageOf } from '../lib/errors';
import { initMapSharing, isSharing, useMapSharing } from '../lib/useMapSpot';
import { PeopleMapSheet, stopSharingMySpot } from './PeopleMapSheet';
import { PrimaryButton } from './kit';
import { tx } from './primitives';

/**
 * Account → App → "Map": the switch for showing your rounded spot to people you have finished a
 * task with. Switching it on always opens the notice first; it is never turned on without it.
 * The switch has no animation of its own, so there is nothing to tone down for reduced motion.
 */
export function PeopleMapCard({ style }: { style?: ViewStyle }) {
  const t = useTheme();
  const { flash } = useActions();
  const { sharing } = useMapSharing();
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const saved = await getMapSharing();
      // The server says it is on but this phone has not started yet (e.g. just signed in): catch up.
      if (saved?.share_live && !isSharing()) await initMapSharing();
      if (live) setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const turnOff = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stopSharingMySpot();
      flash('Your spot is hidden and deleted');
    } catch (e) {
      flash(messageOf(e, 'We couldn’t hide your spot just now. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const onToggle = () => {
    if (sharing) void turnOff();
    else setNotice(true);
  };

  return (
    <View style={style}>
      <RNText style={tx('800', 15, t.colors.ink)}>Map</RNText>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 12 }}>
        <RNText style={tx('600', 14, t.colors.ink, { flex: 1 })}>Show my spot to my people</RNText>
        <Pressable
          onPress={onToggle}
          disabled={!loaded || busy}
          accessibilityRole="switch"
          accessibilityLabel="Show my spot to my people"
          accessibilityState={{ checked: sharing, disabled: !loaded || busy }}
          hitSlop={8}
          style={{
            width: 48,
            height: 28,
            borderRadius: 999,
            padding: 3,
            backgroundColor: sharing ? t.colors.accent : t.colors.line,
            justifyContent: 'center',
            alignItems: sharing ? 'flex-end' : 'flex-start',
            opacity: !loaded || busy ? 0.6 : 1,
          }}
        >
          <View style={{ width: 22, height: 22, borderRadius: 22, backgroundColor: t.colors.surface }} />
        </Pressable>
      </View>
      {sharing ? (
        <>
          <RNText style={tx('500', 13, t.colors.muted, { marginTop: 6 })}>
            Only people you’ve finished a task with can see it, rounded to about half a kilometre.
          </RNText>
          <PrimaryButton label="Hide me now" tone="quiet" onPress={() => void turnOff()} busy={busy} style={{ marginTop: 12 }} />
        </>
      ) : (
        <RNText style={tx('500', 13, t.colors.muted, { marginTop: 6 })}>Off: you’re hidden (ghost)</RNText>
      )}
      <PeopleMapSheet visible={notice} onClose={() => setNotice(false)} />
    </View>
  );
}
