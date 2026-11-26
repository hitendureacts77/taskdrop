import { useEffect, useMemo, useState } from 'react';
import { Badge, BackButton, EmptyState, IconButton, TopBar, systemHeader, timeAgo, timeLeft } from '../components/kit';
import { ReportSheet } from '../components/ReportSheet';
import { TaskQuestions } from '../components/TaskQuestions';
import { Icon } from '../components/Icon';
import { View, Text as RNText, Pressable, TextInput, Platform } from 'react-native';
import { findContactIssue, maskContacts, offerIssueMessage } from '../lib/mask';
import { Screen, Card, Button, formatINR, cardSurface } from '../components/ui';
import { AmountField } from '../components/AmountField';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { isNeedsAccount, needAccount } from '../lib/guest';
import {
  placeBid,
  canQuoteOn,
  getTaskDetail,
  getPosterStats,
  getProfile,
  getTask,
  getMyBid,
  type Bid,
  type Profile,
  type Task,
} from '../data/api';
import { PRICE_LIMITS, distanceKm, formatDistance } from '@taskdrop/rules';
import { priceNote } from '../lib/limits';
import { ShareSheet, useShare } from '../components/ShareSheet';
import { taskUrl } from '../lib/links';
import { TASK_UNAVAILABLE } from '../lib/taskLink';
import { noteFirstAction } from '../lib/appPrompt';
import { type Theme } from '../theme';
import type { FeedRow } from './HomeScreen';
import { FadeIn, tx } from '../components/primitives';
import { TaskDescription } from '../components/TaskDescription';
import { TaskMediaThumb } from '../components/TaskMediaThumb';
import { PersonSheet } from '../components/PersonSheet';
import { BidSheet } from '../components/BidSheet';
import { DateTimeSheet, formatDeadline } from '../components/DateTimeSheet';
import { roughPlace } from '../lib/place';
import { AvatarPresence, PresenceLabel } from '../components/PresenceDot';
import { HuntFinderPanel } from '../components/Hunt';
import { isHunt } from '../lib/hunt';
import { OFFER_COPY, isDuplicateOfferError } from '../lib/offerState';
import { taskPageView } from '../lib/taskView';
import { noteMyOffer } from '../lib/useMyOffers';
import { useLayout } from '../lib/layout';
import { TwoPane } from '../components/TwoPane';
import { useDesktopHeaderPortal } from '../components/pageHeader';
import { useFees } from '../lib/useFees';
import { pctWords } from '../lib/heldWords';

/**
 * Task detail — pixel parity with docs/design/_design_markup.html lines
 * 706-751 (back/share row, identity row, tag, title, body, media pair,
 * price/complete-by row, detail rows, masked-contacts note). The bottom
 * ±₹ quote stepper is kept from the previous implementation per brief —
 * the markup's own CTA here just opens a separate quote sheet that isn't
 * part of this app's navigation graph, so the existing inline stepper
 * (docs/design/_design_source.jsx lines 436-454 behaviour) stays as the
 * single place a quote/offer gets composed.
 */

type Detail = {
  id?: string;
  who: string;
  rating: string;
  whoMeta: string;
  tag: 'SERVICES' | 'PRODUCTS' | 'LOCAL HELP';
  /** The category the list card shows; the eyebrow uses it when there is one (B179). */
  category?: string;
  title: string;
  body: string;
  amountMinor: number;
  by: string | null;
  hasMedia: boolean;
  glyph: '▶' | '▤' | '';
  mediaPath: string | null;
  mediaKind: 'image' | 'video' | null;
  mediaSeconds: number | null;
  dur: string | null;
  /** The poster's options, as short labels (Flash Drop, Crew 1 of 3...). */
  options?: string[];
};

// Fallbacks mirror _design_source.jsx `fallbackDetail` (converted to paise).
const FALLBACK_WORKER: Detail = {
  who: 'Customer 9014',
  rating: '4.8',
  whoMeta: '31 requests posted · 3.2 km away',
  tag: 'PRODUCTS',
  title: 'Vintage 35mm film camera',
  body: 'Working SLR, clean viewfinder, tested shutter. Pentax or Olympus preferred, lens included.',
  amountMinor: 450000,
  by: '9 Sep, 6 PM',
  hasMedia: false,
  mediaPath: null,
  mediaKind: null,
  mediaSeconds: null,
  glyph: '▶',
  dur: '0:34',
};

const FALLBACK_POSTER: Detail = {
  who: 'Worker 3315',
  rating: '4.9',
  whoMeta: '61 jobs done · 4 km away',
  tag: 'SERVICES',
  title: 'Bespoke carpentry and joinery',
  body: 'Ten years of joinery. Wardrobes, shelving, alcove units, on-site fitting included.',
  amountMinor: 120000,
  by: null,
  hasMedia: false,
  mediaPath: null,
  mediaKind: null,
  mediaSeconds: null,
  glyph: '▤',
  dur: null,
};

const QUOTE_STEP_MINOR = 5000; // ₹50
const MIN_QUOTE_MINOR = PRICE_LIMITS.MIN_MINOR; // ₹20, the smallest offer

function tagInk(t: Theme, tag: Detail['tag']): string {
  if (tag === 'SERVICES') return t.colors.accentDeep;
  if (tag === 'PRODUCTS') return t.colors.ink;
  return t.colors.muted;
}

function isFeedRow(v: unknown): v is FeedRow {
  return !!v && typeof v === 'object' && 'title' in v && 'amountMinor' in v;
}

/**
 * A shared link to a task that does not exist or is closed (B148): a plain message and a way back, not silently Home.
 */
function TaskUnavailable() {
  const { back, go } = useNav();
  return (
    <Screen padded={false}>
      <TopBar title="Task" onBack={back} />
      <EmptyState icon="briefcase" title={TASK_UNAVAILABLE} body="It may have been closed or removed." actionLabel="Go to Home" onAction={() => go('home')} />
    </Screen>
  );
}

