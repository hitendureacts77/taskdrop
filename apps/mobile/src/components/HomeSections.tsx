import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated, Easing } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { openPostedTask } from '../lib/taskRows';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import {
  attachPosters,
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
  recommendedTasks,
  remoteTasks,
  tasksNear,
  urgentTasks,
  setSaved,
  trendingCategories,
  type TrendingCategory,
} from '../data/extras';
import { TEMPLATES } from '../lib/taskBrief';
import { levelFor } from '../lib/levels';
import { taskToFeedRow } from '../lib/openTask';
import { statusBadge } from '../screens/MyTasksScreen';
import { Icon } from './Icon';
import { Badge, BottomSheet, Grid, SectionTitle, Shimmer, rupees, timeLeft } from './kit';
import { WorkCard, categoryIcon } from './WorkCard';
import { BidSheet } from './BidSheet';
import { LiveWorkers } from './LiveWorkers';
import { Rail, useRailItemWidth } from './Rail';
import { HeroCard } from './Hero';
import { Drop, Ripples } from './Ripples';
import { cardSurface } from './ui';
import { useLayout } from '../lib/layout';
import { useReducedMotion } from '../lib/motion';
import type { IconName } from './Icon';
import { HowItWorks } from './HowItWorks';
import { LocationSheet, type PickedPlace } from './LocationSheet';
import { resolveCurrentPlace } from '../lib/location';
import { roughPlace } from '../lib/place';
import { Pressy, tx } from './primitives';

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
  const { go, screen } = useNav();
  const { flash } = useActions();
  const { userId } = useAuth();
  const [active, setActive] = useState<Task[] | null>(null);
  const [trending, setTrending] = useState<TrendingCategory[]>([]);
  const [howOpen, setHowOpen] = useState(false);
  const [place, setPlace] = useState<string | null>(null);
  const [pickPlace, setPickPlace] = useState(false);

  useEffect(() => {
    if (!userId || screen !== 'home') return;
    let alive = true;
    getProfile(userId)
      .then((p) => alive && setPlace(p?.loc_label ?? null))
      .catch(() => {});
    listMyTasks(userId)
      .then(
        (rows) =>
          alive &&
          setActive(rows.filter((r) => !['COMPLETED', 'AUTO_COMPLETED', 'CANCELLED'].includes(r.status)).slice(0, 4)),
      )
      .catch(() => alive && setActive([]));
    trendingCategories(5)
      .then((r) => alive && setTrending(r.filter((c) => c.open_count > 0)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, screen]);

  // The same area a worker sets: where this poster's jobs usually are, and
  // the starting point of every post's location.
  const choosePlace = async (picked: PickedPlace) => {
    setPickPlace(false);
    if (picked.lat === null || picked.lng === null) return flash('Drop a pin on the map to set your area');
    const label = picked.area || picked.label;
    setPlace(label);
    if (!userId) return;
    await updateProfile(userId, { locLabel: label, locLat: picked.lat, locLng: picked.lng }).catch((e) =>
      flash(e instanceof Error ? e.message : 'Could not save your area'),
    );
  };

  const quick = TEMPLATES.filter((x) => x.hot).slice(0, 4);

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

      {/* The composer, on the v2 hero: the card itself is where you type.
          Sending opens the step-by-step flow with these words, which asks the
          quick questions, writes the post and checks it with you. */}
      <HeroCard style={{ marginTop: 10 }} padding={wideHero ? 30 : 20}>
        <View style={{ flexDirection: 'row', gap: 28 }}>
          <View style={{ flex: 1.25 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="edit" size={13} color="rgba(255,255,255,0.85)" />
              <RNText style={tx('700', 11, 'rgba(255,255,255,0.85)', { letterSpacing: 1.3 })}>WE WRITE THE POST FOR YOU</RNText>
            </View>
            <RNText style={tx('800', wideHero ? 36 : 28, '#FFFFFF', { letterSpacing: -0.9, marginTop: 8 })}>Drop a task</RNText>
            <Pressable
              onPress={openComposer}
              accessibilityRole="button"
              accessibilityLabel="What do you need done? Opens the new task screen"
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
                What do you need done? E.g. service my scooter this week
              </RNText>
              <View style={{ width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.btn }}>
                <Icon name="edit" size={17} color={t.colors.onBtn} strokeWidth={2} />
              </View>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {/* Said out loud, so the two chips read as examples to try rather than the only choices. */}
                <RNText style={tx('700', 12, 'rgba(255,255,255,0.85)')}>Try:</RNText>
                {quick.slice(0, 2).map((x) => (
                  <Pressable
                    key={x.key}
                    onPress={() => go('aiPost', { prompt: x.prompt })}
                    accessibilityRole="button"
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      height: 32,
                      borderRadius: 999,
                      backgroundColor: hovered ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.16)',
                      paddingHorizontal: 12,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <Icon name={x.icon} size={13} color="#FFFFFF" />
                    <RNText style={tx('600', 12.5, '#FFFFFF')}>{x.title}</RNText>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
          {wideHero ? <HeroArt /> : null}
        </View>
      </HeroCard>

      <Pressable
        onPress={() => setHowOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="How TaskDrop works"
        style={({ pressed }) => [
          cardSurface(t),
          {
            marginTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 13,
            paddingHorizontal: 15,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          },
        ]}
      >
        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="help" size={17} color={t.colors.accentDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <RNText style={tx('800', 14, t.colors.ink)}>How TaskDrop works</RNText>
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>Post, get offers, pay safely, approve — in pictures</RNText>
          <StepsMini />
        </View>
        <Icon name="chevronRight" size={16} color={t.colors.muted} />
      </Pressable>
      <BottomSheet visible={howOpen} onClose={() => setHowOpen(false)} title="How TaskDrop works" subtitle="Hiring, step by step">
        <HowItWorks side="hire" />
      </BottomSheet>

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
                <PublishedCard key={task.id} task={task} onPress={() => openPostedTask(task, go)} />
              ))}
            </Rail>
          </View>
        </>
      ) : null}

      <LiveWorkers active={screen === 'home'} />

      {/* Starting points */}
      <SectionTitle
        title="Start from an idea"
        icon="sparkle"
        action="See all"
        onAction={() => go('explore')}
        style={{ marginTop: 32 }}
      />
      <View style={{ marginTop: 12 }}>
        <Rail step={300} min={160}>
          {TEMPLATES.slice(0, 8).map((x) => (
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
  const area = label ? roughPlace(label) : null;
  const areaName = area ? area.split(',')[0]! : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={area ? `Your area: ${area}. Change` : 'Set your area'}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: flush ? 0 : 20,
        marginTop: 4,
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
  const { userId } = useAuth();
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
    if (!userId) return;
    const [s, p, ids] = await Promise.all([
      myStats('worker').catch(() => null),
      getProfile(userId).catch(() => null),
      listSavedTaskIds().catch(() => new Set<string>()),
    ]);
    setStats(s);
    setRating(Number(p?.worker_rating_avg ?? 0));
    setSkills(p?.skills ?? []);
    setSavedIds(ids);
    setPlace((cur) => {
      if (p?.loc_lat == null || p?.loc_lng == null) return null;
      // Same pin as before: keep the object, so the nearby list isn't refetched.
      if (cur && cur.lat === p.loc_lat && cur.lng === p.loc_lng) return cur;
      return { label: p.loc_label ?? 'Your area', lat: p.loc_lat, lng: p.loc_lng };
    });
    const [r, rem, urg] = await Promise.all([
      recommendedTasks(p?.skills ?? [], 8).catch(() => []),
      remoteTasks(8).catch(() => []),
      urgentTasks(6).catch(() => []),
    ]);
    const [rp, remp, urgp] = await Promise.all([attachPosters(r), attachPosters(rem), attachPosters(urg)]);
    setRecs(rp);
    setRemote(remp);
    setUrgent(urgp);
  }, [userId]);

  useEffect(() => {
    if (screen === 'home') void load();
  }, [load, screen]);

  const askedLocation = useRef(false);
  useEffect(() => {
    if (!userId || place || askedLocation.current || recs === null) return;
    askedLocation.current = true;
    void resolveCurrentPlace()
      .then((found) => choosePlace(found))
      .catch(() => {
        /* declined or unavailable: the "Set your area" card stays */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, place, recs]);

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
        if (alive) setNear(withPeople.map((x, i) => ({ ...x, km: rows[i]!.km })));
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
          <RNText style={tx('700', 12, 'rgba(255,255,255,0.82)')}>Find your next job</RNText>
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
          <Pressy
            onPress={() => setHowOpen(true)}
            style={{
              marginTop: 16,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: 'rgba(255,255,255,0.16)',
              borderRadius: 999,
              height: 36,
              paddingHorizontal: 14,
              alignSelf: 'flex-start',
            }}
          >
            <Icon name="help" size={14} color="#FFFFFF" />
            <RNText style={tx('700', 12.5, '#FFFFFF')}>How TaskDrop works</RNText>
          </Pressy>
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
      <BottomSheet visible={howOpen} onClose={() => setHowOpen(false)} title="How TaskDrop works" subtitle="Earning, step by step">
        <HowItWorks side="earn" />
      </BottomSheet>
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

/** Post · Offers · Pay · Approve, as a small numbered path. */
function StepsMini() {
  const t = useTheme();
  const steps = ['Post', 'Offers', 'Pay', 'Approve'];
  return (
    // One line, always (owner, 2026-10-30): the connectors stretch to share the width rather than wrapping.
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 8 }}>
      {steps.map((s, i) => (
        <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1, flexGrow: i > 0 ? 1 : 0 }}>
          {i > 0 ? <View style={{ flexGrow: 1, minWidth: 4, maxWidth: 14, height: 1.5, backgroundColor: t.colors.line }} /> : null}
          <View style={{ width: 16, height: 16, borderRadius: 999, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}>
            <RNText style={tx('800', 9, t.colors.onBtn)}>{i + 1}</RNText>
          </View>
          <RNText numberOfLines={1} style={tx('700', 10.5, t.colors.accentDeep, { flexShrink: 1 })}>
            {s}
          </RNText>
        </View>
      ))}
    </View>
  );
}

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

/** One of "Your published tasks". */
function PublishedCard({ task, onPress }: { task: Task; onPress: () => void }) {
  const t = useTheme();
  const width = useRailItemWidth(200);
  const b = statusBadge(task);
  const left = timeLeft(task.due_at);
  return (
    <Pressy onPress={onPress} scaleTo={0.98} label={task.title} style={[cardSurface(t), { width, padding: 14 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={categoryIcon(task.category)} size={15} color={t.colors.accentDeep} />
        </View>
        <Badge label={b.label} tone={b.tone} />
      </View>
      <RNText style={tx('700', 15, t.colors.ink, { marginTop: 12, lineHeight: 20, letterSpacing: -0.2 })} numberOfLines={2}>
        {task.title}
      </RNText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <RNText style={tx('800', 18, t.colors.accentDeep, { fontVariant: ['tabular-nums'], letterSpacing: -0.3 })}>
          {rupees(task.benchmark_minor / 100)}
        </RNText>
        {left && task.status === 'OPEN' ? <RNText style={tx('600', 11, t.colors.goldInk)}>{left}</RNText> : null}
      </View>
    </Pressy>
  );
}

/** One of "Start from an idea". */
function IdeaCard({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  const t = useTheme();
  const width = useRailItemWidth(150);
  return (
    <Pressy onPress={onPress} scaleTo={0.97} label={title} style={[cardSurface(t), { width, padding: 14 }]}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={t.colors.accentDeep} />
      </View>
      <RNText style={tx('800', 14, t.colors.ink, { marginTop: 12, letterSpacing: -0.2 })} numberOfLines={1}>
        {title}
      </RNText>
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3, lineHeight: 17 })} numberOfLines={2}>
        {sub}
      </RNText>
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
