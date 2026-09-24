import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { canQuoteOn, placeBid, type Task } from '../data/api';
import { DateTimeSheet, formatDeadline } from './DateTimeSheet';
import { BottomSheet, Field, PrimaryButton, rupees } from './kit';
import { Icon } from './Icon';
import { tx } from './primitives';

/** How far above the posted budget a worker may ask, as on the task page. */
const MAX_OVER = 1.3;

/**
 * "Submit your bid": a proposal, an optional different rate, optional hours,
 * and an optional delivery date. It is an ordinary quote underneath -- the
 * same placeBid() and the same RLS checks as the task page -- with the
 * proposal and date carried in the quote's message.
 */
export function BidSheet({
  task,
  visible,
  onClose,
  onPlaced,
}: {
  task: Task | null;
  visible: boolean;
  onClose: () => void;
  onPlaced?: () => void;
}) {
  const t = useTheme();
  const { flash, celebrate } = useApp();
  const { userId } = useAuth();
  const [proposal, setProposal] = useState('');
  const [rate, setRate] = useState('');
  const [hours, setHours] = useState('');
  const [deliverBy, setDeliverBy] = useState<Date | null>(null);
  const [showDate, setShowDate] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible || !task || !userId) return;
    setProposal('');
    setRate('');
    setHours('');
    setDeliverBy(null);
    setBlocked(null);
    let alive = true;
    void canQuoteOn(task.id, userId).then((v) => {
      if (alive && !v.allowed) setBlocked(v.reason);
    });
    return () => {
      alive = false;
    };
  }, [visible, task, userId]);

  if (!task) return null;
  const budget = Math.round(task.benchmark_minor / 100);
  const cap = Math.floor(budget * MAX_OVER);
  const asked = rate.trim() ? Number(rate) : budget;
  const rateError =
    rate.trim() && (!Number.isFinite(asked) || asked < 10)
      ? 'Enter at least ₹10'
      : asked > cap
        ? `You can ask up to ${rupees(cap)}`
        : null;
  const auto = task.assignment_mode === 'auto' && asked <= budget;

  const submit = async () => {
    if (!userId) return flash('Sign in to send a quote');
    if (proposal.trim().length < 10) return flash('Introduce yourself in a sentence or two');
    if (rateError) return flash(rateError);
    setBusy(true);
    try {
      const h = Number(hours);
      const lines = [proposal.trim()];
      if (Number.isFinite(h) && h > 0) lines.push(`Estimated time: ${h} hour${h === 1 ? '' : 's'}`);
      if (deliverBy) lines.push(`Can deliver by: ${formatDeadline(deliverBy)}`);
      await placeBid({
        taskId: task.id,
        workerId: userId,
        priceMinor: Math.round(asked * 100),
        timeLimitMinutes: Number.isFinite(h) && h > 0 ? Math.round(h * 60) : 240,
        message: lines.join('\n'),
      });
      onClose();
      celebrate(auto ? 'Accepted! Wait for the poster to fund escrow' : `Bid sent at ${rupees(asked)}`);
      onPlaced?.();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send your bid');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BottomSheet
        visible={visible && !showDate}
        onClose={onClose}
        title="Submit your bid"
        subtitle={task.title}
        footer={
          <PrimaryButton
            label={auto ? 'Accept this task' : 'Submit bid'}
            onPress={() => void submit()}
            busy={busy}
            disabled={Boolean(blocked) || proposal.trim().length < 10 || Boolean(rateError)}
          />
        }
      >
        <RNText style={tx('700', 13, t.colors.accentDeep)}>{rupees(budget)} budget</RNText>
        {blocked ? (
          <View style={{ marginTop: 10, backgroundColor: t.colors.signalSoft, borderRadius: 10, padding: 12 }}>
            <RNText style={tx('600', 13, t.colors.signalDeep)}>{blocked}</RNText>
          </View>
        ) : null}
        <Field
          label="Your proposal"
          style={{ marginTop: 14 }}
          value={proposal}
          onChangeText={setProposal}
          multiline
          maxLength={800}
          placeholder="Introduce yourself and explain why you’re the best fit"
        />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <Field
            label="Your rate (₹)"
            style={{ flex: 1 }}
            value={rate}
            onChangeText={(v) => setRate(v.replace(/[^0-9]/g, '').slice(0, 7))}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder={String(budget)}
            error={rateError}
          />
          <Field
            label="Your hours"
            style={{ flex: 1 }}
            value={hours}
            onChangeText={(v) => setHours(v.replace(/[^0-9.]/g, '').slice(0, 5))}
            keyboardType="decimal-pad"
            placeholder="—"
          />
        </View>
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 8, lineHeight: 17 })}>
          Optional — leave the rate blank to accept the posted budget. You can ask up to {rupees(cap)}.
        </RNText>
        {auto ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, backgroundColor: t.colors.accentSoft, borderRadius: 10, padding: 12 }}>
            <Icon name="bolt" size={16} color={t.colors.accentDeep} />
            <RNText style={tx('500', 12, t.colors.accentDeep, { flex: 1, lineHeight: 17 })}>
              This task auto-accepts. A quote at or under the budget is accepted as soon as you send it.
            </RNText>
          </View>
        ) : null}
        <Pressable
          onPress={() => setShowDate(true)}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}
        >
          <Icon name={deliverBy ? 'clock' : 'plus'} size={16} color={t.colors.accentDeep} />
          <RNText style={tx('700', 13, t.colors.accentDeep)}>
            {deliverBy ? `Deliver by ${formatDeadline(deliverBy)}` : 'Suggest a delivery date'}
          </RNText>
          {deliverBy ? (
            <Pressable onPress={() => setDeliverBy(null)} hitSlop={8}>
              <Icon name="close" size={14} color={t.colors.muted} />
            </Pressable>
          ) : null}
        </Pressable>
      </BottomSheet>
      <DateTimeSheet
        visible={visible && showDate}
        initial={deliverBy ?? undefined}
        onCancel={() => setShowDate(false)}
        onConfirm={(d) => {
          setDeliverBy(d);
          setShowDate(false);
        }}
      />
    </>
  );
}
