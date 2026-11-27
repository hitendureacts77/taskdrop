import { useState } from 'react';
import { Text as RNText } from 'react-native';
import { BottomSheet, MenuRow } from './kit';
import { tx } from './primitives';
import { formatINR } from './ui';
import { useTheme } from '../providers/ThemeProvider';
import { raiseTopUp, type Task } from '../data/api';
import { nextTopUpSteps, raisedPriceMinor } from '../lib/topUp';

type TopUpTask = Pick<Task, 'id' | 'benchmark_minor' | 'topup_pct'>;

/**
 * The Top up picker (D31): lists the bigger steps; the server prices the real change (raise_task_topup).
 * Shared by My Tasks, Task manage and Orders. `onRaised` gets the new numbers so a screen can update its list.
 */
export function TopUpSheet({
  task,
  onClose,
  onRaised,
  flash,
}: {
  task: TopUpTask | null;
  onClose: () => void;
  onRaised?: (taskId: string, out: { topup_pct: number; benchmark_minor: number } | null) => void;
  flash: (msg: string) => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);

  const raise = async (x: TopUpTask, pct: number) => {
    setBusy(true);
    try {
      const out = await raiseTopUp(x.id, pct);
      onClose();
      flash(`Topped up ${pct}%: workers now see ${formatINR(out?.benchmark_minor ?? raisedPriceMinor(x.benchmark_minor, x.topup_pct, pct))}`);
      onRaised?.(x.id, out);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not top up that task');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={task !== null} onClose={() => (busy ? undefined : onClose())} title="Top up this task">
      {task ? (
        <>
          <RNText style={tx('500', 13, t.colors.muted, { lineHeight: 19, marginBottom: 6 })}>
            {`Now ${formatINR(task.benchmark_minor)}${task.topup_pct ? ` with a ${task.topup_pct}% top-up` : ''}. A top-up raises what workers see; you pay only when you accept an offer.`}
          </RNText>
          {nextTopUpSteps(task.topup_pct).map((pct) => (
            <MenuRow
              key={pct}
              icon="plus"
              label={`Top up ${pct}%`}
              sub={`Workers see ${formatINR(raisedPriceMinor(task.benchmark_minor, task.topup_pct, pct))}`}
              onPress={() => (busy ? undefined : void raise(task, pct))}
            />
          ))}
        </>
      ) : null}
    </BottomSheet>
  );
}
