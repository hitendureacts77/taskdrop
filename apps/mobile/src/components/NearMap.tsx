import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View, Text as RNText, ScrollView, PanResponder, Platform, Keyboard, type ScrollViewInstance, type ViewInstance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, useFocusTick } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { useMode } from '../providers/ModeProvider';
import { attachPosters, getProfile, type Profile } from '../data/api';
import { mapPeople, remoteTasks, tasksNear, workersNear, type MapPerson, type NearbyWorker } from '../data/extras';
import { JobsMap, mapWords, type JobPin } from './JobsMap';
import { HelperSheet } from './HelperSheet';
import { ModeLockSheet } from './ModeLockSheet';
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
  ROW_GAP,
  ROW_H,
  Segmented,
  StatusPill,
  kmValue,
  type MapArea,
  type MapJob,
} from './NearMapParts';
import { DropFilters, FiltersButton, FiltersPanel, JobChips, PlaceRow, QuickChip, WorkSwitch } from './MapFilterParts';
import { distanceKm, peopleReach, postedToday, withinReach } from '../lib/mapReach';
import { DEFAULT_FILTERS, KM_STEPS, changedFilters, clearJobFilters, filterJobs, jobsSummary, matchesJob, narrowsJobs, type MapFilters } from '../lib/mapFilters';
import { setJobFilters, useJobFilters } from '../lib/jobFiltersStore';
import { REFRESH_DEBOUNCE_MS, createRefreshCache, refreshKey, shouldRefresh } from '../lib/mapRefresh';
import { activeFirst, areaName, farText, firstName, isNearby, jobPin, kmBetween, minePin, offerOf, personMeta, personPin } from './mapPins';
import { Icon } from './Icon';
import { BottomSheet, PrimaryButton, rupees } from './kit';
import { FadeIn, Pressy, tx } from './primitives';
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
/**
 * The phone sheet resting low: a slim bar (handle, one line on the best offer or nearest helper with
 * "See all", the layer chips), so the map fills the screen (owner video, 10 Nov: plan D24).
 */
const PEEK_H = 118;
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
/** The most remote jobs asked for. */
const REMOTE_ITEMS = 50;
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
 * What the map shows. 'jobs' = open tasks, 'people' = helpers, 'mine' = the "People" layer: the people
 * you finished a task with, and other signed-in adults nearby, who chose to share a rounded spot
 * (plan D20, owner decision 35b). Signed-in people only; for anyone else 'mine' falls back to 'people'.
 */
export type NearMapLayer = 'jobs' | 'people' | 'mine';

