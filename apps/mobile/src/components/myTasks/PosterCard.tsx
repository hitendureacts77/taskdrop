import { Text as RNText } from 'react-native';
import { useTheme } from '../../providers/ThemeProvider';
import { cardSurface } from '../ui';
import { rupees, timeAgo } from '../kit';
import { categoryLabel } from '../WorkCard';
import { FadeIn, Pressy, tx } from '../primitives';
import { presenceOf } from '../../lib/presence';
import {
  POSTER_STAGES,
  openDatePassed,
  posterDateBits,
  posterHint,
  posterPill,
  posterStage,
  posterTabOf,
  whereLine,
} from '../../lib/myTasksBoard';
import { newOffersLabel } from '../../lib/seenOffers';
import { canTopUp } from '../../lib/topUp';
import type { Profile, Task } from '../../data/api';
import {
  ActionButton,
  CardAct,
  CardTop,
  ChatButton,
  DotsButton,
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
import { areaOf } from './WorkerCard';

/** The live button a posted task offers (the same rule the old card had). */
export function posterNextLabel(task: Task, offers: number): string {
  if (task.status === 'COMPLETED' || task.status === 'AUTO_COMPLETED') return 'Notify helper';
  if (task.status === 'OPEN') return offers > 0 ? 'Choose an offer' : 'Open';
  if (task.status === 'LOCKED' && !task.funded_at) return 'Pay to start';
  if (task.status === 'WORK_DONE') return 'Review the work';
  if (task.status === 'LOCKED' || task.status === 'TASK_STARTED' || task.status === 'REVISION_REQUESTED') return 'Track';
  return 'Open';
}

export type PosterCardProps = {
  task: Task;
  index: number;
  offers: number;
  /** Offers that came in since this device last opened them (lib/seenOffers). */
  newOffers?: number;
  /** The person hired, once loaded (undefined while loading or for posts nobody was picked for). */
  worker?: Profile | null;
  /** "₹463.50": offer + service fee, what paying would cost. */
  payText: string;
  /** "₹1,545": what is held (or was paid) for it. */
  heldText: string;
  /** The money line of a closed post (lib/myTasksBoard closedLine). */
  closedText: string;
  onOpen: () => void;
  onMenu: () => void;
  /** Closing a task lives in the ⋯ menu now (same confirm dialog); kept so the screen's wiring stays the same. */
  onClose: () => void;
  /** Starts a new post from this one ("Create similar" / "Post again"). */
  onAgain: () => void;
  /**
   * A finished task: tell the person hired about one of your open tasks or a new one (NotifyHelperSheet,
   * owner 27 Nov 2026: it replaced "Book again"). Absent until the person is loaded.
   */
  onNotify?: () => void;
  /** The live review screen for a finished task (taskRows: done row act = review). */
  onReview: () => void;
  onChat: () => void;
  /** Opens the Top up picker for an open post (D31; lib/topUp, migration 194). */
  onTopUp?: () => void;
  /** Opens the date picker for an open post whose date passed (plan 1.19 J): a new date, or keep no fixed date. */
  onNewDate?: () => void;
};

/**
 * One of my posted tasks on the phone (1.19 row G): the status pill, the title with Nearby or Remote, who and how
 * much, a thin 5-step track, the date, an optional hint and ONE main button (filled when the next step is mine,
 * outline when I am waiting). Every other action stays in the ⋯ menu.
 */
export function PosterCard(p: PosterCardProps) {
  const t = useTheme();
  const { task, offers } = p;
  const now = Date.now();
  const tab = posterTabOf(task.status);
  const closed = tab === 3;
  const done = tab === 2;
  const hired = tab === 1 || done;
  const unpaid = task.status === 'LOCKED' && !task.funded_at;
  const passed = openDatePassed(task, now);
  const pill = posterPill(task, offers, now);
  const name = p.worker?.display_name ?? null;
  const rating = p.worker && p.worker.worker_rating_count > 0 ? p.worker.worker_rating_avg.toFixed(1) : null;
  const fresh = newOffersLabel(p.newOffers);
  const hint = closed ? { tone: 'mut' as const, text: p.closedText } : posterHint(task, { offers, name, now });
  const stage = posterStage(task.status, offers);

  const person = closed ? (
    <PersonRow
      face={<QuietFace icon="tag" />}
      name={<PersonName>Closed before anyone was hired</PersonName>}
      money={<MoneyBlock price={rupees(task.benchmark_minor / 100)} sub="your price" />}
    />
  ) : hired ? (
    <PersonRow
      face={<Face name={name} lastSeen={p.worker?.last_seen_at} />}
      name={<PersonName>{name ?? (done ? 'Done' : 'Hired')}</PersonName>}
      sub={
        <PersonSub>
          {[rating ? `★ ${rating}` : null, done ? 'Done' : presenceOf(p.worker?.last_seen_at).label].filter(Boolean).join(' · ')}
        </PersonSub>
      }
      extra={!done && p.worker ? <ChatButton onPress={p.onChat} /> : null}
      money={
        done ? (
          <MoneyBlock price={p.heldText} sub="paid" />
        ) : unpaid ? (
          <MoneyBlock price={p.payText} sub="not paid yet" />
        ) : (
          <MoneyBlock price={p.heldText} sub="held safely" held />
        )
      }
    />
  ) : (
    <PersonRow
      face={<QuietFace icon="users" />}
      name={<PersonName>{offers > 0 ? `${offers} ${offers === 1 ? 'offer' : 'offers'}` : 'No offers yet'}</PersonName>}
      sub={<PersonSub>{offers > 0 ? (fresh ? `${fresh} · compare and pick one` : 'Compare and pick one') : 'Helpers nearby and online can see it'}</PersonSub>}
      money={<MoneyBlock price={rupees(task.benchmark_minor / 100)} sub="your price" />}
    />
  );

  const topUp = p.onTopUp && tab === 0 && canTopUp(task) ? <ActionButton big kind="quiet" label="Top up" onPress={p.onTopUp} a11y={`Top up: ${task.title}`} /> : null;
  // The date passed: the task is open with no fixed date now (plan 1.19 J); a new date is optional.
  const newDate = passed && p.onNewDate ? (
    <ActionButton big kind={offers > 0 ? 'quiet' : 'outline'} label="Set a new date" onPress={p.onNewDate} a11y={`Set a new date: ${task.title}`} />
  ) : null;
  const act = closed ? (
    <ActionButton big kind="outline" label="Post again" onPress={p.onAgain} a11y={`Post again: ${task.title}`} />
  ) : done ? (
    <>
      {p.onNotify ? (
        <ActionButton big label="Notify helper" onPress={p.onNotify} a11y={`Notify about a task: ${task.title}`} />
      ) : (
        <ActionButton big kind="outline" label="Post again" onPress={p.onAgain} a11y={`Post again: ${task.title}`} />
      )}
      <ActionButton big kind="quiet" label="Leave a review" onPress={p.onReview} a11y={`Leave a review: ${task.title}`} />
    </>
  ) : tab === 0 ? (
    offers > 0 ? (
      <>
        <ActionButton big label={`Choose an offer (${offers})`} onPress={p.onOpen} a11y={`Choose an offer: ${task.title}`} />
        {newDate ?? topUp}
      </>
    ) : passed ? (
      newDate ?? <ActionButton big label="Post again" onPress={p.onAgain} a11y={`Post again: ${task.title}`} />
    ) : (
      <>
        <ActionButton big kind="outline" label="Open task" onPress={p.onOpen} a11y={`Open task: ${task.title}`} />
        {topUp}
      </>
    )
  ) : unpaid ? (
    <ActionButton big label="Pay to start" onPress={p.onOpen} a11y={`Pay to start: ${task.title}`} />
  ) : task.status === 'WORK_DONE' ? (
    <ActionButton big label="Review the work" onPress={p.onOpen} a11y={`Review the work: ${task.title}`} />
  ) : (
    <ActionButton big kind="outline" label="Track work" onPress={p.onOpen} a11y={`Track work: ${task.title}`} />
  );

  return (
    <FadeIn duration={340} delay={Math.min(p.index, 6) * 60} translateY={8} style={{ marginTop: 12 }}>
      <Pressy
        containsControls
        onPress={p.onOpen}
        scaleTo={0.985}
        style={[cardSurface(t, 20), { padding: 14, opacity: closed ? 0.82 : 1 }]}
      >
        <CardTop pill={<StatusPill label={pill.label} tone={pill.tone} />} meta={whereLine(categoryLabel(task), areaOf(task))} right={<DotsButton onPress={p.onMenu} />} />
        <RNText style={tx('800', 16, t.colors.ink, { marginTop: 9, letterSpacing: -0.2, lineHeight: 21 })} numberOfLines={2}>
          {task.title}
        </RNText>
        {person}
        {closed ? null : <ThinTrack stages={POSTER_STAGES} stage={stage} />}
        <WhenLine bits={posterDateBits(task, now, timeAgo(task.created_at))} />
        {hint ? <HintLine hint={hint} /> : null}
        <CardAct>{act}</CardAct>
      </Pressy>
    </FadeIn>
  );
}
