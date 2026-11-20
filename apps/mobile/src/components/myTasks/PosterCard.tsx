import { View, Text as RNText } from 'react-native';
import { useTheme } from '../../providers/ThemeProvider';
import { cardSurface } from '../ui';
import { Icon } from '../Icon';
import { rupees, timeAgo } from '../kit';
import { categoryIcon, categoryLabel } from '../WorkCard';
import { FadeIn, Pressy, tx } from '../primitives';
import { descriptionPreview } from '../TaskDescription';
import { PresenceDot } from '../PresenceDot';
import { datePassedLine } from '../../lib/taskStatusText';
import {
  POSTER_STAGES,
  dayMonth,
  dueIn,
  openDatePassed,
  postLine,
  posterNextStep,
  posterStage,
  posterTabOf,
  statusBadge,
} from '../../lib/myTasksBoard';
import type { Profile, Task } from '../../data/api';
import { ActionButton, ChatButton, DotsButton, Initial, NextStepBox, SegmentTrack } from './bits';

/** The live button a posted task offers (the same rule the old card had). */
export function posterNextLabel(task: Task, offers: number): string {
  if (task.status === 'COMPLETED' || task.status === 'AUTO_COMPLETED') return 'Book again';
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
  /** Opens the close-task confirm dialog (the same path as the menu's "Close task"). */
  onClose: () => void;
  /** Starts a new post from this one ("Create similar" / "Book again" / "Post again"). */
  onAgain: () => void;
  /** The live review screen for a finished task (taskRows: done row act = review). */
  onReview: () => void;
  onChat: () => void;
};

/**
 * One of my posted tasks on the phone (D31 v11, board MyTasks), the Upwork way: an open task is a *post getting
 * offers* (status, category, posted time, title, description, OFFERS | YOUR PRICE | DUE, the 5-step track, the
 * live button); once someone is picked it is *hired work* (who, the money held or "Not paid yet", the track, a
 * tinted Next step box, the live button). Completed: Book again + Leave a review. Closed: what was charged.
 */
export function PosterCard(p: PosterCardProps) {
  const t = useTheme();
  const { task } = p;
  const tab = posterTabOf(task.status);
  return (
    <FadeIn duration={340} delay={Math.min(p.index, 6) * 60} translateY={8} style={{ marginTop: 12 }}>
      <Pressy containsControls onPress={p.onOpen} scaleTo={0.985} style={[cardSurface(t, 20), { overflow: 'hidden' }]}>
        {tab === 0 ? <PostBody {...p} /> : tab === 3 ? <ClosedBody {...p} /> : <HiredBody {...p} />}
      </Pressy>
    </FadeIn>
  );
}

function useStripe(task: Task, passed: boolean): string {
  const t = useTheme();
  if (passed) return t.colors.gold;
  const tone = statusBadge(task).tone;
  return { accent: t.colors.accent, gold: t.colors.gold, signal: t.colors.signal, blue: t.colors.accent, neutral: t.colors.muted }[tone];
}

function TopLine({ text, ink, task, onMenu, extra }: { text: string; ink: string; task: Task; onMenu: () => void; extra?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {/* B165: the status line keeps its words; the category beside it gives way first. */}
      <RNText style={tx('800', 10.5, ink, { letterSpacing: 1.2, flexShrink: 0, maxWidth: '80%' })} numberOfLines={1}>
        {text}
      </RNText>
      <RNText style={tx('600', 11, t.colors.muted, { flexShrink: 1 })} numberOfLines={1}>
        {extra ? `· ${extra} ` : ''}· {categoryLabel(task)}
      </RNText>
      <View style={{ flex: 1 }} />
      <DotsButton onPress={onMenu} />
    </View>
  );
}

function Stripe({ color }: { color: string }) {
  return <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: color }} />;
}