/** The Explore list's search, applied to the jobs on the map too (Jobs layer only). The filters are shared (lib/jobFiltersStore). */
export type NearMapListFilter = { query: string };

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
  onUseLocation,
  meKind = 'area',
  areaLabel,
  listFilter,
  placeIsMine = true,
  onChangePlace,
  onUseMyPlace,
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
  /** "Type my area" on the empty card (the parent opens its typing step). */
  onChooseArea?: () => void;
  /** "Use my location" on the empty card (the parent asks for the position). */
  onUseLocation?: () => void;
  /** Your marker says "You" (a live position) or "Your area" (typed or saved). */
  meKind?: 'live' | 'area';
  /** The name of the person's area ("Financial District, Hyderabad"), for the panel's subtitle. */
  areaLabel?: string;
  /** The Explore list's search, applied to the jobs shown (Jobs layer only). */
  listFilter?: NearMapListFilter;
  /** False when `centre` is a place the person picked to look around (another city), not their own area. */
  placeIsMine?: boolean;
  /** "Change" on the place row: the parent opens its place picker. */
  onChangePlace?: () => void;
  /** "My area" on the place row, shown while looking around another place. */
  onUseMyPlace?: () => void;
}) {
  const t = useTheme();
  const { go } = useNav();
  const insets = useSafeAreaInsets();
  const { desktop, tablet, height: screenH } = useLayout();
  const wide = desktop || tablet;
  const { userId, guest } = useAuth();
  // "My people" is for signed-in people only; a guest (or a signed-out screen) gets the helpers map.
  const canMine = Boolean(userId) && !guest;
  // One side per mode (plan D26): Hire sees helpers, Earn sees jobs; "People" (signed in) is on both. Any other layer falls back.
  const { mode: appMode } = useMode();
  const poster = appMode === 'poster';
  const ownLayer: NearMapLayer = poster ? 'people' : 'jobs';
  const kind: NearMapLayer = layer === ownLayer || (layer === 'mine' && canMine) ? layer : ownLayer;
  // The other side's locked option was tapped: the switch sheet.
  const [lockWant, setLockWant] = useState<'jobs' | 'helpers' | null>(null);
  const mine = kind === 'mine';
  // The look: 'mine' wears the helpers' blue faces.
  const mode: 'jobs' | 'people' = kind === 'jobs' ? 'jobs' : 'people';
  const home = centre;
  const words = mine ? { ...mapWords('people'), ...MINE_WORDS } : mapWords(mode);
  const { sharing, cell: myCell } = useMapSharing();
  const focused = useScreenFocused();
  const tick = useFocusTick();
  const root = useRef<ViewInstance>(null);

  // Where, how far, Nearby or remote, price, how they hire, due date and the order (plan D23, D27). The tab shares
  // them with the Find work list and keeps them on this device; a route that sets the distance keeps its own.
  const shared = useJobFilters();
  const own = typeof radiusKm === 'number';
  const [local, setLocal] = useState<MapFilters>(() => ({ ...DEFAULT_FILTERS, km: radiusKm ?? DEFAULT_FILTERS.km }));
  const filters = own ? local : shared;
  const setFilters = own ? setLocal : setJobFilters;
  const radius = filters.km;
  const [filtersOpen, setFiltersOpen] = useState(false);
  // From-home jobs: no pin, so they are asked for on their own and only join the list.
  const [remoteJobs, setRemoteJobs] = useState<MapJob[] | null>(null);
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
  // "Active now" (helpers and my people).
  const [narrow, setNarrow] = useState(false);
  // Helpers only: just those who list a service.
  const [served, setServed] = useState(false);
  const [tab, setTab] = useState<'jobs' | 'areas'>('jobs');
  const [sheetUp, setSheetUp] = useState(false);
  // Desktop: the side panel can be minimised to give the map the whole screen.
  const [panelOpen, setPanelOpen] = useState(true);
  // Goes up when the map should zoom to fit the chosen reach.
  const [fitKey, setFitKey] = useState(1);
  // The one-time "scroll or pinch to zoom" tip (web desktop with a mouse or trackpad).
  const [tip, setTip] = useState(false);
  const reduced = useReducedMotion();
  const list = useRef<ScrollViewInstance>(null);

  // Whether the tip was already closed once.
  useEffect(() => {
    let alive = true;
    if (Platform.OS === 'web' && desktop && browserInfo().touch === 0) {
      void AsyncStorage.getItem(TIP_KEY)
        .then((v) => alive && setTip(v !== '1'))
        .catch(() => alive && setTip(true));
    }
    return () => {
      alive = false;
    };
    // Read once per screen size; a distance from the parent is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setFiltersOpen(false);
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
      setLocal((f) => ({ ...f, km: radiusKm }));
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

  // From-home jobs (Jobs layer): they have no pin, so they join the list and the best offer, never the map.
  useEffect(() => {
    if (mode !== 'jobs') return;
    let alive = true;
    void once('remote', async () => {
      const r = await remoteTasks(REMOTE_ITEMS);
      const at = Date.now();
      return (await attachPosters(r)).map((x) => ({ ...x, km: 0, fresh: isFresh(x.created_at, at), remote: true }));
    })
      .then((rows) => alive && setRemoteJobs(rows))
      .catch(() => alive && setRemoteJobs((cur) => cur ?? []));
    return () => {
      alive = false;
    };
  }, [mode, tick]);

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

  // The Explore list's search narrows the jobs too.
  const filterQuery = (listFilter?.query ?? '').trim().toLowerCase();
  const matchesList = useMemo(
    () => (j: MapJob) => !filterQuery || `${j.title} ${j.description ?? ''}`.toLowerCase().includes(filterQuery),
    [filterQuery],
  );
  const pinnedPool = useMemo(() => (jobs ?? []).filter(matchesList), [jobs, matchesList]);
  const homePool = useMemo(() => (remoteJobs ?? []).filter(matchesList), [remoteJobs, matchesList]);
  // On the map: every pinned job the price, hire type and due date allow (none while only remote jobs are asked for), highest first.
  const shownJobs = useMemo(
    () => (filters.work === 'remote' ? [] : pinnedPool.filter((j) => matchesJob(j, filters)).sort((a, b) => b.benchmark_minor - a.benchmark_minor)),
    [pinnedPool, filters],
  );
  const shownPeople = useMemo(
    () => (kind === 'people' ? (people ?? []) : []).filter((w) => (!narrow || presenceOf(w.last_seen_at, now).online) && (!served || Boolean(w.top_service))),
    [kind, people, narrow, served, now],
  );
  // Spots older than 15 minutes are never drawn, even if the last answer is still on screen.
  const allMine = useMemo(() => activeFirst((peopleMine ?? []).filter((p) => isSpotFresh(p.spot_at, now)), now), [peopleMine, now]);
  const shownMine = useMemo(() => allMine.filter((p) => !narrow || presenceOf(p.last_seen_at, now).online), [allMine, narrow, now]);
  // The map shows what the last search found, wherever it was dragged. The list, cards, counts and the ring are
  // always around the place (your area, or the one you picked), never around where the map was dragged to:
  // that sent "10 km" somewhere else (owner video, 9 Nov).
  const reachLat = home?.lat;
  const reachLng = home?.lng;
  const reachAt = useMemo(() => (reachLat != null && reachLng != null ? { lat: reachLat, lng: reachLng } : null), [reachLat, reachLng]);
  const listJobs = useMemo(() => filterJobs(pinnedPool, homePool, reachAt, filters), [pinnedPool, homePool, reachAt, filters]);
  const nearJobs = useMemo(() => listJobs.filter((j) => !j.remote), [listJobs]);
  const homeCount = listJobs.length - nearJobs.length;
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
  const loading = mode === 'jobs' ? jobs === null && remoteJobs === null : mine ? peopleMine === null : people === null;
  const count = ids.length;
  // On the map, inside the reach or not.
  const total = mapIds.length;
  const areas = useMemo(() => bestAreas(nearJobs), [nearJobs]);
  // The map was dragged well away from the place: offer the way back.
  const placeName = (areaLabel ?? '').split(',')[0]?.trim() || 'your area';
  const away = Boolean(home && movedTo && distanceKm(home, movedTo) > Math.max(radius * 1.5, 3));
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
  // Someone I have not worked with ("Everyone nearby") gets a small card with what the server sent: no profile is read.
  const pickedPersonId = pickedPerson && !isNearby(pickedPerson) ? pickedPerson.id : null;

  // The person sheet shows their reviews, so it needs their ratings: read once per person tapped (my people only).
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
                  Turn on location to see what's around you
                </RNText>
                {onUseLocation ? (
                  <Pressy onPress={onUseLocation} label="Use my location" style={{ height: 46, paddingHorizontal: 22, borderRadius: 23, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}>
                    <RNText style={tx('800', 14, t.colors.onBtn)}>Use my location</RNText>
                  </Pressy>
                ) : null}
                {onChooseArea ? (
                  <Pressy onPress={onChooseArea} label="Type my area" style={{ height: 46, paddingHorizontal: 22, borderRadius: 23, borderWidth: 1.5, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}>
                    <RNText style={tx('800', 14, t.colors.ink)}>Type my area</RNText>
                  </Pressy>
                ) : null}
              </View>
            </FadeIn>
          </View>
        </View>
      </View>
    );
  }

  // Back to the place: forget the drag and fit the ring round the place again.
  const backToPlace = () => {
    setMovedTo(null);
    setFitKey((k) => k + 1);
  };
  // "Show N jobs" in the Filters sheet: use them now and keep them on this device.
  const applyFilters = (f: MapFilters) => {
    setFilters(f);
    setFiltersOpen(false);
    close();
    if (f.work === 'remote') setTab('jobs');
    // The sheet covers part of the map while it closes; fit again once it is gone.
    Keyboard.dismiss();
    backToPlace();
    setTimeout(() => setFitKey((k) => k + 1), 400);
  };
  const setWork = (work: MapFilters['work']) => applyFilters({ ...filters, work });
  const togglePanel = () => {
    setPanelOpen((v) => !v);
    setFitKey((k) => k + 1);
  };

  const fromHome = mode === 'jobs' && filters.work === 'remote';
  const title = mode === 'jobs' ? (fromHome ? 'Remote work' : 'Work near you') : mine ? 'People nearby' : 'Helpers near you';
  const within = fromHome ? 'from anywhere' : `within ${radius} km`;
  const sub = loading ? 'Looking around…' : `${placeName} · ${within}${mode === 'people' && live > 0 ? ` · ${live} active now` : ''}`;
  const countWords = `${count} ${count === 1 ? words.one : words.many}`;
  const pillText = busy ? 'Looking around…' : fromHome ? 'Remote jobs are in the list, not on the map' : total === 0 ? `No ${words.many} on this part of the map` : `${total} ${total === 1 ? words.one : words.many} on the map`;
  const nextReach = KM_STEPS.find((k) => k > radius) ?? null;

  // What the map shows: Jobs, Helpers or (signed in) My people. Only drawn when the parent handles the change (the tab), not on the route.
  const layerOptions: { value: NearMapLayer; label: string; locked?: boolean; lockedHint?: string }[] = [
    poster
      ? { value: 'jobs', label: 'Jobs', locked: true, lockedHint: 'Locked. Opens a switch to Earn mode' }
      : { value: 'jobs', label: 'Jobs' },
    poster
      ? { value: 'people', label: 'Helpers' }
      : { value: 'people', label: 'Helpers', locked: true, lockedHint: 'Locked. Opens a switch to Hire mode' },
    ...(canMine ? [{ value: 'mine' as NearMapLayer, label: 'People' }] : []),
  ];
  // A locked option opens the switch sheet instead of changing the layer.
  const pickLayer = (l: NearMapLayer) => {
    const o = layerOptions.find((x) => x.value === l);
    if (o?.locked) setLockWant(l === 'jobs' ? 'jobs' : 'helpers');
    else onLayer?.(l);
  };
  const layerSwitch = onLayer ? <Segmented label="Show" value={kind} onChange={pickLayer} options={layerOptions} /> : null;

  // The small chips that say what is set and open the Filters sheet; helpers keep their two on/off chips.
  const openFilters = () => setFiltersOpen(true);
  const quickChips =
    mode === 'jobs'
      ? [
          ...(fromHome ? [] : [<QuickChip key="km" label={`${radius} km`} open onPress={openFilters} />]),
          // Each set filter, with an x that takes it off; the rest are in the Filters sheet.
          <JobChips key="set" filters={filters} onChange={applyFilters} />,
        ]
      : [
          <QuickChip key="km" label={`${radius} km`} open onPress={openFilters} />,
          <QuickChip key="live" label="Active now" on={narrow} dot={t.colors.online} onPress={() => setNarrow((v) => !v)} />,
          ...(mine ? [] : [<QuickChip key="served" label="Has services" on={served} onPress={() => setServed((v) => !v)} />]),
        ];
  const placeRow = (
    <PlaceRow label={placeName} mine={placeIsMine} {...(onChangePlace ? { onChange: onChangePlace } : {})} {...(onUseMyPlace ? { onUseMine: onUseMyPlace } : {})} />
  );

  // The hero card: the best offer (jobs), or the nearest person (helpers, my people), and one line that sums up the rest.
  const bestJob = [...listJobs].sort((a, b) => b.benchmark_minor - a.benchmark_minor)[0];
  const hero = ((): {
    label: string;
    value: string;
    title: string;
    meta?: string;
    onFocus: () => void;
    onOpen: () => void;
    openLabel?: string;
    summary: string;
  } | null => {
    if (mode === 'jobs') {
      if (!bestJob) return null;
      const p = bestJob.poster;
      const rating = p && p.poster_rating_count > 0 ? `${Number(p.poster_rating_avg).toFixed(1)} ★` : null;
      const today = postedToday([bestJob], now) > 0 ? 'posted today' : null;
      const where = bestJob.remote ? ['From home'] : [areaName(bestJob.loc_label), kmValue(bestJob.km)];
      return {
        label: bestJob.remote ? 'BEST OFFER FROM HOME' : 'BEST OFFER NEAR YOU',
        value: rupees(bestJob.benchmark_minor / 100),
        title: bestJob.title,
        meta: [...where, p ? `by ${firstName(p.display_name || p.username)}` : null, rating, today].filter(Boolean).join(' · '),
        onFocus: () => (bestJob.remote ? openJob(bestJob) : pick(bestJob.id)),
        onOpen: () => openJob(bestJob),
        summary: jobsSummary(nearJobs.length, homeCount, radius, filters.work),
      };
    }
    if (mine) {
      const closest = [...listMine].sort((a, b) => a.km - b.km)[0];
      if (!closest) return null;
      return {
        label: 'NEAREST PERSON',
        value: kmValue(closest.km),
        title: firstName(closest.display_name),
        meta: `${personMeta(closest)} · ${presenceOf(closest.last_seen_at, now).label}`,
        onFocus: () => pick(closest.id),
        onOpen: () => pick(closest.id),
        openLabel: 'View',
        summary: `${countWords} within ${radius} km · ${live} active now`,
      };
    }
    const near = [...listPeople].sort((a, b) => a.km - b.km)[0];
    if (!near) return null;
    const o = offerOf(near);
    const top = topLabel(listPeople.map((w) => offerOf(w).what));
    return {
      label: 'NEAREST HELPER',
      value: kmValue(near.km),
      title: o.price ? `${o.what} · from ${o.price}` : o.what,
      meta: `${areaName(near.loc_label)}${presenceOf(near.last_seen_at, now).online ? ' · Active now' : ''}`,
      onFocus: () => pick(near.id),
      onOpen: () => pick(near.id),
      openLabel: 'View',
      summary: `${countWords} within ${radius} km · ${live} active now${top ? ` · most offer ${top.name}` : ''}`,
    };
  })();
  const heroCard = (compact: boolean) =>
    hero ? (
      <HeroCard
        tone={mode}
        compact={compact}
        label={hero.label}
        value={hero.value}
        title={hero.title}
        {...(hero.meta ? { meta: hero.meta } : {})}
        onFocus={hero.onFocus}
        onOpen={hero.onOpen}
        {...(hero.openLabel ? { openLabel: hero.openLabel } : {})}
        summary={hero.summary}
      />
    ) : null;

  const noneToShow = mine && allMine.length === 0;
  const jobFilters = mode === 'jobs' && narrowsJobs(filters);
  const filtered = narrow || served || Boolean(filterQuery) || jobFilters;
  const emptyText = fromHome
    ? jobFilters
      ? 'No remote jobs match these filters yet.'
      : 'No remote jobs right now. Check back soon.'
    : total > 0
      ? `No ${words.many} within ${radius} km of ${placeName} yet. ${total} more on the map further out.`
      : filtered
        ? 'Nothing matches these filters yet.'
        : `No ${words.many} near ${placeName} yet.`;
  const empty =
    !loading && count === 0 ? (
      noneToShow ? (
        // Nobody shows yet: either you are not sharing (offer to), or nobody around is.
        <View style={{ padding: 16, gap: 12, alignItems: 'flex-start' }}>
          <RNText style={tx('600', 13, t.colors.muted)}>
            {sharing ? 'Nobody is sharing their spot nearby right now.' : 'People show up here when they share their spot. Share yours?'}
          </RNText>
          {sharing ? null : (
            <Pressy onPress={() => setShareOpen(true)} label="Share my spot" style={{ height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}>
              <RNText style={tx('800', 13, t.colors.onBtn)}>Share my spot</RNText>
            </Pressy>
          )}
        </View>
      ) : (
        // Say why it is empty and offer the one tap that fixes it.
        <View style={{ padding: 16, gap: 12, alignItems: 'flex-start' }}>
          <RNText style={tx('600', 13, t.colors.muted)}>{emptyText}</RNText>
          {jobFilters ? (
            // One tap loosens one filter, and says how many jobs it would then show.
            <DropFilters filters={filters} count={(f) => filterJobs(pinnedPool, homePool, reachAt, f).length} onChange={applyFilters} />
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {nextReach && !fromHome && !jobFilters ? (
              <Pressy
                onPress={() => applyFilters({ ...filters, km: nextReach })}
                label={`Show within ${nextReach} km`}
                style={{ height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}
              >
                <RNText style={tx('800', 13, t.colors.onBtn)}>Show within {nextReach} km</RNText>
              </Pressy>
            ) : null}
            {jobFilters ? (
              <Pressy
                onPress={() => applyFilters(clearJobFilters(filters))}
                label="Clear filters"
                style={{ height: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}
              >
                <RNText style={tx('700', 13, t.colors.ink)}>Clear filters</RNText>
              </Pressy>
            ) : null}
          </View>
        </View>
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
      listJobs.map((j) => <JobRow key={j.id} job={j} on={picked === j.id} onPress={() => (j.remote ? openJob(j) : pick(j.id))} />)
    ));

  // The tab row (jobs only): "Jobs · 15" / "Best-paying areas". From-home jobs have no area, so that tab goes then.
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
  const tabRow =
    mode === 'jobs' ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 8, borderBottomWidth: 1, borderColor: t.colors.line }}>
        {tabButton('jobs', count > 0 ? `Jobs · ${count}` : 'Jobs')}
        {fromHome ? null : tabButton('areas', 'Best-paying areas')}
      </View>
    ) : null;

  // The controls: what the map shows, where, Nearby or remote, and the chips with the Filters button.
  const chipRow = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {quickChips}
      <View style={{ flex: 1 }} />
      <FiltersButton count={mode === 'jobs' ? changedFilters(filters) : 0} onPress={openFilters} />
    </View>
  );
  const controls = (
    <View style={{ gap: 10 }}>
      {layerSwitch}
      {placeRow}
      {mode === 'jobs' ? <WorkSwitch value={filters.work} onChange={setWork} /> : null}
      {chipRow}
    </View>
  );

  // How many a draft of the filters would show, for the sheet's button.
  const countFor = (f: MapFilters) =>
    mode === 'jobs'
      ? filterJobs(pinnedPool, homePool, reachAt, f).length
      : !reachAt
        ? 0
        : mine
          ? withinReach(shownMine, reachAt, f.km, (p) => p).length
          : withinReach(shownPeople, reachAt, f.km).length;
  const filtersSheet = (
    <BottomSheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
      <FiltersPanel
        initial={filters}
        jobs={mode === 'jobs'}
        place={{
          label: placeName,
          mine: placeIsMine,
          ...(onChangePlace ? { onChange: () => (setFiltersOpen(false), onChangePlace()) } : {}),
          ...(onUseMyPlace ? { onUseMine: () => (setFiltersOpen(false), onUseMyPlace()) } : {}),
        }}
        count={countFor}
        words={{ one: words.one, many: words.many }}
        onApply={applyFilters}
      />
    </BottomSheet>
  );

  const privacyText = mine ? MINE_WORDS.privacy : mode === 'people' ? words.privacy : 'Pins show the area, never the exact spot. Each shows the biggest offer there.';

  const map = (fill: { top: number; bottom: number; left?: number }) => (
    <JobsMap
      // With sharing on, your own pin sits on your rounded cell (what your people see), never on your exact spot.
      me={mine && sharing && myCell ? myCell : home}
      meKind={mine && sharing && myCell ? 'area' : meKind}
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
      {filtersSheet}
      <ModeLockSheet visible={lockWant !== null} want={lockWant ?? 'jobs'} onClose={() => setLockWant(null)} />
      <PeopleMapSheet visible={shareOpen} onClose={() => setShareOpen(false)} onDone={(on) => on && setBeat((b) => b + 1)} />
      {pickedPerson && isNearby(pickedPerson) ? (
        // Someone I have not worked with: a small card with only what the server sent. No profile, no chat.
        <BottomSheet visible onClose={close} title={pickedPerson.display_name?.trim() || 'Someone'}>
          <RNText style={tx('600', 14, t.colors.muted, { lineHeight: 20 })}>
            {[personMeta(pickedPerson), presenceOf(pickedPerson.last_seen_at, now).label, farText(pickedPerson.km)].join(' · ')}
          </RNText>
          <RNText style={tx('500', 13, t.colors.muted, { marginTop: 10, lineHeight: 19 })}>
            Shown on a rounded spot about 2 km wide, only while TaskDrop is open. {poster ? 'To work with them, post a task.' : 'To work with them, send a quote on one of their tasks.'}
          </RNText>
          <PrimaryButton label="Close" tone="quiet" onPress={close} style={{ marginTop: 16 }} />
        </BottomSheet>
      ) : pickedPerson ? (
        <PersonSheet
          visible
          onClose={close}
          userId={pickedPerson.id}
          name={pickedPerson.display_name?.trim() || 'Someone'}
          meta={[presenceOf(pickedPerson.last_seen_at, now).label, personMeta(pickedPerson)].join(' · ')}
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
            <StatusPill text={away && !busy ? `Back to ${placeName}` : pillText} busy={busy} {...(away && !busy ? { onPress: backToPlace } : {})} />
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
  // The low sheet is a slim bar; everything else (hero card, controls, list, footer) is one pull away.
  const sheetLow = PEEK_H;
  // Pulled up, the list takes nearly all the screen; a strip of map stays above it to show where it went.
  const sheetHigh = Math.max(sheetLow + 120, screenH - bottomInset - topBar - 90);
  const bottom = (pickedHelper ? HELPER_H : pickedJob ? CARD_H : sheetLow) + insets.bottom;
  // The low bar's line: the best offer or nearest person, else why there is nothing yet.
  const peekTitle = hero
    ? `${hero.label.charAt(0)}${hero.label.slice(1).toLowerCase()} · ${hero.value}`
    : loading
      ? 'Looking around…'
      : count === 0
        ? fromHome
          ? 'No remote jobs right now'
          : `No ${words.many} within ${radius} km yet`
        : countWords;
  const peekSub = hero ? hero.title : loading ? '' : 'Swipe up for the list';
  const here = pickedJob && step ? { title: `${areaName(pickedJob.loc_label)} area`, sub: `${step.here} ${step.here === 1 ? words.one : words.many} here · ${farText(pickedJob.km)} from you` } : null;

  return (
    <View ref={root} collapsable={false} style={{ flex: 1, backgroundColor: t.colors.surface2 }}>
      {modals}
      {/* Everything is laid out inside this box, so a bar under the map is never drawn over. */}
      <View style={{ flex: 1, marginBottom: bottomInset }}>
        {map({ top: topBar, bottom: bottom + 16 })}

        {/* Top bar: what this map shows, where, how many; the distance button opens the Filters sheet. */}
        <View style={{ position: 'absolute', left: 12, right: 12, top: insets.top + 10, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1, height: 46, borderRadius: 23, ...glass, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, gap: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}>
              <View style={{ flex: 1 }}>
                <RNText style={tx('800', 14, t.colors.ink)} numberOfLines={1}>
                  {here ? here.title : title}
                </RNText>
                <RNText style={tx('600', 11, t.colors.muted)} numberOfLines={1}>
                  {here ? here.sub : loading ? 'Looking around…' : `${countWords} · ${placeName} · ${within}`}
                </RNText>
              </View>
              {here ? null : (
                <Pressy
                  onPress={openFilters}
                  label={fromHome ? 'Filters' : `How far: ${radius} km. Change`}
                  style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                >
                  <Icon name="filter" size={12} color={t.colors.ink} />
                  <RNText style={tx('700', 12, t.colors.ink)}>{fromHome ? 'Filters' : `${radius} km`}</RNText>
                </Pressy>
              )}
            </View>
            {leadingControl(46)}
          </View>
          {away && !busy ? (
            <View style={{ alignItems: 'center' }}>
              <StatusPill text={`Back to ${placeName}`} busy={false} onPress={backToPlace} />
            </View>
          ) : busy && !loading ? (
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
                      {loading ? 'Looking around…' : `${countWords} · ${within}`}
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
                {/* The controls and the best offer (or nearest helper) scroll with the list, so a short screen still shows the list. */}
                <FadeList contentStyle={{ padding: 8, gap: ROW_GAP, paddingBottom: 28 }}>
                  <View style={{ paddingHorizontal: 8, gap: 10, paddingBottom: 8 }}>
                    {controls}
                    {footer ?? null}
                    {heroCard(true)}
                    {tabRow}
                  </View>
                  {rows}
                </FadeList>
                <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderColor: t.colors.line }}>
                  <PrivacyLine text={privacyText} tone={mode} />
                </View>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 16, gap: 10 }}>
                {/* One line on what is best here, and the clear way up to the list. */}
                <Pressy onPress={() => setSheetUp(true)} label={`${peekTitle}${peekSub ? `, ${peekSub}` : ''}. See all`} scaleTo={0.99} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <RNText style={tx('800', 14.5, t.colors.ink, { fontVariant: ['tabular-nums'] })} numberOfLines={1}>
                      {peekTitle}
                    </RNText>
                    {peekSub ? (
                      <RNText style={tx('600', 12, t.colors.muted)} numberOfLines={1}>
                        {peekSub}
                      </RNText>
                    ) : null}
                  </View>
                  <View style={{ height: 36, paddingLeft: 12, paddingRight: 14, borderRadius: 18, backgroundColor: t.colors.btn, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <PeekArrow color={t.colors.onBtn} reduced={reduced} />
                    <RNText style={tx('800', 13, t.colors.onBtn)}>See all</RNText>
                  </View>
                </Pressy>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {onLayer ? layerOptions.map((o) => (
                    <QuickChip key={o.value} label={o.label} on={kind === o.value} onPress={() => pickLayer(o.value)} {...(o.locked ? { locked: true, ...(o.lockedHint ? { lockedHint: o.lockedHint } : {}) } : {})} />
                  )) : null}
                  <View style={{ flex: 1 }} />
                  <FiltersButton count={mode === 'jobs' ? changedFilters(filters) : 0} onPress={openFilters} />
                </View>
              </View>
            )}
          </MapSheet>
        )}
      </View>
    </View>
  );
}

/** The "See all" arrow: points up and gives a few small nudges after the map opens, then rests. */
function PeekArrow({ color, reduced }: { color: string; reduced: boolean }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const nudge = Animated.sequence([
      Animated.timing(y, { toValue: -3, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(y, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.delay(900),
    ]);
    const run = Animated.loop(nudge, { iterations: 3 });
    const id = setTimeout(() => run.start(), 700);
    return () => {
      clearTimeout(id);
      run.stop();
    };
  }, [reduced, y]);
  return (
    <Animated.View style={{ transform: [{ translateY: y }, { rotate: '-90deg' }] }}>
      <Icon name="chevronRight" size={14} color={color} />
    </Animated.View>
  );
}
