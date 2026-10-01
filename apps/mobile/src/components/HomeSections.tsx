import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, TextInput } from 'react-native';
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
import { useVoiceInput } from '../lib/speech';
import { contactIssueMessage, findContactIssue } from '../lib/mask';
import { taskToFeedRow } from '../lib/openTask';
import { statusBadge } from '../screens/MyTasksScreen';
import { Icon } from './Icon';
import { Badge, BottomSheet, Grid, SectionTitle, Shimmer, rupees, timeLeft } from './kit';
import { WorkCard, categoryIcon } from './WorkCard';
import { BidSheet } from './BidSheet';
import { LiveWorkers } from './LiveWorkers';
import { Rail } from './Rail';
import { HowItWorks } from './HowItWorks';
import { LocationSheet, type PickedPlace } from './LocationSheet';
import { resolveCurrentPlace } from '../lib/location';
import { roughPlace } from '../lib/place';
import { Pressy, tx } from './primitives';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

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

  // The composer on the card: typed (or spoken) here, sent to the posting flow.
  const [prompt, setPrompt] = useState('');
  const [focused, setFocused] = useState(false);
  const voice = useVoiceInput((text) => setPrompt((cur) => (cur ? cur + ' ' + text : text)), flash);
  const issue = findContactIssue(prompt);
  const submit = () => {
    if (prompt.trim().length < 3) return flash('Tell us what you need done');
    if (issue) return flash(contactIssueMessage(issue));
    go('aiPost', { prompt: prompt.trim() });
    setPrompt('');
  };
  const busiest = Math.max(1, ...trending.map((c) => c.open_count));

  return (
    <View style={{ paddingHorizontal: 20 }}>
      <AreaBar
        label={place}
        sub={(area) => (area ? 'Your posts reach workers around here' : 'So workers near you see your posts')}
        onPress={() => setPickPlace(true)}
        flush
      />

      {/* The composer: the card itself is where you type. Sending opens the
          step-by-step flow with these words, which asks the quick questions,
          writes the post and checks it with you. */}
      <View
        style={{
          marginTop: 6,
          borderRadius: 22,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: issue ? t.colors.signal : focused ? t.colors.accent : t.colors.line,
          backgroundColor: t.colors.surface,
          shadowColor: t.colors.accent,
          shadowOpacity: focused ? 0.22 : 0.1,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 6 },
          elevation: 3,
        }}
      >
        <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0 }} width="100%" height={150} preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="composerGlow" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={t.colors.accent} stopOpacity={0.2} />
              <Stop offset="0.55" stopColor={t.colors.accent} stopOpacity={0.04} />
              <Stop offset="1" stopColor={t.colors.accent} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="150" fill="url(#composerGlow)" />
        </Svg>
        <View style={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="edit" size={13} color={t.colors.accentDeep} />
            <RNText style={tx('700', 11, t.colors.accentDeep, { letterSpacing: 0.6 })}>WE WRITE THE POST FOR YOU</RNText>
          </View>
          <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.6, marginTop: 8 })}>Drop a task</RNText>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            onSubmitEditing={submit}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="What do you need done? E.g. service my scooter this week"
            placeholderTextColor={t.colors.muted}
            multiline
            blurOnSubmit
            returnKeyType="send"
            style={tx('400', 16, t.colors.ink, {
              minHeight: 56,
              maxHeight: 120,
              padding: 0,
              marginTop: 10,
              lineHeight: 23,
              textAlignVertical: 'top',
            })}
          />
          {issue ? (
            <RNText style={tx('600', 12, t.colors.signalDeep, { marginTop: 8, lineHeight: 17 })}>
              {contactIssueMessage(issue)}
            </RNText>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {quick.slice(0, 2).map((x) => (
                <Pressable
                  key={x.key}
                  onPress={() => go('aiPost', { prompt: x.prompt })}
                  accessibilityRole="button"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    borderRadius: 999,
                    backgroundColor: t.colors.surface2,
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                  }}
                >
                  <Icon name={x.icon} size={12} color={t.colors.accentDeep} />
                  <RNText style={tx('600', 11, t.colors.text)}>{x.title}</RNText>
                </Pressable>
              ))}
            </View>
            {voice.supported ? (
              <Pressable
                onPress={voice.toggle}
                accessibilityRole="button"
                accessibilityLabel="Voice typing"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: voice.listening ? t.colors.signalSoft : t.colors.surface2,
                }}
              >
                <Icon name="mic" size={18} color={voice.listening ? t.colors.signal : t.colors.muted} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={submit}
              accessibilityRole="button"
              accessibilityLabel="Continue"
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: prompt.trim().length >= 3 && !issue ? t.colors.accent : t.colors.surface2,
              }}
            >
              <Icon
                name="send"
                size={17}
                color={prompt.trim().length >= 3 && !issue ? t.colors.onAccent : t.colors.muted}
                strokeWidth={2}
              />
            </Pressable>
          </View>
        </View>
      </View>

      <Pressable
        onPress={() => setHowOpen(true)}
        accessibilityRole="button"
        style={({ pressed }) => ({
          marginTop: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: t.colors.line,
          borderRadius: 14,
          paddingVertical: 11,
          paddingHorizontal: 14,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <View style={{ width: 30, height: 30, borderRadius: 999, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="help" size={16} color={t.colors.accentDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <RNText style={tx('700', 13, t.colors.ink)}>How TaskDrop works</RNText>
          <RNText style={tx('400', 11, t.colors.muted, { marginTop: 1 })}>Post, get offers, pay safely, approve — in pictures</RNText>
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
            style={{ marginTop: 24 }}
          />
          <View style={{ marginTop: 10 }}>
            <Rail>
              {active.map((task) => {
                const b = statusBadge(task);
                const left = timeLeft(task.due_at);
                return (
                  <Pressy
                    key={task.id}
                    onPress={() => openPostedTask(task, go)}
                    scaleTo={0.98}
                    style={{
                      width: 200,
                      backgroundColor: t.colors.surface,
                      borderWidth: 1,
                      borderColor: t.colors.line,
                      borderRadius: 14,
                      padding: 12,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Icon name={categoryIcon(task.category)} size={16} color={t.colors.accentDeep} />
                      <Badge label={b.label} tone={b.tone} />
                    </View>
                    <RNText style={tx('700', 13, t.colors.ink, { marginTop: 8 })} numberOfLines={2}>
                      {task.title}
                    </RNText>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <RNText style={tx('800', 13, t.colors.accentDeep)}>{rupees(task.benchmark_minor / 100)}</RNText>
                      {left && task.status === 'OPEN' ? (
                        <RNText style={tx('500', 11, t.colors.goldInk)}>{left}</RNText>
                      ) : null}
                    </View>
                  </Pressy>
                );
              })}
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
        style={{ marginTop: 24 }}
      />
      <View style={{ marginTop: 12 }}>
        <Rail step={300}>
          {TEMPLATES.slice(0, 8).map((x) => (
            <Pressy
              key={x.key}
              onPress={() => go('aiPost', { prompt: x.prompt })}
              scaleTo={0.97}
              label={x.title}
              style={{
                width: 138,
                backgroundColor: t.colors.surface,
                borderWidth: 1,
                borderColor: t.colors.line,
                borderRadius: 16,
                padding: 12,
              }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  backgroundColor: t.colors.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={x.icon} size={17} color={t.colors.accentDeep} />
              </View>
              <RNText style={tx('700', 13, t.colors.ink, { marginTop: 10 })} numberOfLines={1}>
                {x.title}
              </RNText>
              <RNText style={tx('400', 11, t.colors.muted, { marginTop: 3, lineHeight: 15 })} numberOfLines={2}>
                {x.sub}
              </RNText>
            </Pressy>
          ))}
        </Rail>
      </View>

      {/* What is busy */}
      {trending.length > 0 ? (
        <>
          <SectionTitle title="Busy on TaskDrop" icon="trending" style={{ marginTop: 24 }} />
          <View
            style={{
              marginTop: 10,
              backgroundColor: t.colors.surface,
              borderWidth: 1,
              borderColor: t.colors.line,
              borderRadius: 14,
              paddingHorizontal: 12,
            }}
          >
            {trending.map((c, i) => (
              <Pressable
                key={c.category}
                onPress={() => go('aiPost', { prompt: `I need help with ${c.category.toLowerCase()}: ` })}
                accessibilityRole="button"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 11,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: t.colors.line,
                }}
              >
                <Icon name={categoryIcon(c.category)} size={16} color={t.colors.accentDeep} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <RNText style={tx('600', 13, t.colors.ink)} numberOfLines={1}>
                      {c.category}
                    </RNText>
                    <RNText style={tx('500', 11, t.colors.muted)}>
                      {c.open_count} open · ~{rupees(c.avg_budget_minor / 100)}
                    </RNText>
                  </View>
                  <View style={{ height: 4, borderRadius: 999, backgroundColor: t.colors.surface2, marginTop: 6 }}>
                    <View
                      style={{
                        height: 4,
                        borderRadius: 999,
                        width: `${Math.max(8, Math.round((c.open_count / busiest) * 100))}%`,
                        backgroundColor: t.colors.accent,
                      }}
                    />
                  </View>
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
        gap: 8,
        marginHorizontal: flush ? 0 : 20,
        marginTop: 6,
        paddingVertical: 6,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 30, height: 30, borderRadius: 999, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="pin" size={16} color={t.colors.accentDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <RNText style={tx('800', 15, t.colors.ink)} numberOfLines={1}>
            {areaName ?? 'Set your location'}
          </RNText>
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <Icon name="chevronRight" size={14} color={t.colors.ink} />
          </View>
        </View>
        <RNText style={tx('400', 11, t.colors.muted)} numberOfLines={1}>
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
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <RNText style={tx('700', 12, t.colors.purpleDeep)}>
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

      <View style={{ paddingHorizontal: 20, marginTop: 6 }}>
        {/* Where you stand, in one card: level, jobs on the go, availability. */}
        <View style={{ backgroundColor: t.colors.purpleDeep, borderRadius: 18, padding: 16, overflow: 'hidden' }}>
          <View
            style={{
              position: 'absolute',
              right: -30,
              top: -30,
              width: 120,
              height: 120,
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.08)',
            }}
          />
          <RNText style={tx('600', 12, 'rgba(255,255,255,0.75)')}>Find your next job</RNText>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 6 }}>
            <View style={{ flex: 1 }}>
              <RNText style={tx('800', 20, '#FFFFFF', { letterSpacing: -0.4 })}>{level.name}</RNText>
              <View
                style={{
                  height: 5,
                  borderRadius: 999,
                  backgroundColor: 'rgba(255,255,255,0.22)',
                  marginTop: 8,
                  overflow: 'hidden',
                }}
              >
                <View style={{ height: 5, width: `${Math.round(level.progress * 100)}%`, backgroundColor: '#FFFFFF' }} />
              </View>
              <RNText style={tx('400', 11, 'rgba(255,255,255,0.8)', { marginTop: 6 })}>
                {level.next
                  ? `${level.jobsToGo} job${level.jobsToGo === 1 ? '' : 's'}${level.ratingShort ? ` + ★ ${level.next.rating}` : ''} to ${level.next.name}`
                  : 'Highest level'}
              </RNText>
            </View>
            <View style={{ alignItems: 'center' }}>
              <RNText style={tx('800', 22, '#FFFFFF')}>{w?.jobsLive ?? 0}</RNText>
              <RNText style={tx('500', 11, 'rgba(255,255,255,0.8)')}>on the go</RNText>
            </View>
          </View>
          <Pressy
            onPress={() => setHowOpen(true)}
            style={{
              marginTop: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: 'rgba(255,255,255,0.14)',
              borderRadius: 999,
              paddingVertical: 9,
              paddingHorizontal: 14,
              alignSelf: 'flex-start',
            }}
          >
            <Icon name="help" size={14} color="#FFFFFF" />
            <RNText style={tx('700', 12, '#FFFFFF')}>How TaskDrop works</RNText>
          </Pressy>
        </View>
      </View>

      {/* Search lives on Browse jobs; tapping here goes straight there. */}
      <Pressable
        onPress={() => go('explore', { focusSearch: Date.now() })}
        accessibilityRole="search"
        accessibilityLabel="Search jobs"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginHorizontal: 20,
          marginTop: 14,
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: pressed ? t.colors.purple : t.colors.line,
          borderRadius: 999,
          paddingLeft: 14,
          paddingRight: 5,
          paddingVertical: 5,
        })}
      >
        <Icon name="search" size={16} color={t.colors.muted} />
        <RNText style={tx('400', 14, t.colors.muted, { flex: 1, paddingVertical: 7 })} numberOfLines={1}>
          Search jobs: data entry, logo, tutoring…
        </RNText>
        <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: t.colors.purpleDeep, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="search" size={16} color="#FFFFFF" strokeWidth={2} />
        </View>
      </Pressable>

      <View style={{ paddingHorizontal: 20 }}>
        {/* 1. Skills */}
        <SectionTitle
          title="Matches your skills"
          icon="star"
          action="Edit skills"
          onAction={() => go('profileEdit')}
          style={{ marginTop: 22 }}
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
          style={{ marginTop: 26 }}
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
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: radius === km ? t.colors.accent : t.colors.line,
                    backgroundColor: radius === km ? t.colors.accentSoft : 'transparent',
                  }}
                >
                  <RNText style={tx('700', 12, radius === km ? t.colors.accentDeep : t.colors.muted)}>{km} km</RNText>
                </Pressable>
              ))}
            </View>
            {near === null ? (
              <Shimmer height={110} style={{ marginTop: 12 }} />
            ) : near.length === 0 ? (
              <View
                style={{
                  marginTop: 12,
                  backgroundColor: t.colors.surface,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  borderRadius: 14,
                  padding: 14,
                }}
              >
                <RNText style={tx('600', 13, t.colors.ink)}>No jobs within {radius} km yet</RNText>
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
              borderRadius: 14,
              padding: 14,
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
        <SectionTitle title="Remote & online" icon="compass" style={{ marginTop: 26 }} />
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
            <SectionTitle title="Needed today" icon="bolt" badge="Urgent" style={{ marginTop: 26 }} />
            <Grid>{firstFew('urgent', urgent).map((task, i) => card(task, i))}</Grid>
            {more('urgent', urgent.length)}
          </>
        ) : null}

        <Pressable
          onPress={() => go('explore')}
          style={{ alignSelf: 'center', marginTop: 18, marginBottom: 20 }}
          accessibilityRole="button"
        >
          <RNText style={tx('700', 13, t.colors.purpleDeep)}>See every open job ›</RNText>
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
