import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../../providers/ThemeProvider';
import { cardSurface, formatINR } from '../ui';
import { Icon } from '../Icon';
import { timeAgo } from '../kit';
import { FadeIn, Pressy, tx } from '../primitives';
import { roughPlace } from '../../lib/place';
import { toneInk, type ViewRow } from '../../lib/taskRows';
import { workerEarnsMinor, pctWords, type HeldRates } from '../../lib/heldWords';
import { shortDate } from '../../lib/walletClearing';
import {
  WORKER_STAGES,
  customerShown,
  elapsed,
  workerButton,
  workerNextStep,
  workerStage,
  workerStateLabel,
} from '../../lib/myTasksBoard';
import type { Profile, Task } from '../../data/api';
import { ActionButton, ChatButton, DotTrack, NextStepBox, useToneSet } from './bits';

/** "Kondapur" for a task with a place, "Remote" for one without, null when neither is known. */
export function areaOf(task: Pick<Task, 'loc_lat' | 'loc_label'> | null): string | null {
  if (!task) return null;
  if (task.loc_lat === null) return 'Remote';
  return roughPlace(task.loc_label)?.split(',')[0] ?? null;
}

/** What the worker is paid for a row: the agreed price less the commission (a preview; the server prices it). */
export function earnOf(row: ViewRow, task: Task | null, rates: HeldRates): number {
  return workerEarnsMinor(row.escrowMinor ?? 0, rates, task?.locked_minor ?? (row.escrowMinor ? null : row.priceMinor));
}

/** The money line under a closed DONE · PAID row: what was earned and when it can be withdrawn. */
export function earnedLine(earnMinor: number, task: Task | null, now: number): string {
  const clear = task?.clear_at ? new Date(task.clear_at) : null;
  if (clear && clear.getTime() > now) return `${formatINR(earnMinor)} earned · clears ${shortDate(clear)}, then withdraw`;
  return `${formatINR(earnMinor)} earned`;
}

