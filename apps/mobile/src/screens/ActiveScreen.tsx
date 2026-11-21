import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, Linking, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { TIMING } from '@taskdrop/rules';
import { Screen, formatINR, cardSurface } from '../components/ui';
import { Icon } from '../components/Icon';
import { lengthHint } from '../lib/fieldHint';
import { BackButton, ConfirmDialog, EmptyState, Field, LoadFailed, systemHeader } from '../components/kit';
import { messageOf, reportError } from '../lib/errors';
import { ReportProblemSheet } from '../components/ReportProblemSheet';
import { AvatarPresence, PresenceLabel } from '../components/PresenceDot';
import { TwoPane } from '../components/TwoPane';
import { useDesktopHeaderPortal } from '../components/pageHeader';
import {
  Caption,
  DetailRow,
  MoneyNote,
  MoneyRow,
  ProgressList,
  SectionCard,
  StatusBanner,
  type BannerTone,
} from '../components/JobPageParts';
import type { IconName } from '../components/Icon';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useAuth } from '../providers/AuthProvider';
import { useActions } from '../providers/AppStateProvider';
import {
  confirmRelease,
  getProof,
  getTaskDetail,
  markWorkDone,
  requestRevision,
  submitProof,
  type Proof,
  type TaskDetail,
} from '../data/api';
import {
  pickDocument,
  pickMedia,
  imageSource,
  signedMediaUrl,
  signedMediaUrls,
  uploadProofFile,
  type ProofFile,
} from '../lib/media';
import { maskContacts } from '../lib/mask';
import { Pressy, tx } from '../components/primitives';
import { agreedMinor, pctWords, releaseMessage, workerEarnsMinor } from '../lib/heldWords';
import { useFees } from '../lib/useFees';
import { useLayout } from '../lib/layout';

