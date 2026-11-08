import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, ScrollView, PanResponder, Platform, type ScrollViewInstance, type ViewInstance } from 'react-native';
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
  HelperRow,
  JobCard,
  JobRow,
  MapNotes,
  MINE_WORDS,
  PersonRow,
  ROW_GAP,
  ROW_H,
  Segmented,
  StatTiles,
  type MapArea,
  type MapJob,
} from './NearMapParts';
import { withinReach, reachWords } from '../lib/mapReach';
import { activeFirst, areaName, farText, firstName, jobPin, kmBetween, minePin, offerOf, personPin, togetherText } from './mapPins';
import { Icon } from './Icon';
import { rupees } from './kit';
import { FadeIn, Pressy, tx } from './primitives';
import { useReducedMotion } from '../lib/motion';
import { taskToFeedRow } from '../lib/openTask';
import { isFresh } from '../lib/mapMotion';
import { presenceOf } from '../lib/presence';
import { useLayout } from '../lib/layout';
import { inFront, onBackInFront } from '../lib/inFront';
import { PEOPLE_POLL_MS, isSpotFresh } from '../lib/mapSpot';
import { useMapSharing } from '../lib/useMapSpot';

/** The desktop side panel. */
const PANEL_W = 384;
const PANEL_GAP = 16;
/** The phone sheet resting low: a summary over the map. */
const SHEET_LOW = 214;
/** About how much taller the low sheet gets when a `footer` line sits under the stats. */
const FOOTER_H = 40;
/** The layer chip row's height plus its gap, on a phone's top bar. */
const LAYER_ROW_H = 44;
/** About how tall a picked job's card is on a phone, so the map keeps its pin above it. */
const CARD_H = 300;
/** About how tall a tapped helper's sheet is, so the map keeps their pin above it. */
const HELPER_H = 430;
/**
 * The map is asked for everything the server will give (a country-wide reach, its newest 200), so zooming out
 * shows every task; the 5 / 10 / 25 km choice only filters the list and cards and zooms the map to fit.
 */
const WIDE_KM = 20000;
const WIDE_ITEMS = 200;
/** My people are only ever asked for within this reach (the server's limit for that call). */
const MINE_KM = 50;
/** The "₹1,000+" filter. */
const HIGH_PAY = 1000;
/** The reaches you can pick, as on Home. */
const REACH = [5, 10, 25];

type Point = { lat: number; lng: number };

/** With no area chosen the map shows the whole country: about the middle of India, zoomed out as far as the map goes. */
const INDIA_CENTRE: Point = { lat: 22.5, lng: 79 };
const INDIA_ZOOM = 5;
const noPick = () => {};

/**
 * What the map shows. 'jobs' = open tasks, 'people' = helpers, 'mine' = "My people": the people
 * you finished a task with who chose to share a rounded spot (plan D20). Signed-in people only;
 * for anyone else 'mine' falls back to 'people'.
 */
export type NearMapLayer = 'jobs' | 'people' | 'mine';

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

