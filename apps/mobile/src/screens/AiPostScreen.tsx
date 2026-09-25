import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, TextInput, Animated, ActivityIndicator } from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { Icon } from '../components/Icon';
import { AmountField } from '../components/AmountField';
import { Slider } from '../components/Slider';
import { MediaAttach } from '../components/MediaAttach';
import { LocationSheet, type PickedPlace } from '../components/LocationSheet';
import { DateTimeSheet, formatDeadline } from '../components/DateTimeSheet';
import { Badge, Field, PrimaryButton, rupees } from '../components/kit';
import { Pressy, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { useMode } from '../providers/ModeProvider';
import { createTask, getProfile, type Task } from '../data/api';
import type { TaskMedia } from '../lib/media';
import { useVoiceInput } from '../lib/speech';
import { contactIssueMessage, findContactIssue } from '../lib/mask';
import { FEES } from '@taskdrop/rules';
import {
  CATEGORIES,
  WHEN_OPTIONS,
  WRITING_STYLES,
  askBrief,
  askQuestions,
  briefToDescription,
  dueFor,
  pillarFor,
  type Answer,
  type Brief,
  type QuickQuestion,
  type Source,
  type WhenKey,
  type WritingStyle,
} from '../lib/taskBrief';

/**
 * "What's on your mind?" -> a posted task, in five steps.
 *
 *   1  What      the request in one sentence, up to three AI quick-picks,
 *                then an editable AI-written brief (title, description,
 *                category, writing style)
 *   2  When      right now / today / 2 days / this week / a date
 *   3  Budget    what the job is worth, with the brief's suggested range
 *   4  Providers review quotes, or auto-accept the first one within budget;
 *                where the job is
 *   5  Review    the post as a worker will see it, and what it will cost
 *
 * Nothing here moves money. Escrow is paid when a quote is locked, exactly as
 * before; this screen only writes the task row.
 */

type Phase = 'what' | 'picks' | 'brief' | 'when' | 'budget' | 'providers' | 'review';

const STEP_OF: Record<Phase, [number, string]> = {
  what: [1, 'What'],
  picks: [1, 'What'],
  brief: [1, 'What'],
  when: [2, 'When'],
  budget: [3, 'Budget'],
  providers: [4, 'Providers'],
  review: [5, 'Review'],
};

const OTHER = 'Something else';

function isTask(v: unknown): v is Task {
  return !!v && typeof v === 'object' && 'title' in v && 'benchmark_minor' in v;
}

/** Checklist steps for a split job, by how many parts. Percentages add to 100. */
const MILESTONE_PLANS: Record<number, { title: string; pct: number }[]> = {
  2: [
    { title: 'Work started', pct: 50 },
    { title: 'Work completed', pct: 50 },
  ],
  3: [
    { title: 'Plan agreed', pct: 30 },
    { title: 'First draft or half done', pct: 30 },
    { title: 'Work completed', pct: 40 },
  ],
  4: [
    { title: 'Plan agreed', pct: 20 },
    { title: 'Work started', pct: 25 },
    { title: 'Half done, shared for review', pct: 25 },
    { title: 'Work completed', pct: 30 },
  ],
  5: [
    { title: 'Plan agreed', pct: 15 },
    { title: 'Work started', pct: 20 },
    { title: 'Half done, shared for review', pct: 20 },
    { title: 'Changes made', pct: 20 },
    { title: 'Work completed', pct: 25 },
  ],
  6: [
    { title: 'Plan agreed', pct: 10 },
    { title: 'Materials or access ready', pct: 15 },
    { title: 'Work started', pct: 15 },
    { title: 'Half done, shared for review', pct: 20 },
    { title: 'Changes made', pct: 20 },
    { title: 'Work completed', pct: 20 },
  ],
};

/** Where the budget slider ends; it steps up as the amount grows, with no ceiling. */
const SLIDER_STOPS = [2000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

export function AiPostScreen() {
  const t = useTheme();
  const { params, back, reset, go } = useNav();
  const { flash, celebrate } = useActions();
  const { userId } = useAuth();
  const { setMode } = useMode();

  const similar = isTask(params.similar) ? params.similar : null;
  const [phase, setPhase] = useState<Phase>(similar ? 'brief' : 'what');
  const [prompt, setPrompt] = useState(
    typeof params.prompt === 'string' ? params.prompt : similar ? similar.title : '',
  );
  const [busy, setBusy] = useState(false);
  const [promptFocused, setPromptFocused] = useState(false);

  // Quick picks.
  const [questions, setQuestions] = useState<QuickQuestion[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');

  // The brief.
  const [brief, setBrief] = useState<Brief | null>(null);
  const [title, setTitle] = useState(similar?.title ?? '');
  const [description, setDescription] = useState(similar?.description ?? '');
  const [category, setCategory] = useState<string>(similar?.category ?? 'Other');
  const [style, setStyle] = useState<WritingStyle>('professional');
  const [customStyle, setCustomStyle] = useState('');
  const [source, setSource] = useState<Source | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [media, setMedia] = useState<TaskMedia | null>(null);

  // When.
  const [whenKey, setWhenKey] = useState<WhenKey | 'custom'>('today');
  const [customDue, setCustomDue] = useState<Date | null>(null);
  const [showDate, setShowDate] = useState(false);

  // Budget.
  const [budget, setBudget] = useState<number | null>(similar ? Math.round(similar.benchmark_minor / 100) : null);
  const [split, setSplit] = useState<0 | 2 | 3 | 4 | 5 | 6>(0);

  // Providers.
  const [mode, setAssign] = useState<'bids' | 'auto'>('bids');
  const [place, setPlace] = useState<PickedPlace | null>(null);
  const [remote, setRemote] = useState(false);
  const [showLoc, setShowLoc] = useState(false);
  const [posting, setPosting] = useState(false);

  // Start from where the poster lives: most jobs are near home.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getProfile(userId)
      .then((p) => {
        if (alive && p?.loc_label) setPlace((cur) => cur ?? { label: p.loc_label!, lat: p.loc_lat, lng: p.loc_lng });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  const voice = useVoiceInput(
    (text) => setPrompt((cur) => (cur.trim() ? cur.trim() + ' ' + text : text)),
    flash,
  );

  // ---------------------------------------------------------------- flow ---

  const takeResult = (r: { source: Source; note?: string; credits?: number }) => {
    setSource(r.source);
    setNote(r.note ?? null);
    if (typeof r.credits === 'number') setCredits(r.credits);
  };

  const startPicks = async () => {
    if (prompt.trim().length < 5) return flash('Tell us a bit more about what you need');
    setBusy(true);
    try {
      const r = await askQuestions(prompt.trim());
      takeResult(r);
      if (r.value.length === 0) {
        await writeBrief([]);
        return;
      }
      setQuestions(r.value);
      setQIndex(0);
      setAnswers([]);
      setOtherOpen(false);
      setOtherText('');
      setPhase('picks');
    } finally {
      setBusy(false);
    }
  };

  const writeBrief = async (with_: Answer[], nextStyle: WritingStyle = style) => {
    setBusy(true);
    try {
      const r = await askBrief(prompt.trim(), with_, nextStyle, customStyle);
      takeResult(r);
      const b = r.value;
      setBrief(b);
      setTitle(b.title);
      setDescription(briefToDescription(b));
      setCategory(b.category);
      // Suggest the middle of the range; the poster sets the real figure next.
      setBudget((cur) => cur ?? Math.round((b.budgetMinInr + b.budgetMaxInr) / 2 / 10) * 10);
      setPhase('brief');
    } finally {
      setBusy(false);
    }
  };

  const answer = (value: string) => {
    const q = questions[qIndex];
    if (!q) return;
    const next = [...answers.filter((a) => a.question !== q.question), { question: q.question, answer: value }];
    setAnswers(next);
    setOtherOpen(false);
    setOtherText('');
    if (qIndex + 1 < questions.length) {
      setQIndex(qIndex + 1);
    } else {
      void writeBrief(next);
    }
  };

  const restyle = (s: WritingStyle) => {
    setStyle(s);
    if (s === 'custom' && !customStyle.trim()) return; // wait for the instruction
    void writeBrief(answers, s);
  };

  const due = useMemo(
    () => (whenKey === 'custom' ? (customDue ?? dueFor('week')) : dueFor(whenKey)),
    [whenKey, customDue],
  );

  const titleIssue = findContactIssue(title);
  const descIssue = findContactIssue(description);
  const canLeaveBrief =
    title.trim().length >= 4 && description.trim().length >= 10 && !titleIssue && !descIssue;
  const budgetOk = (budget ?? 0) >= 10;
  const feeRupees = Math.round((budget ?? 0) * FEES.POSTER_SERVICE_FEE_PCT);

  const milestones = useMemo(() => MILESTONE_PLANS[split] ?? [], [split]);

  const post = async () => {
    if (!userId) return flash('Sign in to post a task');
    if (posting) return;
    setPosting(true);
    try {
      const minutes = Math.max(60, Math.round((due.getTime() - Date.now()) / 60000));
      const task = await createTask({
        posterId: userId,
        pillar: brief?.pillar ?? pillarFor(category),
        title: title.trim(),
        description: description.trim(),
        benchmarkMinor: Math.round((budget ?? 0) * 100),
        timeLimitMinutes: minutes,
        flag: whenKey === 'now' ? 'urgent' : 'none',
        media,
        locLabel: remote ? 'Remote' : (place?.label ?? null),
        locLat: remote ? null : (place?.lat ?? null),
        locLng: remote ? null : (place?.lng ?? null),
        category,
        skills: brief?.skills ?? similar?.skills ?? [],
        difficulty: brief?.difficulty ?? (similar?.difficulty as Brief['difficulty'] | null) ?? 'medium',
        assignmentMode: mode,
        dueAt: due.toISOString(),
        milestones,
      });
      setMode('poster');
      celebrate('Task posted');
      reset('myTasks');
      go('taskManage', { taskId: task.id });
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not post your task');
    } finally {
      setPosting(false);
    }
  };

  // ------------------------------------------------------------ chrome ----

  const [stepNo, stepLabel] = STEP_OF[phase];
  const progress = useRef(new Animated.Value(stepNo / 5)).current;
  useEffect(() => {
    const anim = Animated.timing(progress, { toValue: stepNo / 5, duration: 320, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [stepNo, progress]);

  const goBack = () => {
    switch (phase) {
      case 'what':
        return back();
      case 'picks':
        return qIndex > 0 ? setQIndex(qIndex - 1) : setPhase('what');
      case 'brief':
        return setPhase(similar ? 'what' : questions.length ? 'picks' : 'what');
      case 'when':
        return setPhase('brief');
      case 'budget':
        return setPhase('when');
      case 'providers':
        return setPhase('budget');
      case 'review':
        return setPhase('providers');
    }
  };

  const chip = (label: string, on: boolean, onPress: () => void, icon?: Parameters<typeof Icon>[0]['name']) => (
    <Pressy
      key={label}
      onPress={onPress}
      label={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 9,
        paddingHorizontal: 13,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? t.colors.accent : t.colors.line,
        backgroundColor: on ? t.colors.accent : t.colors.surface,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={on ? t.colors.onAccent : t.colors.muted} strokeWidth={2} /> : null}
      <RNText style={tx('600', 13, on ? t.colors.onAccent : t.colors.text)}>{label}</RNText>
    </Pressy>
  );

  const optionRow = (label: string, on: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 15,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: on ? t.colors.accent : t.colors.line,
        backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
        marginTop: 9,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <RNText style={tx(on ? '700' : '500', 14, on ? t.colors.accentDeep : t.colors.ink, { flex: 1 })}>{label}</RNText>
      {on ? <Icon name="check" size={16} color={t.colors.accentDeep} strokeWidth={2.4} /> : null}
    </Pressable>
  );

  const sourceNote =
    source === 'ai' ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <Icon name="sparkle" size={13} color={t.colors.ai} strokeWidth={1.8} />
        <RNText style={tx('500', 12, t.colors.ai)}>
          Drafted by AI{credits !== null ? ` · ${credits} credit${credits === 1 ? '' : 's'} left today` : ''}
        </RNText>
      </View>
    ) : source === 'offline' ? (
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 10, lineHeight: 17 })}>
        {note ? `${note.replace(/[.!]?\s*$/, '.')} Using the quick writer instead.` : 'Drafted by the quick writer.'} Edit anything below.
      </RNText>
    ) : null;

  // --------------------------------------------------------------- views ---

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (phase === 'what') {
    const issue = findContactIssue(prompt);
    body = (
      <>
        <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5 })}>What do you need done?</RNText>
        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 6, lineHeight: 19 })}>
          Say it the way you would to a friend. We’ll ask a couple of quick questions and write the post for you.
        </RNText>
        <View
          style={{
            marginTop: 16,
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: issue ? t.colors.signal : promptFocused ? t.colors.accent : t.colors.line,
            borderRadius: 14,
            padding: 14,
          }}
        >
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            onFocus={() => setPromptFocused(true)}
            onBlur={() => setPromptFocused(false)}
            placeholder="E.g. I want a mechanic to fix the side stand of my scooter at home"
            placeholderTextColor={t.colors.muted}
            multiline
            autoFocus
            style={tx('400', 16, t.colors.ink, { minHeight: 120, textAlignVertical: 'top', padding: 0 })}
          />
          {voice.supported ? (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Pressable
                onPress={voice.toggle}
                accessibilityRole="button"
                accessibilityLabel={voice.listening ? 'Stop voice typing' : 'Voice typing'}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: voice.listening ? t.colors.signalSoft : t.colors.surface2,
                }}
              >
                <Icon name="mic" size={18} color={voice.listening ? t.colors.signal : t.colors.muted} />
              </Pressable>
            </View>
          ) : null}
        </View>
        {issue ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, backgroundColor: t.colors.signalSoft, borderRadius: 10, padding: 11 }}>
            <Icon name="shield" size={15} color={t.colors.signalDeep} />
            <RNText style={tx('600', 12, t.colors.signalDeep, { flex: 1, lineHeight: 17 })}>{contactIssueMessage(issue)}</RNText>
          </View>
        ) : (
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 10, lineHeight: 17 })}>
            Don’t add phone numbers or addresses here — you’ll share those in chat with the person you hire.
          </RNText>
        )}
      </>
    );
    footer = busy ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15 }}>
        <ActivityIndicator color={t.colors.accent} />
        <RNText style={tx('600', 14, t.colors.muted)}>Thinking of good questions…</RNText>
      </View>
    ) : (
      <PrimaryButton label="Continue" onPress={() => void startPicks()} disabled={prompt.trim().length < 5 || issue !== null} />
    );
  }

  if (phase === 'picks') {
    const q = questions[qIndex]!;
    const chosen = answers.find((a) => a.question === q.question)?.answer;
    body = busy ? (
      <View style={{ alignItems: 'center', paddingVertical: 80, gap: 14 }}>
        <ActivityIndicator color={t.colors.accent} size="large" />
        <RNText style={tx('600', 14, t.colors.muted)}>Writing your brief…</RNText>
      </View>
    ) : (
      <>
        <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5 })}>A few quick questions</RNText>
        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 6 })}>Tap what fits. It takes about half a minute.</RNText>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 16 }}>
          {questions.map((_, i) => (
            <View
              key={i}
              style={{ flex: 1, height: 4, borderRadius: 999, backgroundColor: i <= qIndex ? t.colors.accent : t.colors.line }}
            />
          ))}
        </View>
        <RNText style={tx('600', 12, t.colors.muted, { marginTop: 16 })}>
          Question {qIndex + 1} of {questions.length}
        </RNText>
        <RNText style={tx('800', 18, t.colors.ink, { marginTop: 4, letterSpacing: -0.3 })}>{q.question}</RNText>
        {q.options.map((o) => optionRow(o, chosen === o, () => answer(o)))}
        {optionRow(OTHER, otherOpen, () => setOtherOpen(true))}
        {otherOpen ? (
          <Field
            style={{ marginTop: 10 }}
            value={otherText}
            onChangeText={setOtherText}
            placeholder="Please specify"
            autoFocus
            returnKeyType="next"
            onSubmitEditing={() => otherText.trim() && answer(otherText.trim())}
          />
        ) : null}
      </>
    );
    footer = busy ? null : (
      <>
        {otherOpen ? (
          <PrimaryButton label="Next" onPress={() => answer(otherText.trim())} disabled={!otherText.trim()} />
        ) : null}
        <Pressable
          onPress={() => void writeBrief(answers)}
          hitSlop={8}
          style={{ alignItems: 'center', paddingVertical: 14 }}
          accessibilityRole="button"
        >
          <RNText style={tx('700', 14, t.colors.accentDeep)}>Skip for now</RNText>
        </Pressable>
      </>
    );
  }

  if (phase === 'brief') {
    body = (
      <>
        <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5 })}>Check your post</RNText>
        {sourceNote}
        {busy ? (
          <View style={{ alignItems: 'center', paddingVertical: 60, gap: 12 }}>
            <ActivityIndicator color={t.colors.accent} />
            <RNText style={tx('600', 13, t.colors.muted)}>Rewriting…</RNText>
          </View>
        ) : (
          <>
            <Field
              label="Title"
              value={title}
              onChangeText={setTitle}
              style={{ marginTop: 16 }}
              maxLength={80}
              error={titleIssue ? contactIssueMessage(titleIssue) : null}
            />
            <Field
              label="Description"
              value={description}
              onChangeText={setDescription}
              multiline
              minHeight={170}
              style={{ marginTop: 16 }}
              maxLength={1500}
              error={descIssue ? contactIssueMessage(descIssue) : null}
            />
          </>
        )}

        <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3, marginTop: 18 })}>CATEGORY</RNText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
          {CATEGORIES.map((c) => chip(c, category === c, () => setCategory(c)))}
        </View>

        {!similar ? (
          <>
            <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3, marginTop: 18 })}>WRITING STYLE</RNText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
              {WRITING_STYLES.map((s) => chip(s.label, style === s.key, () => restyle(s.key)))}
            </View>
            {style === 'custom' ? (
              <Field
                style={{ marginTop: 10 }}
                value={customStyle}
                onChangeText={setCustomStyle}
                placeholder="E.g. Friendly, mention I have a pet dog"
                returnKeyType="done"
                onSubmitEditing={() => customStyle.trim() && void writeBrief(answers, 'custom')}
                right={
                  <Pressable onPress={() => customStyle.trim() && void writeBrief(answers, 'custom')} hitSlop={8}>
                    <RNText style={tx('700', 13, t.colors.accentDeep)}>Apply</RNText>
                  </Pressable>
                }
              />
            ) : null}
            <Pressable
              onPress={() => void startPicks()}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16 }}
              accessibilityRole="button"
            >
              <Icon name="sparkle" size={15} color={t.colors.accentDeep} strokeWidth={1.8} />
              <RNText style={tx('700', 13, t.colors.accentDeep)}>Ask me more questions to refine</RNText>
            </Pressable>
          </>
        ) : null}

        <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3, marginTop: 20 })}>PHOTO OR VIDEO (OPTIONAL)</RNText>
        <View style={{ marginTop: 9 }}>
          <MediaAttach value={media} onChange={setMedia} />
        </View>
      </>
    );
    footer = (
      <PrimaryButton label="Looks good, continue →" onPress={() => setPhase('when')} disabled={!canLeaveBrief || busy} />
    );
  }

  if (phase === 'when') {
    body = (
      <>
        <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5 })}>When do you need it?</RNText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          {WHEN_OPTIONS.map((o) =>
            chip(o.label, whenKey === o.key, () => setWhenKey(o.key), o.key === 'now' ? 'bolt' : 'clock'),
          )}
          {chip(customDue && whenKey === 'custom' ? formatDeadline(customDue) : 'Pick a date', whenKey === 'custom', () => setShowDate(true), 'list')}
        </View>
        <View
          style={{
            marginTop: 18,
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 14,
            padding: 14,
          }}
        >
          <RNText style={tx('600', 12, t.colors.muted)}>Complete by</RNText>
          <RNText style={tx('800', 17, t.colors.ink, { marginTop: 4 })}>{formatDeadline(due)}</RNText>
          {whenKey === 'now' ? (
            <RNText style={tx('400', 12, t.colors.signalDeep, { marginTop: 6 })}>
              Marked urgent, so workers nearby see it first.
            </RNText>
          ) : null}
        </View>
      </>
    );
    footer = <PrimaryButton label="Continue" onPress={() => setPhase('budget')} />;
  }

  if (phase === 'budget') {
    const lo = brief?.budgetMinInr ?? 100;
    const hi = brief?.budgetMaxInr ?? 2000;
    const presets = [...new Set([lo, Math.round((lo + hi) / 2 / 10) * 10, hi, 50, 100, 300, 500, 1000])]
      .filter((n) => n >= 10)
      .sort((a, b) => a - b)
      .slice(0, 6);
    const sliderMax = SLIDER_STOPS.find((m) => m >= Math.max(hi * 2, (budget ?? 0) * 1.25)) ?? Math.ceil(((budget ?? 0) * 1.25) / 100000) * 100000;
    body = (
      <>
        <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5 })}>How much for this task?</RNText>
        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 6, lineHeight: 19 })}>
          Workers quote against this. You only pay once you accept a quote, and the money is held in escrow until you
          approve the work.
        </RNText>
        <View style={{ alignItems: 'center', marginTop: 22 }}>
          {/* Fixed width: a web <input> otherwise sizes itself to ~20ch and
              pushes the box off the screen. AmountField draws its own ₹. */}
          <View
            style={{
              width: 220,
              borderWidth: 1.5,
              borderColor: t.colors.accent,
              borderRadius: 14,
              paddingVertical: 10,
              paddingHorizontal: 14,
            }}
          >
            <AmountField
              rupees={budget}
              onChangeRupees={setBudget}
              min={10}
              align="center"
              placeholder="₹0"
              style={tx('800', 30, t.colors.accentDeep, { width: '100%', padding: 0 })}
            />
          </View>
          {brief ? (
            <RNText style={tx('500', 12, t.colors.muted, { marginTop: 8 })}>
              Similar jobs usually go for {rupees(lo)}–{rupees(hi)}
            </RNText>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          {presets.map((p) => chip(rupees(p), budget === p, () => setBudget(p)))}
        </View>
        <View style={{ marginTop: 18 }}>
          <Slider
            value={Math.min(budget ?? 10, sliderMax)}
            min={10}
            max={sliderMax}
            step={10}
            onChange={(v) => setBudget(Math.round(v))}
            accessibilityLabel="Budget"
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            <RNText style={tx('400', 11, t.colors.muted)}>₹10</RNText>
            <RNText style={tx('400', 11, t.colors.muted)}>{rupees(sliderMax)}+</RNText>
          </View>
          <RNText style={tx('400', 11, t.colors.muted, { marginTop: 6, textAlign: 'center' })}>
            No upper limit. Type any amount above.
          </RNText>
        </View>

        <Pressable
          onPress={() => setSplit(split === 0 ? 2 : 0)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, alignSelf: 'center' }}
          accessibilityRole="button"
        >
          <Icon name="list" size={15} color={t.colors.accentDeep} />
          <RNText style={tx('700', 13, t.colors.accentDeep)}>
            {split ? 'Remove milestones' : 'Split into milestones'}
          </RNText>
        </Pressable>
        {split ? (
          <View style={{ marginTop: 12, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 14 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {([2, 3, 4, 5, 6] as const).map((n) => chip(`${n} parts`, split === n, () => setSplit(n)))}
            </View>
            {milestones.map((m, i) => (
              <View key={m.title} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                <RNText style={tx('600', 13, t.colors.ink, { flex: 1 })}>
                  {i + 1}. {m.title}
                </RNText>
                <RNText style={tx('700', 13, t.colors.accentDeep)}>
                  {m.pct}% · {rupees(((budget ?? 0) * m.pct) / 100)}
                </RNText>
              </View>
            ))}
            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 10, lineHeight: 16 })}>
              Milestones are a checklist you and the worker share. The escrow is released once, when you approve the
              finished work.
            </RNText>
          </View>
        ) : null}
      </>
    );
    footer = <PrimaryButton label="Continue" onPress={() => setPhase('providers')} disabled={!budgetOk} />;
  }

  if (phase === 'providers') {
    const card = (key: 'bids' | 'auto', icon: 'gavel' | 'bolt', label: string, sub: string) => {
      const on = mode === key;
      return (
        <Pressable
          onPress={() => setAssign(key)}
          accessibilityRole="button"
          accessibilityState={{ selected: on }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            gap: 12,
            padding: 15,
            marginTop: 10,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: on ? t.colors.accent : t.colors.line,
            backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          })}
        >
          <Icon name={icon} size={20} color={on ? t.colors.accentDeep : t.colors.muted} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <RNText style={tx('700', 15, t.colors.ink)}>{label}</RNText>
              {on ? <Badge label="Selected" /> : null}
            </View>
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 17 })}>{sub}</RNText>
          </View>
        </Pressable>
      );
    };
    body = (
      <>
        <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5 })}>How do you choose providers?</RNText>
        {card('bids', 'gavel', 'Review bids', 'Compare quotes and pick the one you like.')}
        {card(
          'auto',
          'bolt',
          'Auto-accept',
          `The first quote at or under ${rupees(budget ?? 0)} is accepted automatically. You still fund escrow before work starts.`,
        )}

        <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3, marginTop: 22 })}>WHERE</RNText>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 9 }}>
          {chip('At a location', !remote, () => setRemote(false), 'pin')}
          {chip('Remote / online', remote, () => setRemote(true), 'compass')}
        </View>
        {!remote ? (
          <Pressable
            onPress={() => setShowLoc(true)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginTop: 10,
              padding: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: t.colors.line,
              backgroundColor: t.colors.surface,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Icon name="pin" size={18} color={t.colors.accentDeep} />
            <RNText style={tx('500', 14, place ? t.colors.ink : t.colors.muted, { flex: 1 })} numberOfLines={2}>
              {place?.label ?? 'Set where the job is'}
            </RNText>
            <RNText style={tx('700', 13, t.colors.accentDeep)}>{place ? 'Change' : 'Set'}</RNText>
          </Pressable>
        ) : null}
      </>
    );
    footer = <PrimaryButton label="Continue" onPress={() => setPhase('review')} />;
  }

  if (phase === 'review') {
    const tags = [
      category,
      WHEN_OPTIONS.find((o) => o.key === whenKey)?.label ?? formatDeadline(due),
      rupees(budget ?? 0),
      mode === 'auto' ? 'Auto-accept' : 'Bid-based',
      remote ? 'Remote' : (place?.label.split(',').slice(-2).join(',').trim() ?? 'Location not set'),
    ];
    body = (
      <>
        <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5 })}>Ready to post?</RNText>
        <View style={{ marginTop: 14, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 15 }}>
          <RNText style={tx('800', 17, t.colors.ink)}>{title.trim()}</RNText>
          <RNText style={tx('400', 13, t.colors.text, { marginTop: 8, lineHeight: 20 })}>{description.trim()}</RNText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {tags.map((x) => (
              <View key={x} style={{ borderWidth: 1, borderColor: t.colors.line, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 }}>
                <RNText style={tx('600', 11, t.colors.text)} numberOfLines={1}>{x}</RNText>
              </View>
            ))}
          </View>
        </View>
        <View style={{ marginTop: 12, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 15, gap: 8 }}>
          <Row label="Task budget" value={rupees(budget ?? 0)} />
          <Row label={`Service fee (${Math.round(FEES.POSTER_SERVICE_FEE_PCT * 100)}%)`} value={rupees(feeRupees)} />
          <View style={{ height: 1, backgroundColor: t.colors.line }} />
          <Row label="Held in escrow when you accept a quote" value={formatINR(Math.round((budget ?? 0) * 100) + feeRupees * 100)} strong />
          <RNText style={tx('400', 11, t.colors.muted, { lineHeight: 16 })}>
            The final figure follows the quote you accept. Nothing is charged now.
          </RNText>
        </View>
      </>
    );
    footer = <PrimaryButton label="Post task" onPress={() => void post()} busy={posting} />;
  }

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="back" size={22} color={t.colors.ink} />
          </Pressable>
          <RNText style={tx('600', 13, t.colors.muted, { flex: 1 })}>
            Step {stepNo} of 5 · {stepLabel}
          </RNText>
          <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size={20} color={t.colors.muted} />
          </Pressable>
        </View>
        <View style={{ height: 4, borderRadius: 999, backgroundColor: t.colors.line, marginTop: 12, overflow: 'hidden' }}>
          <Animated.View
            style={{
              height: 4,
              borderRadius: 999,
              backgroundColor: t.colors.accent,
              width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            }}
          />
        </View>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
      {footer ? <View style={{ paddingHorizontal: 20, paddingBottom: 18, paddingTop: 6 }}>{footer}</View> : null}

      <DateTimeSheet
        visible={showDate}
        initial={customDue ?? undefined}
        onCancel={() => setShowDate(false)}
        onConfirm={(d) => {
          setCustomDue(d);
          setWhenKey('custom');
          setShowDate(false);
        }}
      />
      <LocationSheet
        visible={showLoc}
        onCancel={() => setShowLoc(false)}
        onPick={(p) => {
          setPlace(p);
          setShowLoc(false);
        }}
        askForDetails
      />
    </Screen>
  );

}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <RNText style={tx(strong ? '700' : '400', 13, strong ? t.colors.ink : t.colors.muted, { flex: 1 })}>{label}</RNText>
      <RNText style={tx(strong ? '800' : '600', strong ? 15 : 13, t.colors.ink)}>{value}</RNText>
    </View>
  );
}
