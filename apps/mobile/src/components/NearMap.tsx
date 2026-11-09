import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, ScrollView, PanResponder, Platform, Keyboard, type ScrollViewInstance, type ViewInstance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, useFocusTick } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { attachPosters, getProfile, type Profile } from '../data/api';
import { mapPeople, tasksNear, workersNear, type MapPerson, type NearbyWorker } from '../data/extras';
import { JobsMap, mapWords, type JobPin } from './JobsMap';
import { HelperSheet } from './HelperSheet';
import { PersonSheet } from './PersonSheet';
import { PeopleMapSheet } from './PeopleMapSheet';
import { MapSheet } from './MapSheet';
import {
  AreaRow,
  FadeList,
  HeroCard,
  HelperRow,
  JobCard,
  JobRow,
  MINE_WORDS,
  PersonRow,
  PrivacyLine,
  ReachControl,
  ReachEditor,
  ROW_GAP,
  ROW_H,
  Segmented,
  StatusPill,
  kmValue,
  type HeroTile,
  type MapArea,
  type MapJob,
} from './NearMapParts';
import {
  CUSTOM_REACH_KEY,
  MAX_REACH_KM,
  MIN_REACH_KM,
  REACH_PRESETS,
  parseReachKm,
  parseSavedReach,
  peopleReach,
  postedToday,
  reachChoices,
  withinReach,
} from '../lib/mapReach';
import { REFRESH_DEBOUNCE_MS, createRefreshCache, refreshKey, shouldRefresh } from '../lib/mapRefresh';
import { activeFirst, areaName, farText, firstName, jobPin, kmBetween, minePin, offerOf, personPin, togetherText } from './mapPins';
import { Icon } from './Icon';
import { BottomSheet, rupees } from './kit';
import { FadeIn, Pressy, tx } from './primitives';
import { categoryLabel } from './WorkCard';
import { useReducedMotion } from '../lib/motion';
import { taskToFeedRow } from '../lib/openTask';
import { isFresh } from '../lib/mapMotion';
import { presenceOf } from '../lib/presence';
import { useLayout } from '../lib/layout';
import { browserInfo } from '../lib/appDownload';
import { inFront, onBackInFront } from '../lib/inFront';
import { PEOPLE_POLL_MS, isSpotFresh } from '../lib/mapSpot';
import { useMapSharing } from '../lib/useMapSpot';

/** The desktop side panel. */
const PANEL_W = 400;
const PANEL_GAP = 16;
/** The phone sheet resting low: the hero card and the layer chips over the map. */
const SHEET_LOW = 250;
/** About how much taller the low sheet gets when a `footer` line sits under the stats. */
const FOOTER_H = 40;
/** About how tall a picked job's card is on a phone, so the map keeps its pin above it. */
const CARD_H = 300;
/** About how tall a tapped helper's sheet is, so the map keeps their pin above it. */
const HELPER_H = 430;
/**
 * The map is asked for everything the server will give (a country-wide reach, its newest 200), so zooming out
 * shows every task (PR 295); the distance choice only filters the list and cards and zooms the map to fit.
 */
const WIDE_KM = 20000;
const ITEMS = 200;
/** The "₹1,000+" filter. */
const HIGH_PAY = 1000;
/** The phone's top pill. */
const TOP_BAR_H = 70;

/** Where the person last typed a distance; the zoom tip is shown once per device. */
const TIP_KEY = 'taskdrop.map.zoomTipSeen';

type Point = { lat: number; lng: number };

/** With no area chosen the map shows the whole country: about the middle of India, zoomed out as far as the map goes. */
const INDIA_CENTRE: Point = { lat: 22.5, lng: 79 };
const INDIA_ZOOM = 5;
const noPick = () => {};

/** Answers kept for a few minutes, by rounded centre and reach (decision 36b). */
const jobsCache = createRefreshCache<MapJob[]>();
const helpersCache = createRefreshCache<NearbyWorker[]>();
/** A search already on its way is shared, not asked twice. */
const inFlight = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  const have = inFlight.get(key) as Promise<T> | undefined;
  if (have) return have;
  const p = make().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/**
 * What the map shows. 'jobs' = open tasks, 'people' = helpers, 'mine' = "My people": the people
 * you finished a task with who chose to share a rounded spot (plan D20). Signed-in people only;
 * for anyone else 'mine' falls back to 'people'.
 */
export type NearMapLayer = 'jobs' | 'people' | 'mine';

/** The Explore list's own filters, applied to the jobs on the map (Jobs layer only). */
export type NearMapListFilter = { category: string | null; query: string };

/**
 * Is this screen the one being looked at? Phones: the tab or pushed screen is focused (expo-router, the
 * same check navigation/TabRoute.tsx uses). It is read lazily so the web build, which never loads
 * expo-router, never runs it. On the web a hidden tab stays mounted, so see `onScreenNow` instead.
 */
const useScreenFocused: () => boolean =
  Platform.OS === 'web' ? () => true : (require('expo-router') as typeof import('expo-router')).useIsFocused;

/** Web only: a kept-alive tab that is not showing has display:none, so it has no boxes. Elsewhere: true. */
function onScreenNow(node: ViewInstance | null): boolean {
  if (Platform.OS !== 'web' || !node) return true;
  const el = node as unknown as { getClientRects?: () => { length: number } };
  return typeof el.getClientRects === 'function' ? el.getClientRects().length > 0 : true;
}

/** Open tasks by area for "Best-paying areas": each area's biggest offer, highest first. */
function bestAreas(jobs: MapJob[]): MapArea[] {
  const by = new Map<string, MapArea>();
  for (const j of jobs) {
    if (j.loc_lat == null) continue;
    const name = areaName(j.loc_label);
    const a = by.get(name);
    if (!a) by.set(name, { name, top: j, count: 1, km: j.km });
    else {
      a.count += 1;
      a.km = Math.min(a.km, j.km);
      if (j.benchmark_minor > a.top.benchmark_minor) a.top = j;
    }
  }
  return [...by.values()].sort((a, b) => b.top.benchmark_minor - a.top.benchmark_minor);
}