/** An open post: getting offers, waiting for offers, or past its date. */
function PostBody({ task, offers, onMenu, onOpen, onAgain, onClose }: PosterCardProps) {
  const t = useTheme();
  const now = Date.now();
  const passed = openDatePassed(task, now);
  const preview = descriptionPreview(task.description, task.title);
  const due = dueIn(task.due_at, now);
  const stage = posterStage(task.status, offers);
  const label = posterNextLabel(task, offers);
  const cell = (head: string, value: string, ink: string = t.colors.ink, first = false) => (
    <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 10, borderLeftWidth: first ? 0 : 1, borderLeftColor: t.colors.line }}>
      <RNText style={tx('700', 10, t.colors.muted, { letterSpacing: 1 })}>{head}</RNText>
      <RNText numberOfLines={1} style={tx('800', 15, ink, { marginTop: 3, fontVariant: ['tabular-nums'] })}>{value}</RNText>
    </View>
  );
  return (
    <>
      <Stripe color={useStripe(task, passed)} />
      <View style={{ flexDirection: 'row', gap: 12, padding: 14, paddingLeft: 16 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={categoryIcon(task.category)} size={21} color={t.colors.accentDeep} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <TopLine
            text={passed ? datePassedLine(task.status, offers) : postLine(offers)}
            ink={passed ? t.colors.goldInk : offers > 0 ? t.colors.accentDeep : t.colors.muted}
            task={task}
            onMenu={onMenu}
          />
          <RNText style={tx('800', 16, t.colors.ink, { marginTop: 7, letterSpacing: -0.2 })} numberOfLines={2}>{task.title}</RNText>
          <RNText style={tx('600', 11.5, t.colors.muted, { marginTop: 2 })}>Posted {timeAgo(task.created_at)}</RNText>
          {preview ? (
            <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 4, lineHeight: 18 })} numberOfLines={2}>{preview}</RNText>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', backgroundColor: t.colors.surface2, borderTopWidth: 1, borderTopColor: t.colors.line }}>
        {cell('OFFERS', String(offers), t.colors.ink, true)}
        {cell('YOUR PRICE', rupees(task.benchmark_minor / 100))}
        {cell('DUE', due ?? '—', due ? t.colors.goldInk : t.colors.muted)}
      </View>
      {passed ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, backgroundColor: t.colors.goldSoft }}>
          <Icon name="clock" size={13} color={t.colors.goldInk} />
          <RNText style={tx('600', 12, t.colors.goldInk, { flex: 1 })}>
            {offers > 0 ? 'The date has passed. Choose an offer, or post it again.' : 'The date has passed. Post it again, or close it.'}
          </RNText>
        </View>
      ) : null}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderTopWidth: passed ? 0 : 1, borderTopColor: t.colors.line }}>
        <SegmentTrack stages={POSTER_STAGES} stage={stage} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.colors.line }}>
        {passed ? (
          // There is no date edit yet, so a passed date offers a fresh post (or the offers that came in) and Close.
          <>
            {offers > 0 ? (
              <ActionButton big label={`Choose an offer (${offers})`} onPress={onOpen} a11y={`Choose an offer: ${task.title}`} />
            ) : (
              <ActionButton big label="Post again" onPress={onAgain} a11y={`Post again: ${task.title}`} />
            )}
            <ActionButton big kind="quiet" label="Close" onPress={onClose} a11y={`Close: ${task.title}`} />
          </>
        ) : (
          <ActionButton big label={offers > 0 ? `${label} (${offers})` : label} onPress={onOpen} a11y={`${label}: ${task.title}`} />
        )}
      </View>
    </>
  );
}