/** "2h 14m", "3d 4h", "45m", "40s". */
function span(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s % 60}s`;
}

function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** "Tue, 25 Nov, 5:25 pm". */
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * A job in progress, for both sides, from the task itself.
 *
 * Laid out like an Upwork contract page (D31 v11, boards Active and WorkActive): the other person on top, a
 * banner saying where the job stands, the submitted work (or, for the worker, the proof being written), the
 * money, the progress steps and the job's details. On a wide desktop the money and details sit in a side column.
 *
 * The clock counts down to the poster's deadline and stops the moment the
 * worker marks the work done. The worker finishes by sending proof -- what
 * they did, with photos or documents; the poster reviews it and releases the
 * money, asks for changes, or, if they don't answer within the review
 * window, the money is released to the worker automatically.
 */
export function ActiveScreen() {
  const t = useTheme();
  const { params, back, go } = useNav();
  const { mode } = useMode();
  const { userId } = useAuth();
  const { flash, celebrate } = useActions();
  const { twoPane: split, contentWidth } = useLayout();
  const worker = mode === 'worker';
  const fees = useFees();
  const taskId = typeof params.taskId === 'string' ? params.taskId : null;

  const [detail, setDetail] = useState<TaskDetail | null | undefined>(undefined);
  // True when the load itself failed (offline, server hiccup), as opposed to a job that is really gone.
  const [failed, setFailed] = useState(false);
  const [proof, setProof] = useState<Proof | null>(null);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  // Releasing the money cannot be undone, so the button asks first (owner decision 2026-10-25).
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  const [reporting, setReporting] = useState(false);

  // The worker's proof, before it is sent.
  const [summary, setSummary] = useState('');
  const [files, setFiles] = useState<ProofFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return setDetail(null);
    const [d, p] = await Promise.all([getTaskDetail(taskId), getProof(taskId)]);
    setDetail(d);
    setProof(p);
    setFailed(false);
    const paths = (p?.files ?? []).filter((f) => f.kind !== 'file').map((f) => f.path);
    if (paths.length) setProofUrls(await signedMediaUrls(paths));
  }, [taskId]);

  // On failure keep whatever is already on screen; with nothing yet, show the retry card.
  const loadOrFail = useCallback(
    () =>
      load().catch((e) => {
        reportError(e, 'active.load');
        setFailed(true);
        setDetail((prev) => prev ?? null);
      }),
    [load],
  );

  useEffect(() => {
    void loadOrFail();
  }, [loadOrFail]);

  const task = detail?.task ?? null;
  const status = task?.status;
  const doneAt = task?.work_done_at ? new Date(task.work_done_at).getTime() : null;
  const startedAt = task?.started_at ? new Date(task.started_at).getTime() : null;
  const deadline = task
    ? task.due_at
      ? new Date(task.due_at).getTime()
      : (startedAt ?? Date.now()) + task.time_limit_minutes * 60000
    : Date.now();
  const running = status === 'TASK_STARTED' || status === 'OVERDUE' || status === 'REVISION_REQUESTED';

  // Tick only while the clock is live; once the work is done it stays still.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const clockNow = doneAt ?? now;
  const remaining = deadline - clockNow;

  // Lists open in-progress tasks straight here; the overview (quotes, timeline,
  // details) stays one tap away for the poster. In the system header on phones,
  // in the page header on a desktop.
  const detailsButton =
    task && !worker ? (
      <Pressable
        onPress={() => go('taskManage', { taskId: task.id })}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Task details"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: t.colors.line }}
      >
        <Icon name="list" size={13} color={t.colors.ink} />
        <RNText style={tx('700', 12, t.colors.ink)}>Details</RNText>
      </Pressable>
    ) : null;
  // Desktop web: the back link, the job's title and Details go into the page header (undefined elsewhere).
  const desktopHeader = useDesktopHeaderPortal({ title: task?.title || undefined, onBack: back, right: detailsButton ?? undefined });

  if (detail === undefined) {
    return (
      <Screen padded={false}>
        {desktopHeader}
        <ActivityIndicator color={t.colors.accent} style={{ marginTop: 80 }} />
      </Screen>
    );
  }
  if (!detail || !task) {
    return (
      <Screen padded={false}>
        {desktopHeader !== undefined ? (
          desktopHeader
        ) : (
          <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
            <BackButton onBack={back} />
          </View>
        )}
        {failed ? (
          <LoadFailed
            onRetry={() => {
              setDetail(undefined);
              void loadOrFail();
            }}
          />
        ) : (
          <EmptyState icon="briefcase" title="This job isn’t available" body="Open it again from My Work or My Tasks." />
        )}
      </Screen>
    );
  }

  const other = worker ? detail.poster : detail.worker;
  const otherName = startedAt ? (other?.display_name ?? (worker ? 'The customer' : 'The worker')) : 'Shown when the job starts';
  const escrowMinor = detail.assignment?.escrow_minor ?? task.locked_minor ?? 0;
  // The worker sees their own earnings (price less the commission), not the poster's held total (round 7, W3-2).
  const earnsMinor = workerEarnsMinor(escrowMinor, fees, task.locked_minor);
  // The agreed price inside the held figure: the poster's held total less the service fee.
  const offerMinor = agreedMinor(escrowMinor, fees.posterFee, task.locked_minor);
  const finished = status === 'COMPLETED' || status === 'AUTO_COMPLETED';
  const cancelled = status === 'CANCELLED';
  const disputed = status === 'DISPUTED';
  const funded = Boolean(task.funded_at);
  const overdue = !doneAt && remaining < 0;
  const late = running && (status === 'OVERDUE' || overdue);
  const dueText = when(new Date(deadline).toISOString());

  const steps = [
    { label: 'Offer accepted', at: detail?.assignment?.created_at ?? task.funded_at ?? null, reached: Boolean(task.locked_bid_id) },
    { label: 'Payment held safely', at: task.funded_at, reached: Boolean(task.funded_at) },
    { label: 'Work started · contacts shared', at: task.started_at, reached: Boolean(task.started_at) },
    { label: 'Work done · proof sent', at: task.work_done_at, reached: Boolean(task.work_done_at) },
    {
      label: status === 'AUTO_COMPLETED' ? 'Released automatically' : 'Approved · payment released',
      at: task.completed_at,
      reached: finished,
    },
  ];

  // ------------------------------------------------------------ actions ----

  /**
   * A photo for the proof. A Live answer takes it with the camera, there and
   * then; a job that asked for before and after photos marks which one it is.
   */
  const addPhoto = async (label?: 'before' | 'after') => {
    try {
      const picked = await pickMedia('image', task.live_answer ? 'camera' : 'library');
      if (!picked) return;
      setUploading(true);
      const name = label === 'before' ? 'Before' : label === 'after' ? 'After' : task.live_answer ? 'Live photo · ' + new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : 'Photo';
      const uploaded = await uploadProofFile({ uri: picked.uri, mimeType: picked.mimeType, name }, 'image');
      const f: ProofFile = label ? { ...uploaded, label } : uploaded;
      // One before and one after: a new one replaces the old.
      setFiles((x) => [...x.filter((y) => !label || y.label !== label), f]);
      const url = await signedMediaUrl(f.path);
      if (url) setProofUrls((m) => ({ ...m, [f.path]: url }));
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not add that photo');
    } finally {
      setUploading(false);
    }
  };

  const addDocument = async () => {
    try {
      const picked = await pickDocument();
      if (!picked) return;
      setUploading(true);
      const f = await uploadProofFile(picked, 'file');
      setFiles((x) => [...x, f]);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not add that file');
    } finally {
      setUploading(false);
    }
  };

  const openFile = async (f: ProofFile) => {
    // The tile shows a small copy; opening a photo asks for the full-size one.
    const url = await signedMediaUrl(f.path, 'full');
    if (url) void Linking.openURL(url);
  };

  // What a job that asked for them needs before it can be marked done.
  const photosReady =
    (!task.want_photos || (files.some((f) => f.label === 'before') && files.some((f) => f.label === 'after'))) &&
    (!task.live_answer || files.some((f) => f.kind === 'image'));

  const finishWork = async () => {
    if (!userId) return;
    if (!photosReady) return flash(task.live_answer ? 'Add a live photo first' : 'Add the before and after photos first');
    if (summary.trim().length < 10) return flash('Write at least 10 characters about what you did');
    setBusy(true);
    try {
      await submitProof({ taskId: task.id, workerId: userId, summary: maskContacts(summary).text, files });
      await markWorkDone(task.id);
    } catch (e) {
      setBusy(false);
      return flash(messageOf(e, 'Could not mark it done'));
    }
    setBusy(false);
    celebrate('Work sent to the customer');
    // The work is sent: a refresh that fails is not a failed send (round 8, S5-38). It keeps the screen as it is.
    void loadOrFail();
  };

  const approve = async () => {
    setBusy(true);
    try {
      await confirmRelease(task.id);
    } catch (e) {
      setBusy(false);
      return flash(messageOf(e, 'Could not release payment'));
    }
    setBusy(false);
    celebrate('Payment released');
    void loadOrFail();
    // Same as the Confirm screen: once the money is released, ask how it went (also when the refresh fails, S5-38).
    go('review', { title: task.title ?? '', taskId: task.id, price: formatINR(escrowMinor) });
  };

  const askChanges = async () => {
    setBusy(true);
    try {
      await requestRevision(task.id);
    } catch (e) {
      setBusy(false);
      return flash(messageOf(e, 'Could not send it back'));
    }
    setBusy(false);
    flash('Sent back for changes. The review time starts again when they send it');
    void loadOrFail();
  };

  const fileTile = (f: ProofFile, onRemove?: () => void) => (
    <Pressable
      key={f.path}
      onPress={() => void openFile(f)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${f.name}`}
      style={{ width: 84, height: 84, borderRadius: 12, overflow: 'hidden', backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center', padding: 6 }}
    >
      {f.kind === 'image' && proofUrls[f.path] ? (
        <Image source={imageSource(proofUrls[f.path])} style={{ position: 'absolute', inset: 0 }} contentFit="cover" />
      ) : (
        <>
          <Icon name={f.kind === 'video' ? 'play' : 'list'} size={20} color={t.colors.accentDeep} />
          <RNText style={tx('600', 10, t.colors.text, { marginTop: 4, textAlign: 'center' })} numberOfLines={2}>
            {f.name}
          </RNText>
        </>
      )}
      {f.label ? (
        <View style={{ position: 'absolute', left: 4, bottom: 4, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <RNText style={tx('700', 9, '#FFFFFF')}>{f.label === 'before' ? 'BEFORE' : 'AFTER'}</RNText>
        </View>
      ) : null}
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={6} accessibilityLabel="Remove" style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={11} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </Pressable>
  );

  const card = { marginTop: 12, ...cardSurface(t, 18), padding: 15 } as const;

  // -------------------------------------------------------------- view -----

  // Where the job stands, one banner per state (the words the lists use, lib/taskRows.ts).
  const banner = ((): { tone: BannerTone; icon?: IconName; title: string; body?: string; timer?: string } => {
    if (disputed)
      return { tone: 'signal', icon: 'flag', title: 'A problem was reported', body: 'TaskDrop is reviewing it and the payment stays on hold until it is decided.' };
    if (cancelled) return { tone: 'neutral', icon: 'close', title: 'This task was cancelled' };
    if (finished)
      return {
        tone: 'accent',
        icon: 'check',
        title: status === 'AUTO_COMPLETED' ? 'Released automatically' : 'Approved and paid',
        body:
          (status === 'AUTO_COMPLETED' ? 'Released automatically after the review window. ' : '') +
          (worker ? 'Your earnings are on the way to your wallet.' : 'Thanks for using TaskDrop.'),
      };
    if (status === 'WORK_DONE') {
      if (worker)
        return {
          tone: 'gold',
          icon: 'clock',
          title: 'Waiting for the customer to approve',
          body: task.auto_complete_at
            ? `If they don’t respond by ${when(task.auto_complete_at)}, the payment is released to you automatically.`
            : undefined,
        };
      return {
        tone: 'gold',
        icon: 'eye',
        title: 'Work sent for your review',
        body: task.auto_complete_at
          ? `Approve it, or ask for changes, by ${when(task.auto_complete_at)}. If you don’t respond, the payment is released to ${other?.display_name ?? 'the worker'} automatically.`
          : 'Approve it, or ask for changes.',
      };
    }
    if (running && startedAt) {
      const clock = `${hms(Math.abs(remaining))} ${late ? 'past the deadline' : 'left'}`;
      if (worker)
        return {
          tone: late ? 'signal' : 'accent',
          timer: hms(Math.abs(remaining)),
          title: late
            ? `Past the deadline · was due ${dueText}`
            : `${status === 'REVISION_REQUESTED' ? 'Changes asked for · timer' : 'Timer'} running · due ${dueText}`,
        };
      if (status === 'REVISION_REQUESTED')
        return { tone: late ? 'signal' : 'accent', icon: 'repeat', title: 'Sent back for changes', body: `The timer runs again: ${clock}, due ${dueText}. You’ll be notified when they send the work.` };
      return {
        tone: late ? 'signal' : 'accent',
        icon: 'clock',
        title: late ? 'Past the deadline' : 'Work is underway',
        body: `${clock} · due ${dueText}. The worker is on it. You’ll be notified when they send the work.`,
      };
    }
    if (!funded)
      return worker
        ? { tone: 'gold', icon: 'clock', title: 'Waiting on payment', body: 'The customer has not paid yet.' }
        : { tone: 'signal', icon: 'card', title: 'Waiting for your payment', body: 'Pay so the worker can start.' };
    return {
      tone: 'accent',
      icon: 'lock',
      title: 'Payment held safely',
      body: `Due ${dueText}. ${worker ? 'The customer’s' : 'The worker’s'} name and contacts show when the job starts.`,
    };
  })();

  // The page header row on phones and tablets (the system header carries it on the apps, the page header on a desktop).
  const headerRow =
    desktopHeader !== undefined ? (
      desktopHeader
    ) : (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <BackButton onBack={back} title={task.title} right={detailsButton} />
        {systemHeader ? null : (
          <>
            <RNText style={tx('700', 17, t.colors.ink, { flex: 1 })} numberOfLines={1}>{task.title}</RNText>
            {detailsButton}
          </>
        )}
      </View>
    );

  // The other person: named once work starts (the privacy rule), chat open from the hire on.
  const rating = other && startedAt ? (worker ? { avg: other.poster_rating_avg, n: other.poster_rating_count } : { avg: other.worker_rating_avg, n: other.worker_rating_count }) : null;
  const personCard = (
    <View style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View>
        <View style={{ width: 44, height: 44, borderRadius: 999, backgroundColor: worker ? t.colors.accentSoft : t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={tx('800', 16, worker ? t.colors.accentDeep : t.colors.ink)}>{(startedAt ? (other?.display_name ?? '?') : '?').charAt(0).toUpperCase()}</RNText>
        </View>
        {other ? <AvatarPresence lastSeen={other.last_seen_at} ring={t.colors.surface} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <RNText style={tx('700', 15, t.colors.ink)} numberOfLines={1}>{otherName}</RNText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 }}>
          {other ? <PresenceLabel lastSeen={other.last_seen_at} /> : null}
          {rating && rating.n > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }} accessibilityLabel={`Rated ${rating.avg.toFixed(1)} from ${rating.n} reviews`}>
              <Icon name="star" size={11} color={t.colors.gold} />
              <RNText style={tx('600', 11, t.colors.muted)}>
                {rating.avg.toFixed(1)} ({rating.n})
              </RNText>
            </View>
          ) : null}
        </View>
      </View>
      <Pressy onPress={() => go('chat', { taskId: task.id })} label="Chat" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: t.colors.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }}>
        <Icon name="chat" size={14} color={t.colors.accentDeep} />
        <RNText style={tx('700', 13, t.colors.accentDeep)}>Chat</RNText>
      </Pressy>
    </View>
  );

  const bannerView = <StatusBanner {...banner} />;

  // Either side can raise a problem while the job is under way; it freezes the payment for the team to decide.
  const canReport = !disputed && (running || status === 'WORK_DONE');
  const reportLink = (
    <Pressable
      onPress={() => setReporting(true)}
      accessibilityRole="button"
      accessibilityLabel="Report a problem"
      style={{ alignSelf: 'center', marginTop: 10, padding: 8 }}
    >
      <RNText style={tx('700', 13, t.colors.signal)}>Report a problem</RNText>
    </Pressable>
  );

  // The poster's three answers to sent work.
  const reviewing = !worker && status === 'WORK_DONE';
  const reviewActions = reviewing ? (
    <>
      <PrimaryAction label="Approve and release payment" busy={busy} onPress={() => setConfirmingRelease(true)} />
      <Pressable onPress={() => void askChanges()} disabled={busy} accessibilityRole="button" style={{ alignSelf: 'center', marginTop: 12, padding: 4 }}>
        <RNText style={tx('700', 13, t.colors.accentDeep)}>Ask for changes</RNText>
      </Pressable>
      {canReport ? reportLink : null}
    </>
  ) : null;

  // Proof of work, once sent: both sides see it; the poster answers it right under the files.
  const proofShown = Boolean(proof && (doneAt || finished));
  const proofCard =
    proof && proofShown ? (
      <View style={card}>
        <Caption>Proof of work</Caption>
        <RNText style={tx('400', 14, t.colors.ink, { marginTop: 8, lineHeight: 21 })}>{proof.summary}</RNText>
        {proof.files.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>{proof.files.map((f) => fileTile(f))}</View>
        ) : null}
        <RNText style={tx('400', 11, t.colors.muted, { marginTop: 10 })}>Sent {when(proof.created_at)}</RNText>
        {reviewActions}
      </View>
    ) : reviewActions ? (
      <View style={card}>{reviewActions}</View>
    ) : null;

  // The worker's proof, being written, and the one button that sends it.
  const proofForm =
    worker && running && startedAt ? (
      <>
        <View style={card}>
          <RNText style={tx('800', 15, t.colors.ink)}>Finish and send proof</RNText>
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 18 })}>
            {task.live_answer
              ? 'Take a live photo where you are and say what you see. The customer approves it before you are paid.'
              : task.want_photos
                ? 'The customer asked for a before and an after photo. Take the before one first, then say what you did.'
                : 'Say what you did and add photos or documents. The customer sees this before approving.'}
          </RNText>
          <Field
            value={summary}
            onChangeText={setSummary}
            multiline
            maxLength={2000}
            minHeight={90}
            hint={lengthHint(summary, 10, 'what you did') ?? undefined}
            placeholder="E.g. Wrote all 30 captions with hashtags, shared as a Google Doc; changed 3 after your notes."
            style={{ marginTop: 12 }}
          />
          {task.want_photos ? (
            <>
              <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, marginTop: 16 })}>BEFORE AND AFTER · ASKED FOR</RNText>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {(['before', 'after'] as const).map((l) => {
                  const have = files.find((f) => f.label === l);
                  return have ? (
                    fileTile(have, () => setFiles((x) => x.filter((y) => y.path !== have.path)))
                  ) : (
                    <Pressable
                      key={l}
                      onPress={() => void addPhoto(l)}
                      disabled={uploading}
                      accessibilityRole="button"
                      accessibilityLabel={l === 'before' ? 'Add the before photo' : 'Add the after photo'}
                      style={{ width: 84, height: 84, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.colors.accent, alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      <Icon name="camera" size={18} color={t.colors.accentDeep} />
                      <RNText style={tx('700', 10, t.colors.accentDeep)}>{l === 'before' ? 'Before' : 'After'}</RNText>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {files.filter((f) => !f.label).map((f) => fileTile(f, () => setFiles((x) => x.filter((y) => y.path !== f.path))))}
            {files.length < 10 ? (
              <>
                <Pressable onPress={() => void addPhoto()} disabled={uploading} accessibilityRole="button" style={{ width: 84, height: 84, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: t.colors.accentBorder, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Icon name={task.live_answer ? 'camera' : 'plus'} size={18} color={t.colors.accentDeep} />
                  <RNText style={tx('600', 10, t.colors.accentDeep)}>{task.live_answer ? 'Live photo' : 'Photo'}</RNText>
                </Pressable>
                <Pressable onPress={() => void addDocument()} disabled={uploading} accessibilityRole="button" style={{ width: 84, height: 84, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: t.colors.accentBorder, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Icon name="list" size={18} color={t.colors.accentDeep} />
                  <RNText style={tx('600', 10, t.colors.accentDeep)}>Document</RNText>
                </Pressable>
              </>
            ) : null}
            {uploading ? <ActivityIndicator color={t.colors.accent} style={{ alignSelf: 'center', marginLeft: 6 }} /> : null}
          </View>
          <RNText style={tx('400', 11, t.colors.muted, { marginTop: 8 })}>PDF, Word, Excel, PowerPoint or text · up to 50 MB each</RNText>
        </View>
        <PrimaryAction label="Mark work done" busy={busy} disabled={summary.trim().length < 10 || uploading || !photosReady} onPress={() => void finishWork()} />
      </>
    ) : null;

  // The money, the Upwork escrow way: the price, the fee, what is held and what has been released.
  const moneyNote = disputed ? (
    <MoneyNote tone="signal" icon="flag">On hold until TaskDrop decides.</MoneyNote>
  ) : cancelled ? (
    <MoneyNote tone="neutral" icon="close">This task was cancelled.</MoneyNote>
  ) : finished ? (
    worker ? <MoneyNote icon="check">Your earnings are on the way to your wallet.</MoneyNote> : null
  ) : !funded ? (
    worker ? <MoneyNote tone="neutral" icon="clock">The customer has not paid yet.</MoneyNote> : null
  ) : (
    <MoneyNote>{worker ? 'Held safely until the customer approves' : 'TaskDrop holds it until you approve.'}</MoneyNote>
  );
  const moneyCard = worker ? (
    <View style={card}>
      <Caption>Your earnings</Caption>
      <View style={{ marginTop: 6 }}>
        <MoneyRow label="Offer" value={formatINR(offerMinor)} />
        <MoneyRow label={`TaskDrop fee (${pctWords(fees.commission)})`} value={`−${formatINR(Math.max(0, offerMinor - earnsMinor))}`} />
        <View style={{ height: 1, backgroundColor: t.colors.line, marginVertical: 6 }} />
        <MoneyRow label="You earn" value={formatINR(earnsMinor)} strong big color={t.colors.accentDeep} />
      </View>
      {moneyNote}
    </View>
  ) : (
    <View style={card}>
      <Caption>Payment</Caption>
      <View style={{ marginTop: 6 }}>
        <MoneyRow label="Offer price" value={formatINR(offerMinor)} />
        <MoneyRow label={`Service fee (${pctWords(fees.posterFee)})`} value={formatINR(Math.max(0, escrowMinor - offerMinor))} />
        {cancelled ? null : (
          <>
            <MoneyRow
              label="Held safely"
              icon="lock"
              strong
              color={funded ? t.colors.accentDeep : t.colors.signalDeep}
              value={!funded ? 'Not paid yet' : finished ? formatINR(0) : formatINR(escrowMinor)}
            />
            <MoneyRow label="Released" value={formatINR(finished ? escrowMinor : 0)} />
          </>
        )}
      </View>
      {moneyNote}
    </View>
  );

  const progressCard = (
    <View style={card}>
      <Caption>Progress</Caption>
      <ProgressList steps={steps} when={when} />
    </View>
  );

  const crewCard = task.crew_id ? (
    <Pressable
      onPress={() => go('crew', { crewId: task.crew_id, member: true })}
      accessibilityRole="button"
      accessibilityLabel="Crew job: see who else is on it"
      style={[card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}
    >
      <Icon name="users" size={18} color={t.colors.accentDeep} />
      <View style={{ flex: 1 }}>
        <RNText style={tx('800', 14, t.colors.ink)}>
          Crew job · helper {task.crew_slot} of {task.crew_size}
        </RNText>
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>See who else is on it, and the crew chat</RNText>
      </View>
      <Icon name="chevronRight" size={16} color={t.colors.muted} />
    </Pressable>
  ) : null;

  // Time on the job, as a small stat: frozen once the work is done.
  const timeOnJob = startedAt ? (doneAt ? `Done in ${span(doneAt - startedAt)}` : running ? `${span(now - startedAt)} so far` : null) : null;

  // The poster's job details in one card; the worker's board keeps Deadline and Where as their own cards.
  // The exact address: only the customer and the person hired can read it (the database decides).
  const detailsCards = worker ? (
    <>
      <SectionCard caption="Deadline">
        <RNText style={tx('800', 14, t.colors.ink, { marginTop: 4 })}>{dueText}</RNText>
        <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2 })}>Set by the customer</RNText>
      </SectionCard>
      {detail.address ? (
        <SectionCard caption="Where">
          <RNText style={tx('700', 14, t.colors.ink, { marginTop: 4 })}>{detail.address}</RNText>
          <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2 })}>Shared only with the person on this job</RNText>
        </SectionCard>
      ) : null}
      {timeOnJob && doneAt ? (
        <SectionCard caption="Time on job">
          <RNText style={tx('700', 14, t.colors.ink, { marginTop: 4 })}>{timeOnJob}</RNText>
        </SectionCard>
      ) : null}
    </>
  ) : (
    <SectionCard caption="Job details">
      <View style={{ marginTop: 4 }}>
        <DetailRow icon="calendar" value={dueText} sub="Deadline · set by you" />
        {detail.address ? <DetailRow icon="pin" value={detail.address} sub="Shared only with the person on this job" /> : null}
        {timeOnJob ? <DetailRow icon={doneAt ? 'check' : 'clock'} value={timeOnJob} sub="Time on job" /> : null}
      </View>
    </SectionCard>
  );

  // What happens after the worker sends the work, in the live rule numbers.
  const whatNext =
    worker && !finished && !cancelled && !disputed ? (
      <SectionCard caption="What happens next">
        <RNText style={tx('400', 13, t.colors.text, { marginTop: 6, lineHeight: 20 })}>
          The customer has {TIMING.REVIEW_WINDOW_DAYS} days to approve. If they don’t, the payment is released to you
          automatically. Earnings clear after {fees.clearingDays} days, then withdraw to UPI or bank.
        </RNText>
      </SectionCard>
    ) : null;

  const bottomReport = canReport && !reviewing ? reportLink : null;

  const sheets = (
    <>
      <ConfirmDialog
        visible={confirmingRelease}
        icon="shield"
        title="Release the payment?"
        message={releaseMessage(formatINR(escrowMinor))}
        confirmLabel="Yes, release payment"
        cancelLabel="Not yet"
        busy={busy}
        onCancel={() => setConfirmingRelease(false)}
        onConfirm={() => {
          setConfirmingRelease(false);
          void approve();
        }}
      />
      <ReportProblemSheet taskId={task.id} visible={reporting} onClose={() => setReporting(false)} onReported={() => void load()} />
    </>
  );

  if (split) {
    // Wide desktop: the person, where it stands, the work and the progress on the left; the money and the
    // job's details in a side column on the right (components/TwoPane.tsx).
    return (
      <Screen padded={false}>
        {headerRow}
        {/* The cards line up with the page header, 20 px in from the column edge. */}
        <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <TwoPane
          fixed="right"
          width={Math.round(Math.min(380, Math.max(320, contentWidth('feed') * 0.3)))}
          left={
            <View style={{ marginTop: -12 }}>
              {personCard}
              {bannerView}
              {worker ? (proofCard ?? proofForm) : proofCard}
              {progressCard}
              {crewCard}
              {bottomReport}
            </View>
          }
          right={
            <View style={{ marginTop: -12 }}>
              {moneyCard}
              {detailsCards}
              {whatNext}
            </View>
          }
          single={null}
        />
        </View>
        {sheets}
      </Screen>
    );
  }

  return (
    <Screen scroll padded={false}>
      <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 28 }}>
        {headerRow}
        {personCard}
        {bannerView}
        {worker ? (
          <>
            {moneyCard}
            {proofCard ?? proofForm}
          </>
        ) : (
          <>
            {proofCard}
            {moneyCard}
          </>
        )}
        {progressCard}
        {crewCard}
        {detailsCards}
        {whatNext}
        {bottomReport}
      </View>
      {sheets}
    </Screen>
  );
}

function PrimaryAction({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const t = useTheme();
  const off = disabled || busy;
  return (
    <Pressy
      onPress={() => !off && onPress()}
      style={{ marginTop: 16, borderRadius: 999, paddingVertical: 16, alignItems: 'center', backgroundColor: off ? t.colors.surface2 : t.colors.btn }}
    >
      {busy ? <ActivityIndicator color={t.colors.onBtn} /> : <RNText style={tx('700', 16, off ? t.colors.muted : t.colors.onBtn)}>{label}</RNText>}
    </Pressy>
  );
}
