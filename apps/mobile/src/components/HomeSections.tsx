import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated, Easing } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
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
import { useVoiceInput } from '../lib/speech';
import { listGuestSaves, setGuestSaved } from '../lib/guestSaves';
import { TEMPLATES } from '../lib/taskBrief';
import { levelFor } from '../lib/levels';
import { taskToFeedRow } from '../lib/openTask';
import { statusBadge } from '../screens/MyTasksScreen';
import { Icon } from './Icon';
import { Grid, SectionTitle, Shimmer, rupees, timeLeft } from './kit';
import { WorkCard, categoryIcon } from './WorkCard';
import { BidSheet } from './BidSheet';
import { Rail, useRailItemWidth } from './Rail';
import { HeroCard } from './Hero';
import { GetAppButton } from './AppQr';
import { Drop, Ripples } from './Ripples';
import { cardSurface } from './ui';
import { useLayout } from '../lib/layout';
import { useReducedMotion } from '../lib/motion';
import type { IconName } from './Icon';
import { HowSheet } from './HowSheet';
import { LocationSheet, type PickedPlace } from './LocationSheet';
import { resolveCurrentPlace } from '../lib/location';
import { roughPlace } from '../lib/place';
import { Pressy, tx } from './primitives';

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

/** The top of the home screen, above the existing feed. */
export function HomeSections() {
  const { mode } = useMode();
  return mode === 'worker' ? <EarnTop /> : <PostTop />;
}

// ------------------------------------------------------------ posting -------

/**
 * The poster's home: a composer first, because that is what they came to do,
 * then what they already have going, who is free right now, a row of
 * starting points, and what is busy on TaskDrop.
 */