/**
 * The full-screen map (plans D11-D14). A worker sees each area's biggest offer,
 * and zoomed in every task with its price, poster and title; a poster sees
 * helpers as what they offer (plan D13: service and price, no names). Plan D14
 * keeps the map clear: on a wide screen the list, filters and notes live in a
 * side panel and a picked job opens a card right above its pin; on a phone they
 * live in one bottom sheet that rests low or pulls up, and a picked job becomes
 * a single card that steps through the jobs in its area. Moving the map offers
 * "Search this area".
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
}: {
  layer: NearMapLayer;
  /** Given: show the layer chips (Jobs, Helpers). Undefined: no chips (route use). */
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
  // Where the results were looked up; it moves only when "Search this area" is tapped.
  const [searchAt, setSearchAt] = useState<Point | null>(home);
  const [movedTo, setMovedTo] = useState<Point | null>(null);
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
  const reduced = useReducedMotion();
  const list = useRef<ScrollViewInstance>(null);

  // As a tab the parent can change the layer, the area or the reach while this stays mounted.
  useEffect(() => {
    setPicked(null);
    setFocus(null);
    setNarrow(false);
    setServed(false);
    setTab('jobs');
    setSheetUp(false);
    setReachOpen(false);
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

  useEffect(() => {
    if (!searchAt) return;
    let alive = true;
    const at = Date.now();
    // Distances are always from you, even when the map searched somewhere else.
    const from = (lat: number | null, lng: number | null, km: number) => (home && lat != null && lng != null ? kmBetween(home, { lat, lng }) : km);
    if (kind === 'mine') {
      // Never logs the result: it holds names and rounded spots.
      void mapPeople(searchAt, MINE_KM).then((r) => alive && (setNow(at), setPeopleMine(r.map((p) => ({ ...p, km: from(p.lat, p.lng, p.km) })))));
    } else if (mode === 'jobs') {
      // Posters ride along so the zoomed-in map shows who posted each task.
      void tasksNear(searchAt, WIDE_KM, WIDE_ITEMS)
        .then(async (r) => {
          const withPeople = await attachPosters(r);
          if (alive) {
            setNow(at);
            setJobs(withPeople.map((x, i) => ({ ...x, km: from(x.loc_lat, x.loc_lng, r[i]!.km), fresh: isFresh(x.created_at, at) })));
          }
        })
        .catch(() => alive && setJobs([]));
    } else {
      void workersNear(searchAt, WIDE_KM, WIDE_ITEMS)
        .then((r) => alive && (setNow(at), setPeople(activeFirst(r.map((w) => ({ ...w, km: from(w.loc_lat, w.loc_lng, w.km) })), at))))
        .catch(() => alive && setPeople([]));
    }
    return () => {
      alive = false;
    };
    // The point arrives as a fresh object each time; its numbers are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `tick` and `beat` only matter for My people: they re-ask on return, on a live change, and every minute.
  }, [kind, searchAt?.lat, searchAt?.lng, mine ? tick : 0, mine ? beat : 0]);

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

  // Highest offer first, the order of the list and of "Best offer".
  const shownJobs = useMemo(
    () => (jobs ?? []).filter((j) => !narrow || j.benchmark_minor >= HIGH_PAY * 100).sort((a, b) => b.benchmark_minor - a.benchmark_minor),
    [jobs, narrow],
  );
  const shownPeople = useMemo(
    () => (kind === 'people' ? (people ?? []) : []).filter((w) => (!narrow || presenceOf(w.last_seen_at, now).online) && (!served || Boolean(w.top_service))),
    [kind, people, narrow, served, now],
  );
  // Spots older than 15 minutes are never drawn, even if the last answer is still on screen.
  const allMine = useMemo(() => activeFirst((peopleMine ?? []).filter((p) => isSpotFresh(p.spot_at, now)), now), [peopleMine, now]);
  const shownMine = useMemo(() => allMine.filter((p) => !narrow || presenceOf(p.last_seen_at, now).online), [allMine, narrow, now]);
  // The map shows all of the above (zoom out for the whole country); the list, cards and counts only what is inside the reach.
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
  const sectionLabel = (text: string) => <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 0.6 })}>{text}</RNText>;

  // The control where the close X sits: a close button on the route, a "List" pill in the tab.
  const leadingControl = (size: number) =>
    leading.kind === 'close' ? (
      <Pressy onPress={leading.onPress} label="Close the map" style={{ width: size, height: size, borderRadius: size / 2, ...glass, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="close" size={size === 44 ? 18 : 16} color={t.colors.ink} />
      </Pressy>
    ) : (
      <Pressy
        onPress={leading.onPress}
        label="Show the list"
        style={{ height: size, paddingHorizontal: 16, borderRadius: size / 2, ...glass, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        <Icon name="list" size={size === 44 ? 16 : 14} color={t.colors.ink} />
        <RNText style={tx('700', 13, t.colors.ink)}>List</RNText>
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

  const searchedHere = !searchAt || kmBetween(searchAt, home) < 0.5;
  const showSearch = movedTo !== null && searchAt !== null && kmBetween(movedTo, searchAt) > Math.max(1, radius * 0.3);
  // A reach button: filter the list to it and zoom the map to fit its circle.
  const chooseReach = (r: number) => {
    setRadius(r);
    setFitKey((k) => k + 1);
    close();
  };
  const togglePanel = () => {
    setPanelOpen((v) => !v);
    setFitKey((k) => k + 1);
  };
  const searchHere = () => {
    if (!movedTo) return;
    setSearchAt(movedTo);
    setMovedTo(null);
    setFitKey((k) => k + 1);
    close();
  };

  const title = mode === 'jobs' ? 'Work near you' : mine ? 'Your people nearby' : 'Helpers near you';
  const sub = loading
    ? 'Looking around…'
    : count === 0
      ? mine && allMine.length === 0
        ? sharing
          ? 'None of your people are sharing right now'
          : 'Nobody is sharing their spot yet'
        : `No ${words.many} ${searchedHere ? `within ${radius} km` : 'in this part of the map'} yet`
      : `${count} ${count === 1 ? words.one : words.many} ${searchedHere ? `within ${radius} km` : 'in this part of the map'}${mode === 'people' && live > 0 ? ` · ${live} active now` : ''}${total > count ? ` · ${total} on the map` : ''}`;
  const reaches = [...new Set([...REACH, radius])].sort((a, b) => a - b);
  const nextReach = reaches.find((r) => r > radius) ?? null;

  const chip = (label: string, on: boolean, onPress: () => void, dot?: string) => (
    <Pressy
      key={label}
      onPress={onPress}
      label={label}
      style={{ height: 34, paddingHorizontal: 13, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 6, ...(on ? { backgroundColor: t.colors.ink } : glass) }}
    >
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
      <RNText style={tx(on ? '800' : '700', 12.5, on ? t.colors.bg : t.colors.ink)}>{label}</RNText>
    </Pressy>
  );
  const chips =
    mode === 'jobs'
      ? [chip('All', !narrow, () => setNarrow(false)), chip(`${rupees(HIGH_PAY)}+`, narrow, () => setNarrow(true))]
      : mine
        ? [chip('All', !narrow, () => setNarrow(false)), chip('Active now', narrow, () => setNarrow((v) => !v), t.colors.online)]
        : [chip('All', !narrow && !served, () => (setNarrow(false), setServed(false))), chip('Active now', narrow, () => setNarrow((v) => !v), t.colors.online), chip('Has services', served, () => setServed((v) => !v))];

  // What the map shows: Jobs, Helpers or (signed in) My people. Only drawn when the parent handles the change (the tab), not on the route.
  const layerChips = onLayer ? (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {chip('Jobs', layer === 'jobs', () => onLayer('jobs'))}
      {chip('Helpers', layer === 'people', () => onLayer('people'))}
      {canMine ? chip('My people', layer === 'mine', () => onLayer('mine')) : null}
    </View>
  ) : null;

  // Two tiles that answer "where is the money" and "what is closest" at a glance.
  const bestJob = listJobs[0];
  const nearJob = [...listJobs].sort((a, b) => a.km - b.km)[0];
  const reach = reachWords({
    radius,
    best: bestJob ? { id: bestJob.id, rupees: bestJob.benchmark_minor / 100, km: bestJob.km } : null,
    nearest: nearJob ? { id: nearJob.id, rupees: nearJob.benchmark_minor / 100, km: nearJob.km } : null,
    money: rupees,
  });
  const pitch = mode === 'jobs' && count > 0 ? reach.pitch : '';
  const pitchLine = pitch ? <RNText style={tx('700', 13, t.colors.ink)}>{pitch}</RNText> : null;
  const tiles = (() => {
    if (mode === 'jobs') {
      const best = bestJob;
      const near = nearJob;
      if (!best || !near) return null;
      return [
        { label: reach.bestLabel, value: rupees(best.benchmark_minor / 100), sub: `${areaName(best.loc_label)} · ${farText(best.km)} away`, strong: true, onPress: () => pick(best.id) },
        { label: reach.nearestLabel, value: farText(near.km), sub: `${areaName(near.loc_label)} · pays ${rupees(near.benchmark_minor / 100)}`, onPress: () => pick(near.id) },
      ];
    }
    if (mine) {
      const closest = [...listMine].sort((a, b) => a.km - b.km)[0];
      if (!closest) return null;
      return [
        { label: `Active now within ${radius} km`, value: String(live), sub: live === 1 ? 'person with TaskDrop open' : 'people with TaskDrop open', strong: narrow, onPress: () => setNarrow((v) => !v) },
        { label: 'Nearest of your people', value: farText(closest.km), sub: `${firstName(closest.display_name)} · ${togetherText(closest.jobs)}`, onPress: () => pick(closest.id) },
      ];
    }
    const near = [...listPeople].sort((a, b) => a.km - b.km)[0];
    if (!near) return null;
    return [
      { label: `Active now within ${radius} km`, value: String(live), sub: live === 1 ? 'helper with TaskDrop open' : 'helpers with TaskDrop open', strong: narrow, onPress: () => setNarrow((v) => !v) },
      { label: 'Nearest helper', value: farText(near.km), sub: `${areaName(near.loc_label)} · ${offerOf(near).what}`, onPress: () => pick(near.id) },
    ];
  })();

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
            : narrow || served
              ? 'Nothing matches this filter yet. Tap All to see everyone.'
              : `No ${words.many} here yet. Try a bigger reach.`}
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
  const tabs =
    mode === 'jobs' ? (
      <Segmented
        label="Show"
        grow
        value={tab}
        onChange={setTab}
        options={[
          { value: 'jobs', label: count > 0 ? `Jobs · ${count}` : 'Jobs' },
          { value: 'areas', label: 'Best-paying areas' },
        ]}
      />
    ) : null;

  const searchButton = showSearch ? (
    <FadeIn {...(reduced ? { duration: 120 } : { duration: 220, translateY: -8 })}>
      <Pressy onPress={searchHere} label="Search this area" style={{ height: 40, paddingHorizontal: 16, borderRadius: 20, ...glass, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}>
        <Icon name="refresh" size={14} color={t.colors.ink} />
        <RNText style={tx('700', 13, t.colors.ink)}>Search this area</RNText>
      </Pressy>
    </FadeIn>
  ) : null;

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
    return (
      <View ref={root} collapsable={false} style={{ flex: 1, backgroundColor: t.colors.surface2 }}>
        {modals}
        <View style={{ flex: 1, marginBottom: bottomInset }}>
          {map({ top: 0, bottom: 0, left: panelOpen ? PANEL_W + PANEL_GAP : 0 })}

          {panelOpen ? null : (
            <View
              style={{
                position: 'absolute',
                left: PANEL_GAP,
                top: PANEL_GAP + insets.top,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                padding: 6,
                borderRadius: 22,
                ...glass,
                shadowColor: '#000',
                shadowOpacity: 0.2,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
              }}
            >
              {leadingControl(40)}
              <Pressy onPress={togglePanel} label="Show the panel" style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: t.colors.surface2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="list" size={14} color={t.colors.ink} />
                <RNText style={tx('700', 12.5, t.colors.ink)} numberOfLines={1}>
                  {loading ? 'Looking around…' : `${count} ${count === 1 ? words.one : words.many} within ${radius} km`}
                </RNText>
              </Pressy>
              <Segmented label="How far" value={radius} onChange={chooseReach} options={reaches.map((r) => ({ value: r, label: `${r} km` }))} />
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
            <View style={{ padding: 18, paddingBottom: 14, gap: 14, borderBottomWidth: 1, borderColor: t.colors.line }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {leadingControl(40)}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <RNText accessibilityRole="header" style={tx('800', 19, t.colors.ink, { letterSpacing: -0.3 })} numberOfLines={1}>
                    {title}
                  </RNText>
                  <RNText style={tx('600', 12.5, t.colors.muted)} numberOfLines={2}>
                    {sub}
                  </RNText>
                </View>
                <Pressy onPress={togglePanel} label="Hide the panel" style={{ width: 36, height: 36, borderRadius: 18, ...glass, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ transform: [{ rotate: '180deg' }] }}>
                    <Icon name="chevronRight" size={16} color={t.colors.ink} />
                  </View>
                </Pressy>
              </View>
              {layerChips ? (
                <View style={{ gap: 6 }}>
                  {sectionLabel('SHOW')}
                  {layerChips}
                </View>
              ) : null}
              <View style={{ gap: 6 }}>
                {sectionLabel('WITHIN')}
                <Segmented label="How far" grow value={radius} onChange={chooseReach} options={reaches.map((r) => ({ value: r, label: `${r} km` }))} />
              </View>
              <View style={{ gap: 6 }}>
                {sectionLabel('FILTER')}
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>{chips}</View>
              </View>
              {pitchLine}
              {tiles ? <StatTiles tiles={tiles} tone={mode} summary={pitch || undefined} /> : null}
              {pickedHelper ? null : tabs}
            </View>

            {pickedHelper ? (
              <ScrollView contentContainerStyle={{ padding: 16 }}>
                <HelperSheet worker={pickedHelper} onClose={close} />
              </ScrollView>
            ) : (
              <ScrollView ref={list} contentContainerStyle={{ padding: 8, gap: ROW_GAP }}>
                {Array.isArray(rows) && rows.length > 0 ? (
                  <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 0.6, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 2 })}>
                    {mode === 'jobs' ? 'HIGHEST OFFER FIRST' : 'ACTIVE NOW FIRST'}
                  </RNText>
                ) : null}
                {rows}
              </ScrollView>
            )}

            <View style={{ paddingHorizontal: 18, paddingVertical: 12, borderTopWidth: 1, borderColor: t.colors.line }}>
              <MapNotes tone={mode} mine={mine} />
            </View>
          </View>
          ) : null}

          <View pointerEvents="box-none" style={{ position: 'absolute', left: panelOpen ? PANEL_W + PANEL_GAP * 2 : 0, right: 76, top: PANEL_GAP + insets.top, alignItems: 'center' }}>
            {searchButton}
          </View>
        </View>
      </View>
    );
  }

  // Phones: the map fills the screen; one sheet holds the list, a picked job becomes one card.
  const topBar = insets.top + 106 + (layerChips ? LAYER_ROW_H : 0);
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

        {/* Top bar: what this map shows, how far it reaches, and the filters */}
        <View style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 10, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {leadingControl(44)}
            <View style={{ flex: 1, height: 44, borderRadius: 22, ...glass, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, gap: 8 }}>
              <View style={{ flex: 1 }}>
                <RNText style={tx('800', 14, t.colors.ink)} numberOfLines={1}>
                  {here ? here.title : title}
                </RNText>
                <RNText style={tx('600', 11, t.colors.muted)} numberOfLines={1}>
                  {here ? here.sub : sub}
                </RNText>
              </View>
              {here ? null : (
                <Pressy
                  onPress={() => setReachOpen((v) => !v)}
                  label={`How far: ${radius} km. Change`}
                  style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  <RNText style={tx('700', 12, t.colors.text)}>{radius} km</RNText>
                  <View style={{ transform: [{ rotate: reachOpen ? '-90deg' : '90deg' }] }}>
                    <Icon name="chevronRight" size={12} color={t.colors.text} />
                  </View>
                </Pressy>
              )}
            </View>
          </View>
          {layerChips}
          {reachOpen ? (
            <View style={{ alignSelf: 'flex-end', ...glass, borderRadius: 16, padding: 4, gap: 2, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
              {reaches.map((r) => (
                <Pressy
                  key={r}
                  onPress={() => (chooseReach(r), setReachOpen(false))}
                  label={`${r} km`}
                  style={{ height: 40, minWidth: 110, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', backgroundColor: r === radius ? t.colors.surface2 : 'transparent' }}
                >
                  <RNText style={tx(r === radius ? '800' : '600', 13, t.colors.ink)}>Within {r} km</RNText>
                </Pressy>
              ))}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>{chips}</View>
          )}
        </View>

        <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, top: topBar + 4, alignItems: 'center' }}>
          {searchButton}
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
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <RNText style={tx('800', 18, t.colors.ink, { letterSpacing: -0.3 })} numberOfLines={1}>
                    {loading ? 'Looking around…' : `${count} ${count === 1 ? words.one : words.many} within ${radius} km`}
                  </RNText>
                  {sheetUp ? null : (
                    <RNText style={tx('600', 12, t.colors.muted)}>{count > 0 ? 'Pull up to see them all' : sub}</RNText>
                  )}
                </View>
                <Pressy
                  onPress={() => setSheetUp((v) => !v)}
                  // In the tab the "List" pill up top already says "Show the list" (it opens the Explore page), so this one says what it does.
                  label={sheetUp ? 'Show the map' : leading.kind === 'list' ? 'Pull up the list' : 'Show the list'}
                  style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <Icon name={sheetUp ? 'pin' : 'list'} size={14} color={t.colors.ink} />
                  <RNText style={tx('700', 12.5, t.colors.ink)}>{sheetUp ? 'Map' : 'List'}</RNText>
                </Pressy>
              </View>
            }
          >
            {sheetUp ? (
              <View style={{ flex: 1 }}>
                {tabs ? <View style={{ paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderColor: t.colors.line }}>{tabs}</View> : null}
                <ScrollView contentContainerStyle={{ padding: 8, gap: ROW_GAP, paddingBottom: 24 }}>
                  {rows}
                  <View style={{ paddingHorizontal: 10, paddingTop: 12 }}>
                    <MapNotes tone={mode} mine={mine} />
                  </View>
                </ScrollView>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 16, gap: 12 }}>
                {pitchLine}
                {tiles ? <StatTiles tiles={tiles} tone={mode} summary={pitch || undefined} /> : empty}
                {footer ?? null}
                <MapNotes tone={mode} legend={false} mine={mine} />
              </View>
            )}
          </MapSheet>
        )}
      </View>
    </View>
  );
}
