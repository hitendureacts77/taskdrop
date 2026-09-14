import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  Animated,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, formatINR } from '../components/ui';
import { Icon } from '../components/Icon';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { searchTasks, attachPosters, placeBid } from '../data/api';
import { useAuth } from '../providers/AuthProvider';
import { type Theme } from '../theme';
import type { Enums } from '@taskdrop/db-types';
import { FadeIn, Pressy, tx } from '../components/primitives';
import { TaskMediaThumb } from '../components/TaskMediaThumb';
import { signedMediaUrls } from '../lib/media';

/**
 * Home feed — pixel parity with docs/design/_design_markup.html lines 35-139
 * (header, search hint, filter chips, feed title, skeleton loaders, feed
 * cards with sponsored/identity/tag/media-thumb/price/buttons, urgent strip).
 * Data/handlers mirror docs/design/_design_source.jsx renderVals() lines
 * 108-135 (feed) and 335-342 (urgent). Mode-aware: workers see posters'
 * requests, posters see taskers' services. Falls back to the live Supabase
 * OPEN-tasks query when it returns rows; otherwise renders the design's
 * sample feed so the screen always looks finished.
 */

export type FeedRow = {
  id: string;
  sponsored: boolean;
  who: string;
  rating: string;
  whoMeta: string;
  tag: 'SERVICES' | 'PRODUCTS' | 'LOCAL HELP';
  title: string;
  meta: string;
  amountMinor: number;
  hasMedia: boolean;
  glyph: '▶' | '▤' | '';
  /** Storage path for the attached file, and what kind it is. */
  mediaPath: string | null;
  mediaKind: 'image' | 'video' | null;
  mediaSeconds: number | null;
  dur: string | null;
  body: string;
  by: string | null;
};

const FILTER_LABELS = ['Services', 'Goods & products', 'Local help'];


// Live Supabase rows (id,title,pillar,benchmark_minor,flag,loc_label) don't carry
// identity/media/body — map them into the same card shape with what we have.
type LiveTask = {
  id: string;
  title: string;
  pillar: string;
  benchmark_minor: number;
  flag: string;
  loc_label: string | null;
  media_kind: string | null;
  media_path: string | null;
  media_seconds: number | null;
  poster: {
    display_name: string;
    poster_rating_avg: number | string;
    poster_rating_count: number;
    loc_label: string | null;
  } | null;
};

const PILLAR_TAG: Record<string, FeedRow['tag']> = {
  services: 'SERVICES',
  procurement: 'PRODUCTS',
  local_intel: 'LOCAL HELP',
};

function liveToFeedRow(task: LiveTask, worker: boolean): FeedRow {
  return {
    id: task.id,
    sponsored: false,
    who: task.poster?.display_name ?? (worker ? 'Poster' : 'Tasker'),
    // A new account genuinely has no rating; a dash says so without faking 0.0.
    rating:
      task.poster && task.poster.poster_rating_count > 0
        ? Number(task.poster.poster_rating_avg).toFixed(1)
        : 'new',
    whoMeta: task.loc_label ?? task.poster?.loc_label ?? 'Location not shared',
    tag: PILLAR_TAG[task.pillar] ?? 'SERVICES',
    title: task.title,
    meta:
      task.flag === 'urgent'
        ? 'Urgent'
        : task.flag === 'unique'
          ? 'Unique'
          : (task.loc_label ?? 'Location not shared'),
    amountMinor: task.benchmark_minor,
    // Media comes from the row now. hasMedia used to be hard-coded false, so an
    // attached photo was uploaded and then shown to nobody.
    hasMedia: Boolean(task.media_path),
    glyph: task.media_kind === 'video' ? '▶' : task.media_path ? '▤' : '',
    mediaPath: task.media_path ?? null,
    mediaKind:
      task.media_kind === 'video' || task.media_kind === 'image' ? task.media_kind : null,
    mediaSeconds: task.media_seconds ?? null,
    dur: task.media_seconds ? `${task.media_seconds}s` : null,
    body: '',
    by: null,
  };
}