function PostTop() {
  const t = useTheme();
  // The wide composer gets its picture beside it (W2).
  const { desktop } = useLayout();
  const wideHero = desktop;
  const { go } = useNav();
  const { flash } = useActions();
  const { userId, guest } = useAuth();
  const [active, setActive] = useState<Task[] | null>(null);
  const [offers, setOffers] = useState<Map<string, number>>(new Map());
  const [trending, setTrending] = useState<TrendingCategory[]>([]);
  const [howOpen, setHowOpen] = useState(false);
  const [place, setPlace] = useState<string | null>(null);
  const [pickPlace, setPickPlace] = useState(false);
  const [pulse, setPulse] = useState<NearbyPulse | null>(null);
  // Only to know whether this browser can listen; the composer does the listening.
  const canSpeak = useVoiceInput(() => {}).supported;

  // What is going on around the poster's area, in two real numbers (item 4).
  const loadPulse = useCallback(async (at: { lat: number; lng: number } | null, alive: () => boolean = () => true) => {
    const got = at ? await nearbyPulse(at) : null;
    if (alive()) setPulse(got);
  }, []);

  const loadTop = useCallback(
    async (alive: () => boolean) => {
      if (!userId) {
        // A guest sees what is trending; nothing of theirs to load.
        if (guest) await trendingCategories(5).then((r) => alive() && setTrending(r.filter((c) => c.open_count > 0))).catch(() => {});
        return;
      }
      await Promise.all([
        getProfile(userId)
          .then((p) => {
            if (!alive()) return;
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
    void loadPulse({ lat: picked.lat, lng: picked.lng });
    if (!userId) return;
    await updateProfile(userId, { locLabel: label, locLat: picked.lat, locLng: picked.lng }).catch((e) =>
      flash(e instanceof Error ? e.message : 'Could not save your area'),
    );
  };

  // Get opinions and Price check sit in "Only on TaskDrop"; the rest stay here as more ideas.
  const moreIdeas = TEMPLATES.filter((x) => !ONLY_HERE_KEYS.includes(x.key)).slice(0, 8);

  // The card is a doorway: one tap opens the full-screen composer with the
  // keyboard already up, like starting a quick post.
  const openComposer = () => go('aiPost');
  const busiest = Math.max(1, ...trending.map((c) => c.open_count));

  return (
    <View style={{ paddingHorizontal: 20 }}>
      <AreaBar
        label={place}
        sub={(area) => (area ? 'Your posts reach workers around here' : 'So workers near you see your posts')}
        onPress={() => setPickPlace(true)}
        flush
      />
      <PulseLine pulse={pulse} />

      {/* The composer, on the v2 hero: the card itself is where you type.
          Sending opens the step-by-step flow with these words, which asks the
          quick questions, writes the post and checks it with you. */}
      <HeroCard style={{ marginTop: 10 }} padding={wideHero ? 30 : 20}>
        <View style={{ flexDirection: 'row', gap: 28 }}>
          <View style={{ flex: 1.25 }}>
            {/* D22: the question is the title; "How TaskDrop works" is the ? beside it. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <RNText style={tx('800', wideHero ? 34 : 24, '#FFFFFF', { letterSpacing: -0.7, flex: 1, lineHeight: wideHero ? 40 : 30 })}>
                What do you need done?
              </RNText>
              <HowButton onPress={() => setHowOpen(true)} />
            </View>
            <Pressable
              onPress={openComposer}
              accessibilityRole="button"
              accessibilityLabel="Say what you need. Opens the new task screen"
              style={({ pressed }) => ({
                marginTop: 14,
                borderRadius: 16,
                paddingHorizontal: 15,
                paddingVertical: 12,
                minHeight: 72,
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 10,
                backgroundColor: t.isDark ? 'rgba(10,12,14,0.55)' : '#FFFFFF',
                borderWidth: t.isDark ? 1 : 0,
                borderColor: 'rgba(255,255,255,0.2)',
                transform: [{ scale: pressed ? 0.985 : 1 }],
              })}
            >
              <RNText style={tx('400', 15, t.isDark ? 'rgba(213,217,221,0.75)' : t.colors.muted, { flex: 1, lineHeight: 22 })}>
                Say it your way, e.g. clean my kitchen tomorrow
              </RNText>
              {/* Start by talking: the composer opens already listening. Only where the device can listen (lib/speech). */}
              {canSpeak ? (
                <Pressable
                  onPress={() => go('aiPost', { listen: true })}
                  accessibilityRole="button"
                  accessibilityLabel="Speak your task"
                  hitSlop={6}
                  style={({ pressed }) => ({
                    width: 38,
                    height: 38,
                    borderRadius: 999,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1.5,
                    borderColor: t.isDark ? 'rgba(255,255,255,0.55)' : t.colors.line,
                    transform: [{ scale: pressed ? 0.94 : 1 }],
                  })}
                >
                  <Icon name="mic" size={17} color={t.isDark ? '#FFFFFF' : t.colors.ink} strokeWidth={2} />
                </Pressable>
              ) : null}
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
                    backgroundColor: hovered ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.16)',
                    paddingHorizontal: 13,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  })}
                >
                  <RNText style={tx('700', 12.5, '#FFFFFF')}>{d.label}</RNText>
                </Pressable>
              ))}
            </View>
          </View>
          {wideHero ? <HeroArt /> : null}
        </View>
      </HeroCard>

      {/* D22 H1: what only TaskDrop does, as big icons right under the ask box. */}
      <OnlyOnTaskDrop
        onHunt={() => go('aiPost', { prompt: 'Find me ', hunt: true })}
        onBigDay={() => go('bigDay')}
        onPrompt={(prompt) => go('aiPost', { prompt })}
      />

      <HowSheet visible={howOpen} onClose={() => setHowOpen(false)} side="hire" />

      {/* What they already have going */}
      {active && active.length > 0 ? (
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
      ) : null}

      {/* D22 A1: everyday jobs, one tap fills the composer. */}
      <SectionTitle title="Everyday help" icon="wrench" style={{ marginTop: 32 }} />
      <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {EVERYDAY.map((x) => (
          <EverydayTile key={x.title} item={x} onPress={() => go('aiPost', { prompt: x.prompt })} />
        ))}
      </View>

      {/* Every other idea stays one swipe away. */}
      <SectionTitle title="More ideas" icon="sparkle" style={{ marginTop: 32 }} />
      <View style={{ marginTop: 12 }}>
        <Rail step={300} min={160}>
          {moreIdeas.map((x) => (
            <IdeaCard key={x.key} icon={x.icon} title={x.title} sub={x.sub} onPress={() => go('aiPost', { prompt: x.prompt })} />
          ))}
        </Rail>
      </View>

      {/* What is busy */}
      {trending.length > 0 ? (
        <>
          <SectionTitle title="Busy on TaskDrop" icon="trending" style={{ marginTop: 32 }} />
          <View style={[cardSurface(t, 20), { marginTop: 12, paddingHorizontal: 14 }]}>
            {trending.map((c, i) => (
              <Pressable
                key={c.category}
                onPress={() => go('aiPost', { prompt: `I need help with ${c.category.toLowerCase()}: ` })}
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
      <LocationSheet
        visible={pickPlace}
        askForDetails={false}
        onCancel={() => setPickPlace(false)}
        onPick={(p) => void choosePlace(p)}
      />
    </View>
  );
}

/**
 * One line under the poster's area: tasks finished near there today and
 * helpers there right now. Real counts from nearby_pulse (migration 140);
 * a part that is zero is left out, and nothing shows when both are.
 */
function PulseLine({ pulse }: { pulse: NearbyPulse | null }) {
  const t = useTheme();
  const done = pulse?.doneToday ?? 0;
  const active = pulse?.activeNow ?? 0;
  if (done <= 0 && active <= 0) return null;
  const lead = done > 0 ? `${done} done near you today` : `${active} ${active === 1 ? 'helper' : 'helpers'} active now`;
  const rest = done > 0 && active > 0 ? ` · ${active} ${active === 1 ? 'helper' : 'helpers'} active now` : '';
  return (
    <View
      accessibilityRole="text"
      style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: t.colors.accentSoft }}
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
}: {
  label: string | null;
  sub: (area: string | null, areaName: string | null) => string;
  onPress: () => void;
  /** Already inside a padded column. */
  flush?: boolean;
}) {
  const t = useTheme();
  // On a desktop browser the row also carries "Get the app" (a QR to the Android app; web only).
  const { desktop } = useLayout();
  const area = label ? roughPlace(label) : null;
  const areaName = area ? area.split(',')[0]! : null;
  const bar = (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={area ? `Your area: ${area}. Change` : 'Set your area'}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
        gap: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="pin" size={17} color={t.colors.accentDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <RNText style={tx('800', 16, t.colors.ink, { letterSpacing: -0.2 })} numberOfLines={1}>
            {areaName ?? 'Set your location'}
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
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: flush ? 0 : 20, marginTop: 4 }}>
      {bar}
      {desktop ? <GetAppButton /> : null}
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
  const [place, setPlace] = useState<{ label: string; lat: number; lng: number } | null>(null);
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


  const load = useCallback(async () => {
    if (!userId && !guest) return;
    // Remote and urgent work do not depend on the profile, so they are asked for beside it.
    const remoteAsked = remoteTasks(8).catch((): Task[] => []);
    const urgentAsked = urgentTasks(6).catch((): Task[] => []);
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
    setPlace((cur) => {
      if (!userId) return cur;
      if (p?.loc_lat == null || p?.loc_lng == null) return null;
      // Same pin as before: keep the object, so the nearby list isn't refetched.
      if (cur && cur.lat === p.loc_lat && cur.lng === p.loc_lng) return cur;
      return { label: p.loc_label ?? 'Your area', lat: p.loc_lat, lng: p.loc_lng };
    });
    const [r, rem, urg] = await Promise.all([
      recommendedTasks(p?.skills ?? [], 8).catch(() => []),
      remoteAsked,
      urgentAsked,
    ]);
    // One poster lookup for all three lists, each keeping its own order (a task no longer visible drops out).
    const withPosters = new Map((await attachPosters([...r, ...rem, ...urg])).map((x) => [x.id, x]));
    const posted = (list: Task[]) => list.flatMap((x) => withPosters.get(x.id) ?? []);
    setRecs(posted(r));
    setRemote(posted(rem));
    setUrgent(posted(urg));
  }, [userId, guest]);

  useHomeLoad(load);

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
    if (!userId) return;
    await updateProfile(userId, { locLabel: next.label, locLat: next.lat, locLng: next.lng }).catch((e) =>
      flash(e instanceof Error ? e.message : 'Could not save your area'),
    );
  };

  // Two per section to start with; "Show more" opens the rest in place.
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
      onOpen={() => go('taskDetail', { row: taskToFeedRow(task) })}
      onApply={() => setBidTask(task)}
      onToggleSave={() => void toggleSave(task.id)}
    />
  );

  const area = place ? roughPlace(place.label) : null;
  const areaName = area ? area.split(',')[0]! : null;

  return (
    <View>
      <AreaBar
        label={place?.label ?? null}
        sub={(a, n) => (a && a !== n ? `${a} · jobs near you` : a ? 'Showing jobs near you' : 'To show jobs near you')}
        onPress={() => setPickPlace(true)}
      />

      <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
        {/* Where you stand, in one card: level, jobs on the go, availability. */}
        <HeroCard radius={24} padding={18} watermark={false} ringSize={200}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <RNText style={tx('700', 12, 'rgba(255,255,255,0.82)', { flex: 1 })}>Find your next job</RNText>
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
              <RNText style={tx('500', 12, 'rgba(255,255,255,0.85)', { marginTop: 8 })}>
                {level.next
                  ? `${level.jobsToGo} job${level.jobsToGo === 1 ? '' : 's'}${level.ratingShort ? ` + ★ ${level.next.rating}` : ''} to ${level.next.name}`
                  : 'Highest level'}
              </RNText>
            </View>
            <View style={{ alignItems: 'center', minWidth: 64 }}>
              <RNText style={tx('800', 30, '#FFFFFF', { fontVariant: ['tabular-nums'] })}>{w?.jobsLive ?? 0}</RNText>
              <RNText style={tx('600', 11.5, 'rgba(255,255,255,0.85)')}>on the go</RNText>
            </View>
          </View>
        </HeroCard>
      </View>

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

      <View style={{ paddingHorizontal: 20 }}>
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
            <Grid>{firstFew('recs', recs).map((task, i) => card(task, i))}</Grid>
            {more('recs', recs.length)}
          </>
        )}

        {/* 2. Near the area the worker chose */}
        <SectionTitle
          title={areaName ? `Jobs near ${areaName}` : 'Jobs near you'}
          icon="pin"
          style={{ marginTop: 32 }}
        />
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
              <View style={[cardSurface(t), { marginTop: 12, padding: 16 }]}>
                <RNText style={tx('700', 14, t.colors.ink)}>No jobs within {radius} km yet</RNText>
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>
                  {radius < 50 ? 'Widen the radius, or try remote work below.' : 'Try remote work below, or another area.'}
                </RNText>
              </View>
            ) : (
              <>
                <Grid>{firstFew('near', near).map((task, i) => card(task, i, task.km))}</Grid>
                {more('near', near.length)}
              </>
            )}
          </>
        ) : (
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
        )}

        {/* 3. From anywhere */}
        <SectionTitle title="Remote & online" icon="compass" style={{ marginTop: 32 }} />
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>Work you can do from your phone or laptop</RNText>
        {remote === null ? (
          <Shimmer height={110} style={{ marginTop: 12 }} />
        ) : remote.length === 0 ? (
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 10 })}>No remote jobs open right now.</RNText>
        ) : (
          <>
            <Grid>{firstFew('remote', remote).map((task, i) => card(task, i))}</Grid>
            {more('remote', remote.length)}
          </>
        )}

        {/* 4. Needed today */}
        {urgent.length > 0 ? (
          <>
            <SectionTitle title="Needed today" icon="bolt" badge="Urgent" style={{ marginTop: 32 }} />
            <Grid>{firstFew('urgent', urgent).map((task, i) => card(task, i))}</Grid>
            {more('urgent', urgent.length)}
          </>
        ) : null}

        <Pressable
          onPress={() => go('explore')}
          style={{ alignSelf: 'center', marginTop: 18, marginBottom: 20 }}
          accessibilityRole="button"
        >
          <RNText style={tx('700', 13, t.colors.accentDeep)}>See every open job ›</RNText>
        </Pressable>
      </View>
      <HowSheet visible={howOpen} onClose={() => setHowOpen(false)} side="earn" />
      <BidSheet task={bidTask} visible={bidTask !== null} onClose={() => setBidTask(null)} onPlaced={() => void load()} />
      <LocationSheet
        visible={pickPlace}
        askForDetails={false}
        onCancel={() => setPickPlace(false)}
        onPick={(p) => void choosePlace(p)}
      />
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
 * one button. A date that has passed asks to move it instead of shouting "overdue".
 */