export function TaskDetailScreen() {
  const { params } = useNav();
  return params.unavailable === true ? <TaskUnavailable /> : <TaskDetailBody />;
}

function TaskDetailBody() {
  const t = useTheme();
  const { params, back, go } = useNav();
  const { mode } = useMode();
  const { flash, celebrate } = useActions();
  const { userId, guest } = useAuth();
  const [busy, setBusy] = useState(false);
  const worker = mode === 'worker';
  // Wide desktop: the task on the left, the price, offer and poster on the right (components/TwoPane.tsx).
  const { twoPane: split, contentWidth } = useLayout();
  // Web, Android browsers: the one-time "get the app" sheet comes after a first look at a task.
  useEffect(() => {
    noteFirstAction();
  }, []);

  const detail: Detail = useMemo(() => {
    const row = params.row;
    if (isFeedRow(row)) {
      return {
        id: row.id,
        who: row.who,
        rating: row.rating,
        whoMeta: row.whoMeta,
        tag: row.tag,
        ...(row.category ? { category: row.category } : {}),
        title: row.title,
        body: row.body,
        amountMinor: row.amountMinor,
        by: row.by,
        hasMedia: row.hasMedia,
        glyph: row.glyph,
        mediaPath: row.mediaPath,
        mediaKind: row.mediaKind,
        mediaSeconds: row.mediaSeconds,
        dur: row.dur,
        options: row.options ?? [],
      };
    }
    return worker ? FALLBACK_WORKER : FALLBACK_POSTER;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.row]);

  const [quote, setQuote] = useState(detail.amountMinor);
  // A worker either accepts the posted price (the stepper stays hidden and the offer is the budget) or chooses to
  // send a counteroffer (the stepper opens at the budget). A task with no price posted can only be a quote.
  const [counterOn, setCounterOn] = useState(false);
  const counterMode = counterOn || detail.amountMinor <= 0;
  useEffect(() => {
    if (!counterOn) setQuote(detail.amountMinor);
  }, [counterOn, detail.amountMinor]);

  // Only a real row has a uuid; sample rows keep the design copy.
  const realId = detail.id && /^[0-9a-f-]{36}$/i.test(detail.id) ? detail.id : null;

  const share = useShare(flash);
  const fees = useFees();
  const [me, setMe] = useState<Profile | null>(null);
  const [showPerson, setShowPerson] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [otherId, setOtherId] = useState<string | null>(null);
  const [other, setOther] = useState<{
    name: string;
    record: string;
    rating: number;
    ratingCount: number;
    locLabel: string | null;
    locLat: number | null;
    locLng: number | null;
    lastSeen: string | null;
  } | null>(null);
  // The task as the database has it. The feed row is a summary — it carries no
  // description and, until now, the fetched task was used only for the poster
  // and then discarded, so a worker deciding whether to quote could see neither
  // the description nor the photo.
  // Why this person cannot send a new offer here, asked before the button is drawn.
  // "The task closed" or "you already sent an offer" (then the offer is fetched so it can be edited) —
  // a worker looking at his own request is redirected to the poster side instead of refused.
  const [verdict, setVerdict] = useState<{ code: 'own' | 'closed' | 'duplicate'; reason: string } | null>(null);
  const [myOffer, setMyOffer] = useState<Bid | null>(null);
  const [live, setLive] = useState<{
    body: string;
    mediaPath: string | null;
    mediaKind: 'image' | 'video' | null;
    mediaSeconds: number | null;
    /** Where the job is (rounded for strangers by the database), not where the poster lives. */
    lat: number | null;
    lng: number | null;
    /** A request someone posted, or a service someone offers. The page is drawn by this, not only by Hire/Earn. */
    kind: 'request' | 'service' | null;
    /** When it is due, when it was posted, and how it is hired (the desktop page's chips and stat strip). */
    dueAt: string | null;
    createdAt: string | null;
    auto: boolean;
    /** Still OPEN (plan 1.19 J): a passed date never hides it. */
    open: boolean;
  } | null>(null);
  const [huntTask, setHuntTask] = useState<Task | null>(null);

  useEffect(() => {
    if (!realId || (!userId && !guest)) return;
    let alive = true;
    void (async () => {
      try {
        // Whether this worker may quote is asked beside the task, not after it: one round trip, not two.
        const [mine, td, verdictNow] = await Promise.all([
          userId ? getProfile(userId) : null,
          getTaskDetail(realId),
          worker && userId ? canQuoteOn(realId, userId) : null,
        ]);
        if (!alive) return;
        setMe(mine);
        // A City Hunt takes finds, not offers (D19); its own panel replaces the offer box.
        setHuntTask(td?.task && isHunt(td.task) ? td.task : null);
        if (td?.task && isHunt(td.task) && userId && td.task.poster_id === userId) {
          go('taskManage', { taskId: realId, title: td.task.title });
          return;
        }
        if (td?.task) {
          const kind = td.task.media_kind;
          setLive({
            body: td.task.description ?? '',
            mediaPath: td.task.media_path ?? null,
            mediaKind: kind === 'image' || kind === 'video' ? kind : null,
            mediaSeconds: td.task.media_seconds ?? null,
            lat: td.task.loc_lat ?? null,
            lng: td.task.loc_lng ?? null,
            kind: td.task.kind === 'request' || td.task.kind === 'service' ? td.task.kind : null,
            dueAt: td.task.due_at ?? null,
            createdAt: td.task.created_at ?? null,
            auto: td.task.assignment_mode === 'auto',
            open: td.task.status === 'OPEN',
          });
        }
        if (verdictNow) {
          if (!verdictNow.allowed && verdictNow.code === 'own') {
            // Not a refusal — the wrong screen. Your own request has a poster
            // side, and what you want there is the quotes it has received.
            go('compare', {
              title: td?.task.title ?? '',
              priceMinor: td?.task.benchmark_minor ?? 0,
              taskId: realId,
            });
            return;
          }
          setVerdict(verdictNow.allowed ? null : { code: verdictNow.code, reason: verdictNow.reason });
          if (!verdictNow.allowed && verdictNow.code === 'duplicate' && userId) {
            const sent = await getMyBid(realId, userId).catch(() => null);
            if (!alive) return;
            if (sent) {
              setMyOffer(sent);
              noteMyOffer(userId, realId);
            }
          }
        }
        const posterId = td?.task.poster_id;
        if (!posterId) return;
        setOtherId(posterId);
        const stats = await getPosterStats(posterId);
        if (!alive) return;
        const n = stats.requestsPosted;
        setOther({
          name: stats.profile?.display_name ?? 'Customer',
          record: n + (n === 1 ? ' request posted' : ' requests posted'),
          rating: Number(stats.profile?.poster_rating_avg ?? 0),
          ratingCount: stats.profile?.poster_rating_count ?? 0,
          locLabel: roughPlace(stats.profile?.loc_label),
          locLat: stats.profile?.loc_lat ?? null,
          locLng: stats.profile?.loc_lng ?? null,
          lastSeen: stats.profile?.last_seen_at ?? null,
        });
      } catch {
        /* leave the design copy in place */
      }
    })();
    return () => {
      alive = false;
    };
  }, [realId, userId, guest, worker, go]);

  const body = live?.body || detail.body;
  const mediaPath = live ? live.mediaPath : detail.mediaPath;
  const mediaKind = live ? live.mediaKind : detail.mediaKind;
  const mediaSeconds = live ? live.mediaSeconds : detail.mediaSeconds;
  // An open task with no date, or whose date passed: the server switches it to no fixed date within
  // 15 minutes (plan 1.19 J and K), so it reads the same either way.
  const noDate = !!live && live.open && (!live.dueAt || new Date(live.dueAt).getTime() <= Date.now());
  const shownBy = noDate ? 'No fixed date' : detail.by;

  // A request carries the poster's budget; a service listing carries the worker's rate.
  // Drawn by the task's kind: in Hire mode someone's request still shows its budget, not a rate.
  const view = taskPageView(mode, live?.kind);
  const priceLabel = huntTask ? 'REWARD FOR THE FINDER' : view.asRequest ? 'BUDGET' : 'THEIR RATE';
  const delta = quote - detail.amountMinor;
  // W2-11 / W3-11: an offer outside the limits gets the post flow's plain words, and what was typed is kept as typed.
  const quoteNote = priceNote(quote / 100);
  const underMin = quoteNote !== null;
  const deltaText = quoteNote
    ? quoteNote
    : delta === 0 ? 'same as asked' : delta > 0 ? `+${formatINR(delta)} above` : `−${formatINR(-delta)} below`;
  const deltaColor = underMin ? t.colors.signalDeep : delta === 0 ? t.colors.muted : delta > 0 ? t.colors.gold : t.colors.accent;

  // The design's sample rows carry their record inside a display string; a real
  // task has a real poster behind it, so use them rather than parsing that.
  const whoMetaParts = detail.whoMeta.split(' · ');
  const sampleRecord = whoMetaParts[0] ?? null;
  const sampleDistance = whoMetaParts[1] ?? null;

  const recordLabel = view.asRequest ? 'Requests posted' : 'Jobs completed';
  const recordValue = other
    ? other.ratingCount > 0
      ? other.record + ' · ★ ' + other.rating.toFixed(1)
      : other.record + ' · no reviews yet'
    : (sampleRecord ?? 'New here');

  // Never claim "nearby" when neither side has shared a location.
  const distanceValue =
    formatDistance(
      distanceKm(
        { lat: me?.loc_lat ?? null, lng: me?.loc_lng ?? null },
        // The job's own place. The poster's saved home is only a fallback for a task with no place
        // (it said "2368 km" for a job round the corner when the poster's profile was elsewhere).
        live ? { lat: live.lat, lng: live.lng } : { lat: other?.locLat ?? null, lng: other?.locLng ?? null },
      ),
    ) ??
    (live && live.lat === null ? 'Remote / online' : null) ??
    other?.locLabel ??
    sampleDistance ??
    'Not shared';

  // Identity in the header comes from the same loaded profile as the rows
  // below, so the two can never disagree.
  const displayName = other?.name ?? detail.who;
  const ratingText = other
    ? other.ratingCount > 0
      ? '★ ' + other.rating.toFixed(1)
      : null
    : detail.rating && detail.rating !== '—'
      ? '★ ' + detail.rating
      : null;
  const displayMeta = other?.locLabel ?? detail.whoMeta;
  const detailRows = [
    { label: recordLabel, value: recordValue },
    { label: 'Distance', value: distanceValue },
  ];

  // Asking for the posted price is an offer; asking for a different one is a
  // counteroffer, and the button says which, so nobody wonders what it sends.
  const countering = quote !== detail.amountMinor;
  // A worker chooses price only, or a price with a short proposal. The button
  // always says what it sends, with the amount.
  const [withProposal, setWithProposal] = useState(false);
  const [proposal, setProposal] = useState('');
  const proposalShort = withProposal && proposal.trim().length < 10;
  // No fixed date (plan 1.19 J and K): the worker may say when they can finish. Optional; if the customer
  // accepts, the task takes this date (migration 216).
  const [finishBy, setFinishBy] = useState<Date | null>(null);
  const [finishPicker, setFinishPicker] = useState(false);
  // W2-2: a phone number or email in the proposal is refused as it is typed, as in a post or the bio (the
  // server refuses it too).
  const proposalIssue = withProposal ? findContactIssue(proposal) : null;
  const cta = `${countering ? 'Send counteroffer' : 'Send offer'}${withProposal ? ' with proposal' : ''} · ${formatINR(quote)}`;

  // The detailed bid: a proposal, hours and a delivery date on top of the
  // price. Same placeBid underneath, so the same checks apply.
  const [bidTask, setBidTask] = useState<Task | null>(null);
  const openBid = async () => {
    if (!realId) return flash('This is a sample task — post a real one to send an offer');
    const task = await getTask(realId).catch(() => null);
    if (!task) return flash('This task is no longer available');
    setBidTask(task);
  };


  const sendQuote = async () => {
    if (busy) return;
    if (worker) {
      if (!realId) return flash('This is a sample task — post a real one to send an offer');
      if (guest) return needAccount('offer', () => void sendQuote());
      if (!userId) return flash('Sign in to send an offer');
      if (quoteNote) return flash(quoteNote);
      if (proposalShort) return flash('Tell the customer a little about how you will do it');
      if (proposalIssue) return flash(offerIssueMessage(proposalIssue));
      if (noDate && finishBy && finishBy.getTime() < Date.now() - 5 * 60_000) return flash('Pick a finish time from now on');
      setBusy(true);
      try {
        await placeBid({
          taskId: realId,
          workerId: userId,
          priceMinor: quote,
          timeLimitMinutes: 240,
          ...(withProposal ? { message: maskContacts(proposal.trim()).text } : null),
          ...(noDate && finishBy ? { proposedDueAt: finishBy.toISOString() } : null),
        });
        noteMyOffer(userId, realId);
        celebrate((countering ? 'Counteroffer sent · ' : 'Offer sent · ') + formatINR(quote));
        go('orders');
      } catch (e) {
        // placeBid already turns a policy refusal into a sentence. Whatever it
        // is, it also means the quote box should not still be offered.
        if (isNeedsAccount(e)) return;
        if (isDuplicateOfferError(e)) {
          // One offer per task: show the sent offer with an Edit button instead of a raw error.
          const sent = await getMyBid(realId, userId).catch(() => null);
          if (sent) setMyOffer(sent);
          setVerdict({ code: 'duplicate', reason: OFFER_COPY.edit.note });
          return;
        }
        const msg = e instanceof Error ? e.message : 'Could not send the offer';
        setVerdict({ code: 'closed', reason: msg });
        flash(msg);
      } finally {
        setBusy(false);
      }
    }
  };

  // Reverse direction: the customer asks this worker to do a task of their own. It starts a new request with
  // the worker named first, so the same person can be sent many tasks (each is its own request).
  const sendThemATask = () => {
    if (!otherId) return flash('This is a sample listing');
    go('aiPost', { prompt: `${detail.title}: `, preferWorker: { id: otherId, name: displayName } });
  };

  // Report and share: in the system header on phones, in the page's top row on the web.
  const actions = (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {realId && otherId !== userId ? <IconButton icon="flag" label="Report this task" onPress={() => setReporting(true)} /> : null}
      <IconButton
        icon="share"
        label="Share this task"
        onPress={() =>
          share.start(
            realId && taskUrl(realId)
              ? {
                  title: detail.title,
                  message: `${detail.title} · ${formatINR(detail.amountMinor)} on TaskDrop`,
                  url: taskUrl(realId)!,
                }
              : null,
          )
        }
      />
    </View>
  );

  // Desktop (two panes, D31 board WebTaskPage): "< Find work / category" in the page header, with Share and
  // Report as outlined buttons on its right.
  const outlined = (icon: 'share' | 'flag', label: string, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => ({
        height: 40,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: hovered ? t.colors.accentBorder : t.colors.line,
        backgroundColor: t.colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      })}
    >
      <Icon name={icon} size={15} color={t.colors.ink} strokeWidth={1.9} />
      <RNText style={tx('700', 13.5, t.colors.ink)}>{icon === 'share' ? 'Share' : 'Report'}</RNText>
    </Pressable>
  );
  // Desktop web too narrow for two panes (docs/design/desktop-web/PLAN.md, package 8): the task's title, the back
  // link, Report and Share go into the page header, and the content sits on cards. `undefined` off a desktop
  // (phone, tablet, apps): then nothing below changes.
  const deskHeader = useDesktopHeaderPortal(
    split
      ? {
          crumbs: [
            { label: worker ? 'Find work' : 'Back', onPress: back },
            { label: detail.category ?? (detail.tag === 'SERVICES' ? 'Services' : detail.tag === 'PRODUCTS' ? 'Products' : 'Local help') },
          ],
          right: (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {outlined('share', 'Share this task', () =>
                share.start(
                  realId && taskUrl(realId)
                    ? { title: detail.title, message: `${detail.title} · ${formatINR(detail.amountMinor)} on TaskDrop`, url: taskUrl(realId)! }
                    : null,
                ),
              )}
              {realId && otherId !== userId ? outlined('flag', 'Report this task', () => setReporting(true)) : null}
            </View>
          ),
        }
      : { title: detail.title, onBack: back, right: actions },
  );
  const desk = deskHeader !== undefined;
  // The header holds one line: a title too long for it stays in full in the first card as well.
  const titleInPage = !desk || detail.title.length > 56;
  const deskCard = { ...cardSurface(t, 18), padding: 22 } as const;

  const headerRow = (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <BackButton onBack={back} right={actions} />
          {/* Two panes: report and share sit with the offer, on the right. */}
          {systemHeader || split ? null : actions}
        </View>
  );

  const posterCard = (
        <Pressable
          onPress={() => setShowPerson(true)}
          accessibilityRole="button"
          accessibilityLabel={`About ${displayName}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 13,
            marginTop: split ? 12 : desk ? 0 : 16,
            paddingBottom: split || desk ? 0 : 15,
            borderBottomWidth: split || desk ? 0 : 1,
            borderBottomColor: t.colors.line,
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              backgroundColor: t.colors.btn,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RNText style={tx('800', 17, t.colors.onBtn)}>{(displayName || '?').trim().charAt(0).toUpperCase()}</RNText>
            {other ? <AvatarPresence lastSeen={other.lastSeen} ring={desk ? t.colors.surface : t.colors.bg} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <RNText style={tx('700', 15, t.colors.ink)}>{displayName}</RNText>
              {ratingText ? (
                <RNText style={tx('400', 12, t.colors.muted)}>{ratingText}</RNText>
              ) : null}
            </View>
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>{displayMeta}</RNText>
            {other ? (
              <View style={{ marginTop: 5 }}>
                <PresenceLabel lastSeen={other.lastSeen} />
              </View>
            ) : null}
          </View>
          <Icon name="chevronRight" size={16} color={t.colors.muted} />
        </Pressable>
  );

  const titleBlock = (
        <>
        <RNText style={tx('700', 10, tagInk(t, detail.tag), { letterSpacing: 1.6, marginTop: desk ? 0 : 16 })}>
          {detail.category ? detail.category.toUpperCase() : detail.tag}
        </RNText>
        {titleInPage ? (
          <RNText style={tx('800', 25, t.colors.ink, { letterSpacing: -0.7, marginTop: 8, lineHeight: 30 })}>{detail.title}</RNText>
        ) : null}
        {body ? (
          <View style={{ marginTop: titleInPage ? 14 : 10 }}>
            <TaskDescription text={body} title={detail.title} />
          </View>
        ) : null}

        {/* One attachment, shown properly. This used to be two grey squares
            with a glyph in them — a picture of a photo, not the photo. */}
        {mediaPath && (
          <View style={{ marginTop: 16, height: 210 }}>
            <TaskMediaThumb path={mediaPath} kind={mediaKind} seconds={mediaSeconds} radius={20} />
          </View>
        )}
        </>
  );

  const priceRow = (
        <View
          style={{
            flexDirection: 'row',
            marginTop: split || desk ? 0 : 18,
            borderTopWidth: desk ? 0 : 1,
            borderTopColor: t.colors.line,
            borderBottomWidth: desk ? 0 : 1,
            borderBottomColor: t.colors.line,
          }}
        >
          <View style={{ flex: 1, paddingVertical: 14 }}>
            <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2 })}>{priceLabel}</RNText>
            <RNText style={tx('800', 22, t.colors.accentDeep, { marginTop: 4, fontVariant: ['tabular-nums'], letterSpacing: -0.4 })}>{formatINR(detail.amountMinor)}</RNText>
          </View>
          {/* Only shown when there is a real deadline. A worker's service listing
              has none — the poster sets it when engaging — so the column is
              omitted rather than showing a placeholder. */}
          {shownBy ? (
            <View style={{ flex: 1, paddingVertical: 14 }}>
              <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2 })}>COMPLETE BY</RNText>
              <RNText style={tx('700', 20, t.colors.ink, { marginTop: 4, letterSpacing: -0.3 })}>{shownBy}</RNText>
            </View>
          ) : null}
        </View>
  );

  // A worker on a task with no fixed date gives their own finish date in the offer (plan 1.19 J).
  const finishNote = worker && noDate ? (
    <RNText style={tx('500', 13, t.colors.muted, { marginTop: 10, lineHeight: 18 })}>Say in your offer when you can finish it.</RNText>
  ) : null;
  const optionsRow = detail.options?.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {detail.options.map((o) => (
              <Badge key={o} label={o} tone={o === 'Flash Drop' ? 'signal' : 'accent'} />
            ))}
          </View>
        ) : null;

  const detailRowsBlock = (
        <>
        {detailRows.map((r) => (
          <View
            key={r.label}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: t.colors.line,
            }}
          >
            <RNText style={tx('400', 14, t.colors.muted)}>{r.label}</RNText>
            <RNText style={tx('700', 14, t.colors.ink)}>{r.value}</RNText>
          </View>
        ))}

        <RNText style={tx('400', 12, t.colors.muted, { lineHeight: 18, marginTop: 13 })}>
          Phone numbers stay hidden until the work starts.
        </RNText>
        </>
  );

  const questionsBlock =
    worker && realId && !verdict ? (
      <TaskQuestions taskId={realId} role="ask" posterName={other?.name} style={{ marginTop: desk ? 0 : t.spacing.xl }} />
    ) : null;

  const detailBlock = (
        <>
        {detailRowsBlock}
        {questionsBlock}
        </>
  );

  // Two panes: the offer card sits at the top of the right column, with the poster card under it. Desktop's one
  // column of cards spaces them itself.
  const offerGap = split
    ? { marginTop: 0, marginBottom: 12 }
    : desk
      ? { marginTop: 0, marginBottom: 0 }
      : { marginTop: t.spacing.xl, marginBottom: t.spacing.xl };
  const offerPanel = huntTask ? (
          <View style={offerGap}>
            <HuntFinderPanel task={huntTask} />
          </View>
        ) : worker && verdict ? (
          /* Say why instead of showing a price box that cannot be sent. The
             reasons — closed, already sent an offer — each leave the person
             somewhere different to go next. */
          <Card style={offerGap}>
            <RNText style={tx('600', 13, t.colors.muted, { marginBottom: 8 })}>
              {verdict.code === 'duplicate' ? (myOffer?.is_locked ? 'OFFER ACCEPTED' : 'OFFER SENT') : 'CLOSED FOR OFFERS'}
            </RNText>
            <RNText style={tx('600', 15, t.colors.ink, { lineHeight: 22 })}>
              {verdict.code === 'duplicate'
                ? myOffer?.is_locked
                  ? OFFER_COPY.accepted.note
                  : myOffer
                    ? `Your offer: ${formatINR(myOffer.price_minor)}. You can change the price, message, hours or date until the customer picks someone.`
                    : verdict.reason
                : verdict.reason}
            </RNText>
            {verdict.code === 'duplicate' && myOffer?.is_locked ? null : (
              <Button
                label={verdict.code === 'duplicate' ? OFFER_COPY.edit.button! : OFFER_COPY.closed.button!}
                onPress={() => (verdict.code === 'duplicate' ? void openBid() : go('explore'))}
                style={{ marginTop: t.spacing.lg }}
              />
            )}
          </Card>
        ) : view.panel === 'switchToEarn' ? (
          /* Hire mode on someone's request: it is their ask, not a service. Offers are sent from Earn mode. */
          <Card style={offerGap}>
            <RNText style={tx('700', 11, t.colors.muted, { marginBottom: 10, letterSpacing: 1.2 })}>
              {otherId && otherId === userId ? 'YOUR REQUEST' : 'SEND AN OFFER'}
            </RNText>
            <RNText style={tx('600', 15, t.colors.ink, { lineHeight: 22 })}>
              {otherId && otherId === userId
                ? 'This is your own request.'
                : `${displayName} is asking for help with this. Switch to Earn to send an offer.`}
            </RNText>
          </Card>
        ) : view.panel === 'sendTask' ? (
          /* Reverse direction: a customer looking at a worker's service. They do not "send an offer" to a
             listing; they post their own task and the worker gets the first 10 minutes to answer it. */
          <Card style={offerGap}>
            <RNText style={tx('700', 11, t.colors.muted, { marginBottom: 10, letterSpacing: 1.2 })}>
              {otherId && otherId === userId ? 'YOUR SERVICE' : 'SEND THEM A TASK'}
            </RNText>
            {otherId && otherId === userId ? (
              <RNText style={tx('600', 15, t.colors.ink, { lineHeight: 22 })}>This is your own service.</RNText>
            ) : (
              <>
                <RNText style={tx('600', 15, t.colors.ink, { lineHeight: 22 })}>
                  {`Want ${displayName} to do this? Post your task and ${displayName} gets the first 10 minutes to send an offer. You can send them more than one task.`}
                </RNText>
                <Button label={`Send ${displayName} a task`} onPress={sendThemATask} style={{ marginTop: t.spacing.lg }} />
              </>
            )}
          </Card>
        ) : (
        <Card style={offerGap}>
          <RNText style={tx('700', 11, t.colors.muted, { marginBottom: 10, letterSpacing: 1.2 })}>
            {countering ? 'YOUR COUNTEROFFER' : 'YOUR OFFER'}
          </RNText>
          {worker && detail.amountMinor > 0 ? (
            <View style={{ gap: 8, marginBottom: 14 }}>
              {([
                [`Accept ${formatINR(detail.amountMinor)}`, false],
                ['Send a counteroffer', true],
              ] as const).map(([label, on]) => {
                const picked = counterOn === on;
                return (
                  <Pressable
                    key={label}
                    onPress={() => {
                      setCounterOn(on);
                      if (!on) setQuote(detail.amountMinor);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: picked, checked: picked }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      minHeight: 48,
                      paddingHorizontal: 14,
                      borderRadius: 14,
                      borderWidth: 1.5,
                      borderColor: picked ? t.colors.accent : t.colors.line,
                      backgroundColor: picked ? t.colors.accentSoft : t.colors.surface,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        borderWidth: 2,
                        borderColor: picked ? t.colors.accent : t.colors.line,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {picked ? <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: t.colors.accent }} /> : null}
                    </View>
                    <RNText style={tx('700', 14.5, picked ? t.colors.accentDeep : t.colors.ink, { flex: 1 })}>{label}</RNText>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {worker && realId ? (
            <View style={{ flexDirection: 'row', backgroundColor: t.colors.surface2, borderRadius: 14, padding: 4, gap: 4, marginBottom: 14 }}>
              {([['Price only', false], ['Price + proposal', true]] as const).map(([label, on]) => (
                <Pressable
                  key={label}
                  onPress={() => setWithProposal(on)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: withProposal === on }}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 11,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: withProposal === on ? t.colors.surface : 'transparent',
                    borderWidth: withProposal === on ? 1 : 0,
                    borderColor: t.colors.line,
                  }}
                >
                  <RNText style={tx('700', 13.5, withProposal === on ? t.colors.ink : t.colors.muted)}>{label}</RNText>
                </Pressable>
              ))}
            </View>
          ) : null}
          {worker && !counterMode ? (
            <View style={{ alignItems: 'center' }}>
              <RNText style={tx('800', 34, t.colors.ink, { letterSpacing: -0.8 })}>{formatINR(detail.amountMinor)}</RNText>
              <RNText style={tx('500', 12, t.colors.muted, { marginTop: 2 })}>The posted price</RNText>
            </View>
          ) : (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Pressable
              onPress={() => setQuote((q) => Math.max(MIN_QUOTE_MINOR, q - QUOTE_STEP_MINOR))}
              accessibilityRole="button"
              accessibilityLabel="Lower your offer"
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: t.colors.line,
                backgroundColor: t.colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
                transform: [{ scale: pressed ? 0.92 : 1 }],
              })}
            >
              <Icon name="minus" size={18} color={t.colors.ink} strokeWidth={2.2} />
            </Pressable>

            <View style={{ flex: 1, alignItems: 'center' }}>
              <AmountField
                rupees={quote > 0 ? Math.round(quote / 100) : null}
                onChangeRupees={(r) => setQuote((r ?? 0) * 100)}
                min={0}
                style={tx('800', 34, t.colors.ink, { letterSpacing: -0.8 })}
              />
              <RNText style={tx('500', 12, deltaColor, { marginTop: 2 })}>{deltaText}</RNText>
            </View>

            <Pressable
              onPress={() => setQuote((q) => q + QUOTE_STEP_MINOR)}
              accessibilityRole="button"
              accessibilityLabel="Raise your offer"
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: t.colors.line,
                backgroundColor: t.colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
                transform: [{ scale: pressed ? 0.92 : 1 }],
              })}
            >
              <Icon name="plus" size={18} color={t.colors.ink} strokeWidth={2.2} />
            </Pressable>
          </View>
          )}

          {split && worker && realId && quote > 0 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: t.colors.accentSoft, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, marginTop: 14 }}>
              <RNText style={tx('500', 12.5, t.colors.accentDeep)}>You earn after the {pctWords(fees.commission)} fee</RNText>
              <RNText style={tx('800', 13, t.colors.accentDeep, { fontVariant: ['tabular-nums'] })}>{formatINR(Math.round(quote * (1 - fees.commission)))}</RNText>
            </View>
          ) : null}

          {worker && withProposal ? (
            <View style={{ marginTop: t.spacing.lg }}>
              <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, marginBottom: 6 })}>YOUR PROPOSAL</RNText>
              <View style={{ borderWidth: 1.5, borderColor: t.colors.accentBorder, backgroundColor: t.colors.surface, borderRadius: 14, padding: 12 }}>
                <TextInput
                  value={proposal}
                  onChangeText={setProposal}
                  multiline
                  maxLength={500}
                  placeholder="Say how you will do it and when you can start"
                  placeholderTextColor={t.colors.muted}
                  accessibilityLabel="Your proposal"
                  style={tx('400', 14, t.colors.ink, {
                    minHeight: 96,
                    padding: 0,
                    textAlignVertical: 'top',
                    lineHeight: 20,
                    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
                  })}
                />
                <RNText style={tx('400', 11.5, t.colors.muted, { alignSelf: 'flex-end', marginTop: 4 })}>{proposal.length} / 500</RNText>
              </View>
              {proposalIssue ? (
                <RNText accessibilityRole="alert" style={tx('600', 12, t.colors.signalDeep, { marginTop: 6, lineHeight: 17 })}>
                  {offerIssueMessage(proposalIssue)}
                </RNText>
              ) : null}
            </View>
          ) : (
            worker && realId ? (
              <RNText style={tx('400', 13, t.colors.muted, { marginTop: 14, textAlign: 'center' })}>
                Quick. The customer sees your price and your profile.
              </RNText>
            ) : null
          )}

          {worker && realId && noDate ? (
            <View style={{ marginTop: t.spacing.lg }}>
              <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2 })}>WHEN CAN YOU FINISH IT?</RNText>
              <RNText style={tx('500', 12.5, t.colors.muted, { marginTop: 4, lineHeight: 17 })}>
                This task has no fixed date. Tell the customer when you can finish: it becomes the task’s date if they choose you.
              </RNText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <Pressable
                  onPress={() => setFinishPicker(true)}
                  accessibilityRole="button"
                  accessibilityLabel={finishBy ? `Finish by ${formatDeadline(finishBy)}. Change it` : 'When can you finish it?'}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: finishBy ? t.colors.accent : t.colors.line, backgroundColor: finishBy ? t.colors.accentSoft : t.colors.surface, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12 }}
                >
                  <Icon name="clock" size={15} color={finishBy ? t.colors.accentDeep : t.colors.muted} strokeWidth={1.9} />
                  <RNText style={tx(finishBy ? '700' : '500', 13.5, finishBy ? t.colors.accentDeep : t.colors.muted, { flex: 1 })} numberOfLines={1}>
                    {finishBy ? `Finish by ${formatDeadline(finishBy)}` : 'Finish by (optional)'}
                  </RNText>
                </Pressable>
                {finishBy ? (
                  <IconButton icon="close" label="Clear the finish date" onPress={() => setFinishBy(null)} />
                ) : null}
              </View>
            </View>
          ) : null}

          <Button
            label={busy ? 'Sending…' : cta}
            disabled={busy || proposalShort || proposalIssue !== null || (worker && underMin)}
            onPress={sendQuote}
            style={{ marginTop: t.spacing.lg }}
          />
          <RNText style={tx('500', 12, t.colors.muted, { marginTop: 10, textAlign: 'center' })}>
            {countering
              ? 'Not happy with the price? Name your own. You can send one offer per task and edit it later.'
              : 'One offer per task. You can edit it later. Phone numbers stay hidden until the work starts.'}
          </RNText>
        </Card>
        );

  const sheets = (
      <>
      <BidSheet
        task={bidTask}
        visible={bidTask !== null}
        onClose={() => setBidTask(null)}
        onPlaced={() => {
          // An edit changes the price: refresh the "Your offer" card so it never shows the old one.
          if (realId && userId) void getMyBid(realId, userId).then((b) => b && setMyOffer(b)).catch(() => {});
          go('myTasks');
        }}
      />
      <DateTimeSheet
        visible={finishPicker}
        title="When can you finish it?"
        subtitle="The customer sees this on your offer."
        confirmLabel="Set finish date"
        initial={finishBy ?? undefined}
        onCancel={() => setFinishPicker(false)}
        onConfirm={(d) => { setFinishPicker(false); setFinishBy(d); }}
      />
      <ReportSheet
        visible={reporting}
        onClose={() => setReporting(false)}
        targetType="task"
        targetId={realId}
        personId={otherId && otherId !== userId ? otherId : null}
        personName={other?.name}
      />
      <ShareSheet visible={share.open} item={share.item} onClose={share.close} flash={flash} />

      <PersonSheet
        visible={showPerson}
        onClose={() => setShowPerson(false)}
        userId={otherId}
        name={displayName}
        meta={[other?.record, displayMeta].filter(Boolean).join(' · ') || displayMeta}
        rating={other?.rating ?? 0}
        ratingCount={other?.ratingCount ?? 0}
        // A worker is looking at whoever posted the task, and vice versa.
        role={view.asRequest ? 'poster' : 'worker'}
      />
      </>
  );

  // Desktop cards: the task (title card, details) on the left, the price, offer and poster on the right.
  const deskLeft = (top: number) => (
    <View style={{ paddingTop: top, gap: 16 }}>
      <View style={deskCard}>
        {titleBlock}
        {optionsRow}
        {finishNote}
      </View>
      <View style={{ ...deskCard, paddingVertical: 8 }}>{detailRowsBlock}</View>
      {questionsBlock}
    </View>
  );
  const deskRight = (top: number) => (
    <View style={{ paddingTop: top, gap: 16 }}>
      <View style={{ ...deskCard, paddingVertical: 0 }}>{priceRow}</View>
      {offerPanel}
      <View style={{ ...deskCard, padding: 18 }}>{posterCard}</View>
    </View>
  );

  if (split) {
    // An open task with no date (plan 1.19 K), or whose date passed (J): say so instead of a countdown.
    const timeLeftText = noDate ? 'No fixed date' : timeLeft(live?.dueAt);
    const remote = live ? live.lat === null : false;
    const posted = timeAgo(live?.createdAt);
    const chip = (key: string, icon: 'globe' | 'clock', label: string, tone: 'accent' | 'gold' | 'plain') => (
      <View
        key={key}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 5,
          paddingHorizontal: 11,
          borderRadius: 999,
          backgroundColor: tone === 'accent' ? t.colors.accentSoft : tone === 'gold' ? t.colors.goldSoft : t.colors.surface2,
        }}
      >
        <Icon name={icon} size={13} color={tone === 'accent' ? t.colors.accentDeep : tone === 'gold' ? t.colors.goldInk : t.colors.text} strokeWidth={1.9} />
        <RNText style={tx('700', 12.5, tone === 'accent' ? t.colors.accentDeep : tone === 'gold' ? t.colors.goldInk : t.colors.text)}>{label}</RNText>
      </View>
    );
    const stats: { label: string; value: string; money?: boolean }[] = [
      { label: priceLabel, value: formatINR(detail.amountMinor), money: true },
      ...(shownBy ? [{ label: 'COMPLETE BY', value: shownBy }] : []),
      { label: 'DISTANCE', value: distanceValue },
      ...(live && view.asRequest && !huntTask ? [{ label: 'HIRING', value: live.auto ? 'Auto-hire' : 'Open to offers' }] : []),
    ];
    // Two panes on a wide desktop (D31 board WebTaskPage): the task on the left, the offer and the poster on the
    // right, so the offer is in view without scrolling.
    return (
      <Screen padded={false}>
        {deskHeader}
        {/* The cards line up with the page header, 20 px in from the column edge. */}
        <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <TwoPane
          fixed="right"
          width={Math.round(Math.min(440, Math.max(340, contentWidth('feed') * 0.27)))}
          left={
            <FadeIn>
              <View style={[cardSurface(t), { padding: 24 }]}>
                <RNText style={tx('800', 11.5, tagInk(t, detail.tag), { letterSpacing: 1.2 })}>{detail.category ? detail.category.toUpperCase() : detail.tag}</RNText>
                <RNText accessibilityRole="header" style={tx('800', 30, t.colors.ink, { letterSpacing: -0.8, marginTop: 6, lineHeight: 36 })}>{detail.title}</RNText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                  {remote ? chip('remote', 'globe', 'Remote / online', 'accent') : null}
                  {timeLeftText && !huntTask ? chip('left', 'clock', timeLeftText === 'overdue' ? 'Overdue' : timeLeftText, noDate || timeLeftText === 'overdue' ? 'plain' : 'gold') : null}
                  {posted ? chip('posted', 'clock', `Posted ${posted}`, 'plain') : null}
                </View>
                <View style={{ flexDirection: 'row', marginTop: 20, borderWidth: 1, borderColor: t.colors.line, borderRadius: 12, overflow: 'hidden' }}>
                  {stats.map((x, i) => (
                    <View key={x.label} style={{ flex: 1, minWidth: 0, paddingVertical: 14, paddingHorizontal: 16, borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: t.colors.line }}>
                      <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1 })} numberOfLines={1}>{x.label}</RNText>
                      <RNText
                        style={x.money ? tx('800', 22, t.colors.accentDeep, { marginTop: 4, fontVariant: ['tabular-nums'], letterSpacing: -0.4 }) : tx('700', 16, t.colors.ink, { marginTop: 6 })}
                        numberOfLines={2}
                      >
                        {x.value}
                      </RNText>
                    </View>
                  ))}
                </View>
                {optionsRow}
                {finishNote}
                {body ? (
                  <View style={{ marginTop: 22 }}>
                    <RNText style={tx('800', 15, t.colors.ink, { marginBottom: 8 })}>What they need</RNText>
                    <TaskDescription text={body} title={detail.title} />
                  </View>
                ) : null}
                {mediaPath ? (
                  <View style={{ marginTop: 16, height: 210 }}>
                    <TaskMediaThumb path={mediaPath} kind={mediaKind} seconds={mediaSeconds} radius={20} />
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }}>
                  <Icon name="shield" size={14} color={t.colors.accentDeep} />
                  <RNText style={tx('400', 12.5, t.colors.muted)}>Phone numbers stay hidden until the work starts.</RNText>
                </View>
              </View>
              {worker && realId && !verdict ? <TaskQuestions taskId={realId} role="ask" posterName={other?.name} style={{ marginTop: 16 }} /> : null}
            </FadeIn>
          }
          right={
            <FadeIn>
              {offerPanel}
              <View style={[cardSurface(t), { padding: 16 }]}>
                <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2 })}>POSTED BY</RNText>
                {posterCard}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.colors.line }}>
                  <RNText style={tx('400', 13.5, t.colors.muted)}>{recordLabel}</RNText>
                  <RNText style={tx('700', 13.5, t.colors.ink, { flexShrink: 1, textAlign: 'right' })}>{recordValue}</RNText>
                </View>
              </View>
            </FadeIn>
          }
          single={null}
        />
        </View>
        {sheets}
      </Screen>
    );
  }

  if (desk) {
    // Desktop too narrow for two panes: one column of the same cards.
    return (
      <Screen scroll padded={false}>
        <FadeIn style={{ paddingHorizontal: 20, gap: 16 }}>
          {deskLeft(12)}
          {deskRight(0)}
        </FadeIn>
        {sheets}
        {deskHeader}
      </Screen>
    );
  }

  return (
    <Screen scroll padded={false}>
      <FadeIn style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        {headerRow}
        {posterCard}
        {titleBlock}
        {priceRow}
        {optionsRow}
        {finishNote}
        {detailBlock}
        {offerPanel}
      </FadeIn>
      {sheets}
    </Screen>
  );
}