/** Swipe a card left or right; the handler is made once, so it reads the latest callbacks through a ref. */
function useSwipe(onNext: () => void, onPrev: () => void) {
  const latest = useRef({ onNext, onPrev });
  latest.current = { onNext, onPrev };
  return useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -60) latest.current.onNext();
        else if (g.dx > 60) latest.current.onPrev();
      },
    }),
  ).current;
}

/** The most common label in a list, with how many share it. */
function topLabel(labels: string[]): { name: string; n: number } | null {
  const by = new Map<string, { name: string; n: number }>();
  for (const l of labels) {
    const k = l.trim().toLowerCase();
    if (!k) continue;
    const e = by.get(k);
    if (e) e.n += 1;
    else by.set(k, { name: l.trim(), n: 1 });
  }
  return [...by.values()].sort((a, b) => b.n - a.n)[0] ?? null;
}

/**
 * The full-screen map (plans D11-D14, D21). A worker sees each area's biggest offer,
 * and zoomed in every task with its price, poster and title; a poster sees
 * helpers as what they offer (plan D13: service and price, no names). On a wide screen
 * a side panel holds the hero card (best offer), the controls and the list, and a
 * picked job opens a card right above its pin; on a phone they live in one bottom
 * sheet that rests low or pulls up, and a picked job becomes a single card that steps
 * through the jobs in its area. The results refresh by themselves once the map stops
 * moving (plan D21, decision 36b), so there is no "Search this area" button.
 *
 * It is a component so the same map can be a route (Home's NearYou and
 * JobsNearHero open it through NearMapScreen) or sit inside a tab (plan D20).
 */
