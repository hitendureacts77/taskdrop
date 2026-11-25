import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated, Easing, Platform, ScrollView } from 'react-native';
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
import { CATEGORIES, TEMPLATES, type Category } from '../lib/taskBrief';
import { WHEN_WORDS, homeTemplates, templateCategories, templatesIn, type HomeTemplate } from '../lib/homeTemplates';
import { levelFor } from '../lib/levels';
import { taskToFeedRow } from '../lib/openTask';
import { useMyOffers } from '../lib/useMyOffers';
import { statusBadge } from '../screens/MyTasksScreen';
import { Icon } from './Icon';
import { BottomSheet, Grid, SectionTitle, Shimmer, rupees, timeAgo, timeLeft } from './kit';
import { WorkCard, categoryIcon } from './WorkCard';
import { BidSheet } from './BidSheet';
import { Rail, useRailItemWidth } from './Rail';
import { HelpersNearHero } from './HelpersNearHero';
import { JobsNearHero } from './JobsNearHero';
import { MapShortcuts } from './MapShortcuts';
import { SafeOnTaskDrop } from './SafeOnTaskDrop';
import { HeroCard } from './Hero';
import { Drop, Ripples } from './Ripples';
import { cardSurface } from './ui';
import { HomeFeedbackCard } from './HomeFeedbackCard';
import { useLayout } from '../lib/layout';
import { useReducedMotion } from '../lib/motion';
import type { IconName } from './Icon';
import { HowSheet } from './HowSheet';
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
  JobRow,
  MeasuredGrid,
  OnTheGoCard,
  PublishedTable,
  RadiusSegments,
  RailCard,
  RailRow,
} from './HomeDesktop';

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

