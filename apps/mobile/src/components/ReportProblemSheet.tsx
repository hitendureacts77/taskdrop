import { useEffect, useState } from 'react';
import { useActions } from '../providers/AppStateProvider';
import { openDispute } from '../data/api';
import { REPORT_SUBTITLE } from '../legal/disputePolicy';
import { BottomSheet, Field, PrimaryButton } from './kit';

/**
 * "Report a problem" on a job that is under way.
 *
 * It asks what went wrong first: that sentence is all an admin has to decide the
 * dispute by (migration 072 keeps it), so it is required. Reporting freezes the
 * payment until the team decides; nothing is paid out or refunded here.
 */
export function ReportProblemSheet({
  taskId,
  visible,
  onClose,
  onReported,
}: {
  taskId: string | null;
  visible: boolean;
  onClose: () => void;
  onReported?: () => void;
}) {
  const { flash, celebrate } = useActions();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // A sheet that was cancelled or sent starts blank the next time.
  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);

  const send = async () => {
    if (busy) return;
    if (!taskId) return flash('This is a sample task');
    if (reason.trim().length < 10) return flash('Tell us what went wrong, in a sentence or two');
    setBusy(true);
    try {
      await openDispute(taskId, reason);
      onClose();
      celebrate('Problem reported · payment is on hold');
      onReported?.();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not report the problem');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={() => !busy && onClose()}
      title="Report a problem"
      subtitle={REPORT_SUBTITLE}
      footer={<PrimaryButton label="Report problem" onPress={() => void send()} busy={busy} disabled={reason.trim().length < 10} />}
    >
      <Field
        label="What went wrong?"
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={1000}
        placeholder="E.g. the work isn’t what we agreed, or the other person stopped replying"
        hint="TaskDrop reads this before deciding who gets the money."
      />
    </BottomSheet>
  );
}
