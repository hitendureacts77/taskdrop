import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated, Easing, Platform } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { onHero } from '../theme';
import { useFocusTick, useNav } from '../providers/NavProvider';
import { openPostedTask } from '../lib/taskRows';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import {
  attachPosters,
  countBidsByTask,
  getProfile,
  listMyTasks,
  listOpenTasks,
  myStats,
  updateProfile,
  type MyStats,
  type Task,
  type TaskWithPoster,
} from '../data/api';
import {
  listSavedTaskIds,
  nearbyPulse,
  recommendedTasks,
  remoteTasks,
  tasksNear,
  urgentTasks,
  setSaved,
  trendingCategories,
  type NearbyPulse,
  type TrendingCategory,
} from '../data/extras';
import { listGuestSaves, setGuestSaved } from '../lib/guestSaves';
import { TEMPLATES } from '../lib/taskBrief';
import { levelFor } from '../lib/levels';
import { taskToFeedRow } from '../lib/openTask';
import { useMyOffers } from '../lib/useMyOffers';
import { newOffers } from '../lib/seenOffers';
import { loadSeenOffers } from '../lib/seenOffersStore';
import { JOB_CHIPS, livePillText, openNearText, shownJobsChip, type JobsChip } from '../lib/homeJobs';
import { statusBadge } from '../screens/MyTasksScreen';
import { Icon } from './Icon';
import { Grid, SectionTitle, Shimmer, rupees, timeAgo } from './kit';
import { WorkCard } from './WorkCard';
import { BidSheet } from './BidSheet';
import { HelpersNearHero } from './HelpersNearHero';
import { JobsNearHero } from './JobsNearHero';
import { MapShortcuts } from './MapShortcuts';
import { SafeSheet, TrustLine } from './SafeOnTaskDrop';
import { HeroCard } from './Hero';
import { Drop, Ripples } from './Ripples';
import { cardSurface } from './ui';
import { useLayout } from '../lib/layout';
import { useReducedMotion } from '../lib/motion';
import type { IconName } from './Icon';
import { LocationSheet, type PickedPlace } from './LocationSheet';
import { resolveCurrentPlace } from '../lib/location';
import { pickedPlaceName, roughPlace } from '../lib/place';
import { inReachWithoutArea } from '../lib/findWorkRead';
import { guestAreaFromPicked } from '../lib/guestArea';
import { readGuestArea, saveGuestArea } from '../lib/guestAreaStore';
import { areaFromProfile, peekArea, rememberArea, sameArea } from '../lib/areaCache';
import { HitArea, Pressy, tx } from './primitives';
import { useDesktopHeaderPortal } from './pageHeader';
import {
  DesktopColumns,
  EarnHowCard,
  HeaderSearch,
  IdeaTag,
  MeasuredGrid,
  OnTheGoCard,
  PublishedTable,
  RadiusSegments,
  RailCard,
  RailRow,
  type PublishedStep,
} from './HomeDesktop';
import { Chip, ChipFade, ChipRow, LiveDot, LivePill, LiveRailCard, LiveSheet } from './HomeLive';
import { IdeasToPost, WaysToEarn } from './HomeIdeas';
import { HomeNeedsNow, usePosterNeedPick, usePosterNeeds, useWorkerNeedPick, useWorkerNeeds } from './HomeNeeds';
import { NeedsNow } from './myTasks/NeedsNow';

/**
 * Loads one of Home's sections when Home is in view and has not loaded for this focus tick: when it
 * first shows, when it comes back and is due a refresh (useFocusTick, lib/freshness.ts), and after a
 * live change. A load that failed, or was cut off by leaving Home, runs again the next time Home shows.
 */
