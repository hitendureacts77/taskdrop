import { useState } from 'react';
import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { sendFeedback, type FeedbackKind } from '../data/extras';
import { BottomSheet, Field, Pill, PrimaryButton } from './kit';
import { tx } from './primitives';

const KINDS: { key: FeedbackKind; label: string }[] = [
  { key: 'broken', label: 'Something is broken' },
  { key: 'confusing', label: 'Something is confusing' },
  { key: 'idea', label: 'I have an idea' },
  { key: 'praise', label: 'Something I love' },
];

/** "Send feedback": goes straight to the team, no reply expected. */
export function FeedbackSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const { screen } = useNav();
  const { flash, celebrate } = useApp();
  const [kind, setKind] = useState<FeedbackKind>('idea');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await sendFeedback(kind, body, screen);
      setBody('');
      onClose();
      celebrate('Thanks — the team will read it');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Send feedback"
      subtitle="Goes straight to the team that builds TaskDrop. For help with a payment or a task, use Help & support instead."
      footer={<PrimaryButton label="Send feedback" onPress={() => void send()} busy={busy} disabled={body.trim().length < 3} />}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {KINDS.map((k) => (
          <Pill key={k.key} label={k.label} active={kind === k.key} onPress={() => setKind(k.key)} />
        ))}
      </View>
      <Field
        style={{ marginTop: 14 }}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={2000}
        placeholder="Tell us what happened or what you’d like"
      />
      <RNText style={tx('400', 11, t.colors.muted, { marginTop: 8 })}>
        We attach the screen you were on, so you don’t have to describe where you were.
      </RNText>
    </BottomSheet>
  );
}