export function NearMap({
  layer,
  onLayer,
  centre,
  radiusKm,
  leading,
  bottomInset = 0,
  footer,
  onChooseArea,
  areaLabel,
  listFilter,
}: {
  layer: NearMapLayer;
  /** Given: show the layer switch (Jobs, Helpers). Undefined: no switch (route use). */
  onLayer?: (l: NearMapLayer) => void;
  /** Where the person is. Null shows "Choose your area" instead of a map. */
  centre: Point | null;
  radiusKm?: number;
  /** Route: a close (X) button. Tab: a "List" pill in its place. */
  leading: { kind: 'close'; onPress: () => void } | { kind: 'list'; onPress: () => void };
  /** Bottom space taken by a bar the map must stay clear of. 0 when the bar is not drawn over the map. */
  bottomInset?: number;
  /** Shown in the sheet's low state under the stats: e.g. the remote-jobs line. */
  footer?: React.ReactNode;
  /** The "Choose your area" button on the empty card (the parent opens its area picker). */
  onChooseArea?: () => void;
  /** The name of the person's area ("Financial District, Hyderabad"), for the panel's subtitle. */
  areaLabel?: string;
  /** The Explore list's category and search, applied to the jobs shown (Jobs layer only). */
  listFilter?: NearMapListFilter;
}) {
  const t = useTheme();
  const { go } = useNav();
  const insets = useSafeAreaInsets();
  const { desktop, tablet, height: screenH } = useLayout();
  const wide = desktop || tablet;
  const { userId, guest } = useAuth();
  // "My people" is for signed-in people only; a guest (or a signed-out screen) gets the helpers map.
  const canMine = Boolean(userId) && !guest;
  const kind: NearMapLayer = layer === 'mine' && !canMine ? 'people' : layer;
  const mine = kind === 'mine';
  // The look: 'mine' wears the helpers' blue faces.
  const mode: 'jobs' | 'people' = kind === 'jobs' ? 'jobs' : 'people';
  const home = centre;
  const words = mine ? { ...mapWords('people'), ...MINE_WORDS } : mapWords(mode);
  const { sharing, cell: myCell } = useMapSharing();
  const focused = useScreenFocused();
  const tick = useFocusTick();
  const root = useRef<ViewInstance>(null);

  const [radius, setRadius] = useState(() => (typeof radiusKm === 'number' ? radiusKm : 5));
  // The last custom distance, kept on this device.
  const [savedCustom, setSavedCustom] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // Where the results were looked up; it follows the map once it stops moving far enough (lib/mapRefresh).
  const [searchAt, setSearchAt] = useState<Point | null>(home);
  const [movedTo, setMovedTo] = useState<Point | null>(null);
  // A search is on its way.
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<MapJob[] | null>(null);
  const [people, setPeople] = useState<NearbyWorker[] | null>(null);
  // My people (layer 'mine'): rounded spots only, kept in memory just while that layer is showing.
  const [peopleMine, setPeopleMine] = useState<MapPerson[] | null>(null);
  // Goes up when the poll (or a finished "Share my spot") says look again.
  const [beat, setBeat] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  // "Active now" for helpers, "₹1,000+" for jobs.
  const [narrow, setNarrow] = useState(false);
  // Helpers only: just those who list a service.
  const [served, setServed] = useState(false);
  const [tab, setTab] = useState<'jobs' | 'areas'>('jobs');
  const [sheetUp, setSheetUp] = useState(false);
  const [reachOpen, setReachOpen] = useState(false);
  // Desktop: the side panel can be minimised to give the map the whole screen.
  const [panelOpen, setPanelOpen] = useState(true);
  // Goes up when the map should zoom to fit the chosen reach.
  const [fitKey, setFitKey] = useState(1);
  // The one-time "scroll or pinch to zoom" tip (web desktop with a mouse or trackpad).
  const [tip, setTip] = useState(false);
  const reduced = useReducedMotion();
  const list = useRef<ScrollViewInstance>(null);

  // The saved custom distance, and whether the tip was already closed once.
  useEffect(() => {
    let alive = true;
    void AsyncStorage.getItem(CUSTOM_REACH_KEY)
      .then((v) => alive && setSavedCustom(parseSavedReach(v)))
      .catch(() => {});
    if (Platform.OS === 'web' && desktop && browserInfo().touch === 0) {
      void AsyncStorage.getItem(TIP_KEY)
        .then((v) => alive && setTip(v !== '1'))
        .catch(() => alive && setTip(true));
    }
    return () => {
      alive = false;
    };
  }, [desktop]);
  const closeTip = () => {
    setTip(false);
    void AsyncStorage.setItem(TIP_KEY, '1').catch(() => {});
  };

  // As a tab the parent can change the layer, the area or the reach while this stays mounted.
  useEffect(() => {
    setPicked(null);
    setFocus(null);
    setNarrow(false);
    setServed(false);
    setTab('jobs');
    setSheetUp(false);
    setReachOpen(false);
    setEditorOpen(false);
    // Leaving My people drops their spots from memory.
    if (kind !== 'mine') setPeopleMine(null);
  }, [kind]);
  useEffect(() => {
    setSearchAt(centre);
    setMovedTo(null);
    setFitKey((k) => k + 1);
    // Its numbers are what matter, not the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre?.lat, centre?.lng]);
  useEffect(() => {
    if (typeof radiusKm === 'number') {
      setRadius(radiusKm);
      setFitKey((k) => k + 1);
    }
  }, [radiusKm]);

  // The map stopped moving: 0.6 s later, and only if the middle went far enough, search there.
  useEffect(() => {
    if (!movedTo) return;
    const id = setTimeout(() => {
      if (shouldRefresh({ searchedAt: searchAt, centre: movedTo, radiusKm: radius })) setSearchAt(movedTo);
    }, REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // The point arrives as a fresh object each time; its numbers are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movedTo?.lat, movedTo?.lng, searchAt?.lat, searchAt?.lng, radius]);

  useEffect(() => {
    if (!searchAt) return;
    let alive = true;
    const at = Date.now();
    const homeKey = home ? `${home.lat.toFixed(2)},${home.lng.toFixed(2)}` : '-';
    // Distances are always from you, even when the map searched somewhere else.
    const from = (lat: number | null, lng: number | null, km: number) => (home && lat != null && lng != null ? kmBetween(home, { lat, lng }) : km);
    const done = () => alive && setBusy(false);
    if (kind === 'mine') {
      setBusy(true);
      // Never logs the result: it holds names and rounded spots. The server caps this call at 50 km.
      void mapPeople(searchAt, peopleReach(radius))
        .then((r) => alive && (setNow(at), setPeopleMine(r.map((p) => ({ ...p, km: from(p.lat, p.lng, p.km) })))))
        .finally(done)
        .catch(() => {});
    } else if (mode === 'jobs') {
      const key = refreshKey(`jobs:${homeKey}`, searchAt, WIDE_KM);
      const hit = jobsCache.get(key, at);
      if (hit) {
        setNow(at);
        setJobs(hit);
        setBusy(false);
        return () => {
          alive = false;
        };
      }
      setBusy(true);
      // Posters ride along so the zoomed-in map shows who posted each task.
      void once(key, async () => {
        const r = await tasksNear(searchAt, WIDE_KM, ITEMS);
        const withPeople = await attachPosters(r);
        return withPeople.map((x, i) => ({ ...x, km: from(x.loc_lat, x.loc_lng, r[i]!.km), fresh: isFresh(x.created_at, at) }));
      })
        .then((rows) => {
          jobsCache.set(key, rows, Date.now());
          if (alive) {
            setNow(at);
            setJobs(rows);
          }
        })
        .catch(() => alive && setJobs((cur) => cur ?? []))
        .finally(done);
    } else {
      const key = refreshKey(`helpers:${homeKey}`, searchAt, WIDE_KM);
      const hit = helpersCache.get(key, at);
      if (hit) {
        setNow(at);
        setPeople(hit);
        setBusy(false);
        return () => {
          alive = false;
        };
      }
      setBusy(true);
      void once(key, async () => {
        const r = await workersNear(searchAt, WIDE_KM, ITEMS);
        return activeFirst(r.map((w) => ({ ...w, km: from(w.loc_lat, w.loc_lng, w.km) })), at);
      })
        .then((rows) => {
          helpersCache.set(key, rows, Date.now());
          if (alive) {
            setNow(at);
            setPeople(rows);
          }
        })
        .catch(() => alive && setPeople((cur) => cur ?? []))
        .finally(done);
    }
    return () => {
      alive = false;
    };
    // The point arrives as a fresh object each time; its numbers are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `tick` and `beat` only matter for My people: they re-ask on return, on a live change, and every minute.
  }, [kind, searchAt?.lat, searchAt?.lng, mine ? radius : 0, mine ? tick : 0, mine ? beat : 0]);

  // My people refresh every PEOPLE_POLL_MS, but only while this screen is the one being looked at and the
  // app is in front: leave the tab, switch layer or background the app and nothing is asked.
  useEffect(() => {
    if (!mine || !focused) return;
    const again = () => {
      if (inFront() && onScreenNow(root.current)) setBeat((b) => b + 1);
    };
    const id = setInterval(again, PEOPLE_POLL_MS);
    const off = onBackInFront(again);
    return () => {
      clearInterval(id);
      off();
    };
  }, [mine, focused]);

  // Highest offer first, the order of the list and of "Best offer". The Explore list's category and search narrow it too.
  const filterCategory = listFilter?.category ?? null;
  const filterQuery = (listFilter?.query ?? '').trim().toLowerCase();
  const shownJobs = useMemo(
    () =>
      (jobs ?? [])
        .filter((j) => !narrow || j.benchmark_minor >= HIGH_PAY * 100)
        .filter((j) => !filterCategory || categoryLabel(j) === filterCategory)
        .filter((j) => !filterQuery || `${j.title} ${j.description ?? ''}`.toLowerCase().includes(filterQuery))
        .sort((a, b) => b.benchmark_minor - a.benchmark_minor),
    [jobs, narrow, filterCategory, filterQuery],
  );
  const shownPeople = useMemo(
    () => (kind === 'people' ? (people ?? []) : []).filter((w) => (!narrow || presenceOf(w.last_seen_at, now).online) && (!served || Boolean(w.top_service))),
    [kind, people, narrow, served, now],
  );
  // Spots older than 15 minutes are never drawn, even if the last answer is still on screen.
  const allMine = useMemo(() => activeFirst((peopleMine ?? []).filter((p) => isSpotFresh(p.spot_at, now)), now), [peopleMine, now]);
  const shownMine = useMemo(() => allMine.filter((p) => !narrow || presenceOf(p.last_seen_at, now).online), [allMine, narrow, now]);
  // The map shows what the last search found; the list, cards and counts only what is inside the reach of where it searched.
  const reachLat = (searchAt ?? home)?.lat;
  const reachLng = (searchAt ?? home)?.lng;
  const reachAt = useMemo(() => (reachLat != null && reachLng != null ? { lat: reachLat, lng: reachLng } : null), [reachLat, reachLng]);
  const listJobs = useMemo(() => (reachAt ? withinReach(shownJobs, reachAt, radius) : []), [shownJobs, reachAt, radius]);
  const listPeople = useMemo(() => (reachAt ? withinReach(shownPeople, reachAt, radius) : []), [shownPeople, reachAt, radius]);
  const listMine = useMemo(() => (reachAt ? withinReach(shownMine, reachAt, radius, (p) => p) : []), [shownMine, reachAt, radius]);
  const mapIds = useMemo(
    () => (mode === 'jobs' ? shownJobs.map((j) => j.id) : mine ? shownMine.map((p) => p.id) : shownPeople.map((p) => p.id)),
    [mode, mine, shownJobs, shownMine, shownPeople],
  );
  const ids = useMemo(
    () => (mode === 'jobs' ? listJobs.map((j) => j.id) : mine ? listMine.map((p) => p.id) : listPeople.map((p) => p.id)),
    [mode, mine, listJobs, listMine, listPeople],
  );
  const pins = useMemo<JobPin[]>(
    () =>
      mode === 'jobs'
        ? shownJobs.map((j) => jobPin(j, now)).filter((p): p is JobPin => p !== null)
        : mine
          ? shownMine.map((p) => minePin(p, now))
          : shownPeople.map((w) => personPin(w, now)).filter((p): p is JobPin => p !== null),
    [mode, mine, shownJobs, shownMine, shownPeople, now],
  );
  const loading = mode === 'jobs' ? jobs === null : mine ? peopleMine === null : people === null;
  const count = ids.length;
  // On the map but outside the reach.
  const total = mapIds.length;
  const areas = useMemo(() => bestAreas(listJobs), [listJobs]);
  const live = (mine ? listMine : listPeople).filter((w) => presenceOf(w.last_seen_at, now).online).length;

  // A filter, a new search or fresh results can take the picked one away; then nothing stays picked (or dimmed).
  useEffect(() => {
    if (picked && !loading && !mapIds.includes(picked)) {
      setPicked(null);
      setFocus(null);
    }
  }, [picked, loading, mapIds]);

  const pickedJob = mode === 'jobs' ? (shownJobs.find((j) => j.id === picked) ?? null) : null;
  const pickedHelper = kind === 'people' ? (shownPeople.find((w) => w.id === picked) ?? null) : null;
  const pickedPerson = mine ? (shownMine.find((p) => p.id === picked) ?? null) : null;
  const pickedPersonId = pickedPerson?.id ?? null;

  // The person sheet shows their reviews, so it needs their ratings: read once per person tapped.
  useEffect(() => {
    setProfile(null);
    if (!pickedPersonId) return;
    let alive = true;
    void getProfile(pickedPersonId)
      .then((p) => alive && setProfile(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pickedPersonId]);

  // The panel's list follows a pin picked on the map.
  const scrollToRow = (id: string) => {
    const i = ids.indexOf(id);
    if (i >= 0) list.current?.scrollTo({ y: Math.max(0, i * (ROW_H + ROW_GAP) - ROW_H), animated: !reduced });
  };
  const pick = (id: string | null) => {
    setPicked(id);
    setFocus(id);
    if (!id) return;
    setReachOpen(false);
    if (wide) {
      setTab('jobs');
      setTimeout(() => scrollToRow(id), 0);
    } else setSheetUp(false);
  };
  const close = () => pick(null);
  const openJob = (j: MapJob) => go('taskDetail', { row: taskToFeedRow(j) });

  // A phone's card steps through the jobs in the picked one's area, or all of them when it is alone there.
  const step = useMemo(() => {
    if (!pickedJob) return null;
    const here = shownJobs.filter((j) => areaName(j.loc_label) === areaName(pickedJob.loc_label));
    const seq = here.length > 1 ? here : shownJobs;
    const index = Math.max(0, seq.findIndex((j) => j.id === pickedJob.id));
    return { seq, index, label: here.length > 1 ? `in ${areaName(pickedJob.loc_label)}` : 'nearby', here: here.length };
  }, [pickedJob, shownJobs]);
  const stepBy = (d: number) => {
    if (!step || step.seq.length < 2) return;
    pick(step.seq[(step.index + d + step.seq.length) % step.seq.length]!.id);
  };
  const swipe = useSwipe(() => stepBy(1), () => stepBy(-1));

  const glass = { backgroundColor: t.colors.bg, borderWidth: 1, borderColor: t.colors.line };

  // The control where the close X sits: a close button on the route, a "List" pill in the tab.
  const leadingControl = (size: number) =>
    leading.kind === 'close' ? (
      <Pressy onPress={leading.onPress} label="Close the map" style={{ width: size, height: size, borderRadius: size / 2, ...glass, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="close" size={size >= 44 ? 18 : 16} color={t.colors.ink} />
      </Pressy>
    ) : (
      <Pressy
        onPress={leading.onPress}
        label="Show the list"
        style={{ height: size, paddingHorizontal: size >= 44 ? 16 : 12, borderRadius: size / 2, ...glass, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        <Icon name="list" size={size >= 44 ? 16 : 13} color={t.colors.ink} />
        <RNText style={tx('700', size >= 44 ? 13 : 12.5, t.colors.ink)}>List</RNText>
      </Pressy>
    );

  // No area yet: a real map of the whole country (no pins, nothing fetched), with a card that asks for an area.
  if (!home) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.surface2 }}>
        <View style={{ flex: 1, marginBottom: bottomInset }}>
          <JobsMap
            me={null}
            pins={[]}
            selectedId={null}
            onSelect={noPick}
            tone={mode}
            startAt={INDIA_CENTRE}
            startZoom={INDIA_ZOOM}
            // Keeps the country in the part the "List" pill above and the card below leave uncovered.
            fill={{ top: insets.top + 70, bottom: 190 + insets.bottom }}
          />
          <View style={{ position: 'absolute', left: 16, top: insets.top + 10 }}>{leadingControl(44)}</View>
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 24, alignItems: 'center' }}>
            <FadeIn {...(reduced ? { duration: 120 } : { duration: 280, translateY: 24 })} style={{ width: '100%', maxWidth: 360 }}>
              <View
                style={{
                  width: '100%',
                  borderRadius: 24,
                  backgroundColor: t.colors.surface,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  padding: 24,
                  gap: 16,
                  alignItems: 'center',
                  shadowColor: '#000',
                  shadowOpacity: 0.2,
                  shadowRadius: 16,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 6,
                }}
              >
                <RNText accessibilityRole="header" style={tx('800', 18, t.colors.ink, { textAlign: 'center', letterSpacing: -0.3 })}>
                  Choose your area to see what's around you
                </RNText>
                {onChooseArea ? (
                  <Pressy onPress={onChooseArea} label="Choose your area" style={{ height: 46, paddingHorizontal: 22, borderRadius: 23, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}>
                    <RNText style={tx('800', 14, t.colors.onBtn)}>Choose your area</RNText>
                  </Pressy>
                ) : null}
              </View>
            </FadeIn>
          </View>
        </View>
      </View>
    );
  }

  // A reach button: filter the list to it and zoom the map to fit its circle.
  const chooseReach = (r: number) => {
    setRadius(r);
    setFitKey((k) => k + 1);
    setEditorOpen(false);
    close();
  };
  // "Set" in the custom editor: use it now and keep it on this device.
  const setCustom = (km: number) => {
    setSavedCustom(km);
    void AsyncStorage.setItem(CUSTOM_REACH_KEY, String(km)).catch(() => {});
    setReachOpen(false);
    chooseReach(km);
    // The keyboard squeezes the map while it is open, and a fit made then zooms out too far (on a phone the
    // whole of South India for 50 km). Close it, and fit again once the map is back to full size.
    Keyboard.dismiss();
    setTimeout(() => setFitKey((k) => k + 1), 450);
  };
  const togglePanel = () => {
    setPanelOpen((v) => !v);
    setFitKey((k) => k + 1);
  };

  const title = mode === 'jobs' ? 'Work near you' : mine ? 'Your people nearby' : 'Helpers near you';
  const sub = loading
    ? 'Looking around…'
    : `${areaLabel ? `${areaLabel} · ` : ''}within ${radius} km${mode === 'people' && live > 0 ? ` · ${live} active now` : ''}`;
  const countWords = `${count} ${count === 1 ? words.one : words.many}`;
  const pillText = busy ? 'Looking around…' : count === 0 ? `No ${words.many} in this part of the map` : `${countWords} in this part of the map`;
  const choices = reachChoices(radius, savedCustom);
  const nextReach = choices.find((c) => c.km > radius)?.km ?? null;
  const customInitial = REACH_PRESETS.includes(radius) ? savedCustom : radius;

  const chip = (label: string, on: boolean, onPress: () => void, dot?: string) => (
    <Pressy
      key={label}
      onPress={onPress}
      label={label}
      style={{ height: 32, paddingHorizontal: 13, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 6, ...(on ? { backgroundColor: t.colors.ink } : glass) }}
    >
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
      <RNText style={tx(on ? '800' : '700', 12, on ? t.colors.bg : t.colors.ink)}>{label}</RNText>
    </Pressy>
  );
  // The filters beside the tabs (jobs) or in place of them (helpers, my people).
  const filterChips =
    mode === 'jobs'
      ? [chip(`${rupees(HIGH_PAY)}+`, narrow, () => setNarrow((v) => !v))]
      : mine
        ? [chip('Active now', narrow, () => setNarrow((v) => !v), t.colors.online)]
        : [chip('Active now', narrow, () => setNarrow((v) => !v), t.colors.online), chip('Has services', served, () => setServed((v) => !v))];

  // What the map shows: Jobs, Helpers or (signed in) My people. Only drawn when the parent handles the change (the tab), not on the route.
  const layerOptions = [
    { value: 'jobs' as NearMapLayer, label: 'Jobs' },
    { value: 'people' as NearMapLayer, label: 'Helpers' },
    ...(canMine ? [{ value: 'mine' as NearMapLayer, label: 'My people' }] : []),
  ];
  const layerSwitch = onLayer ? <Segmented label="Show" value={layer} onChange={onLayer} options={layerOptions} /> : null;

  // The hero card: the best offer (jobs), or the nearest person (helpers, my people), and three tiles under it.
  const bestJob = listJobs[0];
  const nearJob = [...listJobs].sort((a, b) => a.km - b.km)[0];
  const topArea = areas[0];
  const hero = ((): {
    label: string;
    value: string;
    title: string;
    meta?: string;
    onFocus: () => void;
    onOpen: () => void;
    openLabel?: string;
    tiles: HeroTile[];
  } | null => {
    if (mode === 'jobs') {
      if (!bestJob || !nearJob || !topArea) return null;
      const p = bestJob.poster;
      const rating = p && p.poster_rating_count > 0 ? `${Number(p.poster_rating_avg).toFixed(1)} ★` : null;
      const today = postedToday(listJobs, now);
      return {
        label: 'BEST OFFER NEAR YOU',
        value: rupees(bestJob.benchmark_minor / 100),
        title: bestJob.title,
        meta: [areaName(bestJob.loc_label), kmValue(bestJob.km), p ? `by ${firstName(p.display_name || p.username)}` : null, rating].filter(Boolean).join(' · '),
        onFocus: () => pick(bestJob.id),
        onOpen: () => openJob(bestJob),
        tiles: [
          { label: 'Nearest', value: kmValue(nearJob.km), sub: `${areaName(nearJob.loc_label)} · ${rupees(nearJob.benchmark_minor / 100)}`, onPress: () => pick(nearJob.id) },
          { label: 'Open jobs', value: String(count), ...(today > 0 ? { sub: `${today} posted today` } : {}), onPress: () => setTab('jobs') },
          { label: 'Most pay', value: topArea.name, sub: `${topArea.count} ${topArea.count === 1 ? 'job' : 'jobs'} there`, onPress: () => pick(topArea.top.id) },
        ],
      };
    }
    if (mine) {
      const closest = [...listMine].sort((a, b) => a.km - b.km)[0];
      if (!closest) return null;
      const most = [...listMine].sort((a, b) => b.jobs - a.jobs)[0]!;
      return {
        label: 'NEAREST OF YOUR PEOPLE',
        value: kmValue(closest.km),
        title: firstName(closest.display_name),
        meta: `${togetherText(closest.jobs)} · ${presenceOf(closest.last_seen_at, now).label}`,
        onFocus: () => pick(closest.id),
        onOpen: () => pick(closest.id),
        openLabel: 'View',
        tiles: [
          { label: 'Active now', value: String(live), sub: live === 1 ? 'person with TaskDrop open' : 'people with TaskDrop open', onPress: () => setNarrow((v) => !v) },
          { label: 'Your people', value: String(count), sub: `within ${radius} km` },
          { label: 'Most together', value: firstName(most.display_name), sub: togetherText(most.jobs), onPress: () => pick(most.id) },
        ],
      };
    }
    const near = [...listPeople].sort((a, b) => a.km - b.km)[0];
    if (!near) return null;
    const o = offerOf(near);
    const withServices = listPeople.filter((w) => Boolean(w.top_service)).length;
    const top = topLabel(listPeople.map((w) => offerOf(w).what));
    return {
      label: 'NEAREST HELPER',
      value: kmValue(near.km),
      title: o.price ? `${o.what} · from ${o.price}` : o.what,
      meta: `${areaName(near.loc_label)}${presenceOf(near.last_seen_at, now).online ? ' · Active now' : ''}`,
      onFocus: () => pick(near.id),
      onOpen: () => pick(near.id),
      openLabel: 'View',
      tiles: [
        { label: 'Active now', value: String(live), sub: live === 1 ? 'helper with TaskDrop open' : 'helpers with TaskDrop open', onPress: () => setNarrow((v) => !v) },
        { label: 'Helpers', value: String(count), sub: `${withServices} with services`, onPress: () => setServed((v) => !v) },
        { label: 'Top service', value: top?.name ?? 'Skills', sub: top ? `${top.n} ${top.n === 1 ? 'helper' : 'helpers'}` : undefined },
      ],
    };
  })();
  const heroCard = (compact: boolean) =>
    hero ? (
      <HeroCard tone={mode} compact={compact} label={hero.label} value={hero.value} title={hero.title} {...(hero.meta ? { meta: hero.meta } : {})} onFocus={hero.onFocus} onOpen={hero.onOpen} {...(hero.openLabel ? { openLabel: hero.openLabel } : {})} tiles={hero.tiles} />
    ) : null;

  const noneToShow = mine && allMine.length === 0;
  const empty =
    !loading && count === 0 ? (
      noneToShow ? (
        // Nobody shows yet: either you are not sharing (offer to), or none of your people are.
        <View style={{ padding: 16, gap: 12, alignItems: 'flex-start' }}>
          <RNText style={tx('600', 13, t.colors.muted)}>
            {sharing ? 'None of your people are sharing right now.' : 'Your people show up here when they share their spot. Share yours?'}
          </RNText>
          {sharing ? null : (
            <Pressy onPress={() => setShareOpen(true)} label="Share my spot" style={{ height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}>
              <RNText style={tx('800', 13, t.colors.onBtn)}>Share my spot</RNText>
            </Pressy>
          )}
        </View>
      ) : (
        <RNText style={tx('600', 13, t.colors.muted, { padding: 16 })}>
          {total > 0
            ? `No ${words.many} within ${radius} km yet. ${total} more on the map further out: ${nextReach ? `try ${nextReach} km or zoom out` : 'zoom out'}.`
            : narrow || served || filterCategory || filterQuery
              ? 'Nothing matches this filter yet.'
              : `No ${words.many} here yet. Try a bigger distance.`}
        </RNText>
      )
    ) : null;

  const rows =
    empty ??
    (mine ? (
      listMine.map((p) => <PersonRow key={p.id} person={p} now={now} on={picked === p.id} onPress={() => pick(p.id)} />)
    ) : mode === 'people' ? (
      listPeople.map((w) => <HelperRow key={w.id} worker={w} now={now} on={picked === w.id} onPress={() => pick(w.id)} />)
    ) : tab === 'areas' ? (
      areas.map((a, i) => <AreaRow key={a.name} area={a} best={areas[0]!.top.benchmark_minor} first={i === 0} onPress={() => pick(a.top.id)} />)
    ) : (
      listJobs.map((j) => <JobRow key={j.id} job={j} on={picked === j.id} onPress={() => pick(j.id)} />)
    ));

  // The tab row: "Jobs · 15" / "Best-paying areas" with the ₹1,000+ chip at the right; helpers get just the chips.
  const tabButton = (value: 'jobs' | 'areas', label: string) => {
    const on = tab === value;
    return (
      <Pressy
        key={value}
        onPress={() => setTab(value)}
        label={label}
        scaleTo={0.98}
        style={{ height: 32, marginRight: 14, borderBottomWidth: 2, borderBottomColor: on ? t.colors.btn : 'transparent', justifyContent: 'center' }}
      >
        <RNText style={tx(on ? '800' : '700', 13, on ? t.colors.ink : t.colors.muted)}>{label}</RNText>
      </Pressy>
    );
  };
  const tabRow = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 8, borderBottomWidth: 1, borderColor: t.colors.line }}>
      {mode === 'jobs' ? (
        <>
          {tabButton('jobs', count > 0 ? `Jobs · ${count}` : 'Jobs')}
          {tabButton('areas', 'Best-paying areas')}
        </>
      ) : null}
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: 'row', gap: 6 }}>{filterChips}</View>
    </View>
  );

  // One row: what the map shows on the left, how far on the right; the custom editor opens right under it.
  const controls = (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        {layerSwitch ?? <View />}
        <ReachControl choices={choices} onPick={chooseReach} onCustom={() => setEditorOpen((v) => !v)} customOn={editorOpen} />
      </View>
      {editorOpen && wide ? <ReachEditor initial={customInitial} onSet={setCustom} onCancel={() => setEditorOpen(false)} minKm={MIN_REACH_KM} maxKm={MAX_REACH_KM} parse={parseReachKm} /> : null}
    </View>
  );

  const privacyText = mine ? MINE_WORDS.privacy : mode === 'people' ? words.privacy : 'Pins show the area, never the exact spot. Each shows the biggest offer there.';

  const map = (fill: { top: number; bottom: number; left?: number }) => (
    <JobsMap
      // With sharing on, your own pin sits on your rounded cell (what your people see), never on your exact spot.
      me={mine && sharing && myCell ? myCell : home}
      pins={pins}
      selectedId={picked}
      onSelect={pick}
      ringKm={radius}
      ringAt={reachAt ?? undefined}
      fit={reachAt ? { at: reachAt, km: radius, key: fitKey } : null}
      tone={mode}
      focusId={focus}
      fill={fill}
      dim
      onMoveEnd={setMovedTo}
      callout={wide && pickedJob ? <JobCard job={pickedJob} now={now} onOpen={() => openJob(pickedJob)} onClose={close} /> : undefined}
    />
  );

  // My people: the consent sheet (from the empty state) and the tapped person's sheet.
  const personRole = profile && profile.poster_rating_count > profile.worker_rating_count ? 'poster' : 'worker';
  const modals = (
    <>
      <PeopleMapSheet visible={shareOpen} onClose={() => setShareOpen(false)} onDone={(on) => on && setBeat((b) => b + 1)} />
      {pickedPerson ? (
        <PersonSheet
          visible
          onClose={close}
          userId={pickedPerson.id}
          name={pickedPerson.display_name?.trim() || 'Someone'}
          meta={[presenceOf(pickedPerson.last_seen_at, now).label, togetherText(pickedPerson.jobs)].join(' · ')}
          rating={Number((personRole === 'poster' ? profile?.poster_rating_avg : profile?.worker_rating_avg) ?? 0)}
          ratingCount={(personRole === 'poster' ? profile?.poster_rating_count : profile?.worker_rating_count) ?? 0}
          role={personRole}
        />
      ) : null}
    </>
  );

  // Wide screens: the map fills the page and one panel on the left holds everything to read.
  if (wide) {
    const centreLeft = panelOpen ? PANEL_W + PANEL_GAP * 2 : 0;
    return (
      <View ref={root} collapsable={false} style={{ flex: 1, backgroundColor: t.colors.surface2 }}>
        {modals}
        <View style={{ flex: 1, marginBottom: bottomInset }}>
          {map({ top: 0, bottom: 0, left: panelOpen ? PANEL_W + PANEL_GAP : 0 })}

          {panelOpen ? null : (
            // Folded: one small pill to open the panel again (title and count).
            <View style={{ position: 'absolute', left: PANEL_GAP, top: PANEL_GAP + insets.top, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {leadingControl(40)}
              <Pressy
                onPress={togglePanel}
                label="Show the panel"
                style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, ...glass, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}
              >
                <Icon name="chevronRight" size={14} color={t.colors.ink} />
                <RNText style={tx('800', 12.5, t.colors.ink)} numberOfLines={1}>
                  {title}
                </RNText>
                <RNText style={tx('600', 12.5, t.colors.muted)} numberOfLines={1}>
                  {loading ? 'Looking around…' : countWords}
                </RNText>
              </Pressy>
            </View>
          )}

          {panelOpen ? (
            <View
              style={{
                position: 'absolute',
                left: PANEL_GAP,
                top: PANEL_GAP + insets.top,
                bottom: PANEL_GAP,
                width: PANEL_W,
                borderRadius: 24,
                backgroundColor: t.colors.surface,
                borderWidth: 1,
                borderColor: t.colors.line,
                overflow: 'hidden',
                shadowColor: '#000',
                shadowOpacity: 0.25,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: 10 },
                elevation: 8,
              }}
            >
              <View style={{ padding: 16, paddingBottom: 12, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <RNText accessibilityRole="header" style={tx('800', 20, t.colors.ink, { letterSpacing: -0.3 })} numberOfLines={1}>
                      {title}
                    </RNText>
                    <RNText style={tx('600', 12.5, t.colors.muted)} numberOfLines={2}>
                      {sub}
                    </RNText>
                  </View>
                  {leadingControl(34)}
                  <Pressy onPress={togglePanel} label="Hide the panel" style={{ width: 34, height: 34, borderRadius: 17, ...glass, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ transform: [{ rotate: '180deg' }] }}>
                      <Icon name="chevronRight" size={14} color={t.colors.ink} />
                    </View>
                  </Pressy>
                </View>
                {pickedHelper ? null : heroCard(false)}
                {controls}
              </View>

              {pickedHelper ? (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16 }}>
                  <HelperSheet worker={pickedHelper} onClose={close} />
                </ScrollView>
              ) : (
                <>
                  <View style={{ paddingHorizontal: 16 }}>{tabRow}</View>
                  <FadeList listRef={list} contentStyle={{ padding: 8, paddingBottom: 28, gap: ROW_GAP }}>
                    {rows}
                  </FadeList>
                </>
              )}

              <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderColor: t.colors.line }}>
                <PrivacyLine text={privacyText} tone={mode} />
              </View>
            </View>
          ) : null}

          <View pointerEvents="box-none" style={{ position: 'absolute', left: centreLeft, right: 76, top: PANEL_GAP + insets.top, alignItems: 'center' }}>
            <StatusPill text={pillText} busy={busy} />
          </View>

          {tip ? (
            <View pointerEvents="box-none" style={{ position: 'absolute', left: centreLeft, right: 76, bottom: 28, alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingLeft: 16, paddingRight: 6, borderRadius: 20, ...glass, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 5 }}>
                <RNText style={tx('700', 13, t.colors.ink)}>Scroll or pinch to zoom. Double-click to zoom in.</RNText>
                <Pressy onPress={closeTip} label="Hide this tip" style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={12} color={t.colors.text} />
                </Pressy>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  // Phones: the map fills the screen; one sheet holds the hero card and the list, a picked job becomes one card.
  const topBar = insets.top + TOP_BAR_H;
  const sheetLow = SHEET_LOW + (footer ? FOOTER_H : 0);
  const sheetHigh = Math.max(sheetLow + 120, screenH - bottomInset - topBar - 190);
  const bottom = (pickedHelper ? HELPER_H : pickedJob ? CARD_H : sheetLow) + insets.bottom;
  const here = pickedJob && step ? { title: `${areaName(pickedJob.loc_label)} area`, sub: `${step.here} ${step.here === 1 ? words.one : words.many} here · ${farText(pickedJob.km)} from you` } : null;

  return (
    <View ref={root} collapsable={false} style={{ flex: 1, backgroundColor: t.colors.surface2 }}>
      {modals}
      {/* Everything is laid out inside this box, so a bar under the map is never drawn over. */}
      <View style={{ flex: 1, marginBottom: bottomInset }}>
        {map({ top: topBar, bottom: bottom + 16 })}

        {/* Top bar: what this map shows, how many, and how far */}
        <View style={{ position: 'absolute', left: 12, right: 12, top: insets.top + 10, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1, height: 46, borderRadius: 23, ...glass, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, gap: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}>
              <View style={{ flex: 1 }}>
                <RNText style={tx('800', 14, t.colors.ink)} numberOfLines={1}>
                  {here ? here.title : title}
                </RNText>
                <RNText style={tx('600', 11, t.colors.muted)} numberOfLines={1}>
                  {here ? here.sub : loading ? 'Looking around…' : `${countWords} · within ${radius} km`}
                </RNText>
              </View>
              {here ? null : (
                <Pressy
                  onPress={() => (setEditorOpen(false), setReachOpen((v) => !v))}
                  label={`How far: ${radius} km. Change`}
                  style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  <RNText style={tx('700', 12, t.colors.ink)}>{radius} km</RNText>
                  <View style={{ transform: [{ rotate: reachOpen ? '-90deg' : '90deg' }] }}>
                    <Icon name="chevronRight" size={12} color={t.colors.text} />
                  </View>
                </Pressy>
              )}
            </View>
            {leadingControl(46)}
          </View>
          {reachOpen ? (
            <View style={{ alignSelf: 'flex-end', ...glass, borderRadius: 16, padding: 4, gap: 2, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
              {choices.map((c) => (
                <Pressy
                  key={c.km}
                  onPress={() => (chooseReach(c.km), setReachOpen(false))}
                  label={`${c.km} km`}
                  style={{ height: 40, minWidth: 130, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', backgroundColor: c.on ? t.colors.surface2 : 'transparent' }}
                >
                  <RNText style={tx(c.on ? '800' : '600', 13, t.colors.ink)}>Within {c.km} km</RNText>
                </Pressy>
              ))}
              <Pressy
                onPress={() => (setReachOpen(false), setEditorOpen(true))}
                label="Custom distance"
                style={{ height: 40, minWidth: 130, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center' }}
              >
                <RNText style={tx('700', 13, t.colors.ink)}>Custom…</RNText>
              </Pressy>
            </View>
          ) : null}
          {/* A phone types in the app's own bottom sheet, which lifts itself above the keyboard (on the phone the
              keyboard otherwise pushed the box and the map off the screen). */}
          <BottomSheet visible={editorOpen} onClose={() => setEditorOpen(false)} title="Set your distance">
            <ReachEditor plain initial={customInitial} onSet={setCustom} onCancel={() => setEditorOpen(false)} minKm={MIN_REACH_KM} maxKm={MAX_REACH_KM} parse={parseReachKm} />
          </BottomSheet>
          {busy && !loading && !reachOpen && !editorOpen ? (
            <View style={{ alignItems: 'center' }}>
              <StatusPill text="Looking around…" busy />
            </View>
          ) : null}
        </View>

        {pickedHelper ? (
          // A tapped helper: only now their name, face and service cards (plan D13).
          <FadeIn key={pickedHelper.id} {...(reduced ? { duration: 120 } : { duration: 280, translateY: 40 })} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
            <View style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: t.colors.surface, borderTopWidth: 1, borderColor: t.colors.line, paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 16 }}>
              <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: t.colors.line, marginBottom: 12 }} />
              <HelperSheet worker={pickedHelper} onClose={close} />
            </View>
          </FadeIn>
        ) : pickedJob && step ? (
          // A picked job: one card, swiped or stepped to the next job in its area; the map follows.
          <FadeIn key="card" {...(reduced ? { duration: 120 } : { duration: 260, translateY: 40 })} style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 16 }}>
            <View {...swipe.panHandlers}>
              <JobCard
                job={pickedJob}
                now={now}
                onOpen={() => openJob(pickedJob)}
                onClose={close}
                step={{ index: step.index, count: step.seq.length, label: step.label, prev: () => stepBy(-1), next: () => stepBy(1) }}
              />
            </View>
          </FadeIn>
        ) : (
          <MapSheet
            up={sheetUp}
            onChange={setSheetUp}
            low={sheetLow}
            high={sheetHigh}
            bottomInset={insets.bottom}
            header={
              sheetUp ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 }}>
                  <View style={{ flex: 1 }}>
                    <RNText accessibilityRole="header" style={tx('800', 19, t.colors.ink, { letterSpacing: -0.3 })} numberOfLines={1}>
                      {title}
                    </RNText>
                    <RNText style={tx('600', 12, t.colors.muted)} numberOfLines={1}>
                      {loading ? 'Looking around…' : `${countWords} · within ${radius} km`}
                    </RNText>
                  </View>
                  <Pressy
                    onPress={() => setSheetUp(false)}
                    label="Show the map"
                    style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    <Icon name="pin" size={14} color={t.colors.ink} />
                    <RNText style={tx('700', 12.5, t.colors.ink)}>Map</RNText>
                  </Pressy>
                </View>
              ) : undefined
            }
          >
            {sheetUp ? (
              <View style={{ flex: 1 }}>
                <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    {layerSwitch ?? <View />}
                    <ReachControl choices={choices} onPick={chooseReach} onCustom={() => setEditorOpen((v) => !v)} customOn={editorOpen} />
                  </View>
                  {tabRow}
                </View>
                <FadeList contentStyle={{ padding: 8, gap: ROW_GAP, paddingBottom: 28 }}>{rows}</FadeList>
                <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderColor: t.colors.line }}>
                  <PrivacyLine text={privacyText} tone={mode} />
                </View>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 16, gap: 12 }}>
                {heroCard(true) ?? (loading ? <RNText style={tx('600', 13, t.colors.muted, { paddingVertical: 8 })}>Looking around…</RNText> : empty)}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {onLayer
                    ? layerOptions.map((o) => chip(o.label, layer === o.value, () => onLayer(o.value)))
                    : null}
                  {filterChips}
                </View>
                {footer ?? null}
              </View>
            )}
          </MapSheet>
        )}
      </View>
    </View>
  );
}
