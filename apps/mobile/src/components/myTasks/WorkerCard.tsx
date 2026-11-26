import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../../providers/ThemeProvider';
import { cardSurface, formatINR } from '../ui';
import { Icon } from '../Icon';
import { timeAgo } from '../kit';
import { categoryLabel } from '../WorkCard';
import { FadeIn, Pressy, tx } from '../primitives';
import { roughPlace } from '../../lib/place';
import { presenceOf } from '../../lib/presence';
import type { ViewRow } from '../../lib/taskRows';
import { workerEarnsMinor, pctWords, type HeldRates } from '../../lib/heldWords';
import { shortDate } from '../../lib/walletClearing';
import {
  WORKER_STAGES,
  customerShown,
  dayDate,
  dayMonth,
  dueShort,
  elapsed,
  whereLine,
  workerButton,
  workerNextStep,
  workerPill,
  workerStage,
  type Bit,
  type CardHint,
} from '../../lib/myTasksBoard';
import type { Profile, Task } from '../../data/api';
import {
  ActionButton,
  CardAct,
  CardTop,
  ChatButton,
  Face,
  HintLine,
  MoneyBlock,
  PersonName,
  PersonRow,
  PersonSub,
  QuietFace,
  StatusPill,
  ThinTrack,
  WhenLine,
} from './bits';

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

