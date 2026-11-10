import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, TextInput, Animated, Platform, type ScrollViewInstance } from 'react-native';
import { Screen, formatINR, cardSurface } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { AmountField } from '../components/AmountField';
import { Slider } from '../components/Slider';
import { MediaAttach } from '../components/MediaAttach';
import { CategoryPicker } from '../components/CategoryPicker';
import { LocationSheet, type PickedPlace } from '../components/LocationSheet';
import { DateTimeSheet, formatDeadline } from '../components/DateTimeSheet';
import { Field, IconButton, PrimaryButton, rupees } from '../components/kit';
import { removeDraft, saveDraft } from '../lib/drafts';
import { markBigDayPosted } from '../lib/bigDayStore';
import { bigDayParam } from '../lib/bigDays';
import { GUEST_DRAFTS_OWNER, isNeedsAccount, needAccount } from '../lib/guest';
import { useReducedMotion } from '../lib/motion';
import { FadeIn, Pressy, tx } from '../components/primitives';
import { KeyboardSafe } from '../components/KeyboardSafe';
import { KeyboardScrollView } from '../components/KeyboardScrollView';
import { TaskDescription } from '../components/TaskDescription';
import { roughPlace } from '../lib/place';
import { MIN_PRICE_INR } from '../lib/limits';
import { TOP_UP_PCTS } from '@taskdrop/rules';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { useMode } from '../providers/ModeProvider';
import { createTask, getProfile, getWallet, myRegulars, type Regular, type Task } from '../data/api';
import { NO_OPTIONS, PosterOptionsStep, huntOn, optionsSummary, type PosterOptions } from '../components/PosterOptionsStep';
import { needsFor } from '../lib/hunt';
import { crewShareMinor, looksLikePlaceQuestion, suggestOptions } from '../lib/posterOptions';
import { AddFundsSheet } from '../components/AddFundsSheet';
import { SafetyCardSheet } from '../components/SafetyCardSheet';
import { ExplainerSheet, useExplainerOnce } from '../components/ExplainerSheet';
import { HuntHelpLink } from '../components/Hunt';
import { markSafetyCardSeen, needsSafetyCard } from '../lib/safetyCard';
import { NOT_ALLOWED_LINE } from '../legal/disputePolicy';
import type { TaskMedia } from '../lib/media';
import { useVoiceInput } from '../lib/speech';
import { contactIssueMessage, findContactIssue } from '../lib/mask';
import { useFees } from '../lib/useFees';
import {
  IDEAS,
  WHEN_OPTIONS,
  WRITING_STYLES,
  askBrief,
  answersSayOnline,
  askQuestions,
  briefToDescription,
  dueFor,
  linkedQuestions,
  pillarFor,
  type Answer,
  type Brief,
  type QuickQuestion,
  type WhenKey,
  type WritingStyle,
} from '../lib/taskBrief';
import { looksLikeGibberish } from '../lib/gibberish';
import { pickDefaultPlace } from '../lib/homePlace';
import { loadRecentPlaces } from '../lib/recentPlaces';
import { WIZARD_VERSION, isStale, normalize, ownerMatches, resumable, type WizardSnapshot } from '../lib/postWizard';
import {
  clearWizard,
  loadWizard,
  peekWizard,
  requestResumeSubmit,
  saveWizard,
  takeResumeSubmit,
  useResumeSignal,
} from '../lib/postWizardStore';

/**
 * "What do you need done?" -> a posted task, one page per step.
 *
 *   Ask       the request in a sentence, typed or spoken
 *   Details   the quick questions for it, all on one page, answered together
 *   Post      the written post: title, description, category, tone, a photo
 *   When      the deadline, each choice showing the actual date and time
 *   Budget    the amount, with a meter against what jobs like it usually cost
 *   Place     where the job is, and whether to compare offers or auto-hire
 *   Options   extras suggested for this task (Flash Drop, crew, repeat...), all off until switched on
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

type Phase = 'what' | 'picks' | 'brief' | 'when' | 'budget' | 'providers' | 'options' | 'review';

const ORDER: Phase[] = ['what', 'picks', 'brief', 'when', 'budget', 'providers', 'options', 'review'];
const at = (p: Phase) => ORDER.indexOf(p);

const STEP_LABEL: Record<Phase, string> = {
  what: 'Ask',
  picks: 'Details',
  brief: 'Post',
  when: 'When',
  budget: 'Budget',
  providers: 'Place',
  options: 'Extras',
  review: 'Review',
};

/** The "How it sounds" tone chips on the Post step. Hidden for now (owner video, 2026-11-04); the tone stays 'professional'. */
const SHOW_TONE = false;

/**
 * The route params of the last posting screen that restored or saved here. On the web a screen
 * opened on top unmounts this one; coming back to the same stack entry hands over the same params
 * object, which is how a return is told apart from a new post opened with a prompt.
 */
let lastParams: object | null = null;

const OTHER = 'Something else';

/** One picture per "when" choice, so the rows tell apart at a glance. */
const WHEN_ICONS: Record<WhenKey, IconName> = { now: 'bolt', today: 'sun', '2days': 'calendarTwo', week: 'calendarWeek' };

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

/** The top-up bar's stops: an extra share of the poster's own price, to stand out (the server accepts only these). */
const TOP_UP_STOPS = TOP_UP_PCTS;

