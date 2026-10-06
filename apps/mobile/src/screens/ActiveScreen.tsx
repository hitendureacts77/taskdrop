import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated, Easing, Image, Linking, ActivityIndicator } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Screen, formatINR } from '../components/ui';
import { Icon } from '../components/Icon';
import { EmptyState, Field } from '../components/kit';
import { ReportProblemSheet } from '../components/ReportProblemSheet';
import { AvatarPresence, PresenceLabel } from '../components/PresenceDot';
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
  signedMediaUrl,
  signedMediaUrls,
  uploadProofFile,
  type ProofFile,
} from '../lib/media';
import { maskContacts } from '../lib/mask';
import { Pressy, tx } from '../components/primitives';

const RING_R = 88;
const RING_C = 2 * Math.PI * RING_R;

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

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * A job in progress, for both sides, from the task itself.
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
  const worker = mode === 'worker';
  const taskId = typeof params.taskId === 'string' ? params.taskId : null;

  const [detail, setDetail] = useState<TaskDetail | null | undefined>(undefined);
  const [proof, setProof] = useState<Proof | null>(null);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);

  // The worker's proof, before it is sent.
  const [summary, setSummary] = useState('');
  const [files, setFiles] = useState<ProofFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return setDetail(null);
    const [d, p] = await Promise.all([getTaskDetail(taskId).catch(() => null), getProof(taskId)]);
    setDetail(d);
    setProof(p);
    const paths = (p?.files ?? []).filter((f) => f.kind !== 'file').map((f) => f.path);
    if (paths.length) setProofUrls(await signedMediaUrls(paths));
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

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
  const total = Math.max(60000, deadline - (startedAt ?? deadline - 3600000));
  const frac = Math.min(1, Math.max(0, (clockNow - (startedAt ?? clockNow)) / total));

  const ring = useRef(new Animated.Value(RING_C)).current;
  useEffect(() => {
    Animated.timing(ring, {
      toValue: RING_C * (1 - frac),
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [frac, ring]);

  if (detail === undefined) {
    return (
      <Screen padded={false}>
        <ActivityIndicator color={t.colors.accent} style={{ marginTop: 80 }} />
      </Screen>
    );
  }
  if (!detail || !task) {
    return (
      <Screen padded={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <Pressable onPress={back} hitSlop={10}>
            <Icon name="back" size={20} color={t.colors.ink} />
          </Pressable>
        </View>
        <EmptyState icon="briefcase" title="This job isn’t available" body="Open it again from My Work or My Tasks." />
      </Screen>
    );
  }

  const other = worker ? detail.poster : detail.worker;
  const otherName = startedAt ? (other?.display_name ?? (worker ? 'The customer' : 'The worker')) : 'Shown when the job starts';
  const escrowMinor = detail.assignment?.escrow_minor ?? task.locked_minor ?? 0;
  const finished = status === 'COMPLETED' || status === 'AUTO_COMPLETED';
  const overdue = !doneAt && remaining < 0;

  const steps = [
    { label: 'Offer accepted', at: task.created_at, reached: Boolean(task.locked_bid_id) },
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

  const addPhoto = async () => {
    try {
      const picked = await pickMedia('image');
      if (!picked) return;
      setUploading(true);
      const f = await uploadProofFile({ uri: picked.uri, mimeType: picked.mimeType, name: 'Photo' }, 'image');
      setFiles((x) => [...x, f]);
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
    const url = proofUrls[f.path] ?? (await signedMediaUrl(f.path));
    if (url) void Linking.openURL(url);
  };

  const finishWork = async () => {
    if (!userId) return;
    if (summary.trim().length < 10) return flash('Say what you did — a sentence or two');
    setBusy(true);
    try {
      await submitProof({ taskId: task.id, workerId: userId, summary: maskContacts(summary).text, files });
      await markWorkDone(task.id);
      celebrate('Work sent to the customer');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not mark it done');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await confirmRelease(task.id);
      celebrate('Payment released');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not release payment');
    } finally {
      setBusy(false);
    }
  };

  const askChanges = async () => {
    setBusy(true);
    try {
      await requestRevision(task.id);
      flash('Sent back for changes — the timer runs again');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send it back');
    } finally {
      setBusy(false);
    }
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
        <Image source={{ uri: proofUrls[f.path] }} style={{ position: 'absolute', inset: 0 }} resizeMode="cover" />
      ) : (
        <>
          <Icon name={f.kind === 'video' ? 'play' : 'list'} size={20} color={t.colors.accentDeep} />
          <RNText style={tx('600', 10, t.colors.text, { marginTop: 4, textAlign: 'center' })} numberOfLines={2}>
            {f.name}
          </RNText>
        </>
      )}
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={6} accessibilityLabel="Remove" style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={11} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </Pressable>
  );

  const card = { marginTop: 16, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 16, padding: 15 } as const;

  // -------------------------------------------------------------- view -----

  return (
    <Screen scroll padded={false}>
      <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="back" size={20} color={t.colors.ink} />
          </Pressable>
          <RNText style={tx('700', 17, t.colors.ink, { flex: 1 })} numberOfLines={1}>{task.title}</RNText>
          {/* Lists open in-progress tasks straight here; the overview (quotes,
              timeline, details) stays one tap away for the poster. */}
          {!worker ? (
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
          ) : null}
        </View>

        {/* The clock: time left to the poster's deadline; frozen once done. */}
        <View style={{ alignItems: 'center', marginTop: 20 }}>
          <View style={{ width: 200, height: 200 }}>
            <Svg width={200} height={200} viewBox="0 0 200 200" style={{ transform: [{ rotate: '-90deg' }] }}>
              <Circle cx={100} cy={100} r={RING_R} stroke={t.colors.surface2} strokeWidth={10} fill="none" />
              <AnimatedCircleComp
                cx={100}
                cy={100}
                r={RING_R}
                stroke={overdue ? t.colors.signal : doneAt ? '#22C55E' : t.colors.accent}
                strokeWidth={10}
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={ring}
                fill="none"
              />
            </Svg>
            <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 }}>
              {doneAt ? (
                <>
                  <Icon name="check" size={26} color="#16A34A" strokeWidth={2.4} />
                  <RNText style={tx('800', 20, t.colors.ink, { marginTop: 6 })}>Done</RNText>
                  <RNText style={tx('500', 12, t.colors.muted, { marginTop: 4, textAlign: 'center' })}>
                    {startedAt ? `in ${span(doneAt - startedAt)}` : 'Timer stopped'}
                  </RNText>
                </>
              ) : !startedAt ? (
                <>
                  <RNText style={tx('800', 20, t.colors.ink)}>Not started</RNText>
                  <RNText style={tx('500', 12, t.colors.muted, { marginTop: 4, textAlign: 'center' })}>Due {when(new Date(deadline).toISOString())}</RNText>
                </>
              ) : (
                <>
                  <RNText style={tx('800', 32, overdue ? t.colors.signal : t.colors.ink, { letterSpacing: -1, fontVariant: ['tabular-nums'] })}>
                    {hms(Math.abs(remaining))}
                  </RNText>
                  <RNText style={tx('600', 12, overdue ? t.colors.signal : t.colors.muted, { marginTop: 6 })}>
                    {overdue ? 'past the deadline' : 'left to the deadline'}
                  </RNText>
                </>
              )}
            </View>
          </View>
        </View>

        <View style={{ ...card, flexDirection: 'row' }}>
          <View style={{ flex: 1 }}>
            <RNText style={tx('600', 10, t.colors.muted, { letterSpacing: 1.2 })}>DEADLINE</RNText>
            <RNText style={tx('800', 14, t.colors.ink, { marginTop: 4 })}>{when(new Date(deadline).toISOString())}</RNText>
            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2 })}>Set by the customer</RNText>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <RNText style={tx('600', 10, t.colors.muted, { letterSpacing: 1.2 })}>HELD SAFELY</RNText>
            <RNText style={tx('800', 14, t.colors.ink, { marginTop: 4 })}>{formatINR(escrowMinor)}</RNText>
            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2 })}>Held safely until approval</RNText>
          </View>
        </View>

        {/* The other person. */}
        <View style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View>
            <View style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <RNText style={tx('800', 15, t.colors.ink)}>{(other?.display_name ?? '?').charAt(0).toUpperCase()}</RNText>
            </View>
            {other ? <AvatarPresence lastSeen={other.last_seen_at} ring={t.colors.surface} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <RNText style={tx('700', 14, t.colors.ink)}>{otherName}</RNText>
            {other ? <PresenceLabel lastSeen={other.last_seen_at} /> : null}
          </View>
          <Pressy onPress={() => go('chat', { taskId: task.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: t.colors.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }}>
            <Icon name="chat" size={14} color={t.colors.accentDeep} />
            <RNText style={tx('700', 13, t.colors.accentDeep)}>Chat</RNText>
          </Pressy>
        </View>

        {/* Where it stands. */}
        <View style={{ marginTop: 16 }}>
          {steps.map((s) => (
            <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
              <View style={{ width: 18, height: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: s.reached ? t.colors.accent : t.colors.surface2 }}>
                {s.reached ? <Icon name="check" size={11} color={t.colors.onAccent} strokeWidth={3} /> : null}
              </View>
              <RNText style={tx(s.reached ? '600' : '400', 13, s.reached ? t.colors.ink : t.colors.muted, { flex: 1 })}>{s.label}</RNText>
              {s.reached && s.at ? <RNText style={tx('400', 11, t.colors.muted)}>{when(s.at)}</RNText> : null}
            </View>
          ))}
        </View>

        {/* Proof of work: sent, or being written. */}
        {proof && (doneAt || finished) ? (
          <View style={card}>
            <RNText style={tx('600', 10, t.colors.muted, { letterSpacing: 1.2 })}>PROOF OF WORK</RNText>
            <RNText style={tx('400', 14, t.colors.ink, { marginTop: 8, lineHeight: 21 })}>{proof.summary}</RNText>
            {proof.files.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>{proof.files.map((f) => fileTile(f))}</View>
            ) : null}
            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 10 })}>Sent {when(proof.created_at)}</RNText>
          </View>
        ) : null}

        {worker && running && startedAt ? (
          <View style={card}>
            <RNText style={tx('800', 15, t.colors.ink)}>Finish and send proof</RNText>
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 18 })}>
              Say what you did and add photos or documents. The customer sees this before approving.
            </RNText>
            <Field
              value={summary}
              onChangeText={setSummary}
              multiline
              maxLength={2000}
              minHeight={90}
              placeholder="E.g. Wrote all 30 captions with hashtags, shared as a Google Doc; changed 3 after your notes."
              style={{ marginTop: 12 }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {files.map((f) => fileTile(f, () => setFiles((x) => x.filter((y) => y.path !== f.path))))}
              {files.length < 10 ? (
                <>
                  <Pressable onPress={() => void addPhoto()} disabled={uploading} accessibilityRole="button" style={{ width: 84, height: 84, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: t.colors.accentBorder, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    <Icon name="plus" size={18} color={t.colors.accentDeep} />
                    <RNText style={tx('600', 10, t.colors.accentDeep)}>Photo</RNText>
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
        ) : null}

        {/* The one thing to do next, for whoever is on this screen. */}
        {worker && running && startedAt ? (
          <PrimaryAction label="Mark work done" busy={busy} disabled={summary.trim().length < 10 || uploading} onPress={() => void finishWork()} />
        ) : null}
        {worker && status === 'WORK_DONE' && task.auto_complete_at ? (
          <Note>
            Waiting for the customer to approve. If they don’t respond by {when(task.auto_complete_at)}, the payment is
            released to you automatically.
          </Note>
        ) : null}

        {!worker && status === 'WORK_DONE' ? (
          <>
            <PrimaryAction label="Approve and release payment" busy={busy} onPress={() => void approve()} />
            <Pressable onPress={() => void askChanges()} disabled={busy} accessibilityRole="button" style={{ alignSelf: 'center', marginTop: 14 }}>
              <RNText style={tx('700', 13, t.colors.accentDeep)}>Ask for changes</RNText>
            </Pressable>
            {task.auto_complete_at ? (
              <Note>
                If you don’t respond by {when(task.auto_complete_at)}, the payment is released to the worker
                automatically.
              </Note>
            ) : null}
          </>
        ) : null}
        {!worker && running ? <Note>The worker is on it. You’ll be notified when they send the work.</Note> : null}
        {finished ? (
          <Note>
            {status === 'AUTO_COMPLETED' ? 'Released automatically after the review window.' : 'Approved and paid.'}{' '}
            {worker ? 'Your earnings are on the way to your wallet.' : 'Thanks for using TaskDrop.'}
          </Note>
        ) : null}

        {/* Either side can raise a problem while the job is under way; it freezes the payment for the team to decide. */}
        {status === 'DISPUTED' ? (
          <Note>A problem was reported on this job. TaskDrop is reviewing it and the payment stays on hold until it is decided.</Note>
        ) : running || status === 'WORK_DONE' ? (
          <Pressable
            onPress={() => setReporting(true)}
            accessibilityRole="button"
            accessibilityLabel="Report a problem"
            style={{ alignSelf: 'center', marginTop: 18, padding: 8 }}
          >
            <RNText style={tx('700', 13, t.colors.signal)}>Report a problem</RNText>
          </Pressable>
        ) : null}
      </View>
      <ReportProblemSheet taskId={task.id} visible={reporting} onClose={() => setReporting(false)} onReported={() => void load()} />
    </Screen>
  );
}

const AnimatedCircleComp = Animated.createAnimatedComponent(Circle);

function PrimaryAction({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const t = useTheme();
  const off = disabled || busy;
  return (
    <Pressy
      onPress={() => !off && onPress()}
      style={{ marginTop: 20, borderRadius: 999, paddingVertical: 16, alignItems: 'center', backgroundColor: off ? t.colors.surface2 : t.colors.accent }}
    >
      {busy ? <ActivityIndicator color={t.colors.onAccent} /> : <RNText style={tx('700', 16, off ? t.colors.muted : t.colors.onAccent)}>{label}</RNText>}
    </Pressy>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: 14, flexDirection: 'row', gap: 8, backgroundColor: t.colors.surface2, borderRadius: 12, padding: 12 }}>
      <Icon name="clock" size={14} color={t.colors.muted} />
      <RNText style={tx('400', 12, t.colors.text, { flex: 1, lineHeight: 18 })}>{children}</RNText>
    </View>
  );
}
