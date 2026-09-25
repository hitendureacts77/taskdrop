import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ActivityIndicator } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { canQuoteOn, getMyBid, placeBid, updateBid, type Bid, type Task } from '../data/api';
import { maskContacts } from '../lib/mask';
import { DateTimeSheet, formatDeadline } from './DateTimeSheet';
import { BottomSheet, Field, PrimaryButton, rupees } from './kit';
import { Icon } from './Icon';
import { tx } from './primitives';

const HOURS_LINE = /^Estimated time: ([\d.]+) hours?$/m;
const DATE_LINE = /^Can deliver by: (.+)$/m;

/** Split a stored quote message back into its parts, for editing. */
function parseMessage(message: string | null): { pitch: string; hours: string; dateLabel: string | null } {
  const text = message ?? '';
  const hours = HOURS_LINE.exec(text)?.[1] ?? '';
  const dateLabel = DATE_LINE.exec(text)?.[1] ?? null;
  const pitch = text.replace(HOURS_LINE, '').replace(DATE_LINE, '').trim();
  return { pitch, hours, dateLabel };
}

/**
 * Quoting on a request: your price (required), why you (required), and
 * optionally how long it takes and when you can deliver.
 *
 * A worker who already quoted gets their quote back to change -- a better
 * price, a clearer pitch -- until the poster accepts it. Phone numbers, emails
 * and handles are hidden as they are typed: contact happens in TaskDrop's
 * chat once someone is hired.
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
  const { flash, celebrate } = useActions();
  const { userId } = useAuth();
  const [pitch, setPitch] = useState('');
  const [masked, setMasked] = useState(false);
  const [price, setPrice] = useState('');
  const [hours, setHours] = useState('');
  const [deliverBy, setDeliverBy] = useState<Date | null>(null);
  const [savedDateLabel, setSavedDateLabel] = useState<string | null>(null);
  const [showDate, setShowDate] = useState(false);
  const [existing, setExisting] = useState<Bid | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible || !task || !userId) return;
    setPitch('');
    setMasked(false);
    setPrice('');
    setHours('');
    setDeliverBy(null);
    setSavedDateLabel(null);
    setExisting(null);
    setBlocked(null);
    setLoading(true);
    let alive = true;
    void (async () => {
      try {
        const mine = await getMyBid(task.id, userId);
        if (!alive) return;
        if (mine) {
          setExisting(mine);
          const parsed = parseMessage(mine.message);
          setPitch(parsed.pitch);
          setHours(parsed.hours);
          setSavedDateLabel(parsed.dateLabel);
          setPrice(String(Math.round(mine.price_minor / 100)));
          if (mine.is_locked) setBlocked('The poster accepted this quote, so it can no longer be changed.');
          return;
        }
        const verdict = await canQuoteOn(task.id, userId);
        if (alive && !verdict.allowed) setBlocked(verdict.reason);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, task, userId]);

  if (!task) return null;
  const budget = Math.round(task.benchmark_minor / 100);
  const asked = Number(price);
  const priceError = price.trim() && (!Number.isFinite(asked) || asked < 10) ? 'Enter at least ₹10' : null;
  const ready = !blocked && pitch.trim().length >= 10 && price.trim() !== '' && !priceError;
  const auto = !existing && task.assignment_mode === 'auto' && asked > 0 && asked <= budget;

  const onPitch = (v: string) => {
    const out = maskContacts(v);
    if (out.masked) setMasked(true);
    setPitch(out.text);
  };

  const submit = async () => {
    if (!userId) return flash('Sign in to send a quote');
    if (!price.trim()) return flash('Enter your price');
    if (pitch.trim().length < 10) return flash('Tell the poster a little about why you');
    setBusy(true);
    try {
      const h = Number(hours);
      const lines = [maskContacts(pitch.trim()).text];
      if (Number.isFinite(h) && h > 0) lines.push(`Estimated time: ${h} hour${h === 1 ? '' : 's'}`);
      const dateLabel = deliverBy ? formatDeadline(deliverBy) : savedDateLabel;
      if (dateLabel) lines.push(`Can deliver by: ${dateLabel}`);
      const fields = {
        priceMinor: Math.round(asked * 100),
        timeLimitMinutes: Number.isFinite(h) && h > 0 ? Math.round(h * 60) : (existing?.time_limit_minutes ?? 240),
        message: lines.join('\n'),
      };
      if (existing) {
        await updateBid(existing.id, fields);
        onClose();
        celebrate(`Quote updated · ${rupees(asked)}`);
      } else {
        await placeBid({ taskId: task.id, workerId: userId, ...fields });
        onClose();
        celebrate(auto ? 'You’re hired! The poster funds escrow next' : `Quote sent · ${rupees(asked)}`);
      }
      onPlaced?.();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send your quote');
    } finally {
      setBusy(false);
    }
  };

  const dateText = deliverBy ? formatDeadline(deliverBy) : savedDateLabel;

  return (
    <>
      <BottomSheet
        visible={visible && !showDate}
        onClose={onClose}
        title={existing ? 'Edit your quote' : 'Send a quote'}
        subtitle={task.title}
        footer={
          <PrimaryButton
            label={existing ? 'Save changes' : auto ? 'Take this job' : 'Send quote'}
            onPress={() => void submit()}
            busy={busy}
            disabled={!ready}
          />
        }
      >
        {loading ? (
          <ActivityIndicator color={t.colors.accent} style={{ marginVertical: 30 }} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <RNText style={tx('600', 13, t.colors.muted)}>Poster’s budget</RNText>
              <RNText style={tx('800', 14, t.colors.accentDeep)}>{rupees(budget)}</RNText>
              {existing && !existing.is_locked ? (
                <RNText style={tx('600', 12, t.colors.purpleDeep, { marginLeft: 'auto' })}>
                  Sent · {rupees(existing.price_minor / 100)}
                </RNText>
              ) : null}
            </View>

            {blocked ? (
              <View style={{ marginTop: 12, backgroundColor: t.colors.signalSoft, borderRadius: 10, padding: 12 }}>
                <RNText style={tx('600', 13, t.colors.signalDeep)}>{blocked}</RNText>
              </View>
            ) : null}

            <Field
              label="Your price (₹)"
              style={{ marginTop: 16 }}
              value={price}
              onChangeText={(v) => setPrice(v.replace(/[^0-9]/g, '').slice(0, 7))}
              keyboardType="number-pad"
              inputMode="numeric"
              placeholder={`E.g. ${budget}`}
              left={<RNText style={tx('700', 15, t.colors.muted)}>₹</RNText>}
              error={priceError}
              hint="Quote what the job is worth to you — above or below the budget."
              editable={!blocked}
            />

            <Field
              label="Why you"
              style={{ marginTop: 14 }}
              value={pitch}
              onChangeText={onPitch}
              multiline
              maxLength={800}
              placeholder="Your experience with jobs like this, and how you’ll do it"
              editable={!blocked}
            />
            {masked ? (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'flex-start' }}>
                <Icon name="shield" size={14} color={t.colors.goldInk} />
                <RNText style={tx('500', 12, t.colors.goldInk, { flex: 1, lineHeight: 17 })}>
                  Phone numbers and contact details are hidden. You can share them in chat once you’re hired.
                </RNText>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, alignItems: 'flex-end' }}>
              <Field
                label="Hours (optional)"
                style={{ flex: 1 }}
                value={hours}
                onChangeText={(v) => setHours(v.replace(/[^0-9.]/g, '').slice(0, 5))}
                keyboardType="decimal-pad"
                placeholder="—"
                editable={!blocked}
              />
              <Pressable
                onPress={() => !blocked && setShowDate(true)}
                accessibilityRole="button"
                accessibilityLabel="Delivery date"
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  borderWidth: 1,
                  borderColor: dateText ? t.colors.accent : t.colors.line,
                  backgroundColor: t.colors.surface2,
                  borderRadius: 12,
                  paddingVertical: 13,
                  paddingHorizontal: 12,
                }}
              >
                <Icon name="clock" size={16} color={dateText ? t.colors.accentDeep : t.colors.muted} />
                <RNText style={tx('600', 13, dateText ? t.colors.ink : t.colors.muted, { flex: 1 })} numberOfLines={1}>
                  {dateText ?? 'Delivery date'}
                </RNText>
                {dateText ? (
                  <Pressable
                    onPress={() => {
                      setDeliverBy(null);
                      setSavedDateLabel(null);
                    }}
                    hitSlop={8}
                    accessibilityLabel="Clear delivery date"
                  >
                    <Icon name="close" size={14} color={t.colors.muted} />
                  </Pressable>
                ) : null}
              </Pressable>
            </View>

            {auto ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, backgroundColor: t.colors.accentSoft, borderRadius: 10, padding: 12 }}>
                <Icon name="bolt" size={16} color={t.colors.accentDeep} />
                <RNText style={tx('500', 12, t.colors.accentDeep, { flex: 1, lineHeight: 17 })}>
                  This poster hires instantly: a price at or under {rupees(budget)} gets you the job straight away.
                </RNText>
              </View>
            ) : null}
          </>
        )}
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
