import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text as RNText, ScrollView, TextInput, Pressable, RefreshControl } from 'react-native';
import { Screen } from '../components/ui';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { EmptyState, Pill, SectionTitle, Shimmer, UnderlineTabs } from '../components/kit';
import { TrendingSection } from '../components/Trending';
import { WorkCard, categoryLabel } from '../components/WorkCard';
import { BidSheet } from '../components/BidSheet';
import { FadeIn, Pressy, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import {
  attachPosters,
  getProfile,
  listMyTasks,
  searchTasks,
  type Task,
  type TaskWithPoster,
} from '../data/api';
import { listSavedTaskIds, setSaved } from '../data/extras';
import { IDEAS, TEMPLATES, TEMPLATE_TAGS, CATEGORIES, type TemplateTag } from '../lib/taskBrief';
import { taskToFeedRow } from '../lib/openTask';
import { useVoiceInput } from '../lib/speech';
import { distanceKm } from '@taskdrop/rules';

/**
 * Explore -- two different pages behind one tab.
 *
 * Posting: "Explore ideas". Search goes straight into the AI composer; below
 * it are the quick templates, a few things people often need, and how the
 * marketplace works. The Trending tab shows what is busy.
 *
 * Earning: "Find work". Search and filters over open tasks -- quick accept,
 * quick earn, bid required, live, local, and by category -- with apply and
 * save on every card.
 */
export function ExploreScreen() {
  const { mode } = useMode();
  return mode === 'worker' ? <FindWork /> : <ExploreIdeas />;
}

// ------------------------------------------------------------ poster side ---

function ExploreIdeas() {
  const t = useTheme();
  const { go } = useNav();
  const { flash } = useApp();
  const { userId } = useAuth();
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<TemplateTag | null>(null);
  const [past, setPast] = useState<Task[]>([]);
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    listMyTasks(userId)
      .then((rows) => alive && setPast(rows.slice(0, 2)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  const voice = useVoiceInput((text) => setQ((cur) => (cur ? cur + ' ' + text : text)), flash);

  const ideas = useMemo(() => {
    const pool = [...IDEAS];
    // A cheap seeded shuffle so "Shuffle" gives a new six every tap.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (i * 7 + seed * 13) % (i + 1);
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    return pool.slice(0, 6);
  }, [seed]);

  const templates = tag ? TEMPLATES.filter((x) => x.tag === tag) : TEMPLATES;
  const submit = () => q.trim() && go('aiPost', { prompt: q.trim() });

  return (
    <Screen padded={false}>
      <AppHeader />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', paddingHorizontal: 20, paddingTop: 10 }}>
          <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5 })}>Explore ideas</RNText>
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 4 })}>Discover what you can get done on TaskDrop</RNText>
        </View>
        <SearchBox
          value={q}
          onChange={setQ}
          onSubmit={submit}
          placeholder="What do you need? e.g. ask 10 people which offer to take"
          voice={voice}
          submitIcon="send"
        />
        <View style={{ marginTop: 16 }}>
          <UnderlineTabs tabs={['Get it done', 'Trending']} active={tab} onPick={setTab} />
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
          {tab === 1 ? (
            <TrendingSection onCategory={(c) => go('aiPost', { prompt: `I need help with ${c.toLowerCase()}: ` })} />
          ) : (
            <>
              {past.length > 0 ? (
                <>
                  <SectionTitle title="Post again" icon="refresh" />
                  {past.map((p) => (
                    <View
                      key={p.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        marginTop: 10,
                        backgroundColor: t.colors.surface,
                        borderWidth: 1,
                        borderColor: t.colors.line,
                        borderRadius: 14,
                        padding: 12,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <RNText style={tx('700', 13, t.colors.ink)} numberOfLines={1}>“{p.title}”</RNText>
                        <RNText style={tx('400', 11, t.colors.muted, { marginTop: 3 })}>
                          {categoryLabel(p)} · based on your previous task
                        </RNText>
                      </View>
                      <Pressy
                        onPress={() => go('aiPost', { similar: p })}
                        style={{ backgroundColor: t.colors.accent, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }}
                      >
                        <RNText style={tx('700', 12, t.colors.onAccent)}>Use this</RNText>
                      </Pressy>
                    </View>
                  ))}
                  <View style={{ height: 24 }} />
                </>
              ) : null}

              <SectionTitle title="Quick templates" icon="sparkle" />
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>One-tap task creation — review and post in seconds</RNText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: -20 }}>
                <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
                  <Pill label="All" active={tag === null} onPress={() => setTag(null)} />
                  {TEMPLATE_TAGS.map((x) => (
                    <Pill key={x} label={x} active={tag === x} onPress={() => setTag(x)} />
                  ))}
                </View>
              </ScrollView>
              <TemplateGrid items={templates} onPick={(prompt) => go('aiPost', { prompt })} />

              <View style={{ height: 26 }} />
              <SectionTitle title="What can we help you with?" icon="help" action="Shuffle" onAction={() => setSeed((s) => s + 1)} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
                {ideas.map((idea, i) => (
                  <FadeIn key={idea.title + seed} duration={300} delay={i * 40} style={{ width: '47.5%' }}>
                    <Pressy
                      onPress={() => go('aiPost', { prompt: idea.prompt })}
                      scaleTo={0.98}
                      style={{
                        backgroundColor: t.colors.surface,
                        borderWidth: 1,
                        borderColor: t.colors.line,
                        borderRadius: 14,
                        padding: 12,
                        minHeight: 118,
                      }}
                    >
                      <RNText style={tx('700', 13, t.colors.ink)}>{idea.title}</RNText>
                      <RNText style={tx('400', 11, t.colors.muted, { marginTop: 5, lineHeight: 16 })} numberOfLines={3}>
                        {idea.prompt}
                      </RNText>
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <RNText style={tx('600', 10, t.colors.text, { backgroundColor: t.colors.surface2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 })}>
                          {idea.tag}
                        </RNText>
                        {idea.budget ? <RNText style={tx('700', 10, t.colors.accentDeep)}>{idea.budget}</RNText> : null}
                      </View>
                    </Pressy>
                  </FadeIn>
                ))}
              </View>

              <View style={{ height: 26 }} />
              <SectionTitle title="How it works" icon="help" />
              <View style={{ gap: 10, marginTop: 12 }}>
                {[
                  ['Describe it', 'Say what you need — AI turns it into a clear post in seconds.'],
                  ['Get matched', 'Workers nearby quote on it. Auto-accept, or pick from the bids.'],
                  ['Pay when it’s done', 'Your money sits in escrow until you approve the work.'],
                ].map(([title, body], i) => (
                  <View key={title} style={{ flexDirection: 'row', gap: 12, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 13 }}>
                    <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                      <RNText style={tx('800', 14, t.colors.onAccent)}>{i + 1}</RNText>
                    </View>
                    <View style={{ flex: 1 }}>
                      <RNText style={tx('700', 14, t.colors.ink)}>{title}</RNText>
                      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3, lineHeight: 17 })}>{body}</RNText>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

export function TemplateGrid({
  items,
  onPick,
  limit,
}: {
  items: typeof TEMPLATES;
  onPick: (prompt: string) => void;
  limit?: number;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
      {(limit ? items.slice(0, limit) : items).map((x, i) => (
        <FadeIn key={x.key} duration={300} delay={Math.min(i, 8) * 35} style={{ width: '47.5%' }}>
          <Pressy
            onPress={() => onPick(x.prompt)}
            scaleTo={0.98}
            label={x.title}
            style={{
              backgroundColor: t.colors.surface,
              borderWidth: 1,
              borderColor: t.colors.line,
              borderRadius: 14,
              padding: 12,
              minHeight: 112,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={x.icon} size={16} color={t.colors.accentDeep} strokeWidth={1.9} />
              </View>
              {x.hot ? <Icon name="bolt" size={13} color={t.colors.signal} strokeWidth={2} /> : null}
            </View>
            <RNText style={tx('700', 13, t.colors.ink, { marginTop: 8 })} numberOfLines={2}>{x.title}</RNText>
            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 3, lineHeight: 15 })} numberOfLines={2}>{x.sub}</RNText>
            <RNText
              style={tx('600', 10, t.colors.text, {
                marginTop: 7,
                alignSelf: 'flex-start',
                backgroundColor: t.colors.surface2,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 5,
                overflow: 'hidden',
              })}
            >
              {x.tag}
            </RNText>
          </Pressy>
        </FadeIn>
      ))}
    </View>
  );
}

