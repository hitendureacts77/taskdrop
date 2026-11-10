import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { noteFirstAction } from '../lib/appPrompt';
import { View, Text as RNText, ScrollView, TextInput, Pressable, Animated, Platform, type TextInputInstance, type StyleProp, type ViewStyle } from 'react-native';
import { Screen, ScreenList, cardSurface } from '../components/ui';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { EmptyState, Pill, SectionTitle, Shimmer, UnderlineTabs } from '../components/kit';
import { TrendingSection } from '../components/Trending';
import { WorkCard, categoryLabel } from '../components/WorkCard';
import { BidSheet } from '../components/BidSheet';
import { HowItWorks } from '../components/HowItWorks';
import { FadeIn, Pressy, tx } from '../components/primitives';
import { useTheme, ring } from '../providers/ThemeProvider';
import { useNav, useFocusTick, type NavParams, type ScreenName } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import {
  searchTasksWithPosters,
  getProfile,
  listMyTasks,
  type Task,
  type TaskWithPoster,
} from '../data/api';
import { listSavedTaskIds, setSaved } from '../data/extras';
import { listGuestSaves, setGuestSaved } from '../lib/guestSaves';
import { IDEAS, TEMPLATES, TEMPLATE_TAGS, CATEGORIES, TOP_CATEGORIES, type TemplateTag } from '../lib/taskBrief';
import { taskToFeedRow } from '../lib/openTask';
import { useMyOffers } from '../lib/useMyOffers';
import { useVoiceInput } from '../lib/speech';
import { distanceKm } from '@taskdrop/rules';
import { NearYou } from '../components/NearYou';
import { JobsNearHero } from '../components/JobsNearHero';
import { NearMap, type NearMapLayer } from '../components/NearMap';
import { LocationSheet } from '../components/LocationSheet';
import { useMyArea } from '../lib/useMyArea';
import { roughPlace } from '../lib/place';
import { useReducedMotion } from '../lib/motion';
import { TABLET_CONTENT, WIDE_CONTENT, XL_CONTENT, XL_MIN_WIDTH, useLayout } from '../lib/layout';

/**
 * Explore -- the map of what is around you, with the old page one tap away.
 *
 * The tab opens on the full-screen map (plan D20: components/NearMap, the same
 * map Home's cards open). A "List" pill switches to the page this tab always
 * was, which has two faces:
 *
 * Posting: "Explore ideas". Search goes straight into the AI composer; below
 * it are the quick templates, a few things people often need, and how the
 * marketplace works. The Trending tab shows what is busy.
 *
 * Earning: "Find work". Search and filters over open tasks -- quick accept,
 * quick earn, bid required, live, local, and by category -- with apply and
 * save on every card.
 *
 * Which one shows:
 *  - Coming in from another tab lands on the map, every time.
 *  - Arriving with a search or filter (Home's search bar) opens the list.
 *  - Staying on the tab (or coming back from a job opened here) keeps the choice.
 */
const LIST_INTENT = ['q', 'focusSearch', 'filter', 'category'] as const;
const hasListIntent = (p: NavParams) => LIST_INTENT.some((k) => p[k] !== undefined);
/** The screens that show the tab bar: entering Explore from one of them is "coming in from another tab". */
const TAB_SCREENS: ScreenName[] = ['home', 'explore', 'myTasks', 'wallet', 'profile', 'search', 'orders'];
const defaultLayer = (mode: string): NearMapLayer => (mode === 'worker' ? 'jobs' : 'people');
/** How long a view takes to fade in; shorter, and without the small rise, under reduced motion. */
const VIEW_FADE_MS = 180;
const VIEW_FADE_REDUCED_MS = 120;

