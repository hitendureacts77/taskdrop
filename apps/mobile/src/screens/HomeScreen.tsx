import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import {
  View,
  Text as RNText,
  Pressable,
  Animated,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, ScreenList, formatINR, cardSurface } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, useFocusTick } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import { searchTasks, attachPosters, placeBid, kindFor, getProfile } from '../data/api';
import { HOME_FEED_RADIUS_KM, nearThenRemote } from '../lib/homePlace';
import { useAuth } from '../providers/AuthProvider';
import { isNeedsAccount, needAccount } from '../lib/guest';
import { isHunt } from '../lib/hunt';
import { isDuplicateOfferError } from '../lib/offerState';
import { noteMyOffer, useMyOffers } from '../lib/useMyOffers';
import { moveGuestSaves } from '../lib/guestSaves';
import { setSaved } from '../data/extras';
import { type Theme } from '../theme';
import type { Enums } from '@taskdrop/db-types';
import { FadeIn, Pressy, tx } from '../components/primitives';
import { TaskMediaThumb } from '../components/TaskMediaThumb';
import { AppHeader } from '../components/AppHeader';
import { HomeSections } from '../components/HomeSections';
import { roughPlace } from '../lib/place';
import { ListingCard } from '../components/ListingCard';
import { Rail } from '../components/Rail';
import { taskToFeedRow } from '../lib/openTask';
import type { TaskWithPoster } from '../data/api';
import { signedMediaUrls } from '../lib/media';
import { adAuctionRanks, recordAdImpression, recordAdClick } from '../data/api';
import { Grid, LoadFailed, Shimmer } from '../components/kit';
import { reportError } from '../lib/errors';

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
  /** Winning position in the live ad auction; 1 is best, 0 when organic. */
  adRank: number;
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
  /** The poster's options (Flash Drop, crew, photos...), as short labels; absent on older rows. */
  options?: string[];
  /** A City Hunt: finders send finds, not offers. */
  hunt?: boolean;
};