export function SearchBox({
  value,
  onChange,
  onSubmit,
  placeholder,
  voice,
  submitIcon = 'search',
  tone = 'accent',
  right,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  voice?: { supported: boolean; listening: boolean; toggle: () => void };
  submitIcon?: 'search' | 'send';
  tone?: 'accent' | 'purple';
  right?: React.ReactNode;
}) {
  const t = useTheme();
  const color = tone === 'purple' ? t.colors.purpleDeep : t.colors.accent;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 14 }}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: t.colors.line,
          borderRadius: 999,
          paddingLeft: 14,
          paddingRight: 5,
          paddingVertical: 5,
        }}
      >
        <Icon name="search" size={16} color={t.colors.muted} />
        <TextInput
          value={value}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          returnKeyType="search"
          placeholder={placeholder}
          placeholderTextColor={t.colors.muted}
          style={tx('400', 14, t.colors.ink, { flex: 1, paddingVertical: 7 })}
        />
        {voice?.supported ? (
          <Pressable onPress={voice.toggle} hitSlop={6} accessibilityRole="button" accessibilityLabel="Voice typing">
            <Icon name="mic" size={17} color={voice.listening ? t.colors.signal : t.colors.muted} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onSubmit}
          accessibilityRole="button"
          accessibilityLabel="Go"
          style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name={submitIcon} size={16} color="#FFFFFF" strokeWidth={2} />
        </Pressable>
      </View>
      {right}
    </View>
  );
}