function tagInk(t: Theme, tag: FeedRow['tag']): string {
  if (tag === 'SERVICES') return t.colors.accentDeep;
  if (tag === 'PRODUCTS') return t.colors.purple;
  return t.colors.blue;
}

function FilterChip({
  label,
  active,
  onPress,
  t,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  t: Theme;
}) {
  return (
    <Pressy
      onPress={onPress}
      scaleTo={0.96}
      style={{
        backgroundColor: active ? t.colors.accentSoft : 'transparent',
        borderWidth: 1,
        borderColor: active ? t.colors.accent : t.colors.line,
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 14,
      }}
    >
      <RNText style={tx('600', 12, active ? t.colors.ink : t.colors.muted)} numberOfLines={1}>
        {label}
      </RNText>
    </Pressy>
  );
}

/** Shimmering skeleton bar, standing in for the markup's tdShim background-position animation. */
function ShimmerBar({
  width,
  height,
  marginTop,
  t,
}: {
  width: number | `${number}%`;
  height: number;
  marginTop?: number;
  t: Theme;
}) {
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 575, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 575, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{
        width,
        height,
        marginTop,
        borderRadius: 6,
        backgroundColor: t.colors.surface2,
        opacity,
      }}
    />
  );
}

function SponsoredMark({ t }: { t: Theme }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 11,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.line,
      }}
    >
      <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
        <Path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill={t.colors.accentDeep} />
      </Svg>
      <RNText style={tx('800', 9, t.colors.accentDeep, { letterSpacing: 1.62 })}>SPONSORED</RNText>
    </View>
  );
}

const FeedCard = memo(function FeedCard({
  row,
  index,
  worker,
  onOpen,
  onCounter,
  onAccept,
  mediaUrl,
  t,
}: {
  row: FeedRow;
  index: number;
  worker: boolean;
  onOpen: () => void;
  onCounter: () => void;
  onAccept: () => void;
  /** Signed once for the whole page, not once per card. */
  mediaUrl?: string | null;
  t: Theme;
}) {
  const priceLabel = worker ? 'THEIR QUOTE' : 'THEIR RATE';
  return (
    <FadeIn duration={400} delay={index * 70} translateY={10} style={{ marginTop: 12 }}>
      <Pressy containsControls
        onPress={onOpen}
        scaleTo={0.985}
        style={{
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: row.sponsored ? t.colors.accent : t.colors.line,
          borderRadius: 14,
          padding: 15,
        }}
      >
        {row.sponsored && <SponsoredMark t={t} />}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 999,
              backgroundColor: t.colors.surface2,
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <RNText style={tx('400', 15, t.colors.muted)}>☺</RNText>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <RNText style={tx('700', 14, t.colors.ink)}>{row.who}</RNText>
              <RNText style={tx('400', 12, t.colors.muted)}>
                {row.rating === 'new' ? 'new here' : '★ ' + row.rating}
              </RNText>
              <RNText style={tx('700', 9, tagInk(t, row.tag), { letterSpacing: 1.26, marginLeft: 'auto' })}>
                {row.tag}
              </RNText>
            </View>
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>{row.whoMeta}</RNText>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 13, marginTop: 12 }}>
          {row.hasMedia && (
            <TaskMediaThumb
              path={row.mediaPath}
              kind={row.mediaKind}
              seconds={row.mediaSeconds}
              url={mediaUrl}
              size={62}
            />
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <RNText style={tx('700', 16, t.colors.ink, { letterSpacing: -0.16 })}>{row.title}</RNText>
            <RNText style={tx('400', 13, t.colors.muted, { marginTop: 5, lineHeight: 19 })}>{row.meta}</RNText>
          </View>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            marginTop: 14,
            paddingTop: 13,
            borderTopWidth: 1,
            borderTopColor: t.colors.line,
          }}
        >
          <View style={{ flex: 1 }}>
            <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>{priceLabel}</RNText>
            <RNText style={tx('800', 19, t.colors.accentDeep, { marginTop: 3 })}>{formatINR(row.amountMinor)}</RNText>
          </View>
          <Pressy
            onPress={onCounter}
            style={{
              borderWidth: 1,
              borderColor: t.colors.line,
              borderRadius: 999,
              paddingVertical: 10,
              paddingHorizontal: 15,
            }}
          >
            <RNText style={tx('600', 13, t.colors.muted)}>Counter</RNText>
          </Pressy>
          <Pressy
            onPress={onAccept}
            style={{
              backgroundColor: t.colors.accent,
              borderRadius: 999,
              paddingVertical: 10,
              paddingHorizontal: 16,
              shadowColor: t.colors.accent,
              shadowOpacity: 0.4,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 3,
            }}
          >
            <RNText style={tx('700', 13, t.colors.onAccent)}>Accept</RNText>
          </Pressy>
        </View>
      </Pressy>
    </FadeIn>
  );
});

