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
  type MyStats,
  type Task,
  type TaskWithPoster,
} from '../data/api';
import {
  listSavedTaskIds,
  recommendedTasks,
  setLive,
  setSaved,
  trendingCategories,
  type TrendingCategory,
} from '../data/extras';
import { TEMPLATES } from '../lib/taskBrief';
import { levelFor } from '../lib/levels';
import { useVoiceInput } from '../lib/speech';
import { taskToFeedRow } from '../lib/openTask';
import { TemplateGrid, SearchBox } from '../screens/ExploreScreen';
import { statusBadge } from '../screens/MyTasksScreen';
import { Icon } from './Icon';
import { Badge, SectionTitle, Shimmer, rupees, timeLeft } from './kit';
import { WorkCard, categoryIcon } from './WorkCard';
import { BidSheet } from './BidSheet';
import { LiveWorkers } from './LiveWorkers';
import { Pressy, tx } from './primitives';

/** The top of the home screen, above the existing feed. */
export function HomeSections() {
  const { mode } = useMode();
  return mode === 'worker' ? <EarnTop /> : <PostTop />;
}

// ------------------------------------------------------------ posting -------

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
      .then((rows) =>
        alive &&
        setActive(rows.filter((r) => !['COMPLETED', 'AUTO_COMPLETED', 'CANCELLED'].includes(r.status)).slice(0, 2)),
      )
      .catch(() => alive && setActive([]));
    trendingCategories(6)
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

  return (
    <View style={{ paddingHorizontal: 20 }}>
      <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5, textAlign: 'center', marginTop: 12 })}>
        What’s on your mind?
      </RNText>
      <View
        style={{
          marginTop: 12,
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: t.colors.accentBorder,
          borderRadius: 16,
          padding: 12,
          shadowColor: t.colors.accent,
          shadowOpacity: 0.12,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        }}
      >
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          onSubmitEditing={submit}
          placeholder="E.g. ask 10 people which offer to take, fix my scooter, get quotes for a sofa…"
          placeholderTextColor={t.colors.muted}
          multiline
          blurOnSubmit
          returnKeyType="send"
          style={tx('400', 15, t.colors.ink, { minHeight: 48, maxHeight: 110, padding: 0, textAlignVertical: 'top' })}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Icon name="sparkle" size={14} color={t.colors.ai} />
          <RNText style={tx('500', 11, t.colors.muted, { flex: 1 })}>AI writes the post for you</RNText>
          {voice.supported ? (
            <Pressable
              onPress={voice.toggle}
              accessibilityRole="button"
              accessibilityLabel="Voice typing"
              style={{ width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: voice.listening ? t.colors.signalSoft : t.colors.surface2 }}
            >
              <Icon name="mic" size={17} color={voice.listening ? t.colors.signal : t.colors.muted} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={submit}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            style={{ width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.accent }}
          >
            <Icon name="send" size={16} color={t.colors.onAccent} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      <LiveWorkers active={screen === 'home'} />

      {active && active.length > 0 ? (
        <>
          <SectionTitle title="My active tasks" icon="briefcase" action="See all" onAction={() => go('myTasks')} style={{ marginTop: 24 }} />
          {active.map((task) => {
            const b = statusBadge(task);
            const left = timeLeft(task.due_at);
            return (
              <Pressy
                key={task.id}
                onPress={() => go('taskManage', { taskId: task.id })}
                scaleTo={0.985}
                style={{ flexDirection: 'row', gap: 12, marginTop: 10, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 12 }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={categoryIcon(task.category)} size={19} color={t.colors.accentDeep} />
                </View>
                <View style={{ flex: 1 }}>
                  <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={1}>{task.title}</RNText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }}>
                    <RNText style={tx('800', 13, t.colors.ink)}>{rupees(task.benchmark_minor / 100)}</RNText>
                    <Badge label={b.label} tone={b.tone} />
                    {left && task.status === 'OPEN' ? <RNText style={tx('500', 11, t.colors.goldInk)}>{left}</RNText> : null}
                  </View>
                </View>
                <Icon name="chevronRight" size={16} color={t.colors.muted} />
              </Pressy>
            );
          })}
        </>
      ) : null}

      <SectionTitle title="Try asking" icon="sparkle" action={`See all ${TEMPLATES.length}`} onAction={() => go('explore')} style={{ marginTop: 24 }} />
      <TemplateGrid items={TEMPLATES} limit={6} onPick={(p) => go('aiPost', { prompt: p })} />

      {trending.length > 0 ? (
        <>
          <SectionTitle title="Trending right now" icon="trending" badge="Live" style={{ marginTop: 24 }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: -20 }}>
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20 }}>
              {trending.map((c) => (
                <Pressy
                  key={c.category}
                  onPress={() => go('aiPost', { prompt: `I need help with ${c.category.toLowerCase()}: ` })}
                  style={{ width: 170, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 12 }}
                >
                  <Icon name={categoryIcon(c.category)} size={18} color={t.colors.accentDeep} />
                  <View style={{ flex: 1 }}>
                    <RNText style={tx('700', 12, t.colors.ink)} numberOfLines={1}>{c.category}</RNText>
                    <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2 })}>
                      {c.open_count} open · ~{rupees(c.avg_budget_minor / 100)}
                    </RNText>
                  </View>
                </Pressy>
              ))}
            </View>
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------- earning ------

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
  const [recs, setRecs] = useState<TaskWithPoster[] | null>(null);
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
    const r = await recommendedTasks(p?.skills ?? [], 3).catch(() => []);
    setRecs(await attachPosters(r));
  }, [userId]);

  useEffect(() => {
    if (screen === 'home') void load();
  }, [load, screen]);

  // Re-render every 30s while live, so the countdown moves.
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
      if (until) celebrate('You’re live for 30 minutes');
      else flash('You’re offline');
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

  return (
    <View>
      {live ? (
        <View style={{ marginHorizontal: 20, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.colors.accentSoft, borderWidth: 1, borderColor: t.colors.accentBorder, borderRadius: 12, padding: 12 }}>
          <View style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: t.colors.accent }} />
          <View style={{ flex: 1 }}>
            <RNText style={tx('700', 13, t.colors.accentDeep)}>You’re live · {minsLeft} min left</RNText>
            <RNText style={tx('400', 11, t.colors.accentDeep, { marginTop: 2 })}>Posters can see you’re free for instant tasks</RNText>
          </View>
          <Pressable onPress={() => void toggleLive()} hitSlop={8} accessibilityRole="button">
            <RNText style={tx('700', 12, t.colors.accentDeep)}>Stop</RNText>
          </Pressable>
        </View>
      ) : null}

      <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5, textAlign: 'center', marginTop: 14 })}>
        Ready to earn today?
      </RNText>
      <SearchBox
        value={q}
        onChange={setQ}
        onSubmit={() => go('explore', { q: q.trim() })}
        placeholder="E.g. data entry, logo design, home tutoring…"
        voice={voice}
        tone="purple"
      />

      <View style={{ paddingHorizontal: 20 }}>
        <View style={{ marginTop: 16, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="shield" size={16} color={t.colors.purpleDeep} />
            <RNText style={tx('700', 13, t.colors.ink, { flex: 1 })}>
              {level.name}
              {level.next ? ` → ${level.next.name}` : ''}
            </RNText>
            <RNText style={tx('600', 11, t.colors.muted)}>{w?.jobsLive ?? 0} active</RNText>
          </View>
          <View style={{ height: 5, borderRadius: 999, backgroundColor: t.colors.line, marginTop: 9, overflow: 'hidden' }}>
            <View style={{ height: 5, width: `${Math.round(level.progress * 100)}%`, backgroundColor: t.colors.purpleDeep }} />
          </View>
          <RNText style={tx('400', 11, t.colors.muted, { marginTop: 7 })}>
            {level.next
              ? `${level.jobsToGo} more completed task${level.jobsToGo === 1 ? '' : 's'}${level.ratingShort ? ` and a ★ ${level.next.rating}+ rating` : ''} to reach ${level.next.name}`
              : 'Top level reached'}
          </RNText>
        </View>

        {!live ? (
          <Pressy
            onPress={() => void toggleLive()}
            style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 13 }}
          >
            <Icon name="live" size={18} color={t.colors.signal} />
            <View style={{ flex: 1 }}>
              <RNText style={tx('700', 13, t.colors.ink)}>Go live</RNText>
              <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2 })}>Show you’re available for instant tasks for 30 minutes</RNText>
            </View>
            <Icon name="chevronRight" size={16} color={t.colors.muted} />
          </Pressy>
        ) : null}

        <SectionTitle
          title="Recommended for you"
          icon="compass"
          action="Update skills"
          onAction={() => go('profileEdit')}
          style={{ marginTop: 24 }}
        />
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>
          {skills.length ? `Based on your skills: ${skills.slice(0, 3).join(', ')}` : 'Add skills to get better matches'}
        </RNText>
        {recs === null ? (
          <Shimmer height={110} style={{ marginTop: 12 }} />
        ) : recs.length === 0 ? (
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 10 })}>No open tasks right now — check back soon.</RNText>
        ) : (
          recs.map((task, i) => (
            <WorkCard
              key={task.id}
              task={task}
              index={i}
              saved={saved.has(task.id)}
              onOpen={() => go('taskDetail', { row: taskToFeedRow(task) })}
              onApply={() => setBidTask(task)}
              onToggleSave={() => void toggleSave(task.id)}
            />
          ))
        )}
        <Pressable onPress={() => go('explore')} style={{ alignSelf: 'center', marginTop: 12 }} accessibilityRole="button">
          <RNText style={tx('700', 13, t.colors.purpleDeep)}>Browse all tasks ›</RNText>
        </Pressable>
      </View>
      <BidSheet task={bidTask} visible={bidTask !== null} onClose={() => setBidTask(null)} onPlaced={() => void load()} />
    </View>
  );
}
