import { useEffect, useState } from 'react';
import { Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useFocusTick } from '../providers/NavProvider';
import { getTaskHold, moneySettle, type TaskHold } from '../data/api';
import { useMoneyMode } from '../lib/useMoneyMode';
import { holdLine } from '../lib/moneyText';
import { tx } from './primitives';

const ASKED = new Set(['release_asked', 'refund_asked', 'split_asked']);

/**
 * Plan B: one line saying where this task's money is (waiting, held, sent, refunded). Draws nothing under
 * the wallet flow, when the task has no hold, or when the read fails.
 */
export function HoldLine({ taskId }: { taskId: string }) {
  const t = useTheme();
  const { planB } = useMoneyMode();
  const focusTick = useFocusTick();
  const [hold, setHold] = useState<TaskHold | null>(null);

  useEffect(() => {
    if (!planB) return;
    let alive = true;
    void getTaskHold(taskId)
      .then((h) => {
        if (!alive) return;
        setHold(h);
        // A release or refund asked by someone else (an admin's dispute decision, the 3-day auto-approve) runs
        // now instead of waiting for the server's schedule. The server checks the hold; asking twice is harmless.
        if (h && ASKED.has(h.status)) moneySettle(taskId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [planB, taskId, focusTick]);

  if (!planB || !hold) return null;
  const line = holdLine(hold.status, hold.stuck, hold.mine);
  if (!line) return null;
  return (
    <RNText style={tx('600', 12, hold.stuck ? t.colors.signalDeep : t.colors.accentDeep, { marginTop: 10 })} accessibilityLiveRegion="polite">
      {line}
    </RNText>
  );
}