export function ExploreScreen() {
  const t = useTheme();
  const { mode } = useMode();
  const { params, screen } = useNav();
  const { userId } = useAuth();
  const { area, loaded, choose } = useMyArea();
  const { desktop, tablet, width } = useLayout();
  const reduced = useReducedMotion();

  // A list intent is "new" once per params object: the phone's own tab bar leaves old params
  // behind, and those must not pull a later visit back to the list.
  const consumed = useRef<NavParams | null>(hasListIntent(params) ? params : null);
  const [view, setView] = useState<'map' | 'list'>(hasListIntent(params) ? 'list' : 'map');
  // The list keeps its search, filters and scroll once opened, so it is built the first time and then only hidden.
  const [listBuilt, setListBuilt] = useState(view === 'list');
  if (view === 'list' && !listBuilt) setListBuilt(true);
  const [layer, setLayer] = useState<NearMapLayer>(defaultLayer(mode));
  // The place picker: for your own area, or for a place to look around (another city) without changing yours.
  const [pickFor, setPickFor] = useState<'mine' | 'look' | null>(null);
  const [lookAt, setLookAt] = useState<{ lat: number; lng: number; label: string } | null>(null);
  // What the list is filtered by, so the map opens with the same jobs.
  const [listFilter, setListFilter] = useState<{ category: string | null; query: string }>({ category: null, query: '' });

  // The tab stays mounted while another tab or a job is in front (R4), so the view is steered by where
  // the person came from. The focus tick is no help: it does not move when the tab was seen under 30 s ago.
  const lastScreen = useRef(screen);
  const exitedTo = useRef<ScreenName | null>(null);
  const intentSinceExit = useRef(false);
  useEffect(() => {
    const prev = lastScreen.current;
    lastScreen.current = screen;
    if (prev === 'explore' && screen !== 'explore') {
      exitedTo.current = screen;
      intentSinceExit.current = false;
    }
    if (hasListIntent(params) && params !== consumed.current) {
      consumed.current = params;
      intentSinceExit.current = true;
      setView('list');
      return;
    }
    if (screen === 'explore' && prev !== 'explore') {
      // Back from a job opened here (not a tab) keeps the view; arriving any other way starts on the map.
      const backFromOpened = prev === exitedTo.current && !TAB_SCREENS.includes(prev);
      if (!backFromOpened && !intentSinceExit.current) setView('map');
      intentSinceExit.current = false;
    }
  }, [screen, params]);

  // Each side starts on its own layer, and starts over when the mode flips.
  useEffect(() => setLayer(defaultLayer(mode)), [mode]);

  // The list keeps the reading width the screen host used to give it; the map takes everything beside the menu.
  const web = Platform.OS === 'web';
  const listWidth: StyleProp<ViewStyle> = {
    width: '100%',
    alignSelf: 'center',
    maxWidth: web ? (desktop ? (width >= XL_MIN_WIDTH ? XL_CONTENT : WIDE_CONTENT) : tablet ? TABLET_CONTENT : undefined) : undefined,
  };

  // From-home jobs now sit in the map's own list (plan D23), so the map no longer needs a line about them.
  const centre = lookAt ? { lat: lookAt.lat, lng: lookAt.lng } : area ? { lat: area.lat, lng: area.lng } : null;
  // A picked place keeps the name it was picked by ("Koramangala, Bengaluru"), not its ward.
  const placeLabel = lookAt ? lookAt.label : area ? (roughPlace(area.label) ?? undefined) : undefined;
  return (
    <View style={{ flex: 1 }}>
      {view === 'map' ? (
        <FadeIn key="map" duration={reduced ? VIEW_FADE_REDUCED_MS : VIEW_FADE_MS} translateY={reduced ? 0 : 8} style={{ flex: 1 }}>
          {userId && !loaded ? (
            <View style={{ flex: 1, backgroundColor: t.colors.surface2 }} />
          ) : (
            <NearMap
              layer={layer}
              onLayer={setLayer}
              centre={centre}
              leading={{ kind: 'list', onPress: () => setView('list') }}
              listFilter={listFilter}
              areaLabel={placeLabel}
              placeIsMine={!lookAt}
              onChangePlace={() => setPickFor(area ? 'look' : 'mine')}
              onUseMyPlace={() => setLookAt(null)}
              onChooseArea={() => setPickFor('mine')}
            />
          )}
        </FadeIn>
      ) : null}
      {listBuilt ? (
        <ViewSwap on={view === 'list'} reduced={reduced} style={listWidth}>
          {mode === 'worker' ? (
            <FindWork onMap={() => setView('map')} onFilter={setListFilter} />
          ) : (
            <ExploreIdeas onMap={() => setView('map')} />
          )}
        </ViewSwap>
      ) : null}
      <LocationSheet
        visible={pickFor !== null}
        askForDetails={false}
        onCancel={() => setPickFor(null)}
        onPick={(p) => {
          const forLook = pickFor === 'look';
          setPickFor(null);
          // Looking around another place never changes your own area.
          if (forLook) {
            if (p.lat != null && p.lng != null) setLookAt({ lat: p.lat, lng: p.lng, label: p.area ?? p.label });
          }
          else void choose(p);
        }}
      />
    </View>
  );
}

