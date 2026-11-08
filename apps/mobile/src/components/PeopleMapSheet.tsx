import { useState } from 'react';
import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useActions } from '../providers/AppStateProvider';
import { clearMapSpot, setMapSharing } from '../data/extras';
import { messageOf } from '../lib/errors';
import { setSharing, type SharingResult } from '../lib/useMapSpot';
import { BottomSheet, PrimaryButton } from './kit';
import { tx } from './primitives';

const POINTS = [
  'Only people you’ve finished a task with can see it.',
  'It’s rounded to about half a kilometre, never your exact spot.',
  'Only while TaskDrop is open. It disappears 15 minutes after you close it.',
  'Turn it off any time; your spot is deleted at once.',
  'Strangers never see it. Guests never see it.',
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
 * The notice shown before "Show my spot to my people" is first switched on (design D20, notice v1).
 * "Share my spot" is the only place location permission is asked. The server is told only after
 * the phone says yes; if saving fails, sharing is switched back off on the device.
 * `onDone(true)` fires once sharing is on; the sheet closes itself when finished.
 */
export function PeopleMapSheet({
  visible,
  onClose,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  onDone?: (on: boolean) => void;
}) {
  const t = useTheme();
  const { flash } = useActions();
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
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
      onDone?.(true);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={busy ? () => undefined : onClose} title="Show your spot to your people?">
      <View style={{ gap: 12 }}>
        {POINTS.map((p) => (
          <View key={p} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: t.colors.accent, marginTop: 7 }} />
            <RNText style={tx('500', 14, t.colors.text, { flex: 1, lineHeight: 20 })}>{p}</RNText>
          </View>
        ))}
      </View>
      <View style={{ gap: 10, marginTop: 20 }}>
        <PrimaryButton label="Share my spot" onPress={() => void share()} busy={busy} />
        <PrimaryButton label="Not now" tone="quiet" onPress={onClose} disabled={busy} />
      </View>
    </BottomSheet>
  );
}