/** Someone was picked: in progress or completed. */
function HiredBody({ task, offers, worker, payText, heldText, onMenu, onOpen, onAgain, onReview, onChat }: PosterCardProps) {
  const t = useTheme();
  const now = Date.now();
  const done = task.status === 'COMPLETED' || task.status === 'AUTO_COMPLETED';
  const badge = statusBadge(task);
  const ink = { accent: t.colors.accentDeep, gold: t.colors.goldInk, signal: t.colors.signalDeep, blue: t.colors.accentDeep, neutral: t.colors.muted }[badge.tone];
  const stage = posterStage(task.status, offers);
  const unpaid = task.status === 'LOCKED' && !task.funded_at;
  // The date has passed: said calmly, in gold, never as a red "overdue".
  const overdue = task.status === 'OVERDUE';
  const name = worker?.display_name ?? null;
  const next = done ? null : posterNextStep(task, { name, payText, now });
  const label = posterNextLabel(task, offers);
  const rating = worker && worker.worker_rating_count > 0 ? worker.worker_rating_avg.toFixed(1) : null;
  const finished = done && task.completed_at ? `${task.status === 'AUTO_COMPLETED' ? 'Auto-released' : 'Approved'} ${dayMonth(task.completed_at)}` : undefined;
  return (
    <>
      <Stripe color={useStripe(task, overdue)} />
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
        <TopLine text={overdue ? datePassedLine(task.status, offers) : badge.label.toUpperCase()} ink={overdue ? t.colors.goldInk : ink} task={task} onMenu={onMenu} extra={finished} />
        <RNText style={tx('800', 16, t.colors.ink, { marginTop: 7, letterSpacing: -0.2 })} numberOfLines={2}>{task.title}</RNText>
      </View>
      {worker ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.colors.line }}>
          <Initial name={name} size={36} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <RNText numberOfLines={1} style={tx('700', 14, t.colors.ink)}>{done ? `Done by ${name}` : `Hired: ${name}`}</RNText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
              {rating ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Icon name="star" size={11} color={t.colors.gold} />
                  <RNText style={tx('600', 11.5, t.colors.text)}>{rating}</RNText>
                </View>
              ) : null}
              {done ? null : <PresenceDot lastSeen={worker.last_seen_at} />}
            </View>
          </View>
          {done ? (
            <RNText style={tx('800', 14, t.colors.accentDeep, { fontVariant: ['tabular-nums'] })}>{heldText} paid</RNText>
          ) : (
            <ChatButton onPress={onChat} />
          )}
        </View>
      ) : null}
      {done && !worker ? (
        <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.colors.line }}>
          <RNText style={tx('800', 14, t.colors.accentDeep, { fontVariant: ['tabular-nums'] })}>{heldText} paid</RNText>
        </View>
      ) : null}
      {done ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: t.colors.surface2, borderTopWidth: 1, borderTopColor: t.colors.line }}>
          {unpaid ? (
            <>
              <Icon name="card" size={14} color={t.colors.signalDeep} />
              <RNText style={tx('800', 13, t.colors.signalDeep, { flex: 1 })}>Not paid yet</RNText>
              <RNText style={tx('800', 14, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{payText}</RNText>
            </>
          ) : (
            <>
              <Icon name="lock" size={13} color={t.colors.accentDeep} />
              <RNText style={tx('800', 13, t.colors.accentDeep, { flex: 1, fontVariant: ['tabular-nums'] })}>{heldText} held safely</RNText>
            </>
          )}
        </View>
      )}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: next ? 10 : 12, borderTopWidth: done ? 1 : 0, borderTopColor: t.colors.line }}>
        <SegmentTrack stages={POSTER_STAGES} stage={stage} />
      </View>
      {next ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <NextStepBox tone={next.tone}>{next.text}</NextStepBox>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.colors.line }}>
        {done ? (
          <>
            <ActionButton big label="Book again" onPress={onAgain} a11y={`Book again: ${task.title}`} />
            <ActionButton big kind="quiet" label="Leave a review" onPress={onReview} a11y={`Leave a review: ${task.title}`} />
          </>
        ) : (
          <ActionButton big label={label} onPress={onOpen} a11y={`${label}: ${task.title}`} />
        )}
      </View>
    </>
  );
}

/** Closed: taken down before anyone did the work. */
function ClosedBody({ task, closedText, onMenu, onOpen }: PosterCardProps) {
  const t = useTheme();
  return (
    <>
      <Stripe color={t.colors.muted} />
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
        <TopLine text="CLOSED" ink={t.colors.muted} task={task} onMenu={onMenu} />
        <RNText style={tx('800', 16, t.colors.ink, { marginTop: 7, letterSpacing: -0.2 })} numberOfLines={2}>{task.title}</RNText>
      </View>
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: t.colors.surface2, borderTopWidth: 1, borderTopColor: t.colors.line }}>
        <RNText style={tx('600', 12.5, t.colors.text)}>{closedText}</RNText>
      </View>
      {/* The live card's Open button stays (owner: keep every control), though the card opens on a tap too. */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.colors.line }}>
        <ActionButton big kind="quiet" label="Open" onPress={onOpen} a11y={`Open: ${task.title}`} />
      </View>
    </>
  );
}