function useHomeLoad(load: (alive: () => boolean) => Promise<unknown>) {
  const { screen } = useNav();
  const tick = useFocusTick();
  const onHome = screen === 'home';
  const done = useRef<{ load: unknown; tick: number } | null>(null);
  useEffect(() => {
    if (!onHome || (done.current?.load === load && done.current.tick === tick)) return;
    let alive = true;
    load(() => alive).then(
      () => {
        if (alive) done.current = { load, tick };
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [onHome, tick, load]);
}

/**
 * The top of the home screen, above the existing feed. `footer` (Hire's "Services near you") is drawn after the
 * last section: at the bottom of the main column on a desktop, under everything elsewhere.
 */
export function HomeSections({ footer }: { footer?: React.ReactNode }) {
  const { mode } = useMode();
  return mode === 'worker' ? <EarnTop /> : <PostTop footer={footer} />;
}

// ------------------------------------------------------------ posting -------

/** Statuses that are finished: they leave Home's live lists. */
const DONE = ['COMPLETED', 'AUTO_COMPLETED', 'CANCELLED'];

/**
 * The poster's home (task 1.19 F, eight blocks instead of fourteen): the area with its live pill (the live sheet
 * holds Just posted in full and Busy on TaskDrop), the Just posted ticker, the ask box with one trust line, what
 * needs them now, the helpers map card, what only TaskDrop does, one Ideas block, and Services (the footer). On a
 * desktop the area and a search bar sit in the page header, what needs them is a short table, and the live things
 * (active now, Just posted, Busy on TaskDrop, the helpers map) sit together in the right rail.
 */
function PostTop({ footer }: { footer?: React.ReactNode }) {
  const t = useTheme();
  // The wide composer gets its picture beside it (W2).
  const { desktop, contentWidth } = useLayout();
  const wideHero = desktop;
  // D9: the hero is a 7/5 row (composer, art); the picture grows a little once the column is wide.
  const artSize = contentWidth('feed') >= 1100 ? 260 : 220;
  const { go } = useNav();
  const { flash } = useActions();
  const { userId, guest } = useAuth();
  // Every live task (not finished): Needs you now reads all of them; the desktop table shows the first few.
  const [active, setActive] = useState<Task[] | null>(null);
  const [offers, setOffers] = useState<Map<string, number>>(new Map());
  // "N new" offers per open task, against what this device saw on My tasks (lib/seenOffers; read only here).
  const [fresh, setFresh] = useState<Map<string, number>>(new Map());
  const [trending, setTrending] = useState<TrendingCategory[]>([]);
  const [liveOpen, setLiveOpen] = useState(false);
  const [safeOpen, setSafeOpen] = useState(false);
  // Starts from the area already known this session (P1-13): the same one Earn Home and Explore show.
  const [place, setPlace] = useState<string | null>(() => peekArea(userId ?? (guest ? 'guest' : null))?.label ?? null);
  const [pickPlace, setPickPlace] = useState(false);
  const [pulse, setPulse] = useState<NearbyPulse | null>(null);
  const [posted, setPosted] = useState<Task[]>([]);
  const needs = usePosterNeeds(active, offers, guest);
  const pickNeed = usePosterNeedPick(active);

  // What is going on around the poster's area, in two real numbers (item 4).
  const loadPulse = useCallback(async (at: { lat: number; lng: number } | null, alive: () => boolean = () => true) => {
    const got = at ? await nearbyPulse(at) : null;
    if (alive()) setPulse(got);
  }, []);

  const loadTop = useCallback(
    async (alive: () => boolean) => {
      if (!userId) {
        // A guest sees what is trending, and the area they chose on this device (B87).
        if (guest)
          await Promise.all([
            readGuestArea().then((a) => {
              if (!alive() || !a) return;
              rememberArea('guest', a);
              setPlace(a.label);
              return loadPulse({ lat: a.lat, lng: a.lng }, alive);
            }),
            trendingCategories(5).then((r) => alive() && setTrending(r.filter((c) => c.open_count > 0))).catch(() => {}),
            listOpenTasks(30, 'request').then((r) => alive() && setPosted(r)).catch(() => {}),
          ]);
        return;
      }
      await Promise.all([
        getProfile(userId)
          .then((p) => {
            if (!alive()) return;
            rememberArea(userId, areaFromProfile(p));
            setPlace(p?.loc_label ?? null);
            return loadPulse(p?.loc_lat != null && p?.loc_lng != null ? { lat: p.loc_lat, lng: p.loc_lng } : null, alive);
          })
          .catch(() => {}),
        listMyTasks(userId)
          .then(async (rows) => {
            const live = rows.filter((r) => !DONE.includes(r.status));
            // Offers per open task, so each row can say its next step ("3 offers · choose").
            const open = live.filter((r) => r.status === 'OPEN').map((r) => r.id);
            const counts = open.length ? await countBidsByTask(open).catch(() => new Map<string, number>()) : new Map<string, number>();
            const seen = await loadSeenOffers(userId).catch(() => null);
            if (!alive()) return;
            setOffers(counts);
            setFresh(newOffers(counts, seen).fresh);
            setActive(live);
          })
          .catch(() => alive() && setActive([])),
        trendingCategories(5)
          .then((r) => alive() && setTrending(r.filter((c) => c.open_count > 0)))
          .catch(() => {}),
        listOpenTasks(30, 'request').then((r) => alive() && setPosted(r)).catch(() => {}),
      ]);
    },
    [userId, guest, loadPulse],
  );
  useHomeLoad(loadTop);

  // The same area a worker sets: where this poster's jobs usually are, and
  // the starting point of every post's location.
  const choosePlace = async (picked: PickedPlace) => {
    setPickPlace(false);
    if (picked.lat === null || picked.lng === null) return flash('Drop a pin on the map to set your area');
    const label = picked.area || picked.label;
    setPlace(label);
    rememberArea(userId ?? 'guest', { label, lat: picked.lat, lng: picked.lng });
    void loadPulse({ lat: picked.lat, lng: picked.lng });
    if (!userId) {
      const g = guestAreaFromPicked(picked);
      if (g) await saveGuestArea(g);
      return;
    }
    await updateProfile(userId, { locLabel: label, locLat: picked.lat, locLng: picked.lng }).catch((e) =>
      flash(e instanceof Error ? e.message : 'Could not save your area'),
    );
  };

  // The card is a doorway: one tap opens the full-screen composer with the
  // keyboard already up, like starting a quick post.
  const openComposer = () => go('aiPost');
  const postLike = (prompt: string) => go('aiPost', { prompt });
  const busyPick = (c: TrendingCategory) => go('aiPost', { prompt: `I need help with ${c.category.toLowerCase()}: ` });
  const pill = <LivePill text={livePillText(pulse)} onPress={() => setLiveOpen(true)} />;

  const areaBar = (inHeader: boolean) => (
    <AreaBar
      label={place}
      sub={(area) => (area ? 'Your posts reach workers around here' : 'So workers near you see your posts')}
      onPress={() => setPickPlace(true)}
      flush
      inHeader={inHeader}
      right={inHeader ? undefined : pill}
    />
  );
  // Desktop (WebHire): the area on the left of the page header, a search bar in its middle. Enter shows Home's
  // search results, the same list the Search screen hands back; an empty search opens the Search screen.
  const header = useDesktopHeaderPortal({
    left: desktop ? areaBar(true) : undefined,
    center: desktop ? (
      <HeaderSearch
        placeholder="Search helpers and services"
        label="Search helpers and services"
        onSubmit={(q) => (q ? go('home', { q }) : go('search'))}
      />
    ) : undefined,
  });

  /* The composer, on the v2 hero: the card itself is where you type.
     Sending opens the step-by-step flow with these words, which asks the
     quick questions, writes the post and checks it with you. Speaking a task
     is on that screen (its Speak button). */
  const hero = (
    <HeroCard style={{ marginTop: desktop ? 0 : 10 }} padding={wideHero ? 30 : 20}>
      <View style={{ flexDirection: 'row', gap: 28 }}>
        <View style={wideHero ? { flex: 7, maxWidth: 720, justifyContent: 'center' } : { flex: 1.25 }}>
          {/* D22: the question is the title; "How TaskDrop works" is the ? beside it. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <RNText style={tx('800', wideHero ? 34 : 24, onHero.text, { letterSpacing: -0.7, flex: 1, lineHeight: wideHero ? 40 : 30 })}>
              What do you need done?
            </RNText>
            <HowButton onPress={() => go('intro', { replay: true, side: 'hire' })} />
          </View>
          <RNText style={tx('500', wideHero ? 14.5 : 13, onHero.text, { marginTop: 6 })}>
            Ask for anything. Someone gets it done for you.
          </RNText>
          <Pressable
            onPress={openComposer}
            accessibilityRole="button"
            accessibilityLabel="Say what you need. Opens the new task screen"
            style={({ pressed }) => ({
              marginTop: 14,
              borderRadius: 16,
              paddingHorizontal: 15,
              paddingVertical: 12,
              minHeight: wideHero ? 56 : 72,
              flexDirection: 'row',
              alignItems: wideHero ? 'center' : 'flex-start',
              gap: 10,
              // THEME_AUDIT 35: the mode's own surface and muted, in both themes.
              backgroundColor: t.colors.surface,
              borderWidth: t.isDark ? 1 : 0,
              borderColor: t.colors.line,
              transform: [{ scale: pressed ? 0.985 : 1 }],
            })}
          >
            <RNText style={tx('400', 15, t.colors.muted, { flex: 1, lineHeight: 22 })}>
              {wideHero ? 'Type it your way: clean my kitchen' : 'Tap to type it your way: clean my kitchen'}
            </RNText>
            <View style={{ height: 38, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.btn }}>
              <RNText style={tx('800', 14, t.colors.onBtn)}>Post</RNText>
              <Icon name="chevronRight" size={15} color={t.colors.onBtn} strokeWidth={2.4} />
            </View>
          </Pressable>
          {/* Pick a day first (A6): the composer opens with that day already chosen. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 12 }}>
            {DAY_CHIPS.map((d) => (
              <Pressable
                key={d.key}
                onPress={() => go('aiPost', { when: d.key })}
                accessibilityRole="button"
                accessibilityLabel={`New task for ${d.label.toLowerCase()}`}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
                  height: 32,
                  borderRadius: 999,
                  justifyContent: 'center',
                  backgroundColor: hovered ? onHero.chipHover : onHero.chip,
                  paddingHorizontal: 13,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                })}
              >
                <RNText style={tx('700', 12.5, onHero.text)}>{d.label}</RNText>
              </Pressable>
            ))}
          </View>
          {/* Decision 3: "Why hiring here is safer" is one line; the same words open in a sheet. */}
          <TrustLine worker={false} onPress={() => setSafeOpen(true)} />
        </View>
        {wideHero ? <HeroArt size={artSize} /> : null}
      </View>
    </HeroCard>
  );

  const helpersMap = (
    <View testID="home-hire-map" style={{ marginTop: desktop ? 0 : 20 }}>
      <HelpersNearHero />
      <MapShortcuts worker={false} />
    </View>
  );

  const only = (
    <OnlyOnTaskDrop
      onHunt={() => go('aiPost', { prompt: 'Find me ', hunt: true })}
      onBigDay={() => go('bigDay')}
      onPrompt={postLike}
    />
  );

  const ideas = (
    <IdeasToPost
      onPick={(x) => go('aiPost', x.when ? { prompt: x.prompt, when: x.when } : { prompt: x.prompt })}
      // Explore's list opens on Ideas, which holds every template and idea.
      onSeeAll={() => go('explore', { focusSearch: Date.now() })}
    />
  );

  const sheets = (
    <>
      <SafeSheet visible={safeOpen} onClose={() => setSafeOpen(false)} worker={false} />
      <LiveSheet
        visible={liveOpen}
        onClose={() => setLiveOpen(false)}
        place={place}
        pulse={pulse}
        posted={posted}
        trending={trending}
        onPostLike={postLike}
        onBusy={busyPick}
      />
      <LocationSheet
        visible={pickPlace}
        askForDetails={false}
        onCancel={() => setPickPlace(false)}
        onPick={(p) => void choosePlace(p)}
      />
    </>
  );

  if (desktop) {
    // Needs you now as a short table: what is theirs to do first, then what waits on someone else.
    const rank = (s: PublishedStep) => (s.tone === 'accent' ? 0 : s.tone === 'signal' ? 1 : 2);
    const rows = (active ?? [])
      .map((task) => ({ task, offers: offers.get(task.id) ?? 0, fresh: fresh.get(task.id) ?? 0, step: nextStep(task, offers.get(task.id) ?? 0) }))
      .sort((a, b) => rank(a.step) - rank(b.step))
      // Three rows keep Home calm (1.19 R); "All N in My tasks" opens the full list.
      .slice(0, 3);
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
        {header === undefined ? areaBar(false) : header}
        <DesktopColumns
          main={
            <>
              {hero}
              {rows.length > 0 ? (
                <PublishedTable rows={rows} total={active?.length ?? 0} onOpen={(task) => openPostedTask(task, go)} onManage={() => go('myTasks')} />
              ) : null}
              {only}
              {ideas}
              {footer}
            </>
          }
          rail={
            <>
              {/* 1.19 R: the tool first (live numbers, then the helpers map), the news lists after it, each
                  three rows long with the rest behind Show more. */}
              <LiveRailCard place={place} pulse={pulse} onOpen={() => setLiveOpen(true)} />
              {helpersMap}
              <JustPosted tasks={posted} onOpen={postLike} onOpenList={() => setLiveOpen(true)} rail />
              {trending.length > 0 ? (
                <RailCard title="Busy on TaskDrop" icon="trending" limit={3}>
                  {trending.map((c, i) => (
                    <RailRow
                      key={c.category}
                      first={i === 0}
                      title={c.category}
                      sub={`~${rupees(c.avg_budget_minor / 100)} a task`}
                      value={`${c.open_count} open`}
                      onPress={() => busyPick(c)}
                    />
                  ))}
                </RailCard>
              ) : null}
            </>
          }
        />
        {sheets}
      </View>
    );
  }

  return (
    <>
      <View style={{ paddingHorizontal: 20 }}>
        {areaBar(false)}
        <JustPosted tasks={posted} onOpen={postLike} onOpenList={() => setLiveOpen(true)} />
        {hero}

        <HomeNeedsNow items={needs} side="hire" onPick={pickNeed} allCount={active?.length ?? 0} />

        {/* 1.19 H: the same short live map card as Earn, in jade, then shortcuts to the map. */}
        {helpersMap}

        {/* D22 H1: what only TaskDrop does, as big icons. */}
        {only}

        {/* Decision 1: one Ideas block with chips (poster ideas, Quick templates, Everyday). */}
        {ideas}

        {sheets}
      </View>
      {footer}
    </>
  );
}

/**
 * A news-style strip of what other people are posting right now, so a new customer sees what the app is for.
 * Titles scroll right to left at motion.tickerPxPerSec; a tap opens the live sheet with the full list. Reduced
 * motion shows the newest title still. Nothing renders until there is something real to show. `rail` (desktop,
 * WebHire): the newest few as a list card in the right rail instead of the moving strip.
 */
function JustPosted({ tasks, onOpen, onOpenList, rail = false }: { tasks: Task[]; onOpen: (prompt: string) => void; onOpenList: () => void; rail?: boolean }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [copyW, setCopyW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const rows = tasks.filter((r) => r.title.trim().length > 0);
  const strip = rows.slice(0, 12);
  const key = strip.map((r) => r.id).join(',');
  const speed = t.motion.tickerPxPerSec;

  // A new list has a new width: stop, measure again, restart from the left.
  useEffect(() => {
    setCopyW(0);
  }, [key]);
  useEffect(() => {
    x.setValue(0);
    if (reduced || copyW <= 0) return;
    const loop = Animated.loop(
      Animated.timing(x, { toValue: -copyW, duration: (copyW / speed) * 1000, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }),
    );
    loop.start();
    return () => loop.stop();
  }, [x, reduced, copyW, speed]);

  if (rows.length === 0) return null;

  if (rail) {
    return (
      <RailCard title="Just posted" dot link="See what people are posting" onLink={onOpenList} limit={3}>
        {rows.slice(0, 5).map((r, i) => (
          <RailRow
            key={r.id}
            first={i === 0}
            title={r.title}
            sub={[r.loc_lat === null ? 'Remote' : (roughPlace(r.loc_label) ?? ''), timeAgo(r.created_at)].filter(Boolean).join(' · ')}
            value={r.benchmark_minor > 0 ? rupees(r.benchmark_minor / 100) : undefined}
            onPress={() => onOpen(r.title)}
          />
        ))}
      </RailCard>
    );
  }

  const item = (r: Task, i: number) => (
    <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
      {i > 0 ? <RNText style={tx('700', 12, t.colors.muted, { marginHorizontal: 18 })}>•</RNText> : null}
      <RNText style={tx('600', 13, t.colors.ink)} numberOfLines={1}>
        {r.title}
      </RNText>
      {r.benchmark_minor > 0 ? <RNText style={tx('700', 13, t.colors.ink)}>{` · ${rupees(r.benchmark_minor / 100)}`}</RNText> : null}
    </View>
  );
  const copy = <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 36 }}>{strip.map(item)}</View>;

  return (
    <Pressable
      onPress={onOpenList}
      accessibilityRole="button"
      accessibilityLabel="Tasks people are posting. Opens the list"
      style={({ pressed }) => [
        cardSurface(t, 12),
        { marginTop: 10, height: 40, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, height: '100%', borderRightWidth: 1, borderRightColor: t.colors.line }}>
        <LiveDot size={7} />
        <RNText style={tx('800', 12, t.colors.accentDeep)}>Just posted</RNText>
      </View>
      <View style={{ flex: 1, overflow: 'hidden', paddingLeft: reduced ? 12 : 0 }}>
        {reduced ? (
          <RNText style={tx('600', 13, t.colors.ink)} numberOfLines={1}>
            {rows[0]!.title}
          </RNText>
        ) : (
          <Animated.View style={{ flexDirection: 'row', alignSelf: 'flex-start', transform: [{ translateX: x }] }}>
            {/* Measured from the first copy only: the second is the seamless wrap-around. */}
            <View onLayout={(e) => setCopyW(Math.round(e.nativeEvent.layout.width))}>{copy}</View>
            <View>{copy}</View>
          </Animated.View>
        )}
      </View>
      <View style={{ paddingHorizontal: 10 }}>
        <Icon name="chevronRight" size={15} color={t.colors.muted} />
      </View>
    </Pressable>
  );
}

/**
 * Where you are, like a delivery app: the area in bold, a line under it, tap
 * to search or use your location. Both sides of the app show it -- workers to
 * find jobs near them, posters to reach workers near them. `right`: the live pill (task 1.19 F).
 */
function AreaBar({
  label,
  sub,
  onPress,
  flush = false,
  pending = false,
  inHeader = false,
  right,
}: {
  label: string | null;
  /** The area is still being read: say so, rather than asking for one. */
  pending?: boolean;
  sub: (area: string | null, areaName: string | null) => string;
  onPress: () => void;
  /** Already inside a padded column. */
  flush?: boolean;
  /** Drawn in the desktop page header's left slot (D31 web boards): just the picker, no row around it. */
  inHeader?: boolean;
  /** Beside the area, on the right of the row (the live pill). */
  right?: React.ReactNode;
}) {
  const t = useTheme();
  const area = label ? roughPlace(label) : null;
  // B176: the header names the place they picked ("Madhapur, Ward 104 Kondapur, ..." is Madhapur).
  const areaName = label ? pickedPlaceName(label) : null;
  const bar = (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={area ? `Your area: ${area}. Change` : 'Set your area'}
      style={({ pressed }) => ({
        flex: inHeader ? undefined : 1,
        minWidth: 0,
        alignSelf: inHeader ? 'flex-start' : undefined,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: inHeader ? 0 : 6,
        gap: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="pin" size={17} color={t.colors.accentDeep} />
      </View>
      <View style={inHeader ? { flexShrink: 1 } : { flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <RNText style={tx('800', 16, t.colors.ink, { letterSpacing: -0.2, flexShrink: 1 })} numberOfLines={1}>
            {areaName ?? (pending ? 'Finding your area…' : 'Set your location')}
          </RNText>
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <Icon name="chevronRight" size={14} color={t.colors.ink} />
          </View>
        </View>
        <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 1 })} numberOfLines={1}>
          {sub(area, areaName)}
        </RNText>
      </View>
    </Pressable>
  );
  // The Android app is offered in the desktop side menu now (D31), not beside the area.
  if (inHeader) return bar;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: flush ? 0 : 20, marginTop: 4 }}>
      {bar}
      {right}
    </View>
  );
}

// ------------------------------------------------------------- earning ------

const RADII = [3, 10, 25, 50];
/** How many near jobs Home reads: enough for the pill's count ("30+") and the Near you chip. */
const NEAR_LIMIT = 30;

/**
 * The worker's home (task 1.19 F): the area with a live count, one hero (level, jobs on the go, the job search and
 * the pay promise), what needs them now, the jobs map card, one "Jobs for you" list with chips (For you, Near you
 * with the radius, Remote, Today) and the Ways to earn rail. The list opens on Near you for a worker with no skills
 * and on For you once they have some (decision 5).
 */
function EarnTop() {
  const t = useTheme();
  const { go } = useNav();
  const { flash } = useActions();
  const { userId, guest } = useAuth();
  const [stats, setStats] = useState<MyStats | null>(null);
  const [rating, setRating] = useState(0);
  const [skills, setSkills] = useState<string[] | null>(null);
  // The area already known this session (P1-13): Hire Home or Explore may have read it, so it shows at once
  // instead of "Set your location" while this side's own reads are still on their way.
  const known = peekArea(userId ?? (guest ? 'guest' : null));
  const [place, setPlace] = useState<{ label: string; lat: number; lng: number } | null>(known ?? null);
  // Whether the area is known yet (read, or remembered): until then the bar says so, not "Set your location".
  const [placeKnown, setPlaceKnown] = useState(known !== undefined);
  const [radius, setRadius] = useState(10);
  const [pickPlace, setPickPlace] = useState(false);
  const [recs, setRecs] = useState<TaskWithPoster[] | null>(null);
  const [near, setNear] = useState<(TaskWithPoster & { km: number })[] | null>(null);
  const [remote, setRemote] = useState<TaskWithPoster[] | null>(null);
  const [urgent, setUrgent] = useState<TaskWithPoster[] | null>(null);
  const [saved, setSavedIds] = useState<Set<string>>(new Set());
  const [bidTask, setBidTask] = useState<Task | null>(null);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [safeOpen, setSafeOpen] = useState(false);
  // The chip they tapped; until then the list opens on the one their skills call for (lib/homeJobs).
  const [pickedChip, setPickedChip] = useState<JobsChip | null>(null);
  const chip = shownJobsChip(pickedChip, skills);
  // Bumped by each Home load: the area-dependent lists re-read on it.
  const [listTick, setListTick] = useState(0);
  const workerNeeds = useWorkerNeeds();
  const pickNeed = useWorkerNeedPick(workerNeeds.rows);
  // Tasks this worker already sent an offer on: their button says Edit offer.
  const offers = useMyOffers(
    userId,
    [...(recs ?? []), ...(near ?? []), ...(remote ?? []), ...(urgent ?? [])].map((x) => x.id),
    !guest,
  );

  const load = useCallback(async () => {
    if (!userId && !guest) return;
    // Remote work does not depend on the profile, so it is asked for beside it.
    const remoteAsked = remoteTasks(8).catch((): Task[] => []);
    // A guest has no stats or profile of their own; their saves sit on the phone.
    const [s, p, ids] = userId
      ? await Promise.all([
          myStats('worker').catch(() => null),
          getProfile(userId).catch(() => null),
          listSavedTaskIds().catch(() => new Set<string>()),
        ])
      : [null, null, new Set(await listGuestSaves())];
    setStats(s);
    setRating(Number(p?.worker_rating_avg ?? 0));
    setSkills(p?.skills ?? []);
    setSavedIds(ids);
    // A guest's area sits on the device (B87); read it once, then the pin they pick stays in state.
    const guestSaved = userId ? null : await readGuestArea();
    setPlace((cur) => {
      if (!userId) {
        const g = cur ?? guestSaved;
        rememberArea('guest', g);
        return g;
      }
      // The profile read failed: keep what is known rather than asking for the area again.
      if (!p) return cur;
      const next = areaFromProfile(p);
      rememberArea(userId, next);
      // Same pin as before: keep the object, so the nearby list isn't refetched.
      return sameArea(cur, next) ? cur : next;
    });
    setPlaceKnown(true);
    // The skills and urgent lists depend on the area, so they are read below, once the area is known.
    setListTick((n) => n + 1);
    const rem = await remoteAsked;
    // A task no longer visible drops out.
    const withPosters = new Map((await attachPosters(rem)).map((x) => [x.id, x]));
    setRemote(rem.flatMap((x) => withPosters.get(x.id) ?? []));
  }, [userId, guest]);

  useHomeLoad(load);

  // What fits the worker's skills and what is needed today, in reach of the area they chose: in-person jobs only
  // within the radius, remote ones from anywhere (B156: these showed jobs in Pune and Kuala Lumpur to a worker in
  // Hyderabad). Re-read on every Home load and whenever the area, the radius or the skills change. With no area
  // set yet, only remote jobs are shown (W2-20).
  const skillsKey = (skills ?? []).join('\n');
  useEffect(() => {
    if (listTick === 0) return;
    let alive = true;
    const reach = place ? { lat: place.lat, lng: place.lng, radiusKm: radius } : null;
    const mySkills = skillsKey ? skillsKey.split('\n') : [];
    // No area yet (B156 / W2-20): only remote jobs, so more are asked for and the in-person ones dropped.
    void Promise.all([
      recommendedTasks(mySkills, reach ? 8 : 30, reach).catch((): Task[] => []),
      urgentTasks(reach ? 6 : 30, reach).catch((): Task[] => []),
    ])
      .then(async ([r0, urg0]) => {
        const r = inReachWithoutArea(r0, reach !== null, 8);
        const urg = inReachWithoutArea(urg0, reach !== null, 6);
        // One poster lookup for both lists, each keeping its own order (a task no longer visible drops out).
        const withPosters = new Map((await attachPosters([...r, ...urg])).map((x) => [x.id, x]));
        const posted = (list: Task[]) => list.flatMap((x) => withPosters.get(x.id) ?? []);
        if (!alive) return;
        setRecs(posted(r));
        setUrgent(posted(urg));
      })
      .catch(() => {
        if (!alive) return;
        setRecs((cur) => cur ?? []);
        setUrgent((cur) => cur ?? []);
      });
    return () => {
      alive = false;
    };
  }, [listTick, place, radius, skillsKey]);

  const askedLocation = useRef(false);
  useEffect(() => {
    if ((!userId && !guest) || place || askedLocation.current || recs === null) return;
    askedLocation.current = true;
    void resolveCurrentPlace()
      .then((found) => choosePlace(found))
      .catch(() => {
        /* declined or unavailable: the "Set your area" card stays */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, guest, place, recs]);

  // Work near the worker's chosen area, re-read whenever the area or the
  // radius changes. Nearest first.
  useEffect(() => {
    if (!place) {
      setNear([]);
      return;
    }
    let alive = true;
    setNear(null);
    void tasksNear(place, radius, NEAR_LIMIT)
      .then(async (rows) => {
        const withPeople = await attachPosters(rows);
        if (alive) {
          setNear(withPeople.map((x, i) => ({ ...x, km: rows[i]!.km })));
        }
      })
      .catch(() => alive && setNear([]));
    return () => {
      alive = false;
    };
  }, [place, radius]);

  const w = stats && stats.role === 'worker' ? stats : null;
  const level = levelFor(w?.jobsDone ?? 0, rating);

  const toggleSave = async (id: string) => {
    const on = !saved.has(id);
    setSavedIds((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
    if (guest) return void setGuestSaved(id, on);
    await setSaved(id, on).catch((e) => flash(e instanceof Error ? e.message : 'Could not save'));
  };

  const choosePlace = async (picked: PickedPlace) => {
    setPickPlace(false);
    if (picked.lat === null || picked.lng === null) return flash('Drop a pin on the map to set your area');
    const next = { label: picked.area || picked.label, lat: picked.lat, lng: picked.lng };
    setPlace(next);
    setPlaceKnown(true);
    rememberArea(userId ?? 'guest', next);
    if (!userId) {
      await saveGuestArea(next);
      return;
    }
    await updateProfile(userId, { locLabel: next.label, locLat: next.lat, locLng: next.lng }).catch((e) =>
      flash(e instanceof Error ? e.message : 'Could not save your area'),
    );
  };

  // Two per chip to start with; "Show more" opens the rest in place. On a desktop two is one full row of the main
  // column beside the rail (the page-wide column count left a lone card on a second row, 1.19 R).
  const { desktop } = useLayout();
  const FIRST = 2;
  const more = (key: string, total: number) =>
    total > FIRST ? (
      <Pressable
        onPress={() => setShowAll((m) => ({ ...m, [key]: !m[key] }))}
        accessibilityRole="button"
        style={({ pressed }) => ({
          marginTop: 10,
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 8,
          paddingHorizontal: 16,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: t.colors.line,
          backgroundColor: t.colors.surface,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <RNText style={tx('700', 12.5, t.colors.accentDeep)}>
          {showAll[key] ? 'Show less' : `Show ${total - FIRST} more`}
        </RNText>
      </Pressable>
    ) : null;
  const firstFew = <T,>(key: string, rows: T[]) => (showAll[key] ? rows : rows.slice(0, FIRST));

  const card = (task: TaskWithPoster, i: number, km?: number) => (
    <WorkCard
      key={task.id}
      task={task}
      index={i}
      km={km}
      saved={saved.has(task.id)}
      quoted={offers.has(task.id)}
      onOpen={() => go('taskDetail', { row: taskToFeedRow(task) })}
      onApply={() => setBidTask(task)}
      onToggleSave={() => void toggleSave(task.id)}
    />
  );

  const areaName = place ? pickedPlaceName(place.label) : null;
  const pillText = place ? openNearText(near === null ? null : near.length, NEAR_LIMIT) : null;

  const areaBar = (inHeader: boolean) => (
    <AreaBar
      label={place?.label ?? null}
      pending={!placeKnown}
      sub={(a, n) => (a && a !== n ? `${a} · jobs near you` : a ? 'Showing jobs near you' : 'To show jobs near you')}
      onPress={() => setPickPlace(true)}
      flush={inHeader}
      inHeader={inHeader}
      right={!inHeader && pillText ? <LivePill text={pillText} onPress={() => go('explore')} label={`${pillText}. Opens the map`} /> : undefined}
    />
  );
  // Desktop (WebEarn): the area on the left of the page header and the job search in its middle. Enter opens the
  // Find work list with those words; an empty search opens it with the cursor in its search box, as the phone's
  // search pill does.
  const header = useDesktopHeaderPortal({
    left: desktop ? areaBar(true) : undefined,
    center: desktop ? (
      <HeaderSearch
        placeholder="Search jobs: data entry, logo, tutoring…"
        label="Search jobs"
        onSubmit={(q) => go('explore', q ? { q } : { focusSearch: Date.now() })}
      />
    ) : undefined,
  });

  /* Where you stand, in one hero: level, jobs on the go, the job search (phones; the desktop header has it) and the
     pay promise. */
  const levelCard = (
    <HeroCard radius={24} padding={18} watermark={false} ringSize={200}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <RNText style={tx('700', 12, onHero.text, { flex: 1 })}>Find your next job</RNText>
        {/* D22 H2: "How TaskDrop works" is the ? in the card's corner, as on the Hire side. */}
        <HowButton onPress={() => go('intro', { replay: true, side: 'earn' })} size={28} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 6 }}>
        <View style={{ flex: 1 }}>
          <RNText style={tx('800', 26, onHero.text, { letterSpacing: -0.7 })}>{level.name}</RNText>
          <View
            style={{
              height: 6,
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.25)',
              marginTop: 10,
              overflow: 'hidden',
            }}
          >
            <GrowBar pct={Math.round(level.progress * 100)} color={onHero.text} track="transparent" flush />
          </View>
          <RNText style={tx('500', 12, onHero.text, { marginTop: 8 })}>
            {level.next
              ? `${level.jobsToGo} job${level.jobsToGo === 1 ? '' : 's'}${level.ratingShort ? ` + ★ ${level.next.rating}` : ''} to ${level.next.name}`
              : 'Highest level'}
          </RNText>
        </View>
        <View style={{ alignItems: 'center', minWidth: 64 }}>
          <RNText style={tx('800', 30, onHero.text, { fontVariant: ['tabular-nums'] })}>{w?.jobsLive ?? 0}</RNText>
          <RNText style={tx('600', 11.5, onHero.text)}>on the go</RNText>
        </View>
      </View>
      {desktop ? null : (
        // Search lives on Find work; tapping here goes straight there with the cursor in its box.
        <Pressable
          onPress={() => go('explore', { focusSearch: Date.now() })}
          accessibilityRole="search"
          accessibilityLabel="Search jobs"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            marginTop: 14,
            borderRadius: 999,
            backgroundColor: t.colors.surface,
            borderWidth: t.isDark ? 1 : 0,
            borderColor: t.colors.line,
            paddingLeft: 15,
            paddingRight: 5,
            paddingVertical: 5,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          })}
        >
          <Icon name="search" size={17} color={t.colors.muted} />
          <RNText style={tx('400', 14, t.colors.muted, { flex: 1, paddingVertical: 8 })} numberOfLines={1}>
            Search jobs: data entry, logo, tutoring…
          </RNText>
          <View style={{ width: 38, height: 38, borderRadius: 999, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="search" size={17} color={t.colors.onBtn} strokeWidth={2} />
          </View>
        </Pressable>
      )}
      {/* Decision 3: "Your pay is protected" is one line; the same words open in a sheet. */}
      <TrustLine worker onPress={() => setSafeOpen(true)} />
    </HeroCard>
  );

  // Cards in rows: the page-wide grid on phones and tablets, columns measured from the main column on a desktop.
  const cards = (rows: React.ReactNode) => (desktop ? <MeasuredGrid min={230}>{rows}</MeasuredGrid> : <Grid fill>{rows}</Grid>);

  const setAreaCard = (
    <Pressy
      onPress={() => setPickPlace(true)}
      style={{
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: t.colors.accentSoft,
        borderWidth: 1,
        borderColor: t.colors.accentBorder,
        borderRadius: 18,
        padding: 16,
      }}
    >
      <Icon name="pin" size={20} color={t.colors.accentDeep} />
      <View style={{ flex: 1 }}>
        <RNText style={tx('700', 14, t.colors.accentDeep)}>Set your area</RNText>
        <RNText style={tx('400', 12, t.colors.accentDeep, { marginTop: 2 })}>
          We’ll show jobs close to where you are
        </RNText>
      </View>
      <Icon name="chevronRight" size={16} color={t.colors.accentDeep} />
    </Pressy>
  );

  /** One chip's list: a shimmer while it loads, a plain line when it is empty, else the cards and Show more. */
  const jobList = (key: JobsChip, rows: (TaskWithPoster & { km?: number })[] | null, empty: React.ReactNode) =>
    rows === null ? (
      <Shimmer height={110} style={{ marginTop: 12 }} />
    ) : rows.length === 0 ? (
      <View style={[cardSurface(t), { marginTop: 12, padding: 16 }]}>{empty}</View>
    ) : (
      <>
        {cards(firstFew(key, rows).map((task, i) => card(task, i, task.km)))}
        {more(key, rows.length)}
      </>
    );
  const line = (text: string) => <RNText style={tx('400', 12, t.colors.muted, { marginTop: 10 })}>{text}</RNText>;
  const plain = (text: string) => <RNText style={tx('400', 13, t.colors.muted)}>{text}</RNText>;
  const urgentCount = urgent?.length ?? 0;

  // Decisions 1 and 5: one list with chips replaces Matches your skills, Jobs near you, Remote & online and Needed
  // today. Each chip shows its own list, so no job is lost; the radius sits inside Near you.
  const jobsForYou = (
    <View testID="home-jobs-for-you">
      <SectionTitle title="Jobs for you" icon="star" action="Edit skills" onAction={() => go('profileEdit')} style={{ marginTop: 32 }} />
      <ChipRow>
        {JOB_CHIPS.map((c) => (
          <Chip
            key={c.key}
            testID={`home-jobs-chip-${c.key}`}
            label={c.label}
            on={chip === c.key}
            count={c.key === 'today' ? urgentCount : undefined}
            onPress={() => setPickedChip(c.key)}
          />
        ))}
      </ChipRow>
      <ChipFade chip={chip}>
        {chip === 'you' ? (
          <>
            {line(skills && skills.length ? skills.slice(0, 3).join(' · ') : 'Add skills to your profile for sharper matches')}
            {jobList('you', recs, plain('Nothing open right now. Check back soon.'))}
          </>
        ) : chip === 'near' ? (
          place ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <RNText style={tx('600', 12.5, t.colors.muted, { flex: 1 })} numberOfLines={1}>
                  {areaName ? `Near ${areaName}` : 'Near you'}
                </RNText>
                <RadiusSegments radii={RADII} value={radius} onPick={setRadius} />
              </View>
              {jobList(
                'near',
                near,
                <>
                  <RNText style={tx('700', 14, t.colors.ink)}>No jobs within {radius} km yet</RNText>
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>
                    {radius < 50 ? 'Widen the radius, or try Remote.' : 'Try Remote, or another area.'}
                  </RNText>
                </>,
              )}
            </>
          ) : (
            setAreaCard
          )
        ) : chip === 'remote' ? (
          <>
            {line('Work you can do from your phone or laptop')}
            {jobList('remote', remote, plain('No remote jobs open right now.'))}
          </>
        ) : (
          <>
            {line('Needed today · Urgent')}
            {jobList('today', urgent, plain('Nothing urgent right now. Check back soon.'))}
          </>
        )}
      </ChipFade>
    </View>
  );

  const sections = (
    <>
      {/* D32: a short live map of jobs near you, right after the hero (the desktop header holds the search). */}
      <View testID="home-jobs-map" style={{ marginTop: desktop ? 0 : 20 }}>
        <JobsNearHero onOpenMap={() => go('explore')} />
        <MapShortcuts worker />
      </View>

      {jobsForYou}

      <WaysToEarn onSearch={(q) => go('explore', { q })} onAddSkill={() => go('profileEdit')} />

      <Pressable
        onPress={() => go('explore')}
        style={{ alignSelf: 'center', marginTop: 18, marginBottom: 20 }}
        hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
        accessibilityRole="button"
      >
        <HitArea x={8} y={12} />
        <RNText style={tx('700', 13, t.colors.accentDeep)}>See every open job ›</RNText>
      </Pressable>
    </>
  );

  const sheets = (
    <>
      <SafeSheet visible={safeOpen} onClose={() => setSafeOpen(false)} worker />
      <BidSheet task={bidTask} visible={bidTask !== null} onClose={() => setBidTask(null)} onPlaced={() => void load()} />
      <LocationSheet
        visible={pickPlace}
        askForDetails={false}
        onCancel={() => setPickPlace(false)}
        onPick={(p) => void choosePlace(p)}
      />
    </>
  );

  const liveCount = workerNeeds.rows.filter((r) => r.bucket === 1 || r.bucket === 2).length;

  if (desktop) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
        {header === undefined ? areaBar(false) : header}
        <DesktopColumns
          main={
            <>
              <NeedsNow items={workerNeeds.items} onPick={pickNeed} desktop side="earn" />
              {sections}
            </>
          }
          rail={
            <>
              {levelCard}
              <OnTheGoCard />
              <EarnHowCard />
            </>
          }
        />
        {sheets}
      </View>
    );
  }

  return (
    <View>
      {areaBar(false)}

      <View style={{ paddingHorizontal: 20, marginTop: 8 }}>{levelCard}</View>

      <View style={{ paddingHorizontal: 20 }}>
        <HomeNeedsNow items={workerNeeds.items} side="earn" onPick={pickNeed} allCount={liveCount} />
        {sections}
      </View>
      {sheets}
    </View>
  );
}

// ------------------------------------------------------------ v2 parts ------

/** A bar that grows to its value on view (SYS-Motion "bars fill 700 ms"). */
function GrowBar({
  pct,
  delay = 0,
  color,
  track,
  flush = false,
}: {
  pct: number;
  delay?: number;
  color?: string;
  track?: string;
  /** Already inside a track (fills it edge to edge, no top margin). */
  flush?: boolean;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const grow = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      grow.setValue(1);
      return;
    }
    const anim = Animated.timing(grow, {
      toValue: 1,
      duration: 1100,
      delay: 120 + delay,
      easing: Easing.bezier(0.65, 0, 0.35, 1),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [grow, reduced, delay]);
  const width = grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${Math.max(0, Math.min(100, pct))}%`] });
  return (
    <View
      style={{
        height: 6,
        borderRadius: 999,
        backgroundColor: track ?? t.colors.surface2,
        marginTop: flush ? 0 : 8,
        overflow: 'hidden',
      }}
    >
      <Animated.View style={{ height: 6, borderRadius: 999, width, backgroundColor: color ?? t.colors.accent, opacity: color ? 1 : 0.9 }} />
    </View>
  );
}

/**
 * What a poster should do next with one of their tasks (plan D22, A4): a line and the one button. Colour by whose
 * move it is (decision 6): theirs in the mode's colour, waiting on someone else grey, a problem coral. A date that
 * has passed says so plainly instead of a red "overdue".
 */
function nextStep(task: Task, offers: number): PublishedStep {
  switch (task.status) {
    case 'OPEN':
      return offers > 0
        ? { line: `${offers} offer${offers === 1 ? '' : 's'} waiting`, button: 'Choose', tone: 'accent' }
        : { line: 'Waiting for offers', button: 'Open', tone: 'muted' };
    case 'LOCKED':
      return task.funded_at
        ? { line: 'Helper about to start', button: 'Open', tone: 'muted' }
        : { line: 'Pay to start', button: 'Pay', tone: 'accent' };
    case 'TASK_STARTED':
      return { line: 'Work underway', button: 'Track', tone: 'muted' };
    case 'WORK_DONE':
      return { line: 'Work done · check it', button: 'Review', tone: 'accent' };
    case 'REVISION_REQUESTED':
      return { line: 'Changes asked', button: 'Open', tone: 'muted' };
    case 'OVERDUE':
      return { line: 'The date has passed', button: 'Open', tone: 'signal' };
    case 'DISPUTED':
      return { line: 'Problem reported', button: 'Open', tone: 'signal' };
    default:
      return { line: statusBadge(task).label, button: 'Open', tone: 'muted' };
  }
}

/** The ? on a Home card: opens "How TaskDrop works" (plan D22, H2). */
function HowButton({ onPress, size = 32 }: { onPress: () => void; size?: number }) {
  return (
    <Pressy
      onPress={onPress}
      label="How TaskDrop works"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.18)',
      }}
    >
      <Icon name="help" size={Math.round(size * 0.55)} color={onHero.text} />
    </Pressy>
  );
}

/** The day chips under the ask box; the keys are the composer's own When choices ("Right now" stays in the composer). */
const DAY_CHIPS: { key: string; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '2days', label: 'In 2 days' },
  { key: 'week', label: 'This week' },
];

/**
 * "Only on TaskDrop" (plan D22, H1): what other apps do not do, as big icons. Every one of them already exists.
 * Colours (THEME_AUDIT 34, task 1.19): the mode's own fills with their paired ink, so the icons read in light and
 * dark and Hire Home never shows Earn blue; gold is kept for verified only.
 */
function OnlyOnTaskDrop({
  onHunt,
  onBigDay,
  onPrompt,
}: {
  onHunt: () => void;
  onBigDay: () => void;
  onPrompt: (prompt: string) => void;
}) {
  const t = useTheme();
  const { desktop } = useLayout();
  const opinions = TEMPLATES.find((x) => x.key === 'ask-people');
  const prices = TEMPLATES.find((x) => x.key === 'find-quotes');
  const items: { icon: IconName; title: string; bg: string; ink: string; isNew?: boolean; onPress: () => void }[] = [
    { icon: 'search', title: 'Find it\nfor me', bg: t.colors.accentSoft, ink: t.colors.accentDeep, isNew: true, onPress: onHunt },
    { icon: 'calendarCheck', title: 'Plan a\nbig day', bg: t.colors.btn, ink: t.colors.onBtn, onPress: onBigDay },
    { icon: 'users', title: 'Many\nhands', bg: t.colors.hero, ink: onHero.text, onPress: () => onPrompt('I need a few people together to ') },
    { icon: 'chat', title: 'Get\nopinions', bg: t.colors.signalFill, ink: onHero.text, onPress: () => onPrompt(opinions?.prompt ?? 'Ask people which they prefer: ') },
    { icon: 'tag', title: 'Price\ncheck', bg: t.colors.accent, ink: t.colors.onAccent, onPress: () => onPrompt(prices?.prompt ?? 'Find 3 shops near me that sell ') },
  ];
  return (
    <View testID="home-only-on-taskdrop" style={[cardSurface(t, 20), { marginTop: desktop ? 24 : 20, padding: 14 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="star" size={15} color={t.colors.accentDeep} />
        <RNText accessibilityRole="header" style={tx('800', 15, t.colors.ink, { flex: 1 })}>Only on TaskDrop</RNText>
        {/* These are kinds of posts, so they carry the Ideas tag. */}
        <IdeaTag plural />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: desktop ? 'wrap' : 'nowrap', marginTop: 14, gap: desktop ? 10 : 0 }}>
        {items.map((x) => (
          <Pressy
            key={x.title}
            onPress={x.onPress}
            scaleTo={0.94}
            label={x.isNew ? `${x.title.replace('\n', ' ')}. New` : x.title.replace('\n', ' ')}
            // Desktop (D10): each one is a card, the icon beside a one-line title; five across when they fit, else they
            // wrap (beside the right rail the column is too narrow for five whole titles).
            style={
              desktop
                ? [cardSurface(t, 16), { flexGrow: 1, flexBasis: 170, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, minWidth: 0 }]
                : { flex: 1, alignItems: 'center' }
            }
          >
            <View
              style={{
                width: desktop ? 44 : 54,
                height: desktop ? 44 : 54,
                borderRadius: desktop ? 15 : 18,
                backgroundColor: x.bg,
                borderWidth: x.isNew ? 1.5 : 0,
                borderColor: t.colors.accentBorder,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={x.icon} size={desktop ? 21 : 24} color={x.ink} strokeWidth={2.2} />
              {x.isNew ? (
                <View style={{ position: 'absolute', top: -6, right: -8, borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1, backgroundColor: t.colors.signalFill }}>
                  <RNText style={tx('800', 9, onHero.text)}>NEW</RNText>
                </View>
              ) : null}
            </View>
            {desktop ? (
              <RNText style={tx('700', 13, t.colors.ink, { flex: 1, flexShrink: 1, lineHeight: 17 })} numberOfLines={1}>
                {x.title.replace('\n', ' ')}
              </RNText>
            ) : (
              <RNText style={tx('700', 11.5, t.colors.ink, { marginTop: 7, textAlign: 'center', lineHeight: 14 })}>{x.title}</RNText>
            )}
          </Pressy>
        ))}
      </View>
      <RNText style={tx('500', 12, t.colors.muted, { marginTop: 12, lineHeight: 17 })}>
        <RNText style={tx('700', 12, t.colors.accentDeep)}>Find it for me: </RNText>
        many people look at once, you pay only the one who finds it.
      </RNText>
    </View>
  );
}

/**
 * The wide composer's picture: the drop at the centre of its ripples, with
 * people around it -- a task going out to whoever can do it.
 */
function HeroArt({ size = 220 }: { size?: number }) {
  const t = useTheme();
  const people = [
    { k: 'R', x: 8, y: 22, on: true },
    { k: 'A', x: 82, y: 30, on: true },
    { k: 'K', x: 14, y: 70, on: false },
    { k: 'S', x: 74, y: 78, on: false },
  ];
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flex: 5, minHeight: size + 10, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Ripples color="rgba(255,255,255,0.45)" size={size} count={3} duration={3800} />
        <View style={{ position: 'absolute', width: 116, height: 116, borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' }} />
        <Drop size={74} fill={onHero.text} tick={t.colors.heroMid} />
        {people.map((p) => (
          <View
            key={p.k}
            style={{
              position: 'absolute',
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: 38,
              height: 38,
              borderRadius: 999,
              // THEME_AUDIT 36: the card and its presence dot come from the theme.
              backgroundColor: t.colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000',
              shadowOpacity: 0.2,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <RNText style={tx('800', 15, t.colors.accentDeep)}>{p.k}</RNText>
            {p.on ? (
              <View
                style={{
                  position: 'absolute',
                  right: -1,
                  bottom: -1,
                  width: 11,
                  height: 11,
                  borderRadius: 999,
                  backgroundColor: t.colors.online,
                  borderWidth: 2,
                  borderColor: t.colors.surface,
                }}
              />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}
