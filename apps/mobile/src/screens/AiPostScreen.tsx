import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, TextInput } from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { AmountField } from '../components/AmountField';
import { Slider } from '../components/Slider';
import { MediaAttach } from '../components/MediaAttach';
import { LocationSheet, type PickedPlace } from '../components/LocationSheet';
import { DateTimeSheet, formatDeadline } from '../components/DateTimeSheet';
import { ConfirmDialog, Field, PrimaryButton, rupees } from '../components/kit';
import { FadeIn, Pressy, tx } from '../components/primitives';
import { TaskDescription } from '../components/TaskDescription';
import { roughPlace } from '../lib/place';
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
  IDEAS,
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
  type WhenKey,
  type WritingStyle,
} from '../lib/taskBrief';

/**
 * "What do you need done?" -> a posted task, one page per step.
 *
 *   Ask       the request in a sentence, typed or spoken
 *   Details   the quick questions for it, all on one page, answered together
 *   Post      the written post: title, description, category, tone, a photo
 *   When      the deadline, each choice showing the actual date and time
 *   Budget    the amount, with a meter against what jobs like it usually cost
 *   Place     where the job is, and whether to compare offers or auto-hire
 *   Review    the post as workers will see it, what it costs, an Edit on each part
 *
 * The step path along the top is also the way back: a finished step can be
 * tapped to change it, and after the change the flow returns to wherever the
 * person had got to rather than walking every step again. Going back and
 * forward never throws work away -- the questions are only asked again when
 * the request changes, and the post is only rewritten when the answers do.
 *
 * Questions and post come from the quick writer in lib/taskBrief, on the
 * device: no AI and no waiting. Nothing here moves money; payment is made
 * when an offer is chosen. This screen only writes the task row.
 */

type Phase = 'what' | 'picks' | 'brief' | 'when' | 'budget' | 'providers' | 'review';

const ORDER: Phase[] = ['what', 'picks', 'brief', 'when', 'budget', 'providers', 'review'];
const at = (p: Phase) => ORDER.indexOf(p);