/** The running clock in the date line of a job under way. */
function Timer({ since, color }: { since: string; color: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <RNText style={tx('800', 12, color, { fontVariant: ['tabular-nums'] })}>{elapsed(since, now)}</RNText>;
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

/** The date bits under a worker's card. */
export function workerDateBits(row: ViewRow, task: Task | null, now: number, sentAt?: string): Bit[] {
  const due: Bit[] = task?.due_at ? [{ t: ' · due ' }, { t: dayDate(task.due_at), b: true }] : [];
  switch (row.state) {
    case 'PENDING':
      return [{ t: 'Sent ' }, { t: sentAt ? timeAgo(sentAt) : 'just now', b: true }, ...due];
    case 'ACCEPTED · SWIPE TO START':
    case 'WAITING ON PAYMENT':
      return task?.due_at ? [{ t: 'Due ' }, { t: dueShort(task.due_at, now), b: true }] : [{ t: row.meta }];
    case 'ACTIVE · TIMER RUNNING':
      return task?.due_at ? [{ t: ' · due ' }, { t: dueShort(task.due_at, now), b: true }] : [];
    case 'WORK DONE · WAITING FOR CUSTOMER':
      return task?.auto_complete_at
        ? [{ t: 'Completes by itself ' }, { t: dayDate(task.auto_complete_at), b: true }]
        : [{ t: 'Waiting for the customer' }];
    case 'DONE · PAID':
      return task?.completed_at ? [{ t: 'Finished ' }, { t: dayMonth(task.completed_at), b: true }] : [{ t: row.meta }];
    default:
      return [{ t: row.meta || 'Closed' }];
  }
}

/**
 * One row of My work on the phone (1.19 row G): the status pill, the title with Nearby or Remote, the customer
 * (named only once the job starts) and what the worker earns, a thin 5-step track, the date, an optional hint and
 * ONE main button standing for the live action.
 */
export function WorkerCard({ row, task, customer, sentAt, rates, index, onOpen, onChat }: WorkerCardProps) {
  const t = useTheme();
  const now = Date.now();
  const stage = workerStage(row.state);
  const button = workerButton(row.state);
  const pending = row.state === 'PENDING';
  const active = row.bucket === 1;
  const closed = row.bucket === 3;
  const earn = earnOf(row, task, rates);
  const pct = pctWords(rates.commission);
  const next = active ? workerNextStep(row, task, now) : null;
  const shown = customerShown(task);
  const area = areaOf(task);
  const pill = workerPill(row.state, task?.status);
  const timing = active && row.state === 'ACTIVE · TIMER RUNNING' && task?.status !== 'OVERDUE';

  const hint: CardHint | null = pending
    ? { tone: 'mut', text: 'Waiting for the customer' }
    : row.state === 'DONE · PAID' && earnedLine(earn, task, now).includes('clears')
      ? { tone: 'mut', text: earnedLine(earn, task, now) }
      : next && !next.timer
        ? { tone: next.tone === 'accent' ? 'acc' : next.tone === 'signal' && row.state !== 'WAITING ON PAYMENT' ? 'coral' : 'mut', text: next.text }
        : null;

  const money =
    row.state === 'DONE · PAID' ? (
      <MoneyBlock price={formatINR(earn)} sub="earned" />
    ) : pending ? (
      <MoneyBlock price={formatINR(earn)} sub={`you earn, after ${pct} fee`} />
    ) : active ? (
      <MoneyBlock price={formatINR(earn)} sub={task?.funded_at ? 'held until approval' : 'not paid yet'} held={!!task?.funded_at} />
    ) : (
      <MoneyBlock price={row.priceLabel} sub="your offer" />
    );

  const customerName = shown && customer?.display_name ? customer.display_name : null;
  const person = customerName ? (
    <PersonRow
      face={<Face name={customerName} lastSeen={customer?.last_seen_at} />}
      name={<PersonName>{customerName}</PersonName>}
      sub={<PersonSub>{[presenceOf(customer?.last_seen_at).label, area].filter(Boolean).join(' · ')}</PersonSub>}
      extra={active ? <ChatButton onPress={onChat} /> : null}
      money={money}
    />
  ) : (
    <PersonRow
      face={<QuietFace icon="user" />}
      name={<PersonName>{active || pending ? 'Customer shown when the job starts' : row.meta || 'Closed'}</PersonName>}
      sub={pending && sentAt ? <PersonSub>{`Sent ${timeAgo(sentAt)}`}</PersonSub> : undefined}
      money={money}
    />
  );

  return (
    <FadeIn duration={320} delay={Math.min(index, 6) * 60} translateY={8} style={{ marginTop: 12 }}>
      <Pressy containsControls onPress={onOpen} scaleTo={0.985} style={{ ...cardSurface(t, 20), padding: 14, opacity: closed ? 0.82 : 1 }}>
        <CardTop pill={<StatusPill label={pill.label} tone={pill.tone} />} meta={whereLine(task ? categoryLabel(task) : '', area)} />
        <RNText style={tx('800', 16, t.colors.ink, { marginTop: 9, letterSpacing: -0.2, lineHeight: 21 })} numberOfLines={2}>
          {row.title}
        </RNText>
        {person}
        {stage > 0 ? <ThinTrack stages={WORKER_STAGES} stage={stage} /> : null}
        <WhenLine bits={workerDateBits(row, task, now, sentAt)}>
          {timing ? (
            <>
              Timer running {task?.started_at ? <Timer since={task.started_at} color={t.colors.ink} /> : null}
            </>
          ) : null}
        </WhenLine>
        {hint ? <HintLine hint={hint} /> : null}
        <CardAct>
          {button?.kind === 'swipe' ? (
            <SwipePill label={button.label} onPress={onOpen} title={row.title} />
          ) : button ? (
            <ActionButton big kind={button.kind === 'quiet' ? 'outline' : 'primary'} label={button.label} onPress={onOpen} a11y={`${button.label}: ${row.title}`} />
          ) : (
            <ActionButton big kind="outline" label="Open job" onPress={onOpen} a11y={`Open job: ${row.title}`} />
          )}
        </CardAct>
      </Pressy>
    </FadeIn>
  );
}

/** "Swipe to start" drawn as the swipe pill (filled); it opens the swipe screen, where the real swipe happens. */
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
        gap: 10,
        paddingVertical: 5,
        paddingLeft: 5,
        paddingRight: 14,
        borderRadius: 12,
        backgroundColor: t.colors.btn,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: t.colors.onBtn, opacity: 0.22, position: 'absolute', left: 5 }} />
      <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="chevronRight" size={18} color={t.colors.onBtn} strokeWidth={2.4} />
      </View>
      <RNText style={tx('800', 14, t.colors.onBtn)}>{label}</RNText>
    </Pressable>
  );
}