/** The running clock in the Next step box of a job under way. */
function Timer({ since, color }: { since: string; color: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <RNText style={tx('800', 13, color, { fontVariant: ['tabular-nums'] })}>{elapsed(since, now)}</RNText>;
}

export type WorkerCardProps = {
  row: ViewRow;
  task: Task | null;
  /** The customer, loaded only for jobs that have started (they are named to the worker from then on). */
  customer?: Profile | null;
  /** When this offer was sent (Offers tab). */
  sentAt?: string;
  rates: HeldRates;
  index: number;
  /** The card tap: the row's live action (or Edit offer for an offer still out). */
  onOpen: () => void;
  onChat: () => void;
};

/**
 * One row of My work on the phone (D31 v11, board MyWork), the Upwork way: an active job says the state, the
 * customer (only once it starts), what the worker earns after the commission, the worker track, a tinted Next
 * step and one button standing for the live action. Offers read like submitted proposals; closed rows keep
 * their words.
 */
export function WorkerCard({ row, task, customer, sentAt, rates, index, onOpen, onChat }: WorkerCardProps) {
  const t = useTheme();
  const now = Date.now();
  const stage = workerStage(row.state);
  const button = workerButton(row.state);
  const pending = row.state === 'PENDING';
  const active = row.bucket === 1;
  const earn = earnOf(row, task, rates);
  const pct = pctWords(rates.commission);
  const next = active ? workerNextStep(row, task, now) : null;
  const nextInk = useToneSet(next?.tone ?? 'gold').fg;
  const shown = customerShown(task);
  const area = areaOf(task);
  const header = (
    <>
      <RNText style={tx('800', 10.5, pending ? t.colors.accentDeep : toneInk(row.tone, t.colors), { letterSpacing: 1.3 })}>
        {workerStateLabel(row.state)}
        {pending && sentAt ? ` · ${timeAgo(sentAt)}` : ''}
      </RNText>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
        <RNText style={tx('800', 15.5, t.colors.ink, { flex: 1 })} numberOfLines={2}>{row.title}</RNText>
        {pending ? null : <RNText style={tx('800', 15.5, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{row.priceLabel}</RNText>}
      </View>
    </>
  );

  return (
    <FadeIn duration={320} delay={Math.min(index, 6) * 60} translateY={8} style={{ marginTop: 12 }}>
      <Pressy containsControls={!!button} onPress={onOpen} scaleTo={0.985} style={{ ...cardSurface(t, 18), padding: 14 }}>
        {header}
        {active ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="user" size={14} color={t.colors.accentDeep} />
              </View>
              <RNText numberOfLines={1} style={tx('500', 13, t.colors.text, { flex: 1 })}>
                {shown && customer?.display_name ? (
                  <>
                    For <RNText style={tx('800', 13, t.colors.ink)}>{customer.display_name}</RNText>
                    {area ? ` · ${area}` : ''}
                  </>
                ) : (
                  'Customer shown when the job starts'
                )}
              </RNText>
              {shown ? <ChatButton onPress={onChat} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 10 }}>
              <Icon name={task?.funded_at ? 'lock' : 'flag'} size={14} color={task?.funded_at ? t.colors.accentDeep : t.colors.signalDeep} />
              <RNText style={tx('400', 12.5, t.colors.text, { flex: 1, lineHeight: 18 })}>
                {task?.funded_at ? (
                  <>
                    <RNText style={tx('800', 13, t.colors.ink)}>You earn {formatINR(earn)}</RNText>
                    {` · after TaskDrop’s ${pct} fee, held until approval`}
                  </>
                ) : (
                  <>
                    <RNText style={tx('800', 13, t.colors.ink)}>Not paid yet</RNText>
                    {` · you would earn ${formatINR(earn)} after the ${pct} fee`}
                  </>
                )}
              </RNText>
            </View>
            <View style={{ marginTop: 12 }}>
              <DotTrack stages={WORKER_STAGES} stage={stage} />
            </View>
            {next ? (
              <View style={{ marginTop: 12 }}>
                <NextStepBox tone={next.tone} label="NEXT STEP">
                  {next.timer && task?.started_at ? (
                    <>
                      Timer running <Timer since={task.started_at} color={nextInk} />
                      {next.text}
                    </>
                  ) : next.timer ? (
                    `Timer running${next.text}`
                  ) : (
                    next.text
                  )}
                </NextStepBox>
              </View>
            ) : null}
          </>
        ) : pending ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Icon name="clock" size={13} color={t.colors.muted} />
            <RNText style={tx('500', 12.5, t.colors.muted)}>Waiting for the customer</RNText>
          </View>
        ) : (
          <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 5 })}>
            {row.state === 'DONE · PAID' ? earnedLine(earn, task, now) : row.meta}
          </RNText>
        )}
        {pending ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
            <RNText style={tx('500', 13, t.colors.muted, { flex: 1 })}>
              Your offer <RNText style={tx('800', 16, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{row.priceLabel}</RNText>
            </RNText>
            <ActionButton kind="outline" label="Edit offer" onPress={onOpen} a11y={`Edit offer: ${row.title}`} />
          </View>
        ) : button ? (
          <View style={{ marginTop: 12, flexDirection: 'row' }}>
            {button.kind === 'swipe' ? (
              <SwipePill label={button.label} onPress={onOpen} title={row.title} />
            ) : (
              <ActionButton big kind={button.kind === 'quiet' ? 'outline' : 'primary'} label={button.label} onPress={onOpen} a11y={`${button.label}: ${row.title}`} />
            )}
          </View>
        ) : null}
      </Pressy>
    </FadeIn>
  );
}

/** "Swipe to start" drawn as the swipe pill; it opens the swipe screen, where the real swipe happens. */
function SwipePill({ label, onPress, title }: { label: string; onPress: () => void; title: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${title}`}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        padding: 4,
        borderRadius: 999,
        backgroundColor: t.colors.accentSoft,
        borderWidth: 1,
        borderColor: t.colors.accentBorder,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="chevronRight" size={18} color={t.colors.onBtn} strokeWidth={2.4} />
      </View>
      <RNText style={tx('800', 14, t.colors.accentDeep, { flex: 1, textAlign: 'center', marginRight: 40 })}>{label}</RNText>
    </Pressable>
  );
}