/**
 * The poster's home (D31 boards Main / WebHire): the area, what is going on around it, the composer, what only
 * TaskDrop does, what they already have going, ideas to post, and what is busy. On a desktop the area and a search
 * bar sit in the page header, and "Just posted" and "Busy on TaskDrop" move to a rail on the right.
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
  const [active, setActive] = useState<Task[] | null>(null);
  const [offers, setOffers] = useState<Map<string, number>>(new Map());
  const [trending, setTrending] = useState<TrendingCategory[]>([]);
  const [howOpen, setHowOpen] = useState(false);
  // Starts from the area already known this session (P1-13): the same one Earn Home and Explore show.
  const [place, setPlace] = useState<string | null>(() => peekArea(userId ?? (guest ? 'guest' : null))?.label ?? null);
  const [pickPlace, setPickPlace] = useState(false);
  const [pulse, setPulse] = useState<NearbyPulse | null>(null);
  const [posted, setPosted] = useState<Task[]>([]);

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
            const live = rows.filter((r) => !['COMPLETED', 'AUTO_COMPLETED', 'CANCELLED'].includes(r.status)).slice(0, 4);
            // Offers per open task, so each card can say its next step ("3 offers · choose").
            const open = live.filter((r) => r.status === 'OPEN').map((r) => r.id);
            const counts = open.length ? await countBidsByTask(open).catch(() => new Map<string, number>()) : new Map<string, number>();
            if (!alive()) return;
            setOffers(counts);
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
  const busiest = Math.max(1, ...trending.map((c) => c.open_count));

  const areaBar = (inHeader: boolean) => (
    <AreaBar
      label={place}
      sub={(area) => (area ? 'Your posts reach workers around here' : 'So workers near you see your posts')}
      onPress={() => setPickPlace(true)}
      flush
      inHeader={inHeader}
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
            <RNText style={tx('800', wideHero ? 34 : 24, '#FFFFFF', { letterSpacing: -0.7, flex: 1, lineHeight: wideHero ? 40 : 30 })}>
              What do you need done?
            </RNText>
            <HowButton onPress={() => setHowOpen(true)} />
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
              backgroundColor: t.isDark ? 'rgba(10,12,14,0.55)' : '#FFFFFF',
              borderWidth: t.isDark ? 1 : 0,
              borderColor: 'rgba(255,255,255,0.2)',
              transform: [{ scale: pressed ? 0.985 : 1 }],
            })}
          >
            <RNText style={tx('400', 15, t.isDark ? 'rgba(213,217,221,0.75)' : t.colors.muted, { flex: 1, lineHeight: 22 })}>
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
                <RNText style={tx('700', 12.5, '#FFFFFF')}>{d.label}</RNText>
              </Pressable>
            ))}
          </View>
        </View>
        {wideHero ? <HeroArt size={artSize} /> : null}
      </View>
    </HeroCard>
  );

  // What they already have going: a table on a desktop (WebHire), a row of cards elsewhere.
  const published =
    active && active.length > 0 ? (
      desktop ? (
        <PublishedTable
          rows={active.map((task) => ({ task, offers: offers.get(task.id) ?? 0, step: nextStep(task, offers.get(task.id) ?? 0) }))}
          onOpen={(task) => openPostedTask(task, go)}
          onManage={() => go('myTasks')}
        />
      ) : (
        <>
          <SectionTitle
            title="Your published tasks"
            icon="briefcase"
            action="Manage"
            onAction={() => go('myTasks')}
            style={{ marginTop: 32 }}
          />
          <View style={{ marginTop: 10 }}>
            <Rail min={220}>
              {active.map((task) => (
                <PublishedCard
                  key={task.id}
                  task={task}
                  offers={offers.get(task.id) ?? 0}
                  onPress={() => openPostedTask(task, go)}
                />
              ))}
            </Rail>
          </View>
        </>
      )
    ) : null;

  // Errands people hand off most, as ideas: one tap fills the composer.
  const manage = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 32 }}>
        <SectionTitle title="Ideas for you to manage your tasks" icon="briefcase" style={{ flex: 1 }} />
        {desktop ? null : <IdeaTag plural />}
      </View>
      <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 4, lineHeight: 18 })}>
        {desktop
          ? 'Just ideas. Click one to post it as your own task.'
          : 'Just ideas. Tap one and it fills your post; you set the price and pick who does it.'}
      </RNText>
      <View style={desktop ? { marginTop: 7, marginHorizontal: -5, flexDirection: 'row', flexWrap: 'wrap' } : { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {MANAGE.map((x) => (
          <ManageTile key={x.title} item={x} perRow={desktop ? 3 : undefined} onPress={() => go('aiPost', { prompt: x.prompt })} />
        ))}
      </View>
    </>
  );

  const busyPick = (c: TrendingCategory) => go('aiPost', { prompt: `I need help with ${c.category.toLowerCase()}: ` });
  const sheets = (
    <>
      <HowSheet visible={howOpen} onClose={() => setHowOpen(false)} side="hire" />
      <LocationSheet
        visible={pickPlace}
        askForDetails={false}
        onCancel={() => setPickPlace(false)}
        onPick={(p) => void choosePlace(p)}
      />
    </>
  );

  if (desktop) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
        {header === undefined ? areaBar(false) : header}
        <DesktopColumns
          main={
            <>
              <PulseLine pulse={pulse} first />
              {hero}
              <View testID="home-hire-map" style={{ marginTop: 20 }}>
                <HelpersNearHero />
                <MapShortcuts worker={false} />
              </View>
              <OnlyOnTaskDrop
                onHunt={() => go('aiPost', { prompt: 'Find me ', hunt: true })}
                onBigDay={() => go('bigDay')}
                onPrompt={(prompt) => go('aiPost', { prompt })}
              />
              {published}
              <SafeOnTaskDrop worker={false} />
              <HomeTemplates onPick={(x) => go('aiPost', { prompt: x.prompt, when: x.when })} />
              <PosterIdeas onPrompt={(prompt) => go('aiPost', { prompt })} />
              {manage}
              <HomeFeedbackCard />
              {footer}
            </>
          }
          rail={
            <>
              <JustPosted tasks={posted} onOpen={(prompt) => go('aiPost', { prompt })} rail />
              {trending.length > 0 ? (
                <RailCard title="Busy on TaskDrop" icon="trending">
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
        <PulseLine pulse={pulse} />
        <JustPosted tasks={posted} onOpen={(prompt) => go('aiPost', { prompt })} />
        {hero}

        {/* 1.19 H: the same short live map card as Earn, in jade, then shortcuts to the map. */}
        <View testID="home-hire-map" style={{ marginTop: 20 }}>
          <HelpersNearHero />
          <MapShortcuts worker={false} />
        </View>

        {/* D22 H1: what only TaskDrop does, as big icons right under the ask box. */}
        <OnlyOnTaskDrop
          onHunt={() => go('aiPost', { prompt: 'Find me ', hunt: true })}
          onBigDay={() => go('bigDay')}
          onPrompt={(prompt) => go('aiPost', { prompt })}
        />

        {published}

        {/* Why hiring here beats paying offline: held money, milestones, problem reports. */}
        <SafeOnTaskDrop worker={false} />

        <HomeTemplates onPick={(x) => go('aiPost', { prompt: x.prompt, when: x.when })} />

        <PosterIdeas onPrompt={(prompt) => go('aiPost', { prompt })} />

        {manage}

        {/* What is busy */}
        {trending.length > 0 ? (
          <>
            <SectionTitle title="Busy on TaskDrop" icon="trending" style={{ marginTop: 32 }} />
            <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 4 })}>What people are posting on TaskDrop right now.</RNText>
            <View style={[cardSurface(t, 20), { marginTop: 12, paddingHorizontal: 14 }]}>
              {trending.map((c, i) => (
                <Pressable
                  key={c.category}
                  onPress={() => busyPick(c)}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 13,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: t.colors.line,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={categoryIcon(c.category)} size={16} color={t.colors.accentDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                      <RNText style={tx('700', 14, t.colors.ink, { flexShrink: 1 })} numberOfLines={1}>
                        {c.category}
                      </RNText>
                      <RNText style={tx('500', 12, t.colors.muted, { fontVariant: ['tabular-nums'] })}>
                        {c.open_count} open · ~{rupees(c.avg_budget_minor / 100)}
                      </RNText>
                    </View>
                    <GrowBar pct={Math.max(8, Math.round((c.open_count / busiest) * 100))} delay={i * 90} />
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <HomeFeedbackCard />
        {sheets}
      </View>
      {footer}
    </>
  );
}

/**
 * A news-style strip of what other people are posting right now, so a new customer sees what the
 * app is for. Titles scroll right to left; tap opens the full list. Reduced motion shows the
 * newest title still. Nothing renders until there is something real to show. `rail` (desktop, WebHire): the
 * newest few as a list card in the right rail instead of the moving strip, with the same full list behind it.
 */
function JustPosted({ tasks, onOpen, rail = false }: { tasks: Task[]; onOpen: (prompt: string) => void; rail?: boolean }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [copyW, setCopyW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const rows = tasks.filter((r) => r.title.trim().length > 0);
  const strip = rows.slice(0, 12);
  const key = strip.map((r) => r.id).join(',');

  // A new list has a new width: stop, measure again, restart from the left.
  useEffect(() => {
    setCopyW(0);
  }, [key]);
  useEffect(() => {
    x.setValue(0);
    if (reduced || copyW <= 0) return;
    const loop = Animated.loop(
      Animated.timing(x, { toValue: -copyW, duration: (copyW / 38) * 1000, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }),
    );
    loop.start();
    return () => loop.stop();
  }, [x, reduced, copyW]);

  if (rows.length === 0) return null;

  const item = (r: Task, i: number) => (
    <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
      {i > 0 ? <RNText style={tx('700', 12, t.colors.muted, { marginHorizontal: 18 })}>•</RNText> : null}
      <RNText style={tx('600', 13, t.colors.ink)} numberOfLines={1}>
        {r.title}
      </RNText>
      {r.benchmark_minor > 0 ? <RNText style={tx('500', 13, t.colors.muted)}>{` · ${rupees(r.benchmark_minor / 100)}`}</RNText> : null}
    </View>
  );
  const copy = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 36 }}>{strip.map(item)}</View>
  );

  return (
    <>
      {rail ? (
        <RailCard title="Just posted" dot link="See what people are posting" onLink={() => setOpen(true)}>
          {rows.slice(0, 5).map((r, i) => (
            <RailRow
              key={r.id}
              first={i === 0}
              title={r.title}
              sub={[r.loc_lat === null ? 'Remote' : (roughPlace(r.loc_label) ?? ''), timeAgo(r.created_at)].filter(Boolean).join(' · ')}
              onPress={() => onOpen(r.title)}
            />
          ))}
        </RailCard>
      ) : (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Tasks people are posting. Opens the list"
        style={({ pressed }) => [
          cardSurface(t, 12),
          { marginTop: 10, height: 40, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, height: '100%', borderRightWidth: 1, borderRightColor: t.colors.line }}>
          <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: t.colors.online }} />
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
      )}

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="What people are posting"
        subtitle="Real tasks posted on TaskDrop. Tap one to post your own like it."
      >
        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
          {rows.map((r, i) => {
            const meta = [r.category, r.benchmark_minor > 0 ? rupees(r.benchmark_minor / 100) : '', timeAgo(r.created_at)].filter(Boolean).join(' · ');
            return (
              <Pressable
                key={r.id}
                onPress={() => {
                  setOpen(false);
                  onOpen(r.title);
                }}
                accessibilityRole="button"
                accessibilityLabel={r.title}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 12,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: t.colors.line,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={categoryIcon(r.category ?? '')} size={16} color={t.colors.accentDeep} />
                </View>
                <View style={{ flex: 1 }}>
                  <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={2}>
                    {r.title}
                  </RNText>
                  {meta ? <RNText style={tx('500', 12, t.colors.muted, { marginTop: 2 })}>{meta}</RNText> : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </>
  );
}

/**
 * One line under the poster's area: tasks finished near there today and
 * helpers there right now. Real counts from nearby_pulse (migration 140);
 * a part that is zero is left out, and nothing shows when both are.
 */
function PulseLine({ pulse, first = false }: { pulse: NearbyPulse | null; /** The top of the desktop main column: no gap above, room below. */ first?: boolean }) {
  const t = useTheme();
  const done = pulse?.doneToday ?? 0;
  const active = pulse?.activeNow ?? 0;
  if (done <= 0 && active <= 0) return null;
  const lead = done > 0 ? `${done} done near you today` : `${active} ${active === 1 ? 'helper' : 'helpers'} active now`;
  const rest = done > 0 && active > 0 ? ` · ${active} ${active === 1 ? 'helper' : 'helpers'} active now` : '';
  return (
    <View
      accessibilityRole="text"
      style={{ marginTop: first ? 0 : 6, marginBottom: first ? 16 : 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: t.colors.accentSoft }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: t.colors.online }} />
      <RNText style={tx('500', 13, t.colors.muted, { flex: 1, lineHeight: 18 })} numberOfLines={1}>
        <RNText style={tx('700', 13, t.colors.ink)}>{lead}</RNText>
        {rest}
      </RNText>
    </View>
  );
}

/**
 * Where you are, like a delivery app: the area in bold, a line under it, tap
 * to search or use your location. Both sides of the app show it -- workers to
 * find jobs near them, posters to reach workers near them.
 */
function AreaBar({
  label,
  sub,
  onPress,
  flush = false,
  pending = false,
  inHeader = false,
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
      <View style={inHeader ? { flexShrink: 1 } : { flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <RNText style={tx('800', 16, t.colors.ink, { letterSpacing: -0.2 })} numberOfLines={1}>
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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: flush ? 0 : 20, marginTop: 4 }}>
      {bar}
    </View>
  );
}

// ------------------------------------------------------------- earning ------

const RADII = [3, 10, 25, 50];

/**
 * The worker's home, top to bottom: where they stand, then work in the order
 * they are most likely to take it -- what fits their skills, what is close to
 * the area they chose, what can be done from anywhere, and what is needed
 * today.
 */
function EarnTop() {
  const t = useTheme();
  const { go, screen } = useNav();
  const { flash } = useActions();
  const { userId, guest } = useAuth();
  const [stats, setStats] = useState<MyStats | null>(null);
  const [rating, setRating] = useState(0);
  const [skills, setSkills] = useState<string[]>([]);
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
  const [urgent, setUrgent] = useState<TaskWithPoster[]>([]);
  const [saved, setSavedIds] = useState<Set<string>>(new Set());
  const [bidTask, setBidTask] = useState<Task | null>(null);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [howOpen, setHowOpen] = useState(false);
  // Bumped by each Home load: the area-dependent lists re-read on it.
  const [listTick, setListTick] = useState(0);
  // Tasks this worker already sent an offer on: their button says Edit offer.
  const offers = useMyOffers(
    userId,
    [...(recs ?? []), ...(near ?? []), ...(remote ?? []), ...urgent].map((x) => x.id),
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
  const skillsKey = skills.join('\n');
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
      .catch(() => alive && setRecs((cur) => cur ?? []));
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

  useEffect(() => {
  }, [load, screen]);

  // Work near the worker's chosen area, re-read whenever the area or the
  // radius changes. Nearest first.
  useEffect(() => {
    if (!place) {
      setNear([]);
      return;
    }
    let alive = true;
    setNear(null);
    void tasksNear(place, radius, 8)
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

  // Two per section to start with (a full row on a desktop); "Show more" opens the rest in place.
  const { desktop, columns } = useLayout();
  const FIRST = desktop ? Math.max(2, columns) : 2;
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

  const areaBar = (inHeader: boolean) => (
    <AreaBar
      label={place?.label ?? null}
      pending={!placeKnown}
      sub={(a, n) => (a && a !== n ? `${a} · jobs near you` : a ? 'Showing jobs near you' : 'To show jobs near you')}
      onPress={() => setPickPlace(true)}
      flush={inHeader}
      inHeader={inHeader}
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

  /* Where you stand, in one card: level, jobs on the go, availability. */
  const levelCard = (
    <HeroCard radius={24} padding={18} watermark={false} ringSize={200}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <RNText style={tx('700', 12, onHero.text, { flex: 1 })}>Find your next job</RNText>
        {/* D22 H2: "How TaskDrop works" is the ? in the card's corner, as on the Hire side. */}
        <HowButton onPress={() => setHowOpen(true)} size={28} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 6 }}>
        <View style={{ flex: 1 }}>
          <RNText style={tx('800', 26, '#FFFFFF', { letterSpacing: -0.7 })}>{level.name}</RNText>
          <View
            style={{
              height: 6,
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.25)',
              marginTop: 10,
              overflow: 'hidden',
            }}
          >
            <GrowBar pct={Math.round(level.progress * 100)} color="#FFFFFF" track="transparent" flush />
          </View>
          <RNText style={tx('500', 12, onHero.text, { marginTop: 8 })}>
            {level.next
              ? `${level.jobsToGo} job${level.jobsToGo === 1 ? '' : 's'}${level.ratingShort ? ` + ★ ${level.next.rating}` : ''} to ${level.next.name}`
              : 'Highest level'}
          </RNText>
        </View>
        <View style={{ alignItems: 'center', minWidth: 64 }}>
          <RNText style={tx('800', 30, '#FFFFFF', { fontVariant: ['tabular-nums'] })}>{w?.jobsLive ?? 0}</RNText>
          <RNText style={tx('600', 11.5, onHero.text)}>on the go</RNText>
        </View>
      </View>
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
  const nearEmpty = (
    <>
      <RNText style={tx('700', 14, t.colors.ink)}>No jobs within {radius} km yet</RNText>
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>
        {radius < 50 ? 'Widen the radius, or try remote work below.' : 'Try remote work below, or another area.'}
      </RNText>
    </>
  );
  const nearTitle = areaName ? `Jobs near ${areaName}` : 'Jobs near you';

  // 2. Near the area the worker chose. Desktop (WebEarn): one list card, the distance choices in its header.
  const nearSection = desktop ? (
    place ? (
      <View style={[cardSurface(t, 16), { marginTop: 32, overflow: 'hidden' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.colors.line }}>
          <Icon name="pin" size={16} color={t.colors.accentDeep} />
          <RNText accessibilityRole="header" style={tx('800', 17, t.colors.ink, { flex: 1, letterSpacing: -0.3 })} numberOfLines={1}>
            {nearTitle}
          </RNText>
          <RadiusSegments radii={RADII} value={radius} onPick={setRadius} />
        </View>
        {near === null ? (
          <Shimmer height={110} style={{ margin: 16 }} />
        ) : near.length === 0 ? (
          <View style={{ padding: 20 }}>{nearEmpty}</View>
        ) : (
          <>
            {firstFew('near', near).map((task, i) => (
              <JobRow
                key={task.id}
                task={task}
                km={task.km}
                first={i === 0}
                quoted={offers.has(task.id)}
                onOpen={() => go('taskDetail', { row: taskToFeedRow(task) })}
                onApply={() => setBidTask(task)}
              />
            ))}
            {near.length > FIRST ? (
              <Pressable
                onPress={() => setShowAll((m) => ({ ...m, near: !m.near }))}
                accessibilityRole="button"
                style={({ pressed }) => ({ paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.colors.line, opacity: pressed ? 0.7 : 1 })}
              >
                <RNText style={tx('700', 13, t.colors.accentDeep)}>
                  {showAll.near ? 'Show less' : `Show ${near.length - FIRST} more near you`}
                </RNText>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    ) : (
      <>
        <SectionTitle title={nearTitle} icon="pin" style={{ marginTop: 32 }} />
        {setAreaCard}
      </>
    )
  ) : (
    <>
      <SectionTitle title={nearTitle} icon="pin" style={{ marginTop: 32 }} />
      {place ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {RADII.map((km) => (
              <Pressable
                key={km}
                onPress={() => setRadius(km)}
                accessibilityRole="button"
                accessibilityState={{ selected: radius === km }}
                style={({ pressed }) => ({
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: radius === km ? t.colors.accent : t.colors.line,
                  backgroundColor: radius === km ? t.colors.accentSoft : t.colors.surface,
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                })}
              >
                <RNText style={tx(radius === km ? '700' : '600', 13, radius === km ? t.colors.accentDeep : t.colors.text)}>{km} km</RNText>
              </Pressable>
            ))}
          </View>
          {near === null ? (
            <Shimmer height={110} style={{ marginTop: 12 }} />
          ) : near.length === 0 ? (
            <View style={[cardSurface(t), { marginTop: 12, padding: 16 }]}>{nearEmpty}</View>
          ) : (
            <>
              {cards(firstFew('near', near).map((task, i) => card(task, i, task.km)))}
              {more('near', near.length)}
            </>
          )}
        </>
      ) : (
        setAreaCard
      )}
    </>
  );

  const sections = (
    <>
      {/* D32: a short live map of jobs near you, right after the search pill (the desktop header holds the search). */}
      <View testID="home-jobs-map" style={{ marginTop: desktop ? 0 : 20 }}>
        <JobsNearHero onOpenMap={() => go('explore')} />
        <MapShortcuts worker />
      </View>

      {/* 1. Skills */}
      <SectionTitle
        title="Matches your skills"
        icon="star"
        action="Edit skills"
        onAction={() => go('profileEdit')}
        style={{ marginTop: 32 }}
      />
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>
        {skills.length ? skills.slice(0, 3).join(' · ') : 'Add skills to your profile for sharper matches'}
      </RNText>
      {recs === null ? (
        <Shimmer height={110} style={{ marginTop: 12 }} />
      ) : recs.length === 0 ? (
        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 10 })}>Nothing open right now. Check back soon.</RNText>
      ) : (
        <>
          {cards(firstFew('recs', recs).map((task, i) => card(task, i)))}
          {more('recs', recs.length)}
        </>
      )}

      {nearSection}

      {/* Helper assurance: the pay is held before they start, released on approval, milestones; offline is risky. */}
      <SafeOnTaskDrop worker />

      {/* 3. From anywhere */}
      <SectionTitle title="Remote & online" icon="compass" style={{ marginTop: 32 }} />
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>Work you can do from your phone or laptop</RNText>
      {remote === null ? (
        <Shimmer height={110} style={{ marginTop: 12 }} />
      ) : remote.length === 0 ? (
        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 10 })}>No remote jobs open right now.</RNText>
      ) : (
        <>
          {cards(firstFew('remote', remote).map((task, i) => card(task, i)))}
          {more('remote', remote.length)}
        </>
      )}

      {/* 4. Needed today */}
      {urgent.length > 0 ? (
        <>
          <SectionTitle title="Needed today" icon="bolt" badge="Urgent" style={{ marginTop: 32 }} />
          {cards(firstFew('urgent', urgent).map((task, i) => card(task, i)))}
          {more('urgent', urgent.length)}
        </>
      ) : null}

      <EarnIdeas onSearch={(q) => go('explore', { q })} onAddSkill={() => go('profileEdit')} />

      <Pressable
        onPress={() => go('explore')}
        style={{ alignSelf: 'center', marginTop: 18, marginBottom: 20 }}
        hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
        accessibilityRole="button"
      >
        <HitArea x={8} y={12} />
        <RNText style={tx('700', 13, t.colors.accentDeep)}>See every open job ›</RNText>
      </Pressable>

      <HomeFeedbackCard />
    </>
  );

  const sheets = (
    <>
      <HowSheet visible={howOpen} onClose={() => setHowOpen(false)} side="earn" />
      <BidSheet task={bidTask} visible={bidTask !== null} onClose={() => setBidTask(null)} onPlaced={() => void load()} />
      <LocationSheet
        visible={pickPlace}
        askForDetails={false}
        onCancel={() => setPickPlace(false)}
        onPick={(p) => void choosePlace(p)}
      />
    </>
  );

  if (desktop) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
        {header === undefined ? areaBar(false) : header}
        <DesktopColumns
          main={sections}
          rail={
            <>
              {levelCard}
              <OnTheGoCard />
              <EarnHowCard onSteps={() => setHowOpen(true)} />
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

      {/* Search lives on Browse jobs; tapping here goes straight there. */}
      <Pressable
        onPress={() => go('explore', { focusSearch: Date.now() })}
        accessibilityRole="search"
        accessibilityLabel="Search jobs"
        style={({ pressed }) => [
          cardSurface(t, 999),
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            marginHorizontal: 20,
            marginTop: 14,
            borderColor: pressed ? t.colors.accent : t.colors.line,
            paddingLeft: 15,
            paddingRight: 5,
            paddingVertical: 5,
          },
        ]}
      >
        <Icon name="search" size={17} color={t.colors.muted} />
        <RNText style={tx('400', 14, t.colors.muted, { flex: 1, paddingVertical: 8 })} numberOfLines={1}>
          Search jobs: data entry, logo, tutoring…
        </RNText>
        <View style={{ width: 38, height: 38, borderRadius: 999, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="search" size={17} color={t.colors.onBtn} strokeWidth={2} />
        </View>
      </Pressable>

      <View style={{ paddingHorizontal: 20 }}>{sections}</View>
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
 * What a poster should do next with one of their tasks (plan D22, A4): a line in caps and the
 * one button. A date that has passed says so plainly instead of a red "overdue".
 */
function nextStep(task: Task, offers: number): { line: string; button: string; tone: 'accent' | 'blue' | 'gold' } {
  switch (task.status) {
    case 'OPEN':
      // Past its date the feeds no longer show it (api notExpired, B21), so "waiting" would mislead.
      if (task.due_at && new Date(task.due_at).getTime() <= Date.now()) {
        return { line: 'Date passed · not shown', button: 'Open', tone: 'gold' };
      }
      return offers > 0
        ? { line: `${offers} offer${offers === 1 ? '' : 's'} waiting`, button: 'Choose', tone: 'accent' }
        : { line: 'Waiting for offers', button: 'Open', tone: 'blue' };
    case 'LOCKED':
      return task.funded_at
        ? { line: 'Helper about to start', button: 'Open', tone: 'blue' }
        : { line: 'Pay to start', button: 'Pay', tone: 'accent' };
    case 'TASK_STARTED':
      return { line: 'Work underway', button: 'Track', tone: 'blue' };
    case 'WORK_DONE':
      return { line: 'Work done · check it', button: 'Review', tone: 'gold' };
    case 'REVISION_REQUESTED':
      return { line: 'Changes asked', button: 'Open', tone: 'gold' };
    case 'OVERDUE':
      return { line: 'The date has passed', button: 'Open', tone: 'gold' };
    case 'DISPUTED':
      return { line: 'Problem reported', button: 'Open', tone: 'gold' };
    default:
      return { line: statusBadge(task).label, button: 'Open', tone: 'blue' };
  }
}

/** One of "Your published tasks": what it is, and the one next step. */
function PublishedCard({ task, offers, onPress }: { task: Task; offers: number; onPress: () => void }) {
  const t = useTheme();
  const width = useRailItemWidth(220);
  const step = nextStep(task, offers);
  const ink = step.tone === 'accent' ? t.colors.accentDeep : step.tone === 'gold' ? t.colors.goldInk : t.colors.blue;
  const left = task.status === 'OPEN' ? timeLeft(task.due_at) : null;
  const strong = step.tone === 'accent';
  return (
    <Pressy
      onPress={onPress}
      scaleTo={0.98}
      label={`${task.title}. ${step.line}. ${step.button}`}
      style={[cardSurface(t), strong ? { borderColor: t.colors.accentBorder } : null, { width, padding: 14 }]}
    >
      <RNText style={tx('800', 11, ink, { letterSpacing: 0.8 })} numberOfLines={1}>
        {step.line.toUpperCase()}
      </RNText>
      <RNText style={tx('700', 15, t.colors.ink, { marginTop: 4, lineHeight: 20, letterSpacing: -0.2 })} numberOfLines={2}>
        {task.title}
      </RNText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <RNText style={tx('800', 16, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{rupees(task.benchmark_minor / 100)}</RNText>
          {left ? <RNText style={tx('600', 11, t.colors.muted)}>{left}</RNText> : null}
        </View>
        <View
          style={{
            height: 34,
            borderRadius: 11,
            paddingHorizontal: 13,
            justifyContent: 'center',
            backgroundColor: strong ? t.colors.btn : t.colors.accentSoft,
          }}
        >
          <RNText style={tx('800', 12.5, strong ? t.colors.onBtn : t.colors.accentDeep)}>{step.button}</RNText>
        </View>
      </View>
    </Pressy>
  );
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
      <Icon name="help" size={Math.round(size * 0.55)} color="#FFFFFF" />
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
 * "Only on TaskDrop" (plan D22, H1): what other apps do not do, as big icons right under the
 * ask box. Every one of them already exists; this only moves them to the top.
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
    { icon: 'search', title: 'Find it\nfor me', bg: t.colors.goldSoft, ink: t.colors.goldInk, isNew: true, onPress: onHunt },
    { icon: 'calendarCheck', title: 'Plan a\nbig day', bg: t.colors.accent, ink: '#FFFFFF', onPress: onBigDay },
    { icon: 'users', title: 'Many\nhands', bg: t.colors.blue, ink: '#FFFFFF', onPress: () => onPrompt('I need a few people together to ') },
    { icon: 'chat', title: 'Get\nopinions', bg: t.colors.signal, ink: '#FFFFFF', onPress: () => onPrompt(opinions?.prompt ?? 'Ask people which they prefer: ') },
    { icon: 'tag', title: 'Price\ncheck', bg: t.colors.purple, ink: '#FFFFFF', onPress: () => onPrompt(prices?.prompt ?? 'Find 3 shops near me that sell ') },
  ];
  return (
    <View style={[cardSurface(t, 20), { marginTop: 14, padding: 14, borderColor: t.colors.gold }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="star" size={15} color={t.colors.goldInk} />
        <RNText style={tx('800', 15, t.colors.ink, { flex: 1 })}>Only on TaskDrop</RNText>
        {/* Phone board (Main): these are kinds of posts, so they carry the Ideas tag and a line saying so. */}
        {desktop ? null : <IdeaTag plural />}
      </View>
      {desktop ? null : (
        <RNText style={tx('500', 12, t.colors.muted, { marginTop: 4, lineHeight: 17 })}>
          Kinds of tasks you can post here. Tap one to start your own post.
        </RNText>
      )}
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
                borderColor: t.colors.gold,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={x.icon} size={desktop ? 21 : 24} color={x.ink} strokeWidth={2.2} />
              {x.isNew ? (
                <View style={{ position: 'absolute', top: -6, right: -8, borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1, backgroundColor: t.colors.signalFill }}>
                  <RNText style={tx('800', 9, '#FFFFFF')}>NEW</RNText>
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
        <RNText style={tx('700', 12, t.colors.goldInk)}>Find it for me: </RNText>
        many people look at once, you pay only the one who finds it.
      </RNText>
    </View>
  );
}

/** The template's own wording where it has one, so these tiles and the ideas never drift apart. */
function fromTemplate(key: string, fallback: string) {
  return TEMPLATES.find((x) => x.key === key)?.prompt ?? fallback;
}

const MANAGE: { icon: IconName; title: string; prompt: string }[] = [
  { icon: 'briefcase', title: 'Hand off a task', prompt: fromTemplate('offload', 'I need someone to finish this piece of work for me: ') },
  { icon: 'play', title: 'Reel editing', prompt: fromTemplate('edit-reel', 'Edit my raw footage into a 30-second reel with music and captions') },
  { icon: 'send', title: 'Job referral', prompt: fromTemplate('refer-me', 'Looking for an employee referral at ') },
  { icon: 'trending', title: 'Grow my page', prompt: fromTemplate('promote', 'Help me promote my Instagram page for my small business') },
  { icon: 'chat', title: 'Talk to someone who did it', prompt: fromTemplate('done-it', 'I want advice from someone who has already ') },
  { icon: 'wrench', title: 'Scooter repair', prompt: 'My scooter needs repair: ' },
  { icon: 'list', title: 'Govt form help', prompt: fromTemplate('govt-form', 'Help me fill and submit my ') },
  { icon: 'gavel', title: 'Legal services help', prompt: 'I need help from a lawyer with ' },
  { icon: 'users', title: 'Queue for me', prompt: 'Stand in the queue for me at ' },
];

// Poster ideas (D29, owner 11 Nov): outcome jobs no other app does, under "Idea templates for you" (D31).
type PosterIdea = { icon: IconName; title: string; problem: string; price: string; prompt: string };
const POSTER_IDEAS: { group: string; ideas: PosterIdea[] }[] = [
  {
    group: 'Money back',
    ideas: [
      { icon: 'wallet', title: 'Get my PF out', problem: 'PF claim rejected or stuck? Someone fixes it and follows up.', price: 'from ₹800', prompt: 'My PF withdrawal is stuck. Fix the problem and follow up until the money comes: ' },
      { icon: 'shield', title: 'Claim my insurance', problem: 'Hospital or vehicle claim stuck? Get it filed and paid.', price: 'from ₹1,000', prompt: 'My insurance claim is stuck. File the papers and follow up until it is paid: ' },
      { icon: 'home', title: 'Get my deposit back', problem: 'Moving out? Someone documents the flat and chases the owner.', price: 'from ₹1,000', prompt: 'I am moving out of my rented flat. Video the flat, list what is fair, and follow up with the owner for my deposit of ₹' },
      { icon: 'card', title: 'Fix my credit score', problem: 'A wrong entry on your CIBIL? Raise the dispute and follow it.', price: 'from ₹700', prompt: 'A wrong entry is showing on my CIBIL report. Raise the dispute and follow it until it is fixed: ' },
    ],
  },
  {
    group: 'Earn from it',
    ideas: [
      { icon: 'tag', title: 'Sell my stuff', problem: 'Moving or upgrading? Someone sells it for a good price.', price: '10% of the sale', prompt: 'Sell these things for me at a good price and handle the buyers: ' },
      { icon: 'home', title: 'Rent out my empty flat', problem: 'Find a tenant, show the flat, check them, sign the agreement.', price: 'from ₹3,000', prompt: 'Find a good tenant for my empty flat, show it, check them and get the agreement signed. The flat is in ' },
      { icon: 'camera', title: 'Shoot my products', problem: 'Photos that sell, for Instagram, Meesho or Amazon.', price: 'from ₹1,500', prompt: 'Take product photos for my online listing. Products: ' },
    ],
  },
  {
    group: 'Be there for me',
    ideas: [
      { icon: 'eye', title: 'Watch my plot', problem: 'Monthly photos of your plot or empty flat, and alerts.', price: '₹500 a month', prompt: 'Visit my plot once a month, send photos of the fence and boundary, and tell me if anyone builds near it. The plot is in ' },
      { icon: 'wrench', title: 'Watch my house being built', problem: 'Weekly site visits: material counts and photos.', price: '₹700 a visit', prompt: 'Visit my house construction site every week, count the cement and steel that came in, and send photos. The site is in ' },
      { icon: 'heart', title: 'Hospital runner', problem: 'Billing, insurance desk and medicines while you stay by the bed.', price: '₹1,500 a day', prompt: 'Someone in my family is in hospital. Handle the billing desk, insurance desk and medicines while I stay with them. Hospital: ' },
      { icon: 'gift', title: 'Surprise them for me', problem: 'Cake, flowers and a midnight surprise in another city.', price: 'from ₹2,000', prompt: 'Plan a midnight birthday surprise with cake, flowers and decoration, and send me a video. It is for my ' },
    ],
  },
  {
    group: 'Before I buy',
    ideas: [
      { icon: 'check', title: 'Check my new flat', problem: 'A snag list for the builder before you take possession.', price: 'from ₹3,000', prompt: 'I am taking possession of my new flat. Check every wall, tap and switch and give me a snag list for the builder. The flat is in ' },
      { icon: 'search', title: 'Check this plot before I buy', problem: 'EC, land records, a site visit and a word with neighbours.', price: 'from ₹2,500', prompt: 'Before I buy this plot, get the EC and land records, visit it and ask the neighbours about any disputes. The plot is in ' },
      { icon: 'compass', title: 'Flat hunt for me', problem: 'Shortlist, visit and video tour flats before you move.', price: 'from ₹1,500', prompt: 'I am moving to a new city. Shortlist 5 flats, visit them and send me video tours. Area and budget: ' },
    ],
  },
  {
    group: 'Grow my business',
    ideas: [
      { icon: 'globe', title: 'Put my shop online', problem: 'Google Maps, Swiggy or Zomato, and a WhatsApp catalogue.', price: 'from ₹2,000', prompt: 'Put my shop online: Google Maps listing, food or shopping apps, and a WhatsApp catalogue. My shop is ' },
      { icon: 'trending', title: 'Launch me in my area', problem: 'Get the word out in nearby societies and groups.', price: 'from ₹3,000', prompt: 'Tell the gated communities near me about my new business through society groups and a weekend stall. My business is ' },
    ],
  },
  {
    group: 'My career',
    ideas: [
      { icon: 'send', title: 'Apply for me', problem: '50 job applications a week, tracked in a sheet.', price: 'from ₹1,000', prompt: 'Apply to jobs for me this week with my resume and keep a sheet of where you applied. The roles I want: ' },
      { icon: 'list', title: 'Fill my college options', problem: 'Order your counselling choices for your rank.', price: 'from ₹800', prompt: 'Help me order my college options for counselling. My exam and rank: ' },
    ],
  },
];

/** "from ₹800" reads "₹800+" under "People often offer"; a price that says how it is paid stays as it is. */
function offerLine(price: string): string {
  return price.startsWith('from ') ? `${price.slice(5)}+` : price;
}

/**
 * "Idea templates for you" (D29 ideas, D31 boards): outcome jobs no other app does, read as ideas -- each card
 * carries the Idea tag, what people often offer, and "Post this idea", which fills the composer.
 */
function PosterIdeas({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  const t = useTheme();
  const [group, setGroup] = useState(POSTER_IDEAS[0].group);
  const ideas = (POSTER_IDEAS.find((g) => g.group === group) ?? POSTER_IDEAS[0]).ideas;
  const { desktop, tablet } = useLayout();
  return (
    <View style={{ marginTop: 32 }}>
      <SectionTitle title="Idea templates for you" icon="sparkle" />
      <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 4, lineHeight: 18 })}>
        {desktop
          ? 'Just ideas, not services from TaskDrop. Click one to post it as your own task; helpers send offers and you pick one.'
          : 'Just ideas, not services from TaskDrop. Tap one to post it as your own task; helpers send offers and you pick one.'}
      </RNText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8 }}>
        {POSTER_IDEAS.map((g) => {
          const on = g.group === group;
          return (
            <Pressy
              key={g.group}
              onPress={() => setGroup(g.group)}
              scaleTo={0.96}
              label={on ? `${g.group}, selected` : g.group}
              style={{
                borderRadius: 999,
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderWidth: 1.5,
                // The filled-button pair (B174): white on light jade in dark was 1.89:1.
                borderColor: on ? t.colors.btn : t.colors.accentBorder,
                backgroundColor: on ? t.colors.btn : 'transparent',
              }}
            >
              <RNText style={tx('700', 13, on ? t.colors.onBtn : t.colors.accentDeep)}>{g.group}</RNText>
            </Pressy>
          );
        })}
      </ScrollView>
      <View style={{ marginTop: 12 }}>
        {desktop || tablet ? (
          <Rail min={desktop ? 170 : 220}>
            {ideas.map((x) => (
              <IdeaCard key={x.title} idea={x} onPress={() => onPrompt(x.prompt)} />
            ))}
          </Rail>
        ) : (
          // Phone board (Main): two ideas a row, so a whole group is seen at once.
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {ideas.map((x) => (
              <View key={x.title} style={{ flexGrow: 1, flexBasis: '40%', maxWidth: '50%' }}>
                <IdeaCard idea={x} onPress={() => onPrompt(x.prompt)} fill />
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

/** One poster idea. A component of its own so it can read the width the Rail's grid gives it. */
function IdeaCard({
  idea: x,
  onPress,
  fill = false,
  priceLabel = 'People often offer',
  cta = 'Post this idea',
  hidePrice = false,
  testID,
}: {
  idea: PosterIdea;
  onPress: () => void;
  /** Fill its cell (phone grid). */
  fill?: boolean;
  /** Earn's ideas say what people often pay, and lead to Find work instead of the composer. */
  priceLabel?: string;
  cta?: string;
  /** The Add skill card has no price to show. */
  hidePrice?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const { desktop } = useLayout();
  const railWidth = useRailItemWidth(230);
  // Desktop only: tablets keep the fixed 230 they always had; the phone grid gives each card its cell.
  const width = fill ? undefined : desktop ? railWidth : 230;
  return (
    <Pressy
      testID={testID}
      onPress={onPress}
      scaleTo={0.97}
      label={hidePrice ? `${x.title}. ${x.problem} ${cta}` : `${x.title}. Idea. ${x.problem} ${priceLabel} ${offerLine(x.price)}. ${cta}`}
      style={[cardSurface(t, 16), { width, flex: fill ? 1 : undefined, padding: 12, gap: 8 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={x.icon} size={17} color={t.colors.accentDeep} />
        </View>
        <IdeaTag />
      </View>
      <RNText style={tx('800', 14, t.colors.ink, { lineHeight: 18 })} numberOfLines={2}>{x.title}</RNText>
      <RNText style={tx('500', 12, t.colors.muted, { lineHeight: 17 })} numberOfLines={3}>{x.problem}</RNText>
      <View style={{ flexGrow: 1 }} />
      {hidePrice ? null : (
      <View>
        <RNText style={tx('700', 10, t.colors.muted, { letterSpacing: 0.8 })}>{priceLabel.toUpperCase()}</RNText>
        <RNText style={tx('800', 14, t.colors.ink, { marginTop: 2, fontVariant: ['tabular-nums'] })}>{offerLine(x.price)}</RNText>
      </View>
      )}
      <View style={{ height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.accentSoft }}>
        <RNText style={tx('800', 12.5, t.colors.accentDeep)}>{cta} ›</RNText>
      </View>
    </Pressy>
  );
}

// D32: "Quick templates" on Hire Home. The composer's own templates under category chips; a tap opens the
// new-task screen with the words and the suggested day already in, and the poster changes anything.
function HomeTemplates({ onPick }: { onPick: (x: HomeTemplate) => void }) {
  const t = useTheme();
  const { desktop, tablet } = useLayout();
  const all = homeTemplates(TEMPLATES);
  const chips = templateCategories(all, CATEGORIES);
  const [cat, setCat] = useState<Category | null>(null);
  const list = templatesIn(all, cat);
  const chip = (label: string, on: boolean, onPress: () => void) => (
    <Pressy
      key={label}
      onPress={onPress}
      scaleTo={0.96}
      label={on ? `${label}, selected` : label}
      style={{
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderWidth: 1.5,
        borderColor: on ? t.colors.btn : t.colors.accentBorder,
        backgroundColor: on ? t.colors.btn : 'transparent',
      }}
    >
      <RNText style={tx('700', 13, on ? t.colors.onBtn : t.colors.accentDeep)}>{label}</RNText>
    </Pressy>
  );
  // A wide screen lays the cards out in a grid, so "For you" shows the first eight; a chip shows all of its own.
  const shown = (desktop || tablet) && cat === null ? list.slice(0, 8) : list;
  const cards = shown.map((x) => <TemplateCard key={x.key} item={x} onPress={() => onPick(x)} wide={desktop || tablet} />);
  return (
    <View testID="home-templates" style={{ marginTop: 32 }}>
      <SectionTitle title="Quick templates" icon="sparkle" />
      <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 4, lineHeight: 18 })}>
        {desktop
          ? 'Click one to start your post. The words and day are filled in; you change anything.'
          : 'Tap one to start your post. The words and day are filled in; you change anything.'}
      </RNText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8 }}>
        {chip('For you', cat === null, () => setCat(null))}
        {chips.map((c) => chip(c, cat === c, () => setCat(c)))}
      </ScrollView>
      <View style={{ marginTop: 12 }}>
        {desktop || tablet ? (
          <Rail min={desktop ? 170 : 220}>{cards}</Rail>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {cards}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function TemplateCard({ item: x, onPress, wide }: { item: HomeTemplate; onPress: () => void; wide: boolean }) {
  const t = useTheme();
  const { desktop } = useLayout();
  const railWidth = useRailItemWidth(230);
  const width = wide ? (desktop ? railWidth : 230) : 190;
  return (
    <Pressy
      testID={`home-template-${x.key}`}
      onPress={onPress}
      scaleTo={0.97}
      label={`${x.title}. ${x.sub}. Day filled in: ${WHEN_WORDS[x.when]}. Opens the new task screen`}
      style={[cardSurface(t, 16), { width, padding: 12, gap: 6 }]}
    >
      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={x.icon} size={17} color={t.colors.accentDeep} />
      </View>
      <RNText style={tx('800', 14, t.colors.ink, { lineHeight: 18 })} numberOfLines={2}>{x.title}</RNText>
      <RNText style={tx('600', 11.5, t.colors.accentDeep)} numberOfLines={1}>{x.category}</RNText>
      <RNText style={tx('500', 12, t.colors.muted, { lineHeight: 17 })} numberOfLines={2}>{x.sub}</RNText>
      <View style={{ flexGrow: 1 }} />
      <RNText style={tx('600', 11.5, t.colors.muted)}>Day filled in: {WHEN_WORDS[x.when]}</RNText>
      <View style={{ height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.accentSoft }}>
        <RNText style={tx('800', 12.5, t.colors.accentDeep)}>Use this ›</RNText>
      </View>
    </Pressy>
  );
}

// Ideas to earn (D31 boards, Earn Home): kinds of work people post on TaskDrop, the worker's side of the poster ideas
// above, with the same typical prices. Static idea content: no counts, no live jobs claimed. Each opens Find work
// searched for that kind of job (the search may well find none open today).
const EARN_IDEAS: (PosterIdea & { search: string })[] = [
  { icon: 'camera', title: 'Shoot product photos', problem: 'Small sellers need photos that sell on Instagram, Meesho or Amazon.', price: 'from ₹1,500', prompt: '', search: 'photos' },
  { icon: 'wallet', title: 'Chase a stuck claim', problem: 'PF and insurance claims that need papers filed and follow-ups.', price: 'from ₹800', prompt: '', search: 'claim' },
  { icon: 'wrench', title: 'Weekly site visits', problem: 'Count the material and send photos of a house being built.', price: '₹700 a visit', prompt: '', search: 'site' },
  { icon: 'heart', title: 'Hospital runner', problem: 'Billing, insurance desk and medicines while the family stays by the bed.', price: '₹1,500 a day', prompt: '', search: 'hospital' },
  { icon: 'compass', title: 'Flat hunting tours', problem: 'Shortlist, visit and video tour flats for someone moving to your city.', price: 'from ₹1,500', prompt: '', search: 'flat' },
  { icon: 'globe', title: 'Put a shop online', problem: 'Google Maps, food apps and a WhatsApp catalogue for a local shop.', price: 'from ₹2,000', prompt: '', search: 'shop' },
];

/** D32: the last card of Earn's templates opens Edit skills. No price, so none is shown. */
const ADD_SKILL: PosterIdea = { icon: 'star', title: 'Add a skill', problem: 'Tell us what you can do and see jobs that match.', price: '', prompt: '' };

/**
 * "Ideas to earn" (D31 boards, Earn Home): read as ideas -- the Idea tag, "Just ideas…", what people often pay --
 * each leading to Find work searched for that kind of job. Royal blue: Earn's accent tokens.
 */
function EarnIdeas({ onSearch, onAddSkill }: { onSearch: (q: string) => void; onAddSkill: () => void }) {
  const t = useTheme();
  const { desktop, tablet } = useLayout();
  return (
    <View testID="home-earn-templates" style={{ marginTop: 32 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <SectionTitle title="Idea templates for you" icon="sparkle" />
        </View>
        <IdeaTag plural />
      </View>
      <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 4, lineHeight: 18 })}>
        {desktop
          ? 'Kinds of work you can pick up. Click one to look for jobs like it, or add the skill.'
          : 'Kinds of work you can pick up. Tap one to look for jobs like it, or add the skill.'}
      </RNText>
      <View style={{ marginTop: 12 }}>
        {desktop || tablet ? (
          <Rail min={desktop ? 170 : 220}>
            {EARN_IDEAS.map((x) => (
              <IdeaCard key={x.title} idea={x} onPress={() => onSearch(x.search)} priceLabel="People often pay" cta="Find jobs like this" />
            ))}
            <IdeaCard testID="home-add-skill" idea={ADD_SKILL} onPress={onAddSkill} hidePrice cta="Add to my skills" />
          </Rail>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {EARN_IDEAS.map((x) => (
              <View key={x.title} style={{ flexGrow: 1, flexBasis: '40%', maxWidth: '50%' }}>
                <IdeaCard idea={x} onPress={() => onSearch(x.search)} priceLabel="People often pay" cta="Find jobs like this" fill />
              </View>
            ))}
            <View style={{ flexGrow: 1, flexBasis: '40%', maxWidth: '50%' }}>
              <IdeaCard testID="home-add-skill" idea={ADD_SKILL} onPress={onAddSkill} hidePrice cta="Add to my skills" fill />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function ManageTile({ item, onPress, perRow }: { item: (typeof MANAGE)[number]; onPress: () => void; perRow?: number }) {
  const t = useTheme();
  if (perRow) {
    // Desktop (WebHire): a row tile -- the icon, the idea and its Idea tag -- three to a row.
    return (
      <View style={{ flexGrow: 1, flexBasis: `${100 / perRow - 0.01}%`, minWidth: 0, padding: 5, flexDirection: 'row' }}>
        <Pressy
          onPress={onPress}
          scaleTo={0.98}
          label={`${item.title}. Idea`}
          style={[cardSurface(t, 14), { flexGrow: 1, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }]}
        >
          <Icon name={item.icon} size={18} color={t.colors.accentDeep} />
          <RNText style={tx('700', 14, t.colors.ink, { flex: 1, lineHeight: 18 })} numberOfLines={2}>
            {item.title}
          </RNText>
          <IdeaTag />
        </Pressy>
      </View>
    );
  }
  return (
    <Pressy
      onPress={onPress}
      scaleTo={0.97}
      label={item.title}
      style={[cardSurface(t, 16), { flexGrow: 1, flexBasis: '30%', minHeight: 104, padding: 12, alignItems: 'center', justifyContent: 'center', gap: 9 }]}
    >
      <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={item.icon} size={19} color={t.colors.accentDeep} />
      </View>
      <RNText style={tx('700', 12.5, t.colors.ink, { textAlign: 'center', lineHeight: 16 })} numberOfLines={3}>
        {item.title}
      </RNText>
    </Pressy>
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
        <Drop size={74} fill="#FFFFFF" tick={t.colors.heroMid} />
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
              backgroundColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000',
              shadowOpacity: 0.2,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <RNText style={tx('800', 15, onHero.letter)}>{p.k}</RNText>
            {p.on ? (
              <View
                style={{
                  position: 'absolute',
                  right: -1,
                  bottom: -1,
                  width: 11,
                  height: 11,
                  borderRadius: 999,
                  backgroundColor: '#4ADE9A',
                  borderWidth: 2,
                  borderColor: '#FFFFFF',
                }}
              />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}