// Must match the pillar names in CreateScreen.tsx exactly — this list and
// SearchScreen's copy are the display side of the same 'services' /
// 'procurement' / 'local_intel' pillar enum CreateScreen names "Services",
// "Products", "Local Intel". Keep the three in sync.
const FILTER_LABELS = ['Services', 'Products', 'Local Intel'];


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
  hunt_until?: string | null;
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
    adRank: 0,
    who: task.poster?.display_name ?? (worker ? 'Customer' : 'Worker'),
    // A new account genuinely has no rating; a dash says so without faking 0.0.
    rating:
      task.poster && task.poster.poster_rating_count > 0
        ? Number(task.poster.poster_rating_avg).toFixed(1)
        : 'new',
    // The person, not the job. The job's location is on the line below, and
    // printing the same long address twice on one card helps nobody.
    whoMeta: roughPlace(task.poster?.loc_label) ?? 'new here',
    tag: PILLAR_TAG[task.pillar] ?? 'SERVICES',
    title: task.title,
    meta:
      task.flag === 'urgent'
        ? 'Urgent'
        : task.flag === 'unique'
          ? 'Unique'
          : (roughPlace(task.loc_label) ?? 'Area not shared'),
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
    hunt: isHunt(task),
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
      <RNText style={tx('800', 9, t.colors.accentDeep, { letterSpacing: 1.62 })}>PROMOTED</RNText>
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
  quoted,
  mediaUrl,
  t,
}: {
  row: FeedRow;
  index: number;
  worker: boolean;
  onOpen: () => void;
  onCounter: () => void;
  onAccept: () => void;
  /** This worker already sent an offer on the task: one per task, so the card offers an edit instead. */
  quoted?: boolean;
  /** Signed once for the whole page, not once per card. */
  mediaUrl?: string | null;
  t: Theme;
}) {
  const priceLabel = worker ? 'THEIR OFFER' : 'THEIR RATE';
  // A Hunt takes finds, and a second offer on the same task is refused: either way one button opens the task.
  const hunt = worker && Boolean(row.hunt);
  const single = hunt || (worker && Boolean(quoted));
  return (
    <FadeIn duration={400} delay={Math.min(index, 8) * 70} translateY={10} style={{ marginTop: 12 }}>
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
            <Icon name="user" size={17} color={t.colors.muted} />
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
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })} numberOfLines={1}>
              {row.whoMeta}
            </RNText>
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
            <RNText
              style={tx('400', 13, t.colors.muted, { marginTop: 5, lineHeight: 19 })}
              numberOfLines={1}
            >
              {row.meta}
            </RNText>
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
          {single ? null : (
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
            <RNText style={tx('600', 13, t.colors.muted)}>Counteroffer</RNText>
          </Pressy>
          )}
          <Pressy
            onPress={single ? onOpen : onAccept}
            label={single ? (hunt ? `I’m looking for ${row.title}` : `Edit your offer for ${row.title}`) : undefined}
            style={{
              backgroundColor: t.colors.btn,
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
            <RNText style={tx('700', 13, t.colors.onAccent)}>{hunt ? 'I’m looking' : quoted ? 'Edit your offer' : 'Accept'}</RNText>
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
  const { setOpenTask, celebrate, flash } = useActions();
  const { userId, guest } = useAuth();
  const focusTick = useFocusTick();
  const worker = mode === 'worker';

  // Tasks saved while looking around move into the account the first time Home opens with it, but only
  // when the guest signed in from the pop-up (AuthProvider hands them over; B31).
  useEffect(() => {
    if (userId) void moveGuestSaves(userId, setSaved);
  }, [userId, focusTick]);

  const [liveTasks, setLiveTasks] = useState<LiveTask[] | null>(null);
  const [loading, setLoading] = useState(true);
  // True when the last load failed (offline, server hiccup): an empty feed is then
  // "could not load", not "nothing listed".
  const [failed, setFailed] = useState(false);
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
  // The radius the search screen chose. Carried through here, or the slider
  // would move, report a count, and then be ignored by the list it produced.
  const nearLat = typeof params.nearLat === 'number' ? params.nearLat : null;
  const nearLng = typeof params.nearLng === 'number' ? params.nearLng : null;
  const radiusKm = typeof params.radiusKm === 'number' ? params.radiusKm : null;
  const searching =
    searchQ !== null || searchPillar !== null || searchMin !== null || nearLat !== null;

  const load = useCallback(async () => {
    // Hire's plain Home ("Services near you", B35): around the home place (the area at the top, saved on the
    // profile), nearest first, then remote listings. Two reads because a radius search leaves out posts with no
    // pin; the api keeps its inputs. With no area known (or a guest), the newest listings as before.
    if (!searching && !worker && userId) {
      const me = await getProfile(userId).catch(() => null);
      if (me?.loc_lat != null && me?.loc_lng != null) {
        const at = { lat: me.loc_lat, lng: me.loc_lng };
        const kind = kindFor('poster');
        const [near, wide] = await Promise.all([
          searchTasks({ near: { ...at, radiusKm: HOME_FEED_RADIUS_KM }, limit: 20, kind }),
          searchTasks({ limit: 60, kind }),
        ]);
        return (await attachPosters(nearThenRemote(near, wide, at))) as unknown as LiveTask[];
      }
    }
    const rows = await searchTasks({
      q: searchQ ?? undefined,
      pillar: searchPillar,
      minMinor: searchMin,
      maxMinor: searchMax,
      near:
        nearLat !== null && nearLng !== null && radiusKm !== null
          ? { lat: nearLat, lng: nearLng, radiusKm }
          : null,
      limit: 20,
      // Workers browse requests, posters browse services.
      kind: kindFor(worker ? 'worker' : 'poster'),
    });
    return (await attachPosters(rows)) as unknown as LiveTask[];
  }, [searchQ, searchPillar, searchMin, searchMax, nearLat, nearLng, radiusKm, worker, focusTick, searching, userId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .then((rows) => {
        if (!active) return;
        // Outside a search an empty table falls back to the design's sample
        // feed; inside one, "no results" has to stay visible.
        setLiveTasks(rows);
        setFailed(false);
      })
      .catch((e) => {
        if (!active) return;
        reportError(e, 'home.load');
        setLiveTasks([]);
        setFailed(true);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [load, searching]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setLiveTasks(await load());
      setFailed(false);
    } catch {
      /* keep whatever is on screen */
    } finally {
      setRefreshing(false);
    }
  }, [load, searching]);

  // Switching mode drops the old mode's rows at once, so they are never drawn
  // with the new mode's card. The fetch above owns `loading` and ends it only
  // when the new load settles (a timer here once ended it early).
  useEffect(() => {
    setLiveTasks(null);
    setFailed(false);
  }, [worker]);

  // Which listings are being paid for right now. Without this, promotion was
  // money for nothing: the card had a sponsored style and the flag was
  // hard-coded false, so a live campaign changed nothing anyone could see.
  // Who is winning the ad auction right now. The order is decided server-side
  // (bid x action rate, paced, out-of-budget campaigns dropped); the client is
  // told the running order and nothing else, so placement cannot be argued
  // with from a phone.
  const [adRanks, setAdRanks] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let alive = true;
    void adAuctionRanks().then((m) => alive && setAdRanks(m));
    return () => {
      alive = false;
    };
  }, []);

  const allRows: FeedRow[] = (liveTasks ?? [])
    .map((task) => {
      const adRank = adRanks.get(task.id) ?? 0;
      return { ...liveToFeedRow(task, worker), sponsored: adRank > 0, adRank };
    })
    // Sponsored above organic, then in the auction's own order (rank 1 first).
    // Ties and organic rows keep the server's order, which is newest-first.
    .sort((a, b) => Number(b.sponsored) - Number(a.sponsored) || a.adRank - b.adRank);
  // Chip index -> card tag. No selection shows every pillar.
  const FILTER_TAGS: FeedRow['tag'][] = ['SERVICES', 'PRODUCTS', 'LOCAL HELP'];
  const feed: FeedRow[] =
    filter === null ? allRows : allRows.filter((row) => row.tag === FILTER_TAGS[filter]);
  // Urgent means flagged urgent, by whoever posted it. This used to render one
  // hard-coded card -- a person, a rating and a price that existed nowhere --
  // on the front page of the marketplace, for every user, always.
  const urgentRows = feed.filter((row) => row.meta === 'Urgent').slice(0, 3);

  // Delivery. A sponsored card that reaches the screen is an impression, and
  // an impression is what the advertiser's daily budget actually buys — until
  // this fired, "daily budget" could never be spent. Billed once per task per
  // mount: re-sorting or filtering the feed is not a new view of the ad.
  const billed = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const row of feed) {
      if (!row.sponsored || billed.current.has(row.id)) continue;
      billed.current.add(row.id);
      void recordAdImpression(row.id).catch(() => {});
    }
  }, [feed]);

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
    // A tap on a paid card is the action the auction is estimating. Logged
    // before navigating, and never allowed to block it.
    if (row.sponsored) void recordAdClick(row.id).catch(() => {});
    setOpenTask({
      title: row.title,
      price: formatINR(row.amountMinor),
      who: row.who,
    });
    go('taskDetail', { row });
  };

  const [quoting, setQuoting] = useState<string | null>(null);
  // Tasks this worker already sent an offer on: their card says Edit your offer.
  const offers = useMyOffers(userId, feed.map((row) => row.id), worker);

  const onAccept = async (row: FeedRow) => {
    if (!worker) return openRow(row);
    // A Hunt takes finds, not offers; the task page has the finder panel.
    if (row.hunt) return openRow(row);

    // Sample rows have ids like "w1"; only a real task can be quoted on.
    if (!/^[0-9a-f-]{36}$/i.test(row.id)) {
      return flash('This is a sample card — open a real task to send an offer');
    }
    if (guest) return needAccount('offer', () => void onAccept(row));
    if (!userId) return flash('Sign in to send an offer');
    if (quoting) return;

    setQuoting(row.id);
    try {
      await placeBid({
        taskId: row.id,
        workerId: userId,
        priceMinor: row.amountMinor,
        timeLimitMinutes: 240,
      });
      noteMyOffer(userId, row.id);
      celebrate('Offer sent at ' + formatINR(row.amountMinor));
      go('orders');
    } catch (e) {
      if (isNeedsAccount(e)) return;
      if (isDuplicateOfferError(e)) {
        // One offer per task: the task page shows the sent offer with an edit button.
        noteMyOffer(userId, row.id);
        flash('You already sent an offer for this task. Opening it so you can edit it.');
        openRow(row);
        return;
      }
      flash(e instanceof Error ? e.message : 'Could not send that offer');
    } finally {
      setQuoting(null);
    }
  };

  // The flat feed (search results) is a virtualised list: only the cards near
  // the viewport are drawn. Everything else keeps the plain scrolling page.
  if (searching) {
    const header = (
      <FadeIn duration={260}>
        <AppHeader />
        <>
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            paddingTop: 14,
            paddingHorizontal: 20,
            alignItems: 'center',
          }}
        >
          {FILTER_LABELS.map((label, i) => (
            <FilterChip
              key={label}
              label={label}
              active={filter === i}
              onPress={() => setFilter((cur) => (cur === i ? null : i))}
              t={t}
            />
          ))}
          {/* Only here when there is something to clear. A permanent one would
              be a control that does nothing most of the time. Tapping the
              active chip still clears it too; this is the obvious way out for
              anyone who does not know that. */}
          {(filter !== null || searching) && (
            <Pressable
              onPress={() => {
                setFilter(null);
                if (searching) go('home');
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear the filters"
              hitSlop={8}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: t.colors.line,
                backgroundColor: t.colors.surface,
                transform: [{ scale: pressed ? 0.92 : 1 }],
              })}
            >
              <RNText style={tx('600', 15, t.colors.muted, { lineHeight: 17 })}>×</RNText>
            </Pressable>
          )}
        </View>

        <RNText style={tx('800', 17, t.colors.ink, { letterSpacing: -0.34, paddingTop: 26, paddingHorizontal: 20 })}>
          {searching ? 'Search results' : worker ? 'Work near you' : 'Services near you'}
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
                    ...cardSurface(t, 18),
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
          ) : null}
        </>
      </FadeIn>
    );
    return (
      <ScreenList
        data={loading ? [] : feed}
        keyExtractor={(row) => row.id}
        renderItem={({ item, index }) => (
          <FeedCard
            row={item}
            index={index}
            worker={worker}
            onOpen={() => openRow(item)}
            onCounter={() => openRow(item)}
            onAccept={() => void onAccept(item)}
            quoted={offers.has(item.id)}
            mediaUrl={item.mediaPath ? (mediaUrls[item.mediaPath] ?? null) : undefined}
            t={t}
          />
        )}
        header={header}
        empty={
          loading ? null : failed ? (
            <LoadFailed onRetry={() => void refresh()} />
          ) : (
            <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
                <View
                  style={{
                    ...cardSurface(t, 18),
                    padding: 22,
                    marginTop: 12,
                    alignItems: 'center',
                  }}
                >
                  <RNText style={tx('700', 15, t.colors.ink, { textAlign: 'center' })}>
                    {!worker && !searching && filter === null ? 'No services listed yet' : 'Nothing matches yet'}
                  </RNText>
                  <RNText
                    style={tx('400', 13, t.colors.muted, {
                      textAlign: 'center',
                      marginTop: 7,
                      lineHeight: 19,
                    })}
                  >
                    {filter !== null
                      ? `No ${FILTER_LABELS[filter]?.toLowerCase()} tasks open right now. The category filters are optional — clear them to see everything.`
                      : searching
                        ? 'Try a broader search, or clear the filters.'
                        : worker
                          ? 'Pull down to refresh, or check back soon.'
                          : 'Workers’ services show up here. Meanwhile, post a request and workers will send offers.'}
                  </RNText>
                  <Pressy
                    onPress={() =>
                      filter !== null ? setFilter(null) : searching ? go('home') : go(worker ? 'explore' : 'aiPost')
                    }
                    style={{
                      marginTop: 15,
                      backgroundColor: t.colors.btn,
                      borderRadius: 999,
                      paddingVertical: 11,
                      paddingHorizontal: 20,
                    }}
                  >
                    <RNText style={tx('700', 13, t.colors.onAccent)}>
                      {filter !== null
                        ? `Show all`
                        : searching
                          ? 'Clear filters'
                          : worker
                            ? 'Find work'
                            : 'Post a request'}
                    </RNText>
                  </Pressy>
                </View>
            </View>
          )
        }
        footer={
          loading || !worker || urgentRows.length === 0 ? null : (
            /* Worker-only. These rows are urgent *requests*, which is work a
               worker can pick up — but on the poster's side they were being
               relabelled "Free right now", as though other people's urgent
               jobs were available workers. A poster has no use for a list of
               someone else's requests. */
              <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}>
                <RNText style={tx('800', 19, t.colors.ink, { letterSpacing: -0.38, marginTop: 10 })}>
                  Urgent requests
                </RNText>
                <Grid>
                {urgentRows.map((row) => (
                  <FadeIn key={row.id} duration={400} translateY={10} style={{ marginTop: 12 }}>
                    <Pressy
                      onPress={() => openRow(row)}
                      scaleTo={0.985}
                      label={`${row.title}, ${formatINR(row.amountMinor)}`}
                      style={{
                        ...cardSurface(t, 18),
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
                          <Icon name="user" size={14} color={t.colors.muted} />
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
                </Grid>
              </View>
          )
        }
        onRefresh={refresh}
        refreshing={refreshing}
      />
    );
  }

  return (
    <Screen scroll padded={false} onRefresh={refresh} refreshing={refreshing}>
      <FadeIn duration={260}>
        <AppHeader />
        {/* A worker's home is sectioned (skills, near you, remote, needed
            today) in HomeSections. The Rail below is the poster's. Search
            results are the virtualised list above. */}
        <HomeSections />
        {!worker ? (
          // What workers offer, as gig cards in a row that pages sideways.
          <View style={{ paddingHorizontal: 20, paddingTop: 30, paddingBottom: 110 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <RNText style={tx('800', 18, t.colors.ink, { letterSpacing: -0.35, flex: 1 })}>Services near you</RNText>
              <RNText style={tx('600', 12, t.colors.accentDeep)}>{loading ? '' : `${feed.length} offered`}</RNText>
            </View>
            <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 4 })}>Services workers offer — tap one to see it and hire</RNText>
            {loading ? (
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                {[0, 1].map((i) => (
                  <Shimmer key={i} height={230} style={{ width: 240, borderRadius: 20 }} />
                ))}
              </View>
            ) : failed && feed.length === 0 ? (
              <LoadFailed onRetry={() => void refresh()} />
            ) : feed.length === 0 ? (
              <RNText style={tx('400', 13, t.colors.muted, { marginTop: 12 })}>No services listed nearby yet.</RNText>
            ) : (
              <View style={{ marginTop: 12 }}>
                <Rail step={250} min={260}>
                  {(liveTasks ?? [])
                    .filter((task) => feed.some((row) => row.id === task.id))
                    .map((task) => (
                      <ListingCard
                        key={task.id}
                        task={task as unknown as TaskWithPoster}
                        width={240}
                        onPress={() => go('taskDetail', { row: taskToFeedRow(task as unknown as TaskWithPoster) })}
                      />
                    ))}
                </Rail>
              </View>
            )}
          </View>
        ) : (
          // Room under the last section so the drop button never covers it.
          <View style={{ height: 110 }} />
        )}
      </FadeIn>
    </Screen>
  );
}