// ------------------------------------------------------------ worker side ---

type Filter = 'all' | 'quick_accept' | 'quick_earn' | 'bid' | 'live' | 'local';

const FILTERS: { key: Filter; label: string; icon?: Parameters<typeof Pill>[0]['icon'] }[] = [
  { key: 'all', label: 'All', icon: 'list' },
  { key: 'quick_accept', label: 'Quick accept', icon: 'bolt' },
  { key: 'quick_earn', label: 'Quick earn', icon: 'wallet' },
  { key: 'bid', label: 'Bid required', icon: 'gavel' },
  { key: 'live', label: 'Live', icon: 'live' },
  { key: 'local', label: 'Local', icon: 'pin' },
];

const LOCAL_KM = 10;
const QUICK_EARN_MAX_MINOR = 30000; // ₹300 and under

function FindWork() {
  const t = useTheme();
  const { go, params } = useNav();
  const { flash, setOpenTask } = useApp();
  const { userId } = useAuth();
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState(typeof params.q === 'string' ? params.q : '');
  const [query, setQuery] = useState(typeof params.q === 'string' ? params.q : '');
  const [filter, setFilter] = useState<Filter>(typeof params.filter === 'string' ? (params.filter as Filter) : 'all');
  const [cat, setCat] = useState<string | null>(typeof params.category === 'string' ? params.category : null);
  const [rows, setRows] = useState<TaskWithPoster[] | null>(null);
  const [saved, setSavedIds] = useState<Set<string>>(new Set());
  const [me, setMe] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [bidTask, setBidTask] = useState<Task | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const voice = useVoiceInput((text) => setQ((cur) => (cur ? cur + ' ' + text : text)), flash);

  useEffect(() => {
    if (!userId) return;
    void getProfile(userId).then((p) => p && setMe({ lat: p.loc_lat, lng: p.loc_lng })).catch(() => {});
    void listSavedTaskIds().then(setSavedIds).catch(() => {});
  }, [userId]);

  const load = useCallback(async () => {
    const found = await searchTasks({ q: query || undefined, limit: 60, kind: 'request' });
    return attachPosters(found);
  }, [query]);

  useEffect(() => {
    let alive = true;
    setRows(null);
    load()
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setRows(await load());
    } catch {
      /* keep */
    } finally {
      setRefreshing(false);
    }
  };

  const shown = useMemo(() => {
    if (!rows) return null;
    const soon = Date.now() + 24 * 3600000;
    return rows.filter((r) => {
      if (cat && categoryLabel(r) !== cat) return false;
      switch (filter) {
        case 'quick_accept':
          return r.assignment_mode === 'auto';
        case 'quick_earn':
          return r.benchmark_minor <= QUICK_EARN_MAX_MINOR;
        case 'bid':
          return r.assignment_mode !== 'auto';
        case 'live':
          return r.flag === 'urgent' || (r.due_at ? new Date(r.due_at).getTime() < soon : false);
        case 'local': {
          const km = distanceKm({ lat: me.lat, lng: me.lng }, { lat: r.loc_lat, lng: r.loc_lng });
          return km !== null && km <= LOCAL_KM;
        }
        default:
          return true;
      }
    });
  }, [rows, filter, cat, me]);

  const toggleSave = async (id: string) => {
    const on = !saved.has(id);
    setSavedIds((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
    try {
      await setSaved(id, on);
      flash(on ? 'Saved for later' : 'Removed from saved');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save that');
    }
  };

  const open = (task: TaskWithPoster) => {
    setOpenTask({ title: task.title, price: '₹' + Math.round(task.benchmark_minor / 100) });
    go('taskDetail', { row: taskToFeedRow(task) });
  };

  return (
    <Screen padded={false}>
      <AppHeader />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.purple} />}
      >
        <View style={{ alignItems: 'center', paddingHorizontal: 20, paddingTop: 10 }}>
          <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5 })}>Find work</RNText>
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 4 })}>Discover tasks matching your skills</RNText>
        </View>
        <SearchBox
          value={q}
          onChange={setQ}
          onSubmit={() => setQuery(q.trim())}
          placeholder="E.g. data entry, logo design, home tutoring…"
          voice={voice}
          tone="purple"
        />
        <View style={{ marginTop: 16 }}>
          <UnderlineTabs tabs={['Find work', 'Trending']} active={tab} onPick={setTab} />
        </View>
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
          {tab === 1 ? (
            <TrendingSection
              onCategory={(c) => {
                setCat(c);
                setTab(0);
              }}
            />
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }}>
                <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
                  {FILTERS.map((f) => (
                    <Pill key={f.key} label={f.label} icon={f.icon} active={filter === f.key} onPress={() => setFilter(f.key)} />
                  ))}
                </View>
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, marginTop: 8 }}>
                <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
                  {CATEGORIES.map((c) => (
                    <Pill key={c} label={c} active={cat === c} onPress={() => setCat(cat === c ? null : c)} />
                  ))}
                </View>
              </ScrollView>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}>
                <RNText style={tx('700', 13, t.colors.ink, { flex: 1 })}>
                  {shown === null
                    ? 'Loading…'
                    : `${shown.length} ${shown.length === 1 ? 'result' : 'results'}${query ? ` for “${query}”` : ''}`}
                </RNText>
                {filter !== 'all' || cat !== null || query !== '' ? (
                  <Pressable
                    onPress={() => {
                      setFilter('all');
                      setCat(null);
                      setQ('');
                      setQuery('');
                    }}
                    hitSlop={8}
                  >
                    <RNText style={tx('700', 12, t.colors.purpleDeep)}>Clear all</RNText>
                  </Pressable>
                ) : null}
              </View>
              {filter === 'local' && me.lat === null ? (
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6 })}>
                  Set your location in your profile to see jobs within {LOCAL_KM} km.
                </RNText>
              ) : null}

              {shown === null ? (
                [0, 1, 2].map((i) => <Shimmer key={i} height={120} style={{ marginTop: 12 }} />)
              ) : shown.length === 0 ? (
                <EmptyState
                  icon="compass"
                  title={query ? `No tasks match “${query}”` : 'No tasks match these filters'}
                  body="Try removing a filter or searching for something broader."
                  actionLabel="Clear filters"
                  onAction={() => {
                    setFilter('all');
                    setCat(null);
                    setQ('');
                    setQuery('');
                  }}
                />
              ) : (
                shown.map((task, i) => (
                  <WorkCard
                    key={task.id}
                    task={task}
                    index={i}
                    saved={saved.has(task.id)}
                    onOpen={() => open(task)}
                    onApply={() => setBidTask(task)}
                    onToggleSave={() => void toggleSave(task.id)}
                  />
                ))
              )}
            </>
          )}
        </View>
      </ScrollView>
      <BidSheet task={bidTask} visible={bidTask !== null} onClose={() => setBidTask(null)} onPlaced={() => void refresh()} />
    </Screen>
  );
}