const STEP_LABEL: Record<Phase, string> = {
  what: 'Ask',
  picks: 'Details',
  brief: 'Post',
  when: 'When',
  budget: 'Budget',
  providers: 'Place',
  review: 'Review',
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
  // The furthest step reached. Finished steps up to here can be reopened, and
  // a change to one of them comes back here afterwards.
  const [reached, setReached] = useState(at(similar ? 'brief' : 'what'));
  useEffect(() => setReached((r) => Math.max(r, at(phase))), [phase]);

  const [prompt, setPrompt] = useState(
    typeof params.prompt === 'string' ? params.prompt : similar ? similar.title : '',
  );
  const [promptFocused, setPromptFocused] = useState(false);

  // Details: the quick questions, and which request they were asked for.
  const [questions, setQuestions] = useState<QuickQuestion[]>([]);
  // A copy of an earlier post starts with its post already written and no
  // questions, as if they had been asked and there were none.
  const [askedFor, setAskedFor] = useState<string | null>(similar ? similar.title : null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});

  // The post, and the request + answers + tone it was last written from, so
  // it is only rewritten when one of those actually changed.
  const [brief, setBrief] = useState<Brief | null>(null);
  const [writtenFrom, setWrittenFrom] = useState<string | null>(null);
  const [title, setTitle] = useState(similar?.title ?? '');
  const [description, setDescription] = useState(similar?.description ?? '');
  const [category, setCategory] = useState<string>(similar?.category ?? 'Other');
  const [style, setStyle] = useState<WritingStyle>('professional');
  const [media, setMedia] = useState<TaskMedia | null>(null);

  // When.
  const [whenKey, setWhenKey] = useState<WhenKey | 'custom'>('today');
  const [customDue, setCustomDue] = useState<Date | null>(null);
  const [showDate, setShowDate] = useState(false);

  // Budget.
  const [budget, setBudget] = useState<number | null>(similar ? Math.round(similar.benchmark_minor / 100) : null);
  const [split, setSplit] = useState<0 | 2 | 3 | 4 | 5 | 6>(0);

  // Place and hiring.
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

  /** Forward from `from` -- or, when an earlier step was being changed, straight back to where they were. */
  const advance = (from: Phase) => {
    setPhase(ORDER[Math.max(at(from) + 1, reached)] ?? 'review');
  };

  /** Reopen a finished step. Only ever backwards, and never while posting. */
  const reopen = (p: Phase) => {
    if (posting || at(p) > reached) return;
    setPhase(p);
  };

  /** One step back; Details is passed over when the request had no questions. */
  const stepBack = () => {
    let i = at(phase) - 1;
    if (ORDER[i] === 'picks' && questions.length === 0) i -= 1;
    const p = ORDER[i];
    if (p) setPhase(p);
  };

  const writeBrief = (with_: Answer[], nextStyle: WritingStyle = style) => {
    const b = askBrief(prompt.trim(), with_, nextStyle);
    setBrief(b);
    setWrittenFrom(JSON.stringify([prompt.trim(), with_, nextStyle]));
    setTitle(b.title);
    setDescription(briefToDescription(b));
    setCategory(b.category);
    // Suggest the middle of the usual range; the poster sets the real figure.
    setBudget((cur) => cur ?? Math.round((b.budgetMinInr + b.budgetMaxInr) / 2 / 10) * 10);
  };

  /** Ask -> Details. The questions are only asked again if the request changed. */
  const fromAsk = () => {
    const req = prompt.trim();
    if (req.length < 5) return flash('Tell us a bit more about what you need');
    if (askedFor !== req) {
      const qs = askQuestions(req);
      setQuestions(qs);
      setAskedFor(req);
      setAnswers([]);
      setOtherOpen({});
      if (qs.length === 0) {
        writeBrief([]);
        setPhase('brief');
        return;
      }
      setPhase('picks');
      return;
    }
    setPhase(questions.length === 0 ? 'brief' : 'picks');
  };

  /** Details -> Post. The post is only rewritten if the request or an answer changed. */
  const fromDetails = () => {
    const given = answers.filter((a) => a.answer.trim());
    if (!brief || writtenFrom !== JSON.stringify([prompt.trim(), given, style])) writeBrief(given);
    // A rewritten post is worth a look, even when coming back from Review.
    setPhase('brief');
  };

  const setAnswer = (question: string, value: string) =>
    setAnswers((cur) => [...cur.filter((a) => a.question !== question), { question, answer: value }]);
  const answerOf = (question: string) => answers.find((a) => a.question === question)?.answer ?? '';

  const restyle = (s: WritingStyle) => {
    setStyle(s);
    writeBrief(answers.filter((a) => a.answer.trim()), s);
  };

  const due = useMemo(
    () => (whenKey === 'custom' ? (customDue ?? dueFor('week')) : dueFor(whenKey)),
    [whenKey, customDue],
  );

  const promptIssue = findContactIssue(prompt);
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

  // Each step opens at its top.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [phase]);

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const leave = () => (reached === 0 && !prompt.trim() ? back() : setConfirmDiscard(true));

  // -------------------------------------------------------------- pieces ---

  const whenLabel = WHEN_OPTIONS.find((o) => o.key === whenKey)?.label ?? 'By a date';
  const whereLabel = remote ? 'Remote / online' : (roughPlace(place?.area || place?.label) ?? 'Location not set');
  const hireLabel = mode === 'auto' ? 'Auto-hire' : 'See offers';

  const heading = (text: string, sub?: string) => (
    <>
      <RNText style={tx('800', 26, t.colors.ink, { letterSpacing: -0.8, lineHeight: 31 })}>{text}</RNText>
      {sub ? <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21 })}>{sub}</RNText> : null}
    </>
  );

  const label = (s: string) => (
    <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, marginTop: 22, marginBottom: 10 })}>{s}</RNText>
  );

  const chip = (text: string, on: boolean, onPress: () => void, icon?: IconName) => (
    <Pressy
      key={text}
      onPress={onPress}
      label={text}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 9,
        paddingHorizontal: 13,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: on ? t.colors.accent : t.colors.line,
        backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={on ? t.colors.accentDeep : t.colors.muted} strokeWidth={2} /> : null}
      <RNText style={tx(on ? '700' : '600', 13, on ? t.colors.accentDeep : t.colors.text)}>{text}</RNText>
      {on ? <Icon name="check" size={13} color={t.colors.accentDeep} strokeWidth={2.6} /> : null}
    </Pressy>
  );

  /** A large selectable card: icon, title, one line under it. */
  const choice = (key: string, on: boolean, onPress: () => void, icon: IconName, head: string, sub: string, wide = false) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${head}. ${sub}`}
      style={({ pressed }) => ({
        width: wide ? '100%' : '48.5%',
        padding: 14,
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: on ? t.colors.accent : t.colors.line,
        backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 12,
            backgroundColor: on ? t.colors.accent : t.colors.surface2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={17} color={on ? t.colors.onAccent : t.colors.muted} strokeWidth={2} />
        </View>
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 20,
            borderWidth: 2,
            borderColor: on ? t.colors.accent : t.colors.line,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {on ? <View style={{ width: 9, height: 9, borderRadius: 9, backgroundColor: t.colors.accent }} /> : null}
        </View>
      </View>
      <RNText style={tx('800', 15, t.colors.ink, { marginTop: 12 })}>{head}</RNText>
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3, lineHeight: 17 })}>{sub}</RNText>
    </Pressable>
  );

  const card = (children: React.ReactNode, extra?: { borderColor?: string }) => (
    <View
      style={{
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: extra?.borderColor ?? t.colors.line,
        borderRadius: 20,
        padding: 16,
      }}
    >
      {children}
    </View>
  );

  // --------------------------------------------------------------- steps ---

  let body: React.ReactNode = null;

  if (phase === 'what') {
    body = (
      <>
        {heading('What do you need done?', 'Say it the way you’d tell a friend. We’ll ask a few quick things and write the post for you.')}
        <View
          style={{
            marginTop: 20,
            backgroundColor: t.colors.surface,
            borderWidth: 1.5,
            borderColor: promptIssue ? t.colors.signal : promptFocused ? t.colors.accent : t.colors.line,
            borderRadius: 20,
            padding: 16,
          }}
        >
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            onFocus={() => setPromptFocused(true)}
            onBlur={() => setPromptFocused(false)}
            placeholder="E.g. Fix the side stand of my scooter at home"
            placeholderTextColor={t.colors.muted}
            multiline
            autoFocus
            style={tx('400', 17, t.colors.ink, { minHeight: 130, textAlignVertical: 'top', padding: 0, lineHeight: 24 })}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <RNText style={tx('500', 12, prompt.trim().length >= 5 ? t.colors.accentDeep : t.colors.muted)}>
              {prompt.trim().length >= 5 ? 'Looks good' : 'A sentence is enough'}
            </RNText>
            {voice.supported ? (
              <Pressable
                onPress={voice.toggle}
                accessibilityRole="button"
                accessibilityLabel={voice.listening ? 'Stop voice typing' : 'Voice typing'}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingVertical: 7,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  backgroundColor: voice.listening ? t.colors.signalSoft : t.colors.surface2,
                }}
              >
                <Icon name="mic" size={16} color={voice.listening ? t.colors.signal : t.colors.muted} />
                <RNText style={tx('600', 12, voice.listening ? t.colors.signal : t.colors.muted)}>
                  {voice.listening ? 'Listening…' : 'Speak'}
                </RNText>
              </Pressable>
            ) : null}
          </View>
        </View>
        {promptIssue ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, backgroundColor: t.colors.signalSoft, borderRadius: 12, padding: 11 }}>
            <Icon name="shield" size={15} color={t.colors.signalDeep} />
            <RNText style={tx('600', 12, t.colors.signalDeep, { flex: 1, lineHeight: 17 })}>{contactIssueMessage(promptIssue)}</RNText>
          </View>
        ) : null}

        {!prompt.trim() ? (
          <>
            {label('NEED AN IDEA? TAP ONE')}
            <View style={{ gap: 8 }}>
              {IDEAS.slice(0, 4).map((idea) => (
                <Pressable
                  key={idea.title}
                  onPress={() => setPrompt(idea.prompt)}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 13,
                    borderRadius: 14,
                    backgroundColor: t.colors.surface2,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Icon name="plus" size={15} color={t.colors.accentDeep} strokeWidth={2.2} />
                  <View style={{ flex: 1 }}>
                    <RNText style={tx('700', 13, t.colors.ink)}>{idea.title}</RNText>
                    <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
                      {idea.prompt.trim()}…
                    </RNText>
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </>
    );
  }

  if (phase === 'picks') {
    body = (
      <>
        {heading(
          'A few details',
          brief
            ? 'Changing an answer rewrites your post with it.'
            : 'Tap what fits — it helps workers price the job. Skip any you’re not sure about.',
        )}
        <View style={{ gap: 12, marginTop: 20 }}>
          {questions.map((q, i) => {
            const given = answerOf(q.question);
            const typed = !!otherOpen[q.question];
            return (
              <View key={q.question}>
                {card(
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 24,
                          backgroundColor: given ? t.colors.accent : t.colors.surface2,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {given ? (
                          <Icon name="check" size={13} color={t.colors.onAccent} strokeWidth={2.6} />
                        ) : (
                          <RNText style={tx('800', 12, t.colors.muted)}>{i + 1}</RNText>
                        )}
                      </View>
                      <RNText style={tx('800', 15, t.colors.ink, { flex: 1 })}>{q.question}</RNText>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                      {q.options.map((o) =>
                        chip(o, given === o && !typed, () => {
                          setOtherOpen((c) => ({ ...c, [q.question]: false }));
                          setAnswer(q.question, given === o && !typed ? '' : o);
                        }),
                      )}
                      {chip(OTHER, typed, () => {
                        setOtherOpen((c) => ({ ...c, [q.question]: !typed }));
                        if (q.options.includes(given) || typed) setAnswer(q.question, '');
                      })}
                    </View>
                    {typed ? (
                      <Field
                        style={{ marginTop: 10 }}
                        value={given}
                        onChangeText={(v) => setAnswer(q.question, v)}
                        placeholder="Type your answer"
                        autoFocus
                      />
                    ) : null}
                  </>,
                  given ? { borderColor: t.colors.accentBorder } : undefined,
                )}
              </View>
            );
          })}
        </View>
      </>
    );
  }

  if (phase === 'brief') {
    body = (
      <>
        {heading('Your post', 'We wrote it from what you told us. Change anything — this is what workers will read.')}
        <View style={{ marginTop: 20 }}>
          {card(
            <>
              <Field
                label="Title"
                value={title}
                onChangeText={setTitle}
                maxLength={80}
                error={titleIssue ? contactIssueMessage(titleIssue) : null}
              />
              <Field
                label="Description"
                value={description}
                onChangeText={setDescription}
                multiline
                minHeight={150}
                style={{ marginTop: 14 }}
                maxLength={1500}
                error={descIssue ? contactIssueMessage(descIssue) : null}
              />
            </>,
          )}
        </View>
        {label('CATEGORY')}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {CATEGORIES.map((c) => chip(c, category === c, () => setCategory(c)))}
        </View>
        {!similar ? (
          <>
            {label('HOW IT SOUNDS')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {WRITING_STYLES.map((s) => chip(s.label, style === s.key, () => restyle(s.key)))}
            </View>
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 8 })}>Picking a tone rewrites the title and description.</RNText>
          </>
        ) : null}
        {label('PHOTO OR VIDEO · OPTIONAL')}
        <MediaAttach value={media} onChange={setMedia} />
      </>
    );
  }

  if (phase === 'when') {
    body = (
      <>
        {heading('When should it be done by?', 'Workers plan their offers around this.')}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: 20 }}>
          {WHEN_OPTIONS.map((o) =>
            choice(o.key, whenKey === o.key, () => setWhenKey(o.key), o.key === 'now' ? 'bolt' : 'clock', o.label, `By ${formatDeadline(dueFor(o.key))}`),
          )}
          {choice(
            'custom',
            whenKey === 'custom',
            () => setShowDate(true),
            'list',
            'Pick a date',
            whenKey === 'custom' && customDue ? `By ${formatDeadline(customDue)}` : 'Choose the day and time',
            true,
          )}
        </View>
        {whenKey === 'now' ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, backgroundColor: t.colors.signalSoft, borderRadius: 12, padding: 11 }}>
            <Icon name="bolt" size={15} color={t.colors.signalDeep} />
            <RNText style={tx('600', 12, t.colors.signalDeep, { flex: 1, lineHeight: 17 })}>
              Marked urgent, so workers nearby see it first.
            </RNText>
          </View>
        ) : null}
      </>
    );
  }

  if (phase === 'budget') {
    const lo = brief?.budgetMinInr ?? 100;
    const hi = brief?.budgetMaxInr ?? 2000;
    const amount = budget ?? 0;
    const presets = [...new Set([lo, Math.round((lo + hi) / 2 / 10) * 10, hi, 100, 300, 500, 1000])]
      .filter((n) => n >= 10)
      .sort((a, b) => a - b)
      .slice(0, 6);
    const sliderMax =
      SLIDER_STOPS.find((m) => m >= Math.max(hi * 2, amount * 1.25)) ?? Math.ceil((amount * 1.25) / 100000) * 100000;

    // Where the amount sits against the usual range, on a scale that runs
    // from half the low end to half again past the high end.
    const scaleLo = lo / 2;
    const scaleHi = hi * 1.5;
    const posOf = (v: number) => Math.min(1, Math.max(0, (v - scaleLo) / (scaleHi - scaleLo)));
    const verdict =
      amount < lo
        ? { word: 'Low', color: t.colors.signal, note: 'Below what jobs like this usually get — expect fewer offers.' }
        : amount > hi
          ? { word: 'Generous', color: t.colors.gold, note: 'Above the usual range — offers should come quickly.' }
          : { word: 'Fair', color: t.colors.accent, note: 'Right in the usual range for jobs like this.' };

    body = (
      <>
        {heading('What’s it worth to you?', 'You pay only when you choose an offer, and TaskDrop holds it safely until you approve the work.')}
        <View style={{ marginTop: 20 }}>
          {card(
            <>
              <View style={{ alignItems: 'center' }}>
                {/* Fixed width: a web <input> otherwise sizes itself to ~20ch
                    and pushes the box off the screen. AmountField draws its own ₹. */}
                <View style={{ width: 230 }}>
                  <AmountField
                    rupees={budget}
                    onChangeRupees={setBudget}
                    min={10}
                    align="center"
                    placeholder="₹0"
                    style={tx('800', 40, t.colors.ink, { width: '100%', padding: 0 })}
                  />
                </View>
              </View>

              {/* The fair-price meter: the usual range shaded, the amount as a dot. */}
              {budgetOk ? (
                <View style={{ marginTop: 18 }}>
                  <View>
                    <View style={{ height: 10, borderRadius: 10, backgroundColor: t.colors.surface2, overflow: 'hidden' }}>
                      <View
                        style={{
                          position: 'absolute',
                          left: `${posOf(lo) * 100}%`,
                          width: `${(posOf(hi) - posOf(lo)) * 100}%`,
                          top: 0,
                          bottom: 0,
                          backgroundColor: t.colors.accentBorder,
                        }}
                      />
                    </View>
                    <View
                      style={{
                        position: 'absolute',
                        top: -4,
                        left: `${posOf(amount) * 100}%`,
                        marginLeft: -9,
                        width: 18,
                        height: 18,
                        borderRadius: 18,
                        backgroundColor: verdict.color,
                        borderWidth: 3,
                        borderColor: t.colors.surface,
                      }}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                    <RNText style={tx('500', 11, t.colors.muted)}>
                      Usual: {rupees(lo)}–{rupees(hi)}
                    </RNText>
                    <RNText style={tx('800', 12, verdict.color)}>{verdict.word}</RNText>
                  </View>
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 17 })}>{verdict.note}</RNText>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 16 }}>
                {presets.map((p) => chip(rupees(p), budget === p, () => setBudget(p)))}
              </View>
              <View style={{ marginTop: 16 }}>
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
                  <RNText style={tx('400', 11, t.colors.muted)}>{rupees(sliderMax)}+ · type any amount</RNText>
                </View>
              </View>
            </>,
          )}
        </View>

        <Pressable
          onPress={() => setSplit(split === 0 ? 2 : 0)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }}
          accessibilityRole="button"
        >
          <Icon name="list" size={15} color={t.colors.accentDeep} />
          <RNText style={tx('700', 13, t.colors.accentDeep)}>{split ? 'Remove steps' : 'Split the job into steps'}</RNText>
        </Pressable>
        {split ? (
          <View style={{ marginTop: 10 }}>
            {card(
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {([2, 3, 4, 5, 6] as const).map((n) => chip(`${n} steps`, split === n, () => setSplit(n)))}
                </View>
                {milestones.map((m, i) => (
                  <View key={m.title} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                    <RNText style={tx('600', 13, t.colors.ink, { flex: 1 })}>
                      {i + 1}. {m.title}
                    </RNText>
                    <RNText style={tx('700', 13, t.colors.accentDeep)}>
                      {m.pct}% · {rupees((amount * m.pct) / 100)}
                    </RNText>
                  </View>
                ))}
                <RNText style={tx('400', 11, t.colors.muted, { marginTop: 10, lineHeight: 16 })}>
                  Steps are a checklist you and the worker share. The payment is released once, when you approve the
                  finished work.
                </RNText>
              </>,
            )}
          </View>
        ) : null}
      </>
    );
  }

  if (phase === 'providers') {
    body = (
      <>
        {heading('Where, and how to hire', 'Most jobs are near home — change it if this one isn’t.')}
        {label('WHERE IS THE JOB?')}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {choice('place', !remote, () => setRemote(false), 'pin', 'At a place', 'Someone comes to you, or goes there')}
          {choice('remote', remote, () => setRemote(true), 'compass', 'Remote / online', 'Can be done from anywhere')}
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
              borderRadius: 16,
              borderWidth: 1,
              borderColor: place ? t.colors.line : t.colors.signal,
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

        {label('HOW DO YOU WANT TO HIRE?')}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {choice('bids', mode === 'bids', () => setAssign('bids'), 'users', 'See offers', 'Compare offers and pick the one you like')}
          {choice('auto', mode === 'auto', () => setAssign('auto'), 'bolt', 'Auto-hire', `First offer at or under ${rupees(budget ?? 0)} is accepted`)}
        </View>
        {mode === 'auto' ? (
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 10, lineHeight: 17 })}>
            You still pay before work starts, and TaskDrop holds it until you approve.
          </RNText>
        ) : null}
      </>
    );
  }

  if (phase === 'review') {
    const row = (icon: IconName, head: string, value: string, target: Phase) => (
      <View key={head} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
        <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={16} color={t.colors.accentDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <RNText style={tx('500', 12, t.colors.muted)}>{head}</RNText>
          <RNText style={tx('700', 14, t.colors.ink, { marginTop: 2 })} numberOfLines={2}>
            {value}
          </RNText>
        </View>
        <Pressable onPress={() => reopen(target)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Edit ${head}`}>
          <RNText style={tx('700', 13, t.colors.accentDeep)}>Edit</RNText>
        </Pressable>
      </View>
    );
    const divider = <View style={{ height: 1, backgroundColor: t.colors.line }} />;
    body = (
      <>
        {heading('Ready to post?', 'Check it over. Tap Edit on anything to change it.')}
        <View style={{ marginTop: 20, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 20, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.colors.accentSoft, paddingHorizontal: 16, paddingVertical: 9 }}>
            <RNText style={tx('700', 11, t.colors.accentDeep, { letterSpacing: 1.2, flex: 1 })}>AS WORKERS WILL SEE IT</RNText>
            <Pressable onPress={() => reopen('brief')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit your post">
              <RNText style={tx('700', 12, t.colors.accentDeep)}>Edit</RNText>
            </Pressable>
          </View>
          <View style={{ padding: 16 }}>
            <RNText style={tx('800', 18, t.colors.ink, { letterSpacing: -0.3, marginBottom: 12 })}>{title.trim()}</RNText>
            <TaskDescription text={description} title={title} size="sm" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
              <View style={{ backgroundColor: t.colors.surface2, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
                <RNText style={tx('600', 11, t.colors.text)}>{category}</RNText>
              </View>
              {media ? (
                <View style={{ backgroundColor: t.colors.surface2, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
                  <RNText style={tx('600', 11, t.colors.text)}>With attachment</RNText>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={{ marginTop: 12, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 4 }}>
          {row('clock', 'Done by', `${whenKey === 'custom' ? 'A date you picked' : whenLabel} · ${formatDeadline(due)}`, 'when')}
          {divider}
          {row('tag', 'Budget', split ? `${rupees(budget ?? 0)} · in ${split} steps` : rupees(budget ?? 0), 'budget')}
          {divider}
          {row('pin', 'Where', whereLabel, 'providers')}
          {divider}
          {row(mode === 'auto' ? 'bolt' : 'users', 'How you hire', hireLabel, 'providers')}
        </View>

        <View style={{ marginTop: 12, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 20, padding: 16, gap: 8 }}>
          <Row label="Task budget" value={rupees(budget ?? 0)} />
          <Row label={`TaskDrop fee (${Math.round(FEES.POSTER_SERVICE_FEE_PCT * 100)}%)`} value={rupees(feeRupees)} />
          <View style={{ height: 1, backgroundColor: t.colors.line }} />
          <Row label="Held safely when you accept an offer" value={formatINR(Math.round((budget ?? 0) * 100) + feeRupees * 100)} strong />
          <RNText style={tx('400', 11, t.colors.muted, { lineHeight: 16 })}>
            The final figure follows the offer you accept. Nothing is charged now.
          </RNText>
        </View>
      </>
    );
  }

  // --------------------------------------------------------------- chrome ---

  // Details is left off the path once it is known the request has no questions.
  const steps = ORDER.filter((p) => p !== 'picks' || questions.length > 0 || askedFor === null);
  const stepNo = steps.indexOf(phase) + 1;

  // Changing an earlier step from further on goes straight back there.
  const returning = reached > at(phase) + 1;
  const primary: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean } =
    phase === 'what'
      ? { label: 'Continue', onPress: fromAsk, disabled: prompt.trim().length < 5 || promptIssue !== null }
      : phase === 'picks'
        ? { label: brief ? 'Update my post' : 'Write my post', onPress: fromDetails }
        : phase === 'brief'
          ? { label: returning ? 'Save and review' : 'Continue', onPress: () => advance('brief'), disabled: !canLeaveBrief }
          : phase === 'when'
            ? { label: returning ? 'Save and review' : 'Continue', onPress: () => advance('when') }
            : phase === 'budget'
              ? {
                  label: returning ? 'Save and review' : budgetOk ? `Continue with ${rupees(budget ?? 0)}` : 'Enter an amount',
                  onPress: () => advance('budget'),
                  disabled: !budgetOk,
                }
              : phase === 'providers'
                ? { label: returning ? 'Save and review' : 'Continue', onPress: () => advance('providers') }
                : { label: 'Post my request', onPress: () => void post(), busy: posting };

  return (
    <Screen padded={false}>
      <View style={{ paddingTop: 6, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: t.colors.line }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 }}>
          <Pressable onPress={leave} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size={22} color={t.colors.ink} />
          </Pressable>
          <RNText style={tx('800', 16, t.colors.ink, { flex: 1 })}>Post a request</RNText>
          <RNText style={tx('600', 12, t.colors.muted)}>
            {stepNo} of {steps.length}
          </RNText>
        </View>

        {/* The path: every step by name. Done ones show a tick and can be reopened. */}
        <View style={{ flexDirection: 'row', marginTop: 14, paddingHorizontal: 6 }}>
          {steps.map((p, i) => {
            const here = p === phase;
            const done = !here && at(p) <= reached;
            const next = steps[i + 1];
            return (
              <Pressable
                key={p}
                onPress={done ? () => reopen(p) : undefined}
                disabled={!done}
                accessibilityRole="button"
                accessibilityLabel={`${STEP_LABEL[p]}${here ? ', current step' : done ? ', done. Tap to change' : ''}`}
                style={{ flex: 1, alignItems: 'center' }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', height: 28 }}>
                  <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? 'transparent' : at(p) <= reached ? t.colors.accent : t.colors.line }} />
                  <View
                    style={{
                      width: here ? 28 : 24,
                      height: here ? 28 : 24,
                      borderRadius: 28,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: here ? t.colors.accent : done ? t.colors.accentSoft : t.colors.bg,
                      borderWidth: here ? 0 : 1.5,
                      borderColor: done ? t.colors.accent : t.colors.line,
                    }}
                  >
                    {done ? (
                      <Icon name="check" size={12} color={t.colors.accentDeep} strokeWidth={2.8} />
                    ) : (
                      <RNText style={tx('800', 11, here ? t.colors.onAccent : t.colors.muted)}>{i + 1}</RNText>
                    )}
                  </View>
                  <View
                    style={{
                      flex: 1,
                      height: 2,
                      backgroundColor: !next ? 'transparent' : at(next) <= reached ? t.colors.accent : t.colors.line,
                    }}
                  />
                </View>
                <RNText
                  style={tx(here ? '800' : '600', 10.5, here ? t.colors.ink : done ? t.colors.accentDeep : t.colors.muted, { marginTop: 5 })}
                  numberOfLines={1}
                >
                  {STEP_LABEL[p]}
                </RNText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 28 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FadeIn key={phase} translateY={10} duration={220}>
          {body}
        </FadeIn>
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          gap: 10,
          paddingHorizontal: 20,
          paddingTop: 10,
          paddingBottom: 14,
          borderTopWidth: 1,
          borderTopColor: t.colors.line,
        }}
      >
        {phase !== 'what' ? (
          <Pressable
            onPress={stepBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => ({
              paddingHorizontal: 18,
              borderRadius: 999,
              borderWidth: 1.5,
              borderColor: t.colors.line,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Icon name="back" size={16} color={t.colors.ink} />
            <RNText style={tx('700', 14, t.colors.ink)}>Back</RNText>
          </Pressable>
        ) : null}
        <PrimaryButton
          label={primary.label}
          onPress={primary.onPress}
          disabled={primary.disabled}
          busy={primary.busy}
          style={{ flex: 1, borderRadius: 999 }}
        />
      </View>

      <DateTimeSheet
        visible={showDate}
        quick={false}
        initial={whenKey === 'custom' && customDue ? customDue : due}
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
      <ConfirmDialog
        visible={confirmDiscard}
        danger
        icon="close"
        title="Discard this request?"
        message="Your answers, post, deadline and budget will be lost. Nothing has been posted yet."
        confirmLabel="Discard"
        cancelLabel="Keep going"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          back();
        }}
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