function nextStep(task: Task, offers: number): { line: string; button: string; tone: 'accent' | 'blue' | 'gold' } {
  switch (task.status) {
    case 'OPEN':
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
      return { line: 'The date has passed', button: 'Move the date', tone: 'gold' };
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

/** The day chips under the ask box; the keys are the composer's own When choices. */
const DAY_CHIPS: { key: string; label: string }[] = [
  { key: 'now', label: 'Right now' },
  { key: 'today', label: 'Today' },
  { key: '2days', label: 'In 2 days' },
  { key: 'week', label: 'This week' },
];

/** Templates shown as "Only on TaskDrop" icons, so the ideas rail does not repeat them. */
const ONLY_HERE_KEYS = ['ask-people', 'find-quotes'];

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
  const opinions = TEMPLATES.find((x) => x.key === 'ask-people');
  const prices = TEMPLATES.find((x) => x.key === 'find-quotes');
  const items: { icon: IconName; title: string; bg: string; ink: string; isNew?: boolean; onPress: () => void }[] = [
    { icon: 'search', title: 'Find it\nfor me', bg: t.colors.gold, ink: t.colors.goldInk, isNew: true, onPress: onHunt },
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
      </View>
      <View style={{ flexDirection: 'row', marginTop: 14 }}>
        {items.map((x) => (
          <Pressy
            key={x.title}
            onPress={x.onPress}
            scaleTo={0.94}
            label={x.isNew ? `${x.title.replace('\n', ' ')}. New` : x.title.replace('\n', ' ')}
            style={{ flex: 1, alignItems: 'center' }}
          >
            <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: x.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={x.icon} size={24} color={x.ink} strokeWidth={2.2} />
              {x.isNew ? (
                <View style={{ position: 'absolute', top: -6, right: -8, borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1, backgroundColor: t.colors.signalDeep }}>
                  <RNText style={tx('800', 9, '#FFFFFF')}>NEW</RNText>
                </View>
              ) : null}
            </View>
            <RNText style={tx('700', 11.5, t.colors.ink, { marginTop: 7, textAlign: 'center', lineHeight: 14 })}>{x.title}</RNText>
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

/** Everyday jobs (plan D22, A1): one tap fills the composer with a sentence to finish. */
const EVERYDAY: { icon: IconName; title: string; sub: string; prompt: string }[] = [
  { icon: 'sparkle', title: 'Cleaning', sub: 'Kitchen, bathroom', prompt: 'Deep clean my ' },
  { icon: 'wrench', title: 'Repairs', sub: 'Fan, tap, switch', prompt: 'Fix my ' },
  { icon: 'send', title: 'Pick up & drop', sub: 'Parcel, medicine', prompt: 'Pick up and drop ' },
  { icon: 'users', title: 'Queue for me', sub: 'Bank, RTO', prompt: 'Stand in the queue for me at ' },
  { icon: 'briefcase', title: 'Shifting help', sub: 'Pack, lift', prompt: 'Help me shift ' },
  { icon: 'globe', title: 'Online help', sub: 'Forms, documents', prompt: 'Help me fill and submit my ' },
];

function EverydayTile({ item, onPress }: { item: (typeof EVERYDAY)[number]; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressy
      onPress={onPress}
      scaleTo={0.97}
      label={`${item.title}. ${item.sub}`}
      style={[cardSurface(t, 14), { flexGrow: 1, flexBasis: '30%', minWidth: 100, padding: 11 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={item.icon} size={15} color={t.colors.accentDeep} />
        </View>
        <RNText style={tx('700', 13, t.colors.ink, { flex: 1, lineHeight: 16 })} numberOfLines={2}>
          {item.title}
        </RNText>
      </View>
      <RNText style={tx('400', 11.5, t.colors.muted, { marginTop: 6 })} numberOfLines={1}>
        {item.sub}
      </RNText>
    </Pressy>
  );
}

/** One of "Start from an idea". */
function IdeaCard({
  icon,
  title,
  sub,
  onPress,
  tag,
  gold,
}: {
  icon: IconName;
  title: string;
  sub: string;
  onPress: () => void;
  /** A small "NEW" tag under the text. */
  tag?: string;
  /** Gold styling, for the Hunt tile. */
  gold?: boolean;
}) {
  const t = useTheme();
  const width = useRailItemWidth(150);
  const tint = gold ? t.colors.goldSoft : t.colors.accentSoft;
  const ink = gold ? t.colors.goldInk : t.colors.accentDeep;
  return (
    <Pressy
      onPress={onPress}
      scaleTo={0.97}
      label={tag ? `${title}. New` : title}
      style={[cardSurface(t), gold ? { borderColor: t.colors.gold } : null, { width, padding: 14 }]}
    >
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={ink} />
      </View>
      <RNText style={tx('800', 14, t.colors.ink, { marginTop: 12, letterSpacing: -0.2 })} numberOfLines={1}>
        {title}
      </RNText>
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3, lineHeight: 17 })} numberOfLines={2}>
        {sub}
      </RNText>
      {tag ? (
        <View style={{ alignSelf: 'flex-start', marginTop: 8, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: tint }}>
          <RNText style={tx('800', 10, ink, { letterSpacing: 0.8 })}>{tag}</RNText>
        </View>
      ) : null}
    </Pressy>
  );
}

/**
 * The wide composer's picture: the drop at the centre of its ripples, with
 * people around it -- a task going out to whoever can do it.
 */
function HeroArt() {
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
      style={{ flex: 0.75, minHeight: 230, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 220, height: 220, alignItems: 'center', justifyContent: 'center' }}>
        <Ripples color="rgba(255,255,255,0.45)" size={220} count={3} duration={3800} />
        <View style={{ position: 'absolute', width: 116, height: 116, borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' }} />
        <Drop size={74} fill="#FFFFFF" tick={t.colors.heroMid} />
      </View>
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
          <RNText style={tx('800', 15, t.colors.purple)}>{p.k}</RNText>
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
  );
}
