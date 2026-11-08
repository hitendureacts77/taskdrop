import { useEffect, useState } from 'react';
import { Pressable, Text as RNText, View, type ViewStyle } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useActions } from '../providers/AppStateProvider';
import { getMapSharing, setMapAudience } from '../data/extras';
import { messageOf } from '../lib/errors';
import type { MapAudience } from '../lib/mapSpot';
import { initMapSharing, isSharing, useMapSharing } from '../lib/useMapSpot';
import { PeopleMapSheet, stopSharingMySpot } from './PeopleMapSheet';
import { PrimaryButton } from './kit';
import { tx } from './primitives';

const CHOICES: { value: MapAudience; label: string }[] = [
  { value: 'people', label: 'My people' },
  { value: 'everyone', label: 'Everyone nearby' },
];

/**
 * Account → App → "Map": the switch for showing your rounded spot on the map, and who may see it: the people
 * you have finished a task with (the default) or everyone nearby (owner decision 35b). Switching it on always
 * opens the notice first, and so does choosing "Everyone nearby"; neither happens without it.
 * The switch has no animation of its own, so there is nothing to tone down for reduced motion.
 */
export function PeopleMapCard({ style }: { style?: ViewStyle }) {
  const t = useTheme();
  const { flash } = useActions();
  const { sharing } = useMapSharing();
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState(false);
  const [wider, setWider] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audience, setAudience] = useState<MapAudience>('people');

  useEffect(() => {
    let live = true;
    void (async () => {
      const saved = await getMapSharing();
      // The server says it is on but this phone has not started yet (e.g. just signed in): catch up.
      if (saved?.share_live && !isSharing()) await initMapSharing();
      if (live) {
        setAudience(saved?.share_live && saved.audience === 'everyone' ? 'everyone' : 'people');
        setLoaded(true);
      }
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
      setAudience('people'); // off always puts the audience back to my people
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

  const pickAudience = async (next: MapAudience) => {
    if (busy || next === audience) return;
    if (next === 'everyone') {
      setWider(true); // the notice first
      return;
    }
    setBusy(true);
    try {
      await setMapAudience('people');
      setAudience('people');
      flash('Only your people can see your spot');
    } catch (e) {
      flash(messageOf(e, 'We couldn’t change that just now. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={style}>
      <RNText style={tx('800', 15, t.colors.ink)}>Map</RNText>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 12 }}>
        <RNText style={tx('600', 14, t.colors.ink, { flex: 1 })}>Show my spot on the map</RNText>
        <Pressable
          onPress={onToggle}
          disabled={!loaded || busy}
          accessibilityRole="switch"
          accessibilityLabel="Show my spot on the map"
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
          <RNText style={tx('700', 13, t.colors.ink, { marginTop: 12 })}>Who can see it</RNText>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Who can see my spot">
            {CHOICES.map((c) => {
              const on = audience === c.value;
              return (
                <Pressable
                  key={c.value}
                  onPress={() => void pickAudience(c.value)}
                  disabled={busy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: busy }}
                  accessibilityLabel={c.label}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1.5,
                    borderColor: on ? t.colors.accent : t.colors.line,
                    backgroundColor: on ? t.colors.accentSoft : 'transparent',
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  <RNText style={tx(on ? '800' : '600', 13, t.colors.ink)}>{c.label}</RNText>
                </Pressable>
              );
            })}
          </View>
          <RNText style={tx('500', 13, t.colors.muted, { marginTop: 8 })}>
            {audience === 'everyone'
              ? 'Other signed-in adults nearby see your first name and a rounded spot about 2 km wide. Your people see the finer one.'
              : 'Only people you’ve finished a task with can see it, rounded to about half a kilometre.'}
          </RNText>
          <PrimaryButton label="Hide me now" tone="quiet" onPress={() => void turnOff()} busy={busy} style={{ marginTop: 12 }} />
        </>
      ) : (
        <RNText style={tx('500', 13, t.colors.muted, { marginTop: 6 })}>Off: you’re hidden (ghost)</RNText>
      )}
      <PeopleMapSheet visible={notice} onClose={() => setNotice(false)} onDone={(on) => on && void getMapSharing().then((s) => setAudience(s?.audience === 'everyone' ? 'everyone' : 'people'))} />
      <PeopleMapSheet visible={wider} audienceOnly onClose={() => setWider(false)} onDone={(ok) => ok && setAudience('everyone')} />
    </View>
  );
}
