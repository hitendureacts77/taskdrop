import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, TextInput, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
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
  setLive,
  setSaved,
  trendingCategories,
  type TrendingCategory,
} from '../data/extras';
import { TEMPLATES } from '../lib/taskBrief';
import { levelFor } from '../lib/levels';
import { useVoiceInput } from '../lib/speech';
import { taskToFeedRow } from '../lib/openTask';
import { SearchBox } from '../screens/ExploreScreen';
import { statusBadge } from '../screens/MyTasksScreen';
import { Icon } from './Icon';
import { Badge, SectionTitle, Shimmer, rupees, timeLeft } from './kit';
import { WorkCard, categoryIcon } from './WorkCard';
import { BidSheet } from './BidSheet';
import { LiveWorkers } from './LiveWorkers';
import { LocationSheet, type PickedPlace } from './LocationSheet';
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
  const { go, screen } = useNav();
  const { flash } = useApp();
  const { userId } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [active, setActive] = useState<Task[] | null>(null);
  const [trending, setTrending] = useState<TrendingCategory[]>([]);

  const voice = useVoiceInput((text) => setPrompt((cur) => (cur ? cur + ' ' + text : text)), flash);

  useEffect(() => {
    if (!userId || screen !== 'home') return;
    let alive = true;
    listMyTasks(userId)
      .then(
        (rows) =>
          alive &&
          setActive(rows.filter((r) => !['COMPLETED', 'AUTO_COMPLETED', 'CANCELLED'].includes(r.status)).slice(0, 4)),
      )
      .catch(() => alive && setActive([]));
    trendingCategories(5)
      .then((r) => alive && setTrending(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, screen]);

  const submit = () => {
    if (prompt.trim().length < 3) return flash('Tell us what you need done');
    go('aiPost', { prompt: prompt.trim() });
    setPrompt('');
  };

  const quick = TEMPLATES.filter((x) => x.hot).slice(0, 4);
  const busiest = Math.max(1, ...trending.map((c) => c.open_count));

  return (
    <View style={{ paddingHorizontal: 20 }}>
      {/* Composer */}
      <View
        style={{
          marginTop: 10,
          borderRadius: 20,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: t.colors.accentBorder,
          backgroundColor: t.colors.surface,
        }}
      >
        <View style={{ backgroundColor: t.colors.accentDeep, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
          <RNText style={tx('800', 20, '#FFFFFF', { letterSpacing: -0.4 })}>Drop a task</RNText>
          <RNText style={tx('400', 12, 'rgba(255,255,255,0.85)', { marginTop: 3 })}>
            Say it in your own words. We’ll turn it into a post.
          </RNText>
        </View>
        <View style={{ padding: 12 }}>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            onSubmitEditing={submit}
            placeholder="E.g. get my scooter serviced this week, or find 3 caterers for 40 people…"
            placeholderTextColor={t.colors.muted}
            multiline
            blurOnSubmit
            returnKeyType="send"
            style={tx('400', 15, t.colors.ink, { minHeight: 52, maxHeight: 110, padding: 0, textAlignVertical: 'top' })}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Icon name="sparkle" size={14} color={t.colors.ai} />
            <RNText style={tx('500', 11, t.colors.muted, { flex: 1 })}>AI drafts it, you check it</RNText>
            {voice.supported ? (
              <Pressable
                onPress={voice.toggle}
                accessibilityRole="button"
                accessibilityLabel="Voice typing"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: voice.listening ? t.colors.signalSoft : t.colors.surface2,
                }}
              >
                <Icon name="mic" size={17} color={voice.listening ? t.colors.signal : t.colors.muted} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={submit}
              accessibilityRole="button"
              accessibilityLabel="Continue"
              style={{
                height: 36,
                borderRadius: 999,
                paddingHorizontal: 14,
                flexDirection: 'row',
                gap: 6,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: t.colors.accent,
              }}
            >
              <RNText style={tx('700', 13, t.colors.onAccent)}>Next</RNText>
              <Icon name="send" size={14} color={t.colors.onAccent} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingBottom: 12 }}>
          {quick.map((x) => (
            <Pressable
              key={x.key}
              onPress={() => go('aiPost', { prompt: x.prompt })}
              accessibilityRole="button"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: t.colors.line,
                paddingVertical: 5,
                paddingHorizontal: 10,
              }}
            >
              <Icon name={x.icon} size={12} color={t.colors.accentDeep} />
              <RNText style={tx('600', 11, t.colors.text)}>{x.title}</RNText>
            </Pressable>
          ))}
        </View>
      </View>

      {/* What they already have going */}
      {active && active.length > 0 ? (
        <>
          <SectionTitle
            title="Your tasks"
            icon="briefcase"
            action="Manage"
            onAction={() => go('myTasks')}
            style={{ marginTop: 24 }}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10, marginHorizontal: -20 }}>
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20 }}>
              {active.map((task) => {
                const b = statusBadge(task);
                const left = timeLeft(task.due_at);
                return (
                  <Pressy
                    key={task.id}
                    onPress={() => go('taskManage', { taskId: task.id })}
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
            </View>
          </ScrollView>
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: -20 }}>
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20 }}>
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
        </View>
      </ScrollView>

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
  const { flash, celebrate } = useApp();
  const { userId } = useAuth();
  const [q, setQ] = useState('');
  const [stats, setStats] = useState<MyStats | null>(null);
  const [rating, setRating] = useState(0);
  const [skills, setSkills] = useState<string[]>([]);
  const [liveUntil, setLiveUntil] = useState<string | null>(null);
  const [place, setPlace] = useState<{ label: string; lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(10);
  const [pickPlace, setPickPlace] = useState(false);
  const [recs, setRecs] = useState<TaskWithPoster[] | null>(null);
  const [near, setNear] = useState<(TaskWithPoster & { km: number })[] | null>(null);
  const [remote, setRemote] = useState<TaskWithPoster[] | null>(null);
  const [urgent, setUrgent] = useState<TaskWithPoster[]>([]);
  const [saved, setSavedIds] = useState<Set<string>>(new Set());
  const [bidTask, setBidTask] = useState<Task | null>(null);
  const [, setTick] = useState(0);

  const voice = useVoiceInput((text) => setQ((cur) => (cur ? cur + ' ' + text : text)), flash);

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
    setLiveUntil(p?.live_until ?? null);
    setSavedIds(ids);
    setPlace((cur) => {
      if (p?.loc_lat == null || p?.loc_lng == null) return null;
      // Same pin as before: keep the object, so the nearby list isn't refetched.
      if (cur && cur.lat === p.loc_lat && cur.lng === p.loc_lng) return cur;
      return { label: p.loc_label ?? 'Your area', lat: p.loc_lat, lng: p.loc_lng };
    });
    const [r, rem, urg] = await Promise.all([
      recommendedTasks(p?.skills ?? [], 3).catch(() => []),
      remoteTasks(4).catch(() => []),
      urgentTasks(3).catch(() => []),
    ]);
    const [rp, remp, urgp] = await Promise.all([attachPosters(r), attachPosters(rem), attachPosters(urg)]);
    setRecs(rp);
    setRemote(remp);
    setUrgent(urgp);
  }, [userId]);

  useEffect(() => {
    if (screen === 'home') void load();
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
    void tasksNear(place, radius, 5)
      .then(async (rows) => {
        const withPeople = await attachPosters(rows);
        if (alive) setNear(withPeople.map((x, i) => ({ ...x, km: rows[i]!.km })));
      })
      .catch(() => alive && setNear([]));
    return () => {
      alive = false;
    };
  }, [place, radius]);

  // Re-render every 30s while available, so the countdown moves.
  const live = liveUntil !== null && new Date(liveUntil).getTime() > Date.now();
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [live]);

  const w = stats && stats.role === 'worker' ? stats : null;
  const level = levelFor(w?.jobsDone ?? 0, rating);
  const minsLeft = live ? Math.max(1, Math.round((new Date(liveUntil!).getTime() - Date.now()) / 60000)) : 0;

  const toggleLive = async () => {
    if (!userId) return;
    try {
      const until = await setLive(userId, live ? 0 : 30);
      setLiveUntil(until);
      if (until) celebrate('Posters can see you’re available');
      else flash('You’re no longer shown as available');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not update that');
    }
  };

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

  const areaName = place
    ? (place.label.split(',').map((x) => x.trim()).filter(Boolean)[0] ?? 'your area')
    : null;

  return (
    <View>
      <View style={{ paddingHorizontal: 20, marginTop: 10 }}>
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
            onPress={() => void toggleLive()}
            style={{
              marginTop: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: live ? '#FFFFFF' : 'rgba(255,255,255,0.14)',
              borderRadius: 999,
              paddingVertical: 9,
              paddingHorizontal: 14,
              alignSelf: 'flex-start',
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                backgroundColor: live ? t.colors.accent : 'rgba(255,255,255,0.6)',
              }}
            />
            <RNText style={tx('700', 12, live ? t.colors.purpleDeep : '#FFFFFF')}>
              {live ? `Available now · ${minsLeft} min · tap to stop` : 'Show me as available for 30 min'}
            </RNText>
          </Pressy>
        </View>
      </View>

      <SearchBox
        value={q}
        onChange={setQ}
        onSubmit={() => go('explore', { q: q.trim() })}
        placeholder="Search jobs: data entry, logo, tutoring…"
        voice={voice}
        tone="purple"
      />

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
          recs.map((task, i) => card(task, i))
        )}

        {/* 2. Near the area the worker chose */}
        <SectionTitle
          title={areaName ? `Near ${areaName}` : 'Work near you'}
          icon="pin"
          action={place ? 'Change area' : undefined}
          onAction={() => setPickPlace(true)}
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
              near.map((task, i) => card(task, i, task.km))
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
          remote.map((task, i) => card(task, i))
        )}

        {/* 4. Needed today */}
        {urgent.length > 0 ? (
          <>
            <SectionTitle title="Needed today" icon="bolt" badge="Urgent" style={{ marginTop: 26 }} />
            {urgent.map((task, i) => card(task, i))}
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
