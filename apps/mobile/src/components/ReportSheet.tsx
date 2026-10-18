import { useEffect, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import { useActions } from '../providers/AppStateProvider';
import { useTheme } from '../providers/ThemeProvider';
import { blockUser, reportContent } from '../data/api';
import { BottomSheet, Field, PrimaryButton } from './kit';
import { tx } from './primitives';

/**
 * Report a person or a task to the TaskDrop team (not a dispute: no payment is
 * held). The team sees it in the admin panel's reports queue. Optionally block
 * the person at the same time.
 */
export function ReportSheet({
  visible,
  onClose,
  targetType,
  targetId,
  personId,
  personName,
}: {
  visible: boolean;
  onClose: () => void;
  targetType: 'user' | 'task';
  targetId: string | null;
  /** Who to offer to block; omit to hide the option. */
  personId?: string | null;
  personName?: string;
}) {
  const t = useTheme();
  const { flash, celebrate } = useActions();
  const [reason, setReason] = useState('');
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setReason('');
      setBlock(false);
    }
  }, [visible]);

  const send = async () => {
    if (busy) return;
    if (!targetId) return flash('This is a sample, so there is nothing to report');
    if (reason.trim().length < 5) return flash('Tell us what is wrong, in a few words');
    setBusy(true);
    try {
      await reportContent(targetType, targetId, reason);
      let blocked = false;
      if (block && personId) {
        blocked = await blockUser(personId).then(() => true, () => false);
      }
      onClose();
      if (block && personId && !blocked) flash('Reported, but we could not block them');
      else celebrate(blocked ? 'Reported and blocked' : 'Thanks, we will look into it');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send the report');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={() => !busy && onClose()}
      title={targetType === 'user' ? 'Report this person' : 'Report this task'}
      subtitle="The TaskDrop team reads every report. The other person is not told who reported."
      footer={<PrimaryButton label="Send report" onPress={() => void send()} busy={busy} disabled={reason.trim().length < 5} />}
    >
      <Field
        label="What is wrong?"
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={500}
        placeholder="E.g. asking to pay outside TaskDrop, abusive messages, a scam"
      />
      {personId ? (
        <Pressable
          onPress={() => setBlock((b) => !b)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: block }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              borderWidth: 2,
              borderColor: block ? t.colors.accentDeep : t.colors.line,
              backgroundColor: block ? t.colors.accentDeep : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {block ? <RNText style={tx('800', 13, t.colors.onBtn)}>✓</RNText> : null}
          </View>
          <RNText style={tx('600', 14, t.colors.ink, { flex: 1 })}>Also block {personName ?? 'this person'}</RNText>
        </Pressable>
      ) : null}
    </BottomSheet>
  );
}