export function HomeScreen() {
  const t = useTheme();
  const { go, params } = useNav();
  const { mode } = useMode();
  const { setOpenTask, celebrate, flash } = useApp();
  const { userId } = useAuth();
  const worker = mode === 'worker';

  const [liveTasks, setLiveTasks] = useState<LiveTask[] | null>(null);
  const [loading, setLoading] = useState(true);
  // Pillar filters are optional: none selected means "show everything", and
  // tapping the active chip clears it again.
  const [filter, setFilter] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filters arriving from the search screen. Their presence also switches the
  // feed from "fall back to samples" to "show exactly what matched".
  const searchQ = typeof params.q === 'string' ? params.q : null;
  const searchPillar = typeof params.pillar === 'string' ? (params.pillar as Enums<'pillar'>) : null;
  const searchMin = typeof params.minMinor === 'number' ? params.minMinor : null;
  const searchMax = typeof params.maxMinor === 'number' ? params.maxMinor : null;
  const searching = searchQ !== null || searchPillar !== null || searchMin !== null;

  const load = useCallback(async () => {
    const rows = await searchTasks({
      q: searchQ ?? undefined,
      pillar: searchPillar,
      minMinor: searchMin,
      maxMinor: searchMax,
      limit: 20,
    });
    return (await attachPosters(rows)) as unknown as LiveTask[];
  }, [searchQ, searchPillar, searchMin, searchMax]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .then((rows) => {
        if (!active) return;
        // Outside a search an empty table falls back to the design's sample
        // feed; inside one, "no results" has to stay visible.
        setLiveTasks(rows);
      })
      .catch(() => active && setLiveTasks([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [load, searching]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setLiveTasks(await load());
    } catch {
      /* keep whatever is on screen */
    } finally {
      setRefreshing(false);
    }
  }, [load, searching]);

  // Skeleton flash when switching mode, mirroring the design's setMode() window.
  // (The fetch above owns `loading` for the initial load.)
  useEffect(() => {
    setLoading(true);
    const id = setTimeout(() => setLoading(false), 400);
    return () => clearTimeout(id);
  }, [worker]);

  const allRows: FeedRow[] = (liveTasks ?? []).map((task) => liveToFeedRow(task, worker));
  // Chip index -> card tag. No selection shows every pillar.
  const FILTER_TAGS: FeedRow['tag'][] = ['SERVICES', 'PRODUCTS', 'LOCAL HELP'];
  const feed: FeedRow[] =
    filter === null ? allRows : allRows.filter((row) => row.tag === FILTER_TAGS[filter]);
  // Urgent means flagged urgent, by whoever posted it. This used to render one
  // hard-coded card -- a person, a rating and a price that existed nowhere --
  // on the front page of the marketplace, for every user, always.
  const urgentRows = allRows.filter((row) => row.meta === 'Urgent').slice(0, 3);

  /**
   * One signing call for the whole page.
   *
   * The bucket is private, so every thumbnail needs a signed URL, and asking
   * for them one card at a time is a request per row — the difference between
   * a feed that loads and a feed that trickles in. Keyed by path so a card
   * looks its own up.
   */
  const mediaPaths = useMemo(
    () => allRows.map((row) => row.mediaPath).filter((x): x is string => Boolean(x)),
    [allRows],
  );
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const signedKey = mediaPaths.join('|');
  useEffect(() => {
    if (!signedKey) return;
    let alive = true;
    void signedMediaUrls(signedKey.split('|')).then((map) => {
      if (alive) setMediaUrls(map);
    });
    return () => {
      alive = false;
    };
  }, [signedKey]);

  const openRow = (row: FeedRow) => {
    setOpenTask({
      title: row.title,
      price: formatINR(row.amountMinor),
      who: row.who,
    });
    go('taskDetail', { row });
  };

  const [quoting, setQuoting] = useState<string | null>(null);

  const onAccept = async (row: FeedRow) => {
    if (!worker) return openRow(row);

    // Sample rows have ids like "w1"; only a real task can be quoted on.
    if (!/^[0-9a-f-]{36}$/i.test(row.id)) {
      return flash('This is a sample card — open a real task to quote');
    }
    if (!userId) return flash('Sign in to send a quote');
    if (quoting) return;

    setQuoting(row.id);
    try {
      await placeBid({
        taskId: row.id,
        workerId: userId,
        priceMinor: row.amountMinor,
        timeLimitMinutes: 240,
      });
      celebrate('Quote sent at ' + formatINR(row.amountMinor));
      go('orders');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not send that quote';
      flash(/duplicate|unique/i.test(msg) ? 'You have already quoted on this task' : msg);
    } finally {
      setQuoting(null);
    }
  };

  return (
    <Screen scroll padded={false} onRefresh={refresh} refreshing={refreshing}>
      <FadeIn duration={260}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 6 }}>
          <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.66 })}>
            taskdrop
            <RNText style={tx('800', 22, t.colors.accent)}>.</RNText>
          </RNText>
          <Pressy
            onPress={() => go('profile')}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
              backgroundColor: t.colors.surface2,
              borderRadius: 999,
              paddingVertical: 7,
              paddingHorizontal: 13,
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: t.colors.accent }} />
            <RNText style={tx('700', 12, t.colors.ink)}>{worker ? 'Worker' : 'Poster'}</RNText>
          </Pressy>
        </View>

        <Pressy
          onPress={() => go('search')}
          style={{
            marginTop: 15,
            marginHorizontal: 20,
            backgroundColor: t.colors.surface2,
            borderRadius: 12,
            paddingVertical: 13,
            paddingHorizontal: 15,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 11,
          }}
        >
          <Icon name="search" size={17} color={t.colors.muted} strokeWidth={1.8} />
          <RNText style={tx('400', 14, t.colors.muted)}>
            {worker ? 'Find a task or a service' : 'Find a worker or a service'}
          </RNText>
        </Pressy>

        <View style={{ flexDirection: 'row', gap: 8, paddingTop: 14, paddingHorizontal: 20 }}>
          {FILTER_LABELS.map((label, i) => (
            <FilterChip
              key={label}
              label={label}
              active={filter === i}
              onPress={() => setFilter((cur) => (cur === i ? null : i))}
              t={t}
            />
          ))}
        </View>

        <RNText style={tx('800', 19, t.colors.ink, { letterSpacing: -0.38, paddingTop: 22, paddingHorizontal: 20 })}>
          {searching ? 'Search results' : worker ? 'Tasks near you' : 'Workers near you'}
        </RNText>
        {searchQ ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginTop: 10,
              marginHorizontal: 20,
              alignSelf: 'flex-start',
              backgroundColor: t.colors.accentSoft,
              borderWidth: 1,
              borderColor: t.colors.accentBorder,
              borderRadius: 999,
              paddingVertical: 7,
              paddingHorizontal: 13,
            }}
          >
            <RNText style={tx('600', 12, t.colors.accentDeep)}>“{searchQ}”</RNText>
            <Pressable onPress={() => go('home')} hitSlop={8}>
              <RNText style={tx('700', 13, t.colors.accentDeep)}>✕</RNText>
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <View style={{ paddingHorizontal: 20 }}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={{
                  backgroundColor: t.colors.surface,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  borderRadius: 14,
                  padding: 15,
                  marginTop: 12,
                }}
              >
                <ShimmerBar width="52%" height={13} t={t} />
                <ShimmerBar width="84%" height={17} marginTop={13} t={t} />
                <ShimmerBar width="38%" height={13} marginTop={13} t={t} />
              </View>
            ))}
          </View>
        ) : (
          <>
            <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
              {feed.length === 0 ? (
                <View
                  style={{
                    backgroundColor: t.colors.surface,
                    borderWidth: 1,
                    borderColor: t.colors.line,
                    borderRadius: 14,
                    padding: 22,
                    marginTop: 12,
                    alignItems: 'center',
                  }}
                >
                  <RNText style={tx('700', 15, t.colors.ink, { textAlign: 'center' })}>
                    Nothing matches yet
                  </RNText>
                  <RNText
                    style={tx('400', 13, t.colors.muted, {
                      textAlign: 'center',
                      marginTop: 7,
                      lineHeight: 19,
                    })}
                  >
                    {searching
                      ? 'Try a broader search, or clear the filters.'
                      : 'Pull down to refresh, or post the first request.'}
                  </RNText>
                  <Pressy
                    onPress={() => (searching ? go('home') : go('create'))}
                    style={{
                      marginTop: 15,
                      backgroundColor: t.colors.accent,
                      borderRadius: 999,
                      paddingVertical: 11,
                      paddingHorizontal: 20,
                    }}
                  >
                    <RNText style={tx('700', 13, t.colors.onAccent)}>
                      {searching ? 'Clear filters' : 'Post a request'}
                    </RNText>
                  </Pressy>
                </View>
              ) : null}
              {feed.map((row, i) => (
                <FeedCard
                  key={row.id}
                  row={row}
                  index={i}
                  worker={worker}
                  onOpen={() => openRow(row)}
                  onCounter={() => openRow(row)}
                  onAccept={() => void onAccept(row)}
                  mediaUrl={row.mediaPath ? (mediaUrls[row.mediaPath] ?? null) : undefined}
                  t={t}
                />
              ))}
            </View>

            {urgentRows.length > 0 && (
              <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}>
                <RNText style={tx('800', 19, t.colors.ink, { letterSpacing: -0.38, marginTop: 10 })}>
                  {worker ? 'Urgent requests' : 'Free right now'}
                </RNText>
                {urgentRows.map((row) => (
                  <FadeIn key={row.id} duration={400} translateY={10} style={{ marginTop: 12 }}>
                    <Pressy
                      onPress={() => openRow(row)}
                      scaleTo={0.985}
                      label={`${row.title}, ${formatINR(row.amountMinor)}`}
                      style={{
                        backgroundColor: t.colors.surface,
                        borderWidth: 1,
                        borderColor: t.colors.line,
                        borderRadius: 14,
                        padding: 15,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 999,
                            backgroundColor: t.colors.surface2,
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <RNText style={tx('400', 13, t.colors.muted)}>☺</RNText>
                        </View>
                        <RNText style={tx('700', 13, t.colors.ink)}>{row.who}</RNText>
                        <RNText style={tx('400', 12, t.colors.muted)}>
                          {row.rating === 'new' ? 'new here' : '★ ' + row.rating}
                        </RNText>
                        <RNText
                          style={tx('700', 9, t.colors.signal, {
                            letterSpacing: 1.26,
                            marginLeft: 'auto',
                          })}
                        >
                          URGENT
                        </RNText>
                      </View>
                      <View
                        style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 11 }}
                      >
                        <RNText style={tx('700', 16, t.colors.ink, { flex: 1 })} numberOfLines={2}>
                          {row.title}
                        </RNText>
                        <RNText style={tx('800', 16, t.colors.accentDeep)}>
                          {formatINR(row.amountMinor)}
                        </RNText>
                      </View>
                    </Pressy>
                  </FadeIn>
                ))}
              </View>
            )}
          </>
        )}
      </FadeIn>
    </Screen>
  );
}