/** The list page, built once and then only hidden, fading in each time it is shown. */
function ViewSwap({ on, reduced, style, children }: { on: boolean; reduced: boolean; style: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const ms = reduced ? VIEW_FADE_REDUCED_MS : VIEW_FADE_MS;
    opacity.setValue(0);
    rise.setValue(reduced ? 0 : 8);
    const anim = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: ms, useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: ms, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [on, reduced, opacity, rise]);
  return (
    <Animated.View style={[{ flex: 1, display: on ? 'flex' : 'none' }, style, { opacity, transform: [{ translateY: rise }] }]}>
      {children}
    </Animated.View>
  );
}

/** The one List / Map switch (design D21): List is where you are, Map opens the full map. */
function ViewSwitch({ onMap }: { onMap: () => void }) {
  const t = useTheme();
  const seg = (label: string, on: boolean, onPress?: () => void) => (
    <Pressy
      key={label}
      onPress={onPress}
      label={on ? label + ' view, selected' : 'Show the ' + label.toLowerCase()}
      scaleTo={0.95}
      style={{
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 11,
        justifyContent: 'center',
        backgroundColor: on ? t.colors.line : 'transparent',
      }}
    >
      <RNText style={tx(on ? '800' : '700', 13, on ? t.colors.ink : t.colors.muted)}>{label}</RNText>
    </Pressy>
  );
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', padding: 3, borderRadius: 14, backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line }}
    >
      {seg('List', true)}
      {seg('Map', false, onMap)}
    </View>
  );
}

// ------------------------------------------------------------ poster side ---

function ExploreIdeas({ onMap }: { onMap: () => void }) {
  const t = useTheme();
  const { go } = useNav();
  const { flash } = useActions();
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
      <View style={{ alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 2 }}>
        <ViewSwitch onMap={onMap} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        {/* The hero: who can help near you, and what tasks round here pay. */}
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <NearYou active first />
        </View>
        <View style={{ alignItems: 'center', paddingHorizontal: 20, paddingTop: 22 }}>
          <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5 })}>Ideas & templates</RNText>
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 4 })}>Pick a starting point, or describe your own</RNText>
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
          <UnderlineTabs tabs={['Ideas', 'Busy now']} active={tab} onPick={setTab} />
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
                        ...cardSurface(t, 18),
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
                        style={{ backgroundColor: t.colors.btn, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }}
                      >
                        <RNText style={tx('700', 12, t.colors.onAccent)}>Use this</RNText>
                      </Pressy>
                    </View>
                  ))}
                  <View style={{ height: 32 }} />
                </>
              ) : null}

              <SectionTitle title="Start from a template" icon="sparkle" />
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>Tap one, tweak the details, post</RNText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: -20 }}>
                <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
                  <Pill label="All" active={tag === null} onPress={() => setTag(null)} />
                  {TEMPLATE_TAGS.map((x) => (
                    <Pill key={x} label={x} active={tag === x} onPress={() => setTag(x)} />
                  ))}
                </View>
              </ScrollView>
              <TemplateGrid items={templates} onPick={(prompt) => go('aiPost', { prompt })} />

              <View style={{ height: 32 }} />
              <SectionTitle title="People often ask for" icon="users" action="Shuffle" onAction={() => setSeed((s) => s + 1)} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
                {ideas.map((idea, i) => (
                  <FadeIn key={idea.title + seed} duration={300} delay={i * 40} style={{ width: '47.5%' }}>
                    <Pressy
                      onPress={() => go('aiPost', { prompt: idea.prompt })}
                      scaleTo={0.98}
                      style={{
                        ...cardSurface(t, 18),
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

              <View style={{ height: 32 }} />
              <SectionTitle title="How TaskDrop works" icon="help" />
              <HowItWorks side="hire" />
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
              ...cardSurface(t, 18),
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
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  voice?: { supported: boolean; listening: boolean; toggle: () => void };
  submitIcon?: 'search' | 'send';
  tone?: 'accent' | 'purple';
  right?: React.ReactNode;
  inputRef?: React.RefObject<TextInputInstance | null>;
}) {
  const t = useTheme();
  const color = tone === 'purple' ? t.colors.purpleDeep : t.colors.accent;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 14 }}>
      <View {...ring}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          ...cardSurface(t, 999),
          paddingLeft: 14,
          paddingRight: 5,
          paddingVertical: 5,
        }}
      >
        <Icon name="search" size={16} color={t.colors.muted} />
        <TextInput
          ref={inputRef}
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

