import { useState } from 'react';
import { Pressable, View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useActions } from '../providers/AppStateProvider';
import { clearMapSpot, setMapAudience, setMapSharing } from '../data/extras';
import { messageOf } from '../lib/errors';
import type { MapAudience } from '../lib/mapSpot';
import { setSharing, type SharingResult } from '../lib/useMapSpot';
import { BottomSheet, PrimaryButton } from './kit';
import { tx } from './primitives';

const COMMON = [
  'Only while TaskDrop is open. It disappears 15 minutes after you close it.',
  'Turn it off any time; your spot is deleted at once.',
  'Guests never see it, and people you block never see it.',
];

const POINTS: Record<MapAudience, string[]> = {
  people: [
    'Only people you’ve finished a task with can see it.',
    'It’s rounded to about half a kilometre, never your exact spot.',
    ...COMMON,
  ],
  everyone: [
    'Other signed-in adults on TaskDrop near you can see your first name and a rounded spot about 2 km wide. No photo, no exact place.',
    'People you’ve finished a task with still see your name and the finer spot.',
    ...COMMON,
  ],
};

const CHOICES: { value: MapAudience; label: string; hint: string }[] = [
  { value: 'people', label: 'My people', hint: 'People you’ve finished a task with' },
  { value: 'everyone', label: 'Everyone nearby', hint: 'Other TaskDrop members near you' },
];

/** Plain words for each way the phone can say no to location. Nothing here is a legal claim. */
const WHY_OFF: Record<Exclude<SharingResult, 'on' | 'off'>, string> = {
  denied: 'Location is off, so your spot can’t be shared',
  blocked: 'Location is off for TaskDrop. Turn it on in your phone’s settings to share your spot',
  'services-off': 'Location is off, so your spot can’t be shared',
  unavailable: 'Location isn’t available right now, so your spot can’t be shared',
};

/**
 * Stops sharing on this device and on the server (the spot is deleted at once). Used by the
 * "Hide me now" button and the switch. Both server calls are tried even if the first fails, so a
 * hiccup never leaves the spot visible; it throws a plain message if either one failed.
 */
export async function stopSharingMySpot(): Promise<void> {
  await setSharing(false);
  let failed = false;
  try {
    await clearMapSpot();
  } catch {
    failed = true;
  }
  try {
    await setMapSharing(false);
  } catch {
    failed = true;
  }
  if (failed) throw new Error('We couldn’t hide your spot just now. Please try again.');
}

/**
 * The notice shown before a spot is first shared (design D20, notice v1) with the second choice, who may see it
 * (owner decision 35b, notice v2): "My people" (the default) or "Everyone nearby". Nothing is wider unless the
 * person picks it. "Share my spot" is the only place location permission is asked. The server is told only after
 * the phone says yes; if saving fails, sharing is switched back off on the device.
 *
 * `audienceOnly`: sharing is already on and the person is switching to "Everyone nearby" (Account → Map); the
 * sheet then shows just that notice and its own button, and asks for no location permission.
 * `onDone(true)` fires once the choice is saved; the sheet closes itself when finished.
 */
export function PeopleMapSheet({
  visible,
  onClose,
  onDone,
  audienceOnly = false,
}: {
  visible: boolean;
  onClose: () => void;
  onDone?: (on: boolean) => void;
  audienceOnly?: boolean;
}) {
  const t = useTheme();
  const { flash } = useActions();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<MapAudience>('people');
  const audience: MapAudience = audienceOnly ? 'everyone' : picked;

  const widen = async (): Promise<boolean> => {
    try {
      await setMapAudience('everyone');
      return true;
    } catch (e) {
      flash(messageOf(e, 'We couldn’t switch to everyone just now. Your spot stays with your people only.'));
      return false;
    }
  };

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (audienceOnly) {
        const ok = await widen();
        onDone?.(ok);
        if (ok) onClose();
        return;
      }
      const r = await setSharing(true);
      if (r !== 'on') {
        if (r !== 'off') flash(WHY_OFF[r]);
        onDone?.(false);
        onClose();
        return;
      }
      try {
        await setMapSharing(true);
      } catch (e) {
        await setSharing(false);
        flash(messageOf(e, 'We couldn’t turn this on just now. Please try again.'));
        onDone?.(false);
        return;
      }
      // The wider audience is a second, explicit step. If it fails, the spot is still on, for my people only.
      if (picked === 'everyone') await widen();
      onDone?.(true);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={busy ? () => undefined : onClose}
      title={audienceOnly ? 'Show your spot to everyone nearby?' : 'Show your spot on the map?'}
    >
      {audienceOnly ? null : (
        <View style={{ gap: 8, marginBottom: 16 }} accessibilityRole="radiogroup" accessibilityLabel="Who can see my spot">
          {CHOICES.map((c) => {
            const on = picked === c.value;
            return (
              <Pressable
                key={c.value}
                onPress={() => setPicked(c.value)}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: busy }}
                accessibilityLabel={c.label}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: on ? t.colors.accent : t.colors.line,
                  backgroundColor: on ? t.colors.accentSoft : 'transparent',
                }}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: on ? t.colors.accent : t.colors.line,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors.accent }} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <RNText style={tx('700', 14, t.colors.ink)}>{c.label}</RNText>
                  <RNText style={tx('500', 12.5, t.colors.muted)}>{c.hint}</RNText>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      <View style={{ gap: 12 }}>
        {POINTS[audience].map((p) => (
          <View key={p} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: t.colors.accent, marginTop: 7 }} />
            <RNText style={tx('500', 14, t.colors.text, { flex: 1, lineHeight: 20 })}>{p}</RNText>
          </View>
        ))}
      </View>
      <View style={{ gap: 10, marginTop: 20 }}>
        <PrimaryButton
          label={audienceOnly ? 'Show me to everyone nearby' : 'Share my spot'}
          onPress={() => void share()}
          busy={busy}
        />
        <PrimaryButton label="Not now" tone="quiet" onPress={onClose} disabled={busy} />
      </View>
    </BottomSheet>
  );
}