export function AiPostScreen() {
  const t = useTheme();
  const { params, back, reset, go } = useNav();
  const { flash, celebrate } = useActions();
  const { userId, guest } = useAuth();
  const draftOwner = userId ?? (guest ? GUEST_DRAFTS_OWNER : null);
  const postRef = useRef<() => Promise<void>>(async () => {});
  const { setMode } = useMode();

  const similar = isTask(params.similar) ? params.similar : null;
  // Set when this request was picked up from Drafts, so posting it clears the draft.
  const paramDraftId = typeof params.draftId === 'string' ? params.draftId : null;
  const [draftId, setDraftId] = useState<string | null>(paramDraftId);
  const [phase, setPhase] = useState<Phase>(similar ? 'brief' : 'what');
  // The furthest step reached. Finished steps up to here can be reopened, and
  // a change to one of them comes back here afterwards.
  const [reached, setReached] = useState(at(similar ? 'brief' : 'what'));
  useEffect(() => setReached((r) => Math.max(r, at(phase))), [phase]);

  const [prompt, setPrompt] = useState(
    typeof params.prompt === 'string' ? params.prompt : similar ? similar.title : '',
  );

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
  // Home's day chips (plan D22, A6) open the composer with the day already picked.
  const [whenKey, setWhenKey] = useState<WhenKey | 'custom'>(() =>
    WHEN_OPTIONS.some((o) => o.key === params.when) ? (params.when as WhenKey) : 'today',
  );
  const [customDue, setCustomDue] = useState<Date | null>(null);
  const [showDate, setShowDate] = useState(false);

  // Budget.
  const [budget, setBudget] = useState<number | null>(similar ? Math.round(similar.benchmark_minor / 100) : null);
  // The top-up bar: an index into TOP_UP_STOPS. The posted price is the typed
  // amount plus that share, so workers see one figure.
  const [topUpStop, setTopUpStop] = useState(0);
  const [split, setSplit] = useState<0 | 2 | 3 | 4 | 5 | 6>(0);

  // Place and hiring.
  const [mode, setAssign] = useState<'bids' | 'auto'>('bids');
  const [place, setPlace] = useState<PickedPlace | null>(null);
  // Where the place was filled in from for the poster: 'home' shows a HOME label on the Place card.
  const [placeSource, setPlaceSource] = useState<'home' | 'profile' | null>(null);
  const [remote, setRemote] = useState(false);
  const [showLoc, setShowLoc] = useState(false);
  const [posting, setPosting] = useState(false);
  // "Staying safe on a job", once before a person's first in-person post (plan 4.9).
  const [safetyOpen, setSafetyOpen] = useState(false);

  // Auto-hire accepts an offer the moment it arrives, so the money has to be
  // in the wallet already. `walletMinor` is what is there; `topUpMinor` is the
  // shortfall being added when posting found the wallet short.
  const [walletMinor, setWalletMinor] = useState<number | null>(null);
  const [topUpMinor, setTopUpMinor] = useState<number | null>(null);

  // Options: all off until the poster switches one on. "Book again" from the
  // Regulars screen arrives with that person already chosen.
  const preferParam = params.preferWorker as { id?: unknown; name?: unknown } | undefined;
  // "Find it for me" on Home opens the writer with the Hunt already on (City Hunt, D19); nothing
  // else switches an option on without a tap.
  const [opts, setOpts] = useState<PosterOptions>(() =>
    typeof preferParam?.id === 'string' && typeof preferParam.name === 'string'
      ? { ...NO_OPTIONS, preferWorker: { id: preferParam.id, name: preferParam.name } }
      : params.hunt === true
        ? huntOn(NO_OPTIONS, false)
        : NO_OPTIONS,
  );
  // People hired before, to pick from when "Book again" chose one.
  const [regulars, setRegulars] = useState<Regular[]>([]);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void myRegulars().then((r) => alive && setRegulars(r));
    return () => {
      alive = false;
    };
  }, [userId]);
  // Asked once per request, on the Ask step; "Keep as a task" hides it.
  const [liveAnswerDismissed, setLiveAnswerDismissed] = useState<string | null>(null);

  // ------------------------------------------------- keeping the post ---
  // Everything above is kept on the device as it changes (lib/postWizardStore), so the post
  // survives this screen closing under it: signing in from the guest pop-up, Google's round
  // trip (a full reload on the web), a reload by hand. Close is the one way to drop it.

  const viewer = userId ?? (guest ? GUEST_DRAFTS_OWNER : null);
  // Nothing is saved until the kept post, if any, has been put back.
  const [hydrated, setHydrated] = useState(false);
  // "What is a Hunt?": opens by itself the first time this person (or guest) starts a Hunt on this
  // device, never for a resumed post, and any "How a Hunt works" link opens it again.
  const huntHelp = useExplainerOnce('hunt', viewer ?? GUEST_DRAFTS_OWNER, hydrated && params.hunt === true && params.resume !== true);
  // "Post my request" was pressed as a guest in this page session: post it when the sign-in signal comes.
  const resumeArmed = useRef(false);
  // Posted or closed: nothing more is saved.
  const doneRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<WizardSnapshot | null>(null);

  const snapshot = (): WizardSnapshot | null =>
    viewer
      ? {
          v: WIZARD_VERSION,
          owner: viewer,
          savedAt: Date.now(),
          phase,
          reached,
          prompt,
          questions,
          askedFor,
          answers,
          brief,
          writtenFrom,
          title,
          description,
          category,
          style,
          media,
          whenKey,
          customDue: customDue ? customDue.toISOString() : null,
          budget,
          topUpStop,
          split,
          mode,
          place,
          placeSource,
          remote,
          opts,
          draftId,
          submitAfterAuth: false,
        }
      : null;

  const applySnapshot = (s: WizardSnapshot, showAt: Phase) => {
    setPhase(showAt);
    setReached(Math.max(s.reached, at(showAt)));
    setPrompt(s.prompt);
    setQuestions(s.questions);
    setAskedFor(s.askedFor);
    setAnswers(s.answers);
    setOtherOpen({});
    setBrief(s.brief);
    setWrittenFrom(s.writtenFrom);
    setTitle(s.title);
    setDescription(s.description);
    setCategory(s.category);
    setStyle(s.style);
    setMedia(s.media);
    setWhenKey(s.whenKey);
    setCustomDue(s.customDue ? new Date(s.customDue) : null);
    setBudget(s.budget);
    setTopUpStop(Math.min(s.topUpStop, TOP_UP_STOPS.length - 1));
    setSplit(s.split);
    setAssign(s.mode);
    setPlace(s.place);
    setPlaceSource(s.placeSource);
    setRemote(s.remote);
    setOpts(s.opts);
    setDraftId(s.draftId);
  };

  /** Stops any save still waiting: the post is about to be saved by hand, posted or dropped. */
  const cancelSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    pendingSave.current = null;
  };
  const forget = () => {
    doneRef.current = true;
    cancelSave();
    void clearWizard();
  };

  // Once, on opening: put back the kept post, unless this is a new one opened with words already in it.
  useEffect(() => {
    let alive = true;
    const resumeParam = params.resume === true;
    const seeded = typeof params.prompt === 'string' || similar !== null || paramDraftId !== null || params.preferWorker !== undefined;
    // The same stack entry again (web: a screen opened on top has closed), not a new post.
    const sameEntry = lastParams === params;
    lastParams = params;
    const usable = (s: WizardSnapshot | null) => (s && ownerMatches(s, viewer) && !isStale(s) ? normalize(s) : null);

    const restore = (s: WizardSnapshot, fromMemory: boolean) => {
      if (userId && resumable(s)) {
        applySnapshot(s, 'review');
        // Same page session (phone sign-in): posted when the sign-in signal arrives. After a
        // reload or Google's round trip the signal is gone, so it waits on Review for the tap.
        if (fromMemory) resumeArmed.current = true;
        else flash('Signed in. Your request is ready to post.');
      } else {
        applySnapshot(s, s.phase);
        if (!sameEntry) flash('Picked up where you left off');
      }
      setHydrated(true);
    };

    if (seeded && !sameEntry && !resumeParam) {
      // A new post replaces the kept one; an older one with words in it goes to Drafts rather than being lost.
      void loadWizard().then((old) => {
        const o = usable(old);
        if (!o || !viewer || o.prompt.trim().length < 3 || o.prompt.trim() === prompt.trim()) return;
        if (o.draftId && o.draftId === paramDraftId) return;
        void saveDraft(viewer, o.prompt, o.draftId);
      });
      setHydrated(true);
      return;
    }
    const mem = usable(peekWizard());
    if (mem) {
      restore(mem, true);
      return;
    }
    void loadWizard().then((s) => {
      if (!alive) return;
      const u = usable(s);
      if (u) restore(u, false);
      else setHydrated(true);
    });
    return () => {
      alive = false;
    };
    // Once, on opening: later changes are this screen's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Saved 400 ms after the last change. Wallet figures and the posting state are never kept.
  useEffect(() => {
    if (!hydrated || doneRef.current) return;
    if (prompt.trim().length < 3) {
      cancelSave();
      // Emptied by hand: the kept post goes too, so it does not come back.
      const kept = peekWizard();
      if (kept && viewer && kept.owner === viewer) void clearWizard();
      return;
    }
    const s = snapshot();
    if (!s) return;
    pendingSave.current = s;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      pendingSave.current = null;
      void saveWizard(s);
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
    };
    // `snapshot` reads exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, viewer, phase, reached, prompt, questions, askedFor, answers, brief, writtenFrom, title, description, category, style, media, whenKey, customDue, budget, topUpStop, split, mode, place, placeSource, remote, opts, draftId]);

  // Closing under a save still waiting (a tab tapped, a screen opened on top): save it now.
  useEffect(
    () => () => {
      if (pendingSave.current && !doneRef.current) void saveWizard(pendingSave.current);
    },
    [],
  );

  // Back from signing in, in the same page session: post it, once. The safety card and the
  // wallet top-up still show if they apply.
  const resumeSignal = useResumeSignal();
  useEffect(() => {
    if (!hydrated || !userId || !resumeArmed.current) return;
    if (!takeResumeSubmit()) return;
    resumeArmed.current = false;
    setPhase('review');
    void postRef.current();
  }, [hydrated, userId, resumeSignal]);

  // Start from where the poster lives: most jobs are near home. The address saved as Home
  // first, then the profile's area. Never over a place already chosen or put back.
  const placeRef = useRef(place);
  placeRef.current = place;
  useEffect(() => {
    if (!hydrated || (!userId && !guest)) return;
    let alive = true;
    void (async () => {
      const [recents, profile] = await Promise.all([
        loadRecentPlaces().catch(() => []),
        userId ? getProfile(userId).catch(() => null) : Promise.resolve(null),
      ]);
      const d = pickDefaultPlace(recents, profile);
      if (!alive || !d || placeRef.current) return;
      setPlace({ label: d.label, lat: d.lat, lng: d.lng });
      setPlaceSource(d.source);
    })();
    return () => {
      alive = false;
    };
  }, [hydrated, userId, guest]);

  const voice = useVoiceInput(
    (text) => setPrompt((cur) => (cur.trim() ? cur.trim() + ' ' + text : text)),
    flash,
  );

  // Home's mic opens this screen already listening (plan item 2), once.
  const listenOnOpen = params.listen === true;
  const startedListening = useRef(false);
  useEffect(() => {
    if (!listenOnOpen || startedListening.current || !voice.supported) return;
    startedListening.current = true;
    voice.toggle();
  }, [listenOnOpen, voice]);

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
  };

  /** Ask -> Details. The questions are only asked again if the request changed. */
  const fromAsk = () => {
    const req = prompt.trim();
    if (req.length < 5) return flash('Tell us a bit more about what you need');
    if (looksLikeGibberish(req)) return flash('That doesn’t read like a task yet. Say what you need in a few real words.');
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
    const given = liveAnswers();
    if (!brief || writtenFrom !== JSON.stringify([prompt.trim(), given, style])) writeBrief(given);
    // Work the answers place online starts as Remote on the Place step; hands-on work as At a place.
    const online = answersSayOnline(given);
    if (online !== null) setRemote(online);
    // A rewritten post is worth a look, even when coming back from Review.
    setPhase('brief');
  };

  const setAnswer = (question: string, value: string) =>
    setAnswers((cur) => [...cur.filter((a) => a.question !== question), { question, answer: value }]);
  const answerOf = (question: string) => answers.find((a) => a.question === question)?.answer ?? '';
  // The questions as the earlier answers leave them, and only the answers that still apply to them.
  const shownQuestions = linkedQuestions(questions, answers);
  const liveAnswers = () =>
    answers.filter((a) => {
      if (!a.answer.trim()) return false;
      const q = shownQuestions.find((x) => x.question === a.question);
      if (!q) return false;
      const original = questions.find((x) => x.question === a.question);
      // An option an earlier answer took away no longer counts; a typed answer always does.
      return q.options.includes(a.answer) || !original?.options.includes(a.answer);
    });

  const restyle = (s: WritingStyle) => {
    setStyle(s);
    writeBrief(liveAnswers(), s);
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
  const budgetOk = (budget ?? 0) >= MIN_PRICE_INR;
  const topUpPct = TOP_UP_STOPS[topUpStop] ?? 0;
  // What is posted: the poster's own amount plus the top-up.
  const price = Math.round((budget ?? 0) * (1 + topUpPct / 100));
  const fees = useFees();
  const feeRupees = Math.round(price * fees.posterFee);

  const milestones = useMemo(() => MILESTONE_PLANS[split] ?? [], [split]);

  // What an auto-hire must have ready: the budget plus the service fee, since
  // an offer at the full budget is accepted and paid for at once. A crew is
  // that for every helper's share.
  const crewSize = opts.crewSize >= 2 ? opts.crewSize : 1;
  const autoNeedMinor = crewSize * Math.round(crewShareMinor(price * 100, crewSize) * (1 + fees.posterFee));

  // The people hired before, the one who did this kind of job first.
  const orderedRegulars = useMemo(
    () => [...regulars].sort((x, y) => Number(y.categories.includes(category)) - Number(x.categories.includes(category))),
    [regulars, category],
  );
  const suggestions = useMemo(
    () => suggestOptions({ text: `${prompt} ${title}`, whenNow: whenKey === 'now', remote }),
    [prompt, title, whenKey, remote],
  );

  /**
   * Flash Drop rides on Auto-hire, so switching it on switches that on too,
   * and switching it off puts back how the poster had chosen to hire.
   */
  const modeBeforeFlash = useRef<'bids' | 'auto' | null>(null);
  const undoFlashMode = () => {
    if (modeBeforeFlash.current) setAssign(modeBeforeFlash.current);
    modeBeforeFlash.current = null;
  };
  const changeOptions = (next: PosterOptions) => {
    // A Hunt takes finds, not offers, so it never uses Auto-hire.
    if (next.hunt && !opts.hunt && mode === 'auto') {
      modeBeforeFlash.current = null;
      setAssign('bids');
    }
    if (next.flash && !opts.flash) {
      modeBeforeFlash.current = mode;
      setAssign('auto');
    }
    if (!next.flash && opts.flash) undoFlashMode();
    setOpts(next);
  };
  /** Choosing See offers ends Flash Drop, which needs Auto-hire. */
  const chooseMode = (next: 'bids' | 'auto') => {
    modeBeforeFlash.current = null;
    setAssign(next);
    if (next === 'bids' && opts.flash) {
      setOpts((o) => ({ ...o, flash: false }));
      flash('Flash Drop is off: it needs Auto-hire');
    }
    if (next === 'auto' && opts.hunt) {
      setOpts((o) => ({ ...o, hunt: null }));
      flash('Hunt is off: a Hunt takes finds, not offers');
    }
  };

  // Work done remotely cannot use the options tied to a place.
  useEffect(() => {
    if (!remote) return;
    undoFlashMode();
    // A Hunt works online too; only its pin goes.
    setOpts((o) => ({
      ...o,
      flash: false,
      liveAnswer: false,
      crewSize: 0,
      wantPhotos: false,
      photosPublic: false,
      hunt: o.hunt ? { ...o.hunt, needs: needsFor(o.hunt.needs, true) } : null,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- undoFlashMode only reads a ref and a state setter
  }, [remote]);

  const offerLiveAnswer = phase === 'what' && liveAnswerDismissed !== prompt.trim() && !opts.liveAnswer && looksLikePlaceQuestion(prompt);
  const useLiveAnswer = () => {
    setOpts((o) => ({ ...o, liveAnswer: true, crewSize: 0 }));
    setRemote(false);
    setWhenKey('now');
    fromAsk();
  };

  useEffect(() => {
    if (mode !== 'auto' || !userId) return;
    let alive = true;
    void getWallet()
      .then((w) => alive && setWalletMinor(w?.balance_minor ?? 0))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode, topUpMinor, userId]);

  const post = async (safetySeen = false) => {
    if (guest) {
      // Kept with "post when back" before the sign-in page opens: on the web that page replaces this
      // screen, and Google's round trip reloads the app. The pop-up's follow-up is only a signal,
      // which this screen (or the copy of it that opens again) answers.
      cancelSave();
      const s = snapshot();
      if (s) await saveWizard({ ...s, submitAfterAuth: true });
      resumeArmed.current = true;
      return needAccount('post', requestResumeSubmit);
    }
    if (!userId) return flash('Sign in to post a task');
    if (posting) return;
    if (!remote && !safetySeen && (await needsSafetyCard(userId))) {
      setSafetyOpen(true);
      return;
    }
    setPosting(true);
    try {
      if (mode === 'auto') {
        // The server checks this too. Asking here first lets the poster add the
        // money and carry on, instead of meeting a refusal.
        const w = await getWallet();
        const have = w?.balance_minor ?? 0;
        setWalletMinor(have);
        if (have < autoNeedMinor) {
          setTopUpMinor(autoNeedMinor - have);
          return;
        }
      }
      const minutes = Math.max(60, Math.round((due.getTime() - Date.now()) / 60000));
      const task = await createTask({
        posterId: userId,
        pillar: brief?.pillar ?? pillarFor(category),
        title: title.trim(),
        description: description.trim(),
        benchmarkMinor: price * 100,
        topUpPct,
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
        flash: opts.flash || undefined,
        liveAnswer: opts.liveAnswer || undefined,
        crewSize: opts.crewSize >= 2 ? opts.crewSize : undefined,
        repeatEvery: opts.repeat ?? undefined,
        preferWorkerId: opts.preferWorker?.id,
        wantPhotos: opts.wantPhotos || undefined,
        photosPublic: (opts.wantPhotos && opts.photosPublic) || undefined,
        huntWindow: opts.hunt?.window,
        huntNeeds: opts.hunt ? needsFor(opts.hunt.needs, remote) : undefined,
      });
      if (draftId && draftOwner) void removeDraft(draftOwner, draftId);
      // Posted from a big-day plan (screens/BigDayScreen): the plan's line remembers this task.
      const bigDay = bigDayParam(params.bigDay);
      if (bigDay) void markBigDayPosted(userId, bigDay.planId, bigDay.itemId, task.id);
      forget();
      setMode('poster');
      celebrate('Task posted');
      reset('myTasks');
      go('taskManage', { taskId: task.id });
    } catch (e) {
      if (isNeedsAccount(e)) return;
      flash(e instanceof Error ? e.message : 'Could not post your task');
    } finally {
      setPosting(false);
    }
  };
  postRef.current = () => post();

  // Each step opens at its top.
  const scrollRef = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [phase]);

  // Leaving with words typed keeps them as a draft, listed under Drafts in My Tasks. Close is
  // the one way to drop the kept steps: the next post starts fresh.
  const leave = () => {
    forget();
    if (draftOwner && prompt.trim().length >= 3) {
      void saveDraft(draftOwner, prompt, draftId);
      flash('Saved to Drafts in My Tasks');
    }
    back();
  };

  // -------------------------------------------------------------- pieces ---

  const whenLabel = WHEN_OPTIONS.find((o) => o.key === whenKey)?.label ?? 'By a date';
  const whereLabel = remote ? 'Remote / online' : (roughPlace(place?.area || place?.label) ?? 'Location not set');
  const hireLabel = mode === 'auto' ? 'Auto-hire' : 'See offers';

  const heading = (text: string, sub?: string) => (
    <>
      <RNText style={tx('800', 27, t.colors.ink, { letterSpacing: -0.8, lineHeight: 32 })}>{text}</RNText>
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
        padding: 15,
        shadowColor: t.colors.shadow,
        shadowOpacity: on || t.isDark ? 0 : 0.05,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
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
            backgroundColor: on ? t.colors.btn : t.colors.surface2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={17} color={on ? t.colors.onBtn : t.colors.muted} strokeWidth={2} />
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

  /** One row of the "when" list: its own picture, the real deadline, a radio at the end. */
  const whenRow = (
    key: string,
    index: number,
    on: boolean,
    onPress: () => void,
    icon: IconName,
    head: string,
    sub: string,
    urgent = false,
    neutral = false,
  ) => (
    <FadeIn key={key} translateY={10} delay={Math.min(index, t.motion.staggerMax) * t.motion.stagger}>
      <Pressable
        onPress={onPress}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${head}. ${sub}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          minHeight: 68,
          paddingVertical: 10,
          paddingLeft: 12,
          paddingRight: 16,
          borderRadius: 18,
          borderWidth: 1.5,
          borderColor: on ? t.colors.accent : t.colors.line,
          backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
          transform: [{ scale: pressed ? t.motion.pressScale : 1 }],
        })}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            borderWidth: 3,
            borderColor: on ? t.colors.accentSoft : t.colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: urgent ? t.colors.signalSoft : neutral ? t.colors.surface2 : t.colors.accentSoft,
          }}
        >
          <Icon name={icon} size={21} color={urgent ? t.colors.signalDeep : neutral ? t.colors.ink : t.colors.accentDeep} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <RNText style={tx('700', 16, t.colors.ink)}>{head}</RNText>
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 2 })}>{sub}</RNText>
        </View>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: on ? t.colors.accent : t.colors.line,
            backgroundColor: on ? t.colors.accent : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {on ? <Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={3} /> : null}
        </View>
      </Pressable>
    </FadeIn>
  );

  const card = (children: React.ReactNode, extra?: { borderColor?: string }) => (
    <View style={[cardSurface(t, 20), { borderColor: extra?.borderColor ?? t.colors.line, padding: 16 }]}>
      {children}
    </View>
  );

  // --------------------------------------------------------------- steps ---

  let body: React.ReactNode = null;

  if (phase === 'what') {
    body = (
      <>
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          placeholder="What do you need done? E.g. fix the side stand of my scooter at home"
          placeholderTextColor={t.colors.muted}
          multiline
          autoFocus
          maxLength={1500}
          accessibilityLabel="What do you need done?"
          style={tx('500', 22, t.colors.ink, {
            minHeight: 180,
            textAlignVertical: 'top',
            padding: 0,
            lineHeight: 30,
            letterSpacing: -0.3,
            ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
          })}
        />
        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 10, lineHeight: 19 })}>
          Say it the way you would tell a friend. We turn it into a clear post, then ask only what is missing.
        </RNText>
        {opts.hunt !== null ? <HuntHelpLink onPress={huntHelp.show} /> : null}
        {promptIssue ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, backgroundColor: t.colors.signalSoft, borderRadius: 12, padding: 11 }}>
            <Icon name="shield" size={15} color={t.colors.signalDeep} />
            <RNText style={tx('600', 12, t.colors.signalDeep, { flex: 1, lineHeight: 17 })}>{contactIssueMessage(promptIssue)}</RNText>
          </View>
        ) : null}

        {offerLiveAnswer ? (
          <FadeIn translateY={16} duration={320}>
            <View
              style={{
                marginTop: 18,
                padding: 16,
                borderRadius: 22,
                borderWidth: 1.5,
                borderColor: t.colors.accentBorder,
                backgroundColor: t.colors.surface,
              }}
            >
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="eye" size={21} color={t.colors.accentDeep} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <RNText style={tx('700', 11, t.colors.accentDeep, { letterSpacing: 1.2 })}>SUGGESTED</RNText>
                  <RNText style={tx('800', 16, t.colors.ink, { marginTop: 3, lineHeight: 21 })}>
                    This sounds like a quick question about a place
                  </RNText>
                </View>
              </View>
              <RNText style={tx('400', 13, t.colors.text, { marginTop: 10, lineHeight: 19 })}>
                Post it as a Live answer. The first helper nearby who accepts goes there and sends a live photo with a short
                reply. You approve it before they are paid.
              </RNText>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <Pressable
                  onPress={() => setLiveAnswerDismissed(prompt.trim())}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    flex: 1,
                    height: 44,
                    borderRadius: 999,
                    borderWidth: 1.5,
                    borderColor: t.colors.line,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <RNText style={tx('700', 14, t.colors.ink)}>Keep as a task</RNText>
                </Pressable>
                <Pressable
                  onPress={useLiveAnswer}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    flex: 1,
                    height: 44,
                    borderRadius: 999,
                    backgroundColor: t.colors.btn,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ scale: pressed ? t.motion.pressScale : 1 }],
                  })}
                >
                  <RNText style={tx('800', 14, t.colors.onBtn)}>Use Live answer</RNText>
                </Pressable>
              </View>
            </View>
          </FadeIn>
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
          {shownQuestions.map((q, i) => {
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
                      {/* This screen adds its own "Something else" chip, the one that opens the
                          text bar, so a canned option with the same name would only set a
                          useless answer. */}
                      {q.options
                        .filter((o) => o !== OTHER)
                        .map((o) =>
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
                        label="Your own answer"
                        style={{ marginTop: 12 }}
                        value={given}
                        onChangeText={(v) => setAnswer(q.question, v)}
                        placeholder="Type it here, in your own words"
                        autoFocus
                      />
                    ) : (
                      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 10 })}>
                        None of these fit? Tap “{OTHER}” and type your own answer.
                      </RNText>
                    )}
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
                // Two lines that grow, so a long title shows from its first
                // word; Enter closes the keyboard instead of adding a line.
                onChangeText={(v) => setTitle(v.replace(/\s*\n+\s*/g, ' '))}
                multiline
                minHeight={40}
                submitBehavior="blurAndSubmit"
                returnKeyType="done"
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
        <CategoryPicker value={category} onChange={setCategory} />
        {SHOW_TONE && !similar ? (
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
        <View style={{ marginTop: 20, rowGap: 10 }}>
          {/* Soonest first, with a line joining the rows from urgent to relaxed. */}
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 34, top: 34, bottom: 34, width: 3, borderRadius: 2, backgroundColor: t.colors.line }}
          />
          {WHEN_OPTIONS.map((o, i) =>
            whenRow(
              o.key,
              i,
              whenKey === o.key,
              () => setWhenKey(o.key),
              WHEN_ICONS[o.key],
              o.key === 'now' ? 'Right now' : o.key === '2days' ? 'In 2 days' : o.label,
              o.key === 'now' ? 'Within 2 hours, marked urgent' : `By ${formatDeadline(dueFor(o.key))}`,
              o.key === 'now',
            ),
          )}
          {whenRow(
            'custom',
            WHEN_OPTIONS.length,
            whenKey === 'custom',
            () => setShowDate(true),
            'calendarCheck',
            'Pick a date and time',
            whenKey === 'custom' && customDue ? `By ${formatDeadline(customDue)}` : 'Choose the day and the hour',
            false,
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
    // The milestone split below works on what is posted, top-up included.
    const amount = price;

    body = (
      <>
        {heading('What will you pay?', 'Your price, your call. You pay only when you pick an offer, and TaskDrop holds it until you approve the work.')}
        <View style={{ marginTop: 20 }}>
          {card(
            <View style={{ alignItems: 'center', paddingVertical: 6 }}>
              <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 0.9 })}>TASK PRICE</RNText>
              {/* Fixed width: a web <input> otherwise sizes itself to ~20ch
                  and pushes the box off the screen. AmountField draws its own ₹. */}
              <View style={{ width: 230, marginTop: 8, borderBottomWidth: 2, borderBottomColor: t.colors.accent, paddingBottom: 4 }}>
                <AmountField
                  rupees={budget}
                  onChangeRupees={setBudget}
                  min={10}
                  align="center"
                  placeholder="₹0"
                  style={tx('800', 44, t.colors.ink, { width: '100%', padding: 0 })}
                />
              </View>
              <RNText
                style={tx('600', 12, budget !== null && budget > 0 && !budgetOk ? t.colors.signalDeep : t.colors.muted, { marginTop: 12 })}
              >
                {budget === null || budget === 0
                  ? 'Type any amount'
                  : budgetOk
                    ? 'Any amount works'
                    : `The lowest price is ${rupees(MIN_PRICE_INR)}`}
              </RNText>
            </View>,
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
            <View style={{ flex: 1 }}>
              {place && placeSource === 'home' ? (
                <RNText style={tx('700', 10.5, t.colors.accentDeep, { letterSpacing: 1.1, marginBottom: 2 })}>HOME</RNText>
              ) : null}
              <RNText style={tx('500', 14, place ? t.colors.ink : t.colors.muted)} numberOfLines={2}>
                {place?.label ?? 'Set where the job is'}
              </RNText>
            </View>
            <RNText style={tx('700', 13, t.colors.accentDeep)}>{place ? 'Change' : 'Set'}</RNText>
          </Pressable>
        ) : null}

        {label('HOW DO YOU WANT TO HIRE?')}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {choice('bids', mode === 'bids', () => chooseMode('bids'), 'users', 'See offers', 'Workers send offers or counteroffers. You pick one')}
          {choice('auto', mode === 'auto', () => chooseMode('auto'), 'bolt', 'Auto-hire', `First offer at or under ${rupees(price)} is accepted`)}
        </View>
        {mode === 'auto' ? (
          <View
            style={{
              marginTop: 12,
              padding: 14,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: walletMinor !== null && walletMinor < autoNeedMinor ? t.colors.signal : t.colors.accentBorder,
              backgroundColor: t.colors.accentSoft,
            }}
          >
            <RNText style={tx('700', 13, t.colors.accentDeep)}>Keep enough in your wallet</RNText>
            <RNText style={tx('400', 12, t.colors.accentDeep, { marginTop: 4, lineHeight: 18 })}>
              The first offer at or under your budget is accepted straight away and paid from your wallet, so it has to
              hold {rupees(Math.ceil(autoNeedMinor / 100))} (budget plus the {Math.round(fees.posterFee * 100)}% service
              fee). TaskDrop holds it until you approve the work.
            </RNText>
            <RNText
              style={tx(
                '700',
                13,
                walletMinor !== null && walletMinor < autoNeedMinor ? t.colors.signalDeep : t.colors.accentDeep,
                { marginTop: 8 },
              )}
            >
              {walletMinor === null
                ? 'Checking your wallet…'
                : walletMinor >= autoNeedMinor
                  ? `Your wallet: ${rupees(Math.floor(walletMinor / 100))} · enough`
                  : `Your wallet: ${rupees(Math.floor(walletMinor / 100))} · add ${rupees(Math.ceil((autoNeedMinor - walletMinor) / 100))} to use auto-hire`}
            </RNText>
          </View>
        ) : null}
      </>
    );
  }

  if (phase === 'options') {
    body = (
      <PosterOptionsStep
        value={opts}
        onChange={changeOptions}
        suggestions={suggestions}
        regulars={orderedRegulars}
        prompt={prompt}
        remote={remote}
        priceMinor={price * 100}
        onHuntHelp={huntHelp.show}
      />
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
        <View style={{ marginTop: 20, ...cardSurface(t, 20), overflow: 'hidden' }}>
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

        <View style={{ marginTop: 12, ...cardSurface(t, 20), paddingHorizontal: 16, paddingVertical: 4 }}>
          {row('clock', 'Done by', `${whenKey === 'custom' ? 'A date you picked' : whenLabel} · ${formatDeadline(due)}`, 'when')}
          {divider}
          {row('tag', 'Budget', `${rupees(price)}${topUpPct ? ` · incl. ${topUpPct}% top up` : ''}${split ? ` · in ${split} steps` : ''}`, 'budget')}
          {divider}
          {row('pin', 'Where', whereLabel, 'providers')}
          {divider}
          {row(mode === 'auto' ? 'bolt' : 'users', 'How you hire', hireLabel, 'providers')}
          {divider}
          {row('sparkle', 'Options', optionsSummary(opts).join(' · ') || 'None', 'options')}
        </View>
        {crewSize > 1 ? (
          <RNText style={tx('600', 12, t.colors.accentDeep, { marginTop: 8, marginLeft: 4 })}>
            {crewSize} helpers, {rupees(crewShareMinor(price * 100, crewSize) / 100)} each. Each one is hired and held for separately.
          </RNText>
        ) : null}

        <View style={{ marginTop: 12, ...cardSurface(t, 20), padding: 16, gap: 8 }}>
          <Row label="Task budget" value={rupees(price)} />
          <Row label={`TaskDrop fee (${Math.round(fees.posterFee * 100)}%)`} value={rupees(feeRupees)} />
          <View style={{ height: 1, backgroundColor: t.colors.line }} />
          <Row label="Held safely when you accept an offer" value={formatINR(price * 100 + feeRupees * 100)} strong />
          <RNText style={tx('400', 11, t.colors.muted, { lineHeight: 16 })}>
            The final figure follows the offer you accept. Nothing is charged now.
          </RNText>
        </View>

        {/* Two promises just above "Post my request" (plan item 3): what stays private, and when money moves. */}
        <View style={{ marginTop: 12, borderRadius: 20, backgroundColor: t.colors.accentSoft, paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
          <Pledge
            icon="lock"
            text={
              remote
                ? 'Your phone number stays hidden until you pick someone.'
                : 'Your number and exact address stay hidden. Workers see only the area until you pick one.'
            }
          />
          <Pledge icon="shield" text="Nothing is paid now. When you pick someone, TaskDrop holds the money until you approve the work." />
        </View>
        <Pressable onPress={() => go('support')} accessibilityRole="link" accessibilityLabel={`${NOT_ALLOWED_LINE} See all`} hitSlop={8} style={{ marginTop: 12 }}>
          <RNText style={tx('400', 12, t.colors.muted, { lineHeight: 17 })}>
            {NOT_ALLOWED_LINE} <RNText style={tx('700', 12, t.colors.accentDeep)}>See all</RNText>
          </RNText>
        </Pressable>
      </>
    );
  }

  // --------------------------------------------------------------- chrome ---

  // Details is left off the path once it is known the request has no questions.
  const steps = ORDER.filter((p) => p !== 'picks' || questions.length > 0 || askedFor === null);
  const stepNo = steps.indexOf(phase) + 1;
  // The first screen is a quick-post composer: close, Next, a big field, the keyboard.
  const composing = phase === 'what';

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
                  label: returning ? 'Save and review' : budgetOk ? `Continue with ${rupees(price)}` : 'Enter your price',
                  onPress: () => advance('budget'),
                  disabled: !budgetOk,
                }
              : phase === 'providers'
                ? { label: returning ? 'Save and review' : 'Continue', onPress: () => advance('providers') }
                : phase === 'options'
                  ? {
                      label: returning
                        ? 'Save and review'
                        : optionsSummary(opts).length === 0
                          ? 'Skip this step'
                          : `Continue with ${optionsSummary(opts).length} option${optionsSummary(opts).length === 1 ? '' : 's'}`,
                      onPress: () => advance('options'),
                    }
                  : { label: 'Post my request', onPress: () => void post(), busy: posting };

  return (
    <Screen padded={false}>
      <View style={{ paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: t.colors.line }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 }}>
          <IconButton icon="close" label="Close" onPress={leave} />
          <RNText style={tx('800', 17, t.colors.ink, { flex: 1, letterSpacing: -0.3 })}>{composing ? 'New task' : 'Post a request'}</RNText>
          {composing ? (
            <Pressable
              onPress={primary.onPress}
              disabled={primary.disabled}
              accessibilityRole="button"
              accessibilityLabel="Next"
              accessibilityState={{ disabled: !!primary.disabled }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                height: 38,
                paddingHorizontal: 16,
                borderRadius: 999,
                backgroundColor: primary.disabled ? t.colors.surface2 : t.colors.btn,
                transform: [{ scale: pressed ? t.motion.pressScale : 1 }],
              })}
            >
              <RNText style={tx('800', 14, primary.disabled ? t.colors.muted : t.colors.onBtn)}>Next</RNText>
              <Icon name="send" size={15} color={primary.disabled ? t.colors.muted : t.colors.onBtn} strokeWidth={2.2} />
            </Pressable>
          ) : (
            <RNText style={tx('600', 12, t.colors.muted)}>
              {stepNo} of {steps.length}
            </RNText>
          )}
        </View>

        {/* The path: every step by name. Done ones show a tick and can be reopened. */}
        {composing ? null : (
        <View style={{ flexDirection: 'row', marginTop: 14, paddingHorizontal: 6, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
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
                accessibilityLabel={`${STEP_LABEL[p]}${p === 'options' ? ', optional' : ''}${here ? ', current step' : done ? ', done. Tap to change' : ''}`}
                style={{ flex: 1, alignItems: 'center' }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', height: 32 }}>
                  <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? 'transparent' : at(p) <= reached ? t.colors.accent : t.colors.line }} />
                  <StepDot here={here} done={done}>
                    {done ? (
                      <Icon name="check" size={12} color={t.colors.accentDeep} strokeWidth={2.8} />
                    ) : (
                      <RNText style={tx('800', 11, here ? t.colors.onBtn : t.colors.muted)}>{i + 1}</RNText>
                    )}
                  </StepDot>
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
        )}
      </View>

      <KeyboardScrollView
        hugContent
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28, width: '100%', maxWidth: 680, alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FadeIn key={phase} translateY={14} duration={320}>
          {body}
        </FadeIn>
      </KeyboardScrollView>

      <KeyboardSafe
        style={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 14,
          borderTopWidth: 1,
          borderTopColor: t.colors.line,
          backgroundColor: t.colors.bg,
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
        }}
      >
        {/* The top-up bar sits at the bottom, right above Continue, so the price it makes stays in view as it moves. */}
        {phase === 'budget' && budgetOk ? (
          <TopUpBar stop={topUpStop} onChange={setTopUpStop} base={budget ?? 0} price={price} feeRate={fees.posterFee} />
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
        {composing ? (
          <>
            {voice.supported ? (
              <Pressable
                onPress={voice.toggle}
                accessibilityRole="button"
                accessibilityLabel={voice.listening ? 'Stop voice typing' : 'Voice typing'}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  height: 40,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  backgroundColor: voice.listening ? t.colors.signalSoft : t.colors.accentSoft,
                  transform: [{ scale: pressed ? t.motion.pressScale : 1 }],
                })}
              >
                <Icon name="mic" size={17} color={voice.listening ? t.colors.signalDeep : t.colors.accentDeep} />
                <RNText style={tx('700', 13, voice.listening ? t.colors.signalDeep : t.colors.accentDeep)}>
                  {voice.listening ? 'Listening…' : 'Speak'}
                </RNText>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }} />
            <RNText style={tx('500', 12, t.colors.muted, { alignSelf: 'center' })}>{prompt.length} / 1500</RNText>
          </>
        ) : null}
        {phase !== 'what' ? (
          <Pressable
            onPress={stepBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => ({
              paddingHorizontal: 20,
              minHeight: 52,
              borderRadius: 999,
              borderWidth: 1.5,
              borderColor: t.colors.line,
              backgroundColor: t.colors.surface,
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
        {composing ? null : (
          <PrimaryButton
            label={primary.label}
            onPress={primary.onPress}
            disabled={primary.disabled}
            busy={primary.busy}
            style={{ flex: 1, borderRadius: 999 }}
          />
        )}
        </View>
      </KeyboardSafe>

      <SafetyCardSheet
        visible={safetyOpen}
        doneLabel="Got it, post my request"
        onClose={() => setSafetyOpen(false)}
        onDone={() => {
          setSafetyOpen(false);
          if (userId) void markSafetyCardSeen(userId);
          void post(true);
        }}
      />

      <ExplainerSheet
        which="hunt"
        visible={huntHelp.open}
        onClose={huntHelp.close}
        onExample={(ex) => {
          if (ex.prompt) setPrompt(ex.prompt);
          if (!opts.hunt) changeOptions(huntOn(opts, remote));
          huntHelp.close();
        }}
      />

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
          setPlaceSource(p.details?.tag === 'home' ? 'home' : null);
          setShowLoc(false);
        }}
        askForDetails
      />
      <AddFundsSheet
        visible={topUpMinor !== null}
        initialMinor={topUpMinor ?? undefined}
        reason={
          topUpMinor !== null
            ? `Auto-hire needs ${rupees(Math.ceil(autoNeedMinor / 100))} in your wallet to accept an offer the moment it arrives. You are ${rupees(Math.ceil(topUpMinor / 100))} short. Add that much and your task is posted.`
            : undefined
        }
        onClose={() => setTopUpMinor(null)}
        flash={flash}
        onFunded={() => {
          setTopUpMinor(null);
          void post();
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

/** One of Review's promises: an icon and a plain sentence. */
function Pledge({ icon, text }: { icon: IconName; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
      <Icon name={icon} size={18} color={t.colors.accentDeep} />
      <RNText style={tx('500', 14, t.colors.ink, { flex: 1, lineHeight: 20 })}>{text}</RNText>
    </View>
  );
}

/**
 * A dot on the step path: done ones are a soft tick, the current one is the
 * filled dot with a soft halo that pops in as you arrive (SYS-Motion "the
 * active dot grows").
 */
function StepDot({ here, done, children }: { here: boolean; done: boolean; children: React.ReactNode }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const pop = useRef(new Animated.Value(here ? 0 : 1)).current;
  useEffect(() => {
    if (!here || reduced) {
      pop.setValue(1);
      return;
    }
    pop.setValue(0);
    const anim = Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 5, tension: 160 });
    anim.start();
    return () => anim.stop();
  }, [here, pop, reduced]);
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
  return (
    <Animated.View style={{ alignItems: 'center', justifyContent: 'center', transform: [{ scale }] }}>
      {here ? (
        <View style={{ position: 'absolute', width: 40, height: 40, borderRadius: 40, backgroundColor: t.colors.accentSoft }} />
      ) : null}
      <View
        style={{
          width: here ? 30 : 24,
          height: here ? 30 : 24,
          borderRadius: 30,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: here ? t.colors.btn : done ? t.colors.accentSoft : t.colors.bg,
          borderWidth: here ? 0 : 1.5,
          borderColor: done ? t.colors.accent : t.colors.line,
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

/**
 * The top-up bar: slide to add a share of the poster's own price on top, so the
 * post stands out. Workers only ever see the one total. Each stop is also a tap
 * target under the track, for anyone who would rather not drag.
 */
function TopUpBar({
  stop,
  onChange,
  base,
  price,
  feeRate,
}: {
  stop: number;
  onChange: (stop: number) => void;
  base: number;
  price: number;
  feeRate: number;
}) {
  const t = useTheme();
  const pct = TOP_UP_STOPS[stop] ?? 0;
  const fee = Math.round(price * feeRate);
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="trending" size={15} color={t.colors.accentDeep} strokeWidth={2.4} />
            <RNText style={tx('800', 14, t.colors.ink)}>Top up</RNText>
          </View>
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 1 })}>Slide to add a little extra and stand out</RNText>
        </View>
        <View
          style={{
            minWidth: 60,
            height: 30,
            paddingHorizontal: 10,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pct ? t.colors.btn : t.colors.surface2,
          }}
        >
          <RNText style={tx('800', 14, pct ? t.colors.onBtn : t.colors.muted, { fontVariant: ['tabular-nums'] })}>
            {pct ? `+${pct}%` : 'None'}
          </RNText>
        </View>
      </View>
      <View style={{ marginTop: 8 }}>
        <Slider value={stop} min={0} max={TOP_UP_STOPS.length - 1} step={1} onChange={onChange} accessibilityLabel="Top up percentage" />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -8 }}>
        {TOP_UP_STOPS.map((p, i) => (
          <Pressable
            key={p}
            onPress={() => onChange(i)}
            accessibilityRole="button"
            accessibilityLabel={p ? `Top up ${p} percent` : 'No top up'}
            accessibilityState={{ selected: i === stop }}
            hitSlop={6}
            style={{ width: 36, height: 28, alignItems: 'center', justifyContent: 'center' }}
          >
            <RNText style={tx(i === stop ? '800' : '600', 11, i === stop ? t.colors.accentDeep : t.colors.muted, { fontVariant: ['tabular-nums'] })}>
              {p ? `+${p}%` : '0%'}
            </RNText>
          </Pressable>
        ))}
      </View>
      <RNText style={tx('500', 12, t.colors.text, { marginTop: 4, textAlign: 'center' })}>
        {pct ? `${rupees(base)} + ${rupees(price - base)} top up = ` : 'Workers see '}
        <RNText style={tx('800', 12, t.colors.ink)}>{rupees(price)}</RNText>
        {` · with the ${Math.round(feeRate * 100)}% fee, ${rupees(price + fee)} is held`}
      </RNText>
    </View>
  );
}