type Filter = 'all' | 'quick_accept' | 'quick_earn' | 'bid' | 'live' | 'local' | 'remote';

const FILTERS: { key: Filter; label: string; icon?: Parameters<typeof Pill>[0]['icon'] }[] = [
  { key: 'all', label: 'All', icon: 'list' },
  { key: 'local', label: 'Nearby', icon: 'pin' },
  { key: 'remote', label: 'Remote', icon: 'compass' },
  { key: 'quick_accept', label: 'Auto-hire', icon: 'bolt' },
  { key: 'live', label: 'Due soon', icon: 'clock' },
  { key: 'quick_earn', label: 'Under ₹300', icon: 'wallet' },
  { key: 'bid', label: 'Open to offers', icon: 'gavel' },
];

const LOCAL_KM = 10;
const QUICK_EARN_MAX_MINOR = 30000; // ₹300 and under

function FindWork({
  onMap,
  initialFilter,
  onFilter,
}: {
  onMap: () => void;
  initialFilter?: { filter: Filter; id: number };
  onFilter: (f: { category: string | null; query: string }) => void;
}) {
  const t = useTheme();
  const { go, params } = useNav();
  const { flash, setOpenTask } = useActions();
  const { userId, guest } = useAuth();
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState(typeof params.q === 'string' ? params.q : '');
  const [query, setQuery] = useState(typeof params.q === 'string' ? params.q : '');
  const [filter, setFilter] = useState<Filter>(typeof params.filter === 'string' ? (params.filter as Filter) : (initialFilter?.filter ?? 'all'));
  const [cat, setCat] = useState<string | null>(typeof params.category === 'string' ? params.category : null);
  const [rows, setRows] = useState<TaskWithPoster[] | null>(null);
  const focusTick = useFocusTick();
  const [allCats, setAllCats] = useState(false);
  // Tell the screen what is filtered, so the map view shows the same jobs.
  useEffect(() => onFilter({ category: cat, query }), [cat, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const searchRef = useRef<TextInputInstance>(null);

  // "See them" on the map's remote-jobs line: show the remote jobs, whatever was filtered before.
  const filterAsk = initialFilter?.id;
  useEffect(() => {
    if (!filterAsk || !initialFilter) return;
    setFilter(initialFilter.filter);
    setCat(null);
    setTab(0);
  }, [filterAsk]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arriving from the home search bar: start clean (no leftover filters that
  // would hide every result) and put the cursor in the search box.
  const focusSearch = params.focusSearch;
  useEffect(() => {
    if (!focusSearch) return;
    setFilter('all');
    setCat(null);
    setTab(0);
    setTimeout(() => searchRef.current?.focus(), 250);
  }, [focusSearch]);
  // A search handed over with a query replaces the old one, filters cleared.
  const handedQ = typeof params.q === 'string' ? params.q : null;
  useEffect(() => {
    if (handedQ === null) return;
    setQ(handedQ);
    setQuery(handedQ);
    setFilter('all');
    setCat(null);
    setTab(0);
  }, [handedQ]);
  const [saved, setSavedIds] = useState<Set<string>>(new Set());
  const [me, setMe] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [bidTask, setBidTask] = useState<Task | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const voice = useVoiceInput((text) => setQ((cur) => (cur ? cur + ' ' + text : text)), flash);

  useEffect(() => {
    if (!userId) {
      if (guest) void listGuestSaves().then((ids) => setSavedIds(new Set(ids)));
      return;
    }
    void getProfile(userId).then((p) => p && setMe({ lat: p.loc_lat, lng: p.loc_lng })).catch(() => {});
    void listSavedTaskIds().then(setSavedIds).catch(() => {});
  }, [userId, guest]);

  const load = useCallback(async () => {
    // One request: the posts and their posters together (it was two back to back, once 13 s on a busy server).
    return searchTasksWithPosters({ q: query || undefined, limit: 60, kind: 'request' });
  }, [query, focusTick]);

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
        case 'remote':
          return r.loc_lat === null;
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
      if (guest) await setGuestSaved(id, on);
      else await setSaved(id, on);
      flash(on ? 'Saved for later' : 'Removed from saved');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save that');
    }
  };

  const open = (task: TaskWithPoster) => {
    setOpenTask({ title: task.title, price: '₹' + Math.round(task.benchmark_minor / 100) });
    go('taskDetail', { row: taskToFeedRow(task) });
  };

  // Tasks this worker already sent an offer on: their button says Edit offer.
  const offers = useMyOffers(userId, (shown ?? []).map((r) => r.id), !guest);

  return (
    <ScreenList
      above={<AppHeader />}
      tint={t.colors.purple}
      data={tab === 0 && shown ? shown : []}
      keyExtractor={(task) => task.id}
      renderItem={({ item: task, index: i }) => (
        <WorkCard
          task={task}
          index={i}
          saved={saved.has(task.id)}
          quoted={offers.has(task.id)}
          onOpen={() => open(task)}
          onApply={() => setBidTask(task)}
          onToggleSave={() => void toggleSave(task.id)}
        />
      )}
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      header={
        <>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 10 }}>
          <View style={{ flex: 1 }}>
            <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5 })}>Find work</RNText>
            <RNText style={tx('500', 13, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>Every open job, near you and online</RNText>
          </View>
          <ViewSwitch onMap={onMap} />
        </View>
        {/* The hero: a short map strip of open jobs round the area you chose. */}
        <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
          <JobsNearHero onOpenMap={onMap} />
        </View>
        <SearchBox
          value={q}
          onChange={setQ}
          onSubmit={() => {
            setQuery(q.trim());
            if (q.trim()) noteFirstAction();
          }}
          inputRef={searchRef}
          placeholder="E.g. data entry, logo design, home tutoring…"
          voice={voice}
          tone="purple"
        />
        <View style={{ marginTop: 16 }}>
          <UnderlineTabs tabs={['Jobs', 'Busy now', 'How it works']} active={tab} onPick={setTab} />
        </View>
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
          {tab === 2 ? (
            <HowItWorks side="earn" />
          ) : tab === 1 ? (
            <TrendingSection
              onCategory={(c) => {
                setCat(c);
                setTab(0);
              }}
            />
          ) : (
            <>
              {/* One row that scrolls sideways (the page edge is the gutter), so the chips never pile up into lines. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
                {FILTERS.map((f) => (
                  <Pill key={f.key} label={f.label} icon={f.icon} active={filter === f.key} onPress={() => setFilter(f.key)} />
                ))}
              </ScrollView>
              <RNText style={tx('600', 11, t.colors.muted, { marginTop: 14, letterSpacing: 0.6 })}>CATEGORY</RNText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, marginHorizontal: -20 }} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
                {(allCats ? [...CATEGORIES] : cat && !TOP_CATEGORIES.includes(cat as (typeof TOP_CATEGORIES)[number]) ? [cat, ...TOP_CATEGORIES] : [...TOP_CATEGORIES]).map((c) => (
                  <Pill key={c} label={c} active={cat === c} onPress={() => setCat(cat === c ? null : c)} />
                ))}
                {CATEGORIES.length > TOP_CATEGORIES.length ? (
                  <Pill label={allCats ? 'Fewer' : `+${CATEGORIES.length - TOP_CATEGORIES.length} more`} onPress={() => setAllCats((v) => !v)} />
                ) : null}
              </ScrollView>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
                <RNText style={tx('700', 13, t.colors.ink, { flex: 1 })}>
                  {shown === null
                    ? 'Loading…'
                    : `${shown.length} ${shown.length === 1 ? 'job' : 'jobs'}${filter === 'local' && me.lat !== null ? ` within ${LOCAL_KM} km` : ''}${query ? ` for “${query}”` : ''}`}
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
                  Set your area on the home screen to see jobs within {LOCAL_KM} km.
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
              ) : null}
            </>
          )}
        </View>
        </>
      }
    >
      <BidSheet task={bidTask} visible={bidTask !== null} onClose={() => setBidTask(null)} onPlaced={() => void refresh()} />
    </ScreenList>
  );
}

