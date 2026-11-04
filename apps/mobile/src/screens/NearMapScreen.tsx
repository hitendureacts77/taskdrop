import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, ScrollView, PanResponder, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { attachPosters } from '../data/api';
import { tasksNear, workersNear, type NearbyWorker } from '../data/extras';
import { JobsMap, mapWords, type JobPin } from '../components/JobsMap';
import { HelperSheet } from '../components/HelperSheet';
import { MapSheet } from '../components/MapSheet';
import {
  AreaRow,
  HelperRow,
  JobCard,
  JobRow,
  MapNotes,
  ROW_GAP,
  ROW_H,
  Segmented,
  StatTiles,
  type MapArea,
  type MapJob,
} from '../components/NearMapParts';
import { activeFirst, areaName, farText, jobPin, kmBetween, offerOf, personPin } from '../components/mapPins';
import { Icon } from '../components/Icon';
import { rupees } from '../components/kit';
import { FadeIn, Pressy, tx } from '../components/primitives';
import { useReducedMotion } from '../lib/motion';
import { taskToFeedRow } from '../lib/openTask';
import { isFresh } from '../lib/mapMotion';
import { presenceOf } from '../lib/presence';
import { useLayout } from '../lib/layout';

/** The desktop side panel. */
const PANEL_W = 384;
const PANEL_GAP = 16;
/** The phone sheet resting low: a summary over the map. */
const SHEET_LOW = 214;
/** About how tall a picked job's card is on a phone, so the map keeps its pin above it. */
const CARD_H = 300;
/** About how tall a tapped helper's sheet is, so the map keeps their pin above it. */
const HELPER_H = 430;
/** Enough to fill a big city's 5-10 km without the map turning to noise (clusters take the rest). */
const MAX_ITEMS = 60;
/** The "₹1,000+" filter. */
const HIGH_PAY = 1000;
/** The reaches you can pick, as on Home. */
const REACH = [5, 10, 25];

type Point = { lat: number; lng: number };
const isPoint = (v: unknown): v is Point =>
  typeof v === 'object' && v !== null && typeof (v as Point).lat === 'number' && typeof (v as Point).lng === 'number';

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
 * "Search this area". Opened from a Home or Explore map with
 * { mode: 'jobs' | 'people', centre, radiusKm }.
 */
export function NearMapScreen() {
  const t = useTheme();
  const { params, back, go } = useNav();
  const insets = useSafeAreaInsets();
  const { desktop, tablet, height: screenH } = useLayout();
  const wide = desktop || tablet;
  const mode = params.mode === 'people' ? 'people' : 'jobs';
  const home = isPoint(params.centre) ? params.centre : null;
  const words = mapWords(mode);

  const [radius, setRadius] = useState(() => (typeof params.radiusKm === 'number' ? params.radiusKm : 5));
  // Where the results were looked up; it moves only when "Search this area" is tapped.
  const [searchAt, setSearchAt] = useState<Point | null>(home);
  const [movedTo, setMovedTo] = useState<Point | null>(null);
  const [jobs, setJobs] = useState<MapJob[] | null>(null);
  const [people, setPeople] = useState<NearbyWorker[] | null>(null);
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
  const reduced = useReducedMotion();
  const list = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    if (!searchAt) return;
    let alive = true;
    const at = Date.now();
    // Distances are always from you, even when the map searched somewhere else.
    const from = (lat: number | null, lng: number | null, km: number) => (home && lat != null && lng != null ? kmBetween(home, { lat, lng }) : km);
    if (mode === 'jobs') {
      // Posters ride along so the zoomed-in map shows who posted each task.
      void tasksNear(searchAt, radius, MAX_ITEMS)
        .then(async (r) => {
          const withPeople = await attachPosters(r);
          if (alive) {
            setNow(at);
            setJobs(withPeople.map((x, i) => ({ ...x, km: from(x.loc_lat, x.loc_lng, r[i]!.km), fresh: isFresh(x.created_at, at) })));
          }
        })
        .catch(() => alive && setJobs([]));
    } else {
      void workersNear(searchAt, radius, MAX_ITEMS)
        .then((r) => alive && (setNow(at), setPeople(activeFirst(r.map((w) => ({ ...w, km: from(w.loc_lat, w.loc_lng, w.km) })), at))))
        .catch(() => alive && setPeople([]));
    }
    return () => {
      alive = false;
    };
    // The point arrives as a fresh object each time; its numbers are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, searchAt?.lat, searchAt?.lng, radius]);

  // Highest offer first, the order of the list and of "Best offer".
  const shownJobs = useMemo(
    () => (jobs ?? []).filter((j) => !narrow || j.benchmark_minor >= HIGH_PAY * 100).sort((a, b) => b.benchmark_minor - a.benchmark_minor),
    [jobs, narrow],
  );
  const shownPeople = useMemo(
    () => (people ?? []).filter((w) => (!narrow || presenceOf(w.last_seen_at, now).online) && (!served || Boolean(w.top_service))),
    [people, narrow, served, now],
  );
  const ids = useMemo(() => (mode === 'jobs' ? shownJobs.map((j) => j.id) : shownPeople.map((p) => p.id)), [mode, shownJobs, shownPeople]);
  const pins = useMemo<JobPin[]>(
    () =>
      mode === 'jobs'
        ? shownJobs.map((j) => jobPin(j, now)).filter((p): p is JobPin => p !== null)
        : shownPeople.map((w) => personPin(w, now)).filter((p): p is JobPin => p !== null),
    [mode, shownJobs, shownPeople, now],
  );
  const loading = mode === 'jobs' ? jobs === null : people === null;
  const count = ids.length;
  const areas = useMemo(() => bestAreas(shownJobs), [shownJobs]);
  const live = shownPeople.filter((w) => presenceOf(w.last_seen_at, now).online).length;

  const pickedJob = mode === 'jobs' ? (shownJobs.find((j) => j.id === picked) ?? null) : null;
  const pickedHelper = mode === 'people' ? (shownPeople.find((w) => w.id === picked) ?? null) : null;

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

  const searchedHere = !searchAt || !home || kmBetween(searchAt, home) < 0.5;
  const showSearch = movedTo !== null && searchAt !== null && kmBetween(movedTo, searchAt) > Math.max(1, radius * 0.3);
  const searchHere = () => {
    if (!movedTo) return;
    setSearchAt(movedTo);
    setMovedTo(null);
    close();
  };

  const title = mode === 'jobs' ? 'Work near you' : 'Helpers near you';
  const sub = loading
    ? 'Looking around…'
    : count === 0
      ? `No ${words.many} ${searchedHere ? `within ${radius} km` : 'in this part of the map'} yet`
      : `${count} ${count === 1 ? words.one : words.many} ${searchedHere ? `within ${radius} km` : 'in this part of the map'}${mode === 'people' && live > 0 ? ` · ${live} active now` : ''}`;
  const reaches = [...new Set([...REACH, radius])].sort((a, b) => a - b);

  const glass = { backgroundColor: t.colors.bg, borderWidth: 1, borderColor: t.colors.line };
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
      : [chip('All', !narrow && !served, () => (setNarrow(false), setServed(false))), chip('Active now', narrow, () => setNarrow((v) => !v), '#22C55E'), chip('Has services', served, () => setServed((v) => !v))];

  // Two tiles that answer "where is the money" and "what is closest" at a glance.
  const tiles = (() => {
    if (mode === 'jobs') {
      const best = shownJobs[0];
      const near = [...shownJobs].sort((a, b) => a.km - b.km)[0];
      if (!best || !near) return null;
      return [
        { label: 'Best offer', value: rupees(best.benchmark_minor / 100), sub: `${areaName(best.loc_label)} · ${farText(best.km)}`, strong: true, onPress: () => pick(best.id) },
        { label: 'Nearest', value: farText(near.km), sub: `${areaName(near.loc_label)} · ${rupees(near.benchmark_minor / 100)}`, onPress: () => pick(near.id) },
      ];
    }
    const near = [...shownPeople].sort((a, b) => a.km - b.km)[0];
    if (!near) return null;
    return [
      { label: 'Active now', value: String(live), sub: live === 1 ? 'helper with TaskDrop open' : 'helpers with TaskDrop open', strong: narrow, onPress: () => setNarrow((v) => !v) },
      { label: 'Nearest', value: farText(near.km), sub: `${areaName(near.loc_label)} · ${offerOf(near).what}`, onPress: () => pick(near.id) },
    ];
  })();

  const empty = !home ? (
    <RNText style={tx('700', 14, t.colors.ink, { padding: 16 })}>Set your area on Home to see what is near you</RNText>
  ) : !loading && count === 0 ? (
    <RNText style={tx('600', 13, t.colors.muted, { padding: 16 })}>
      {narrow || served ? 'Nothing matches this filter yet. Tap All to see everyone.' : `No ${words.many} here yet. Try a bigger reach.`}
    </RNText>
  ) : null;

  const rows =
    empty ??
    (mode === 'people' ? (
      shownPeople.map((w) => <HelperRow key={w.id} worker={w} now={now} on={picked === w.id} onPress={() => pick(w.id)} />)
    ) : tab === 'areas' ? (
      areas.map((a, i) => <AreaRow key={a.name} area={a} best={areas[0]!.top.benchmark_minor} first={i === 0} onPress={() => pick(a.top.id)} />)
    ) : (
      shownJobs.map((j) => <JobRow key={j.id} job={j} on={picked === j.id} onPress={() => pick(j.id)} />)
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
      me={home}
      pins={pins}
      selectedId={picked}
      onSelect={pick}
      ringKm={radius}
      tone={mode}
      focusId={focus}
      fill={fill}
      dim
      onMoveEnd={setMovedTo}
      callout={wide && pickedJob ? <JobCard job={pickedJob} now={now} onOpen={() => openJob(pickedJob)} onClose={close} /> : undefined}
    />
  );

  // Wide screens: the map fills the page and one panel on the left holds everything to read.
  if (wide) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.surface2 }}>
        {map({ top: 0, bottom: 0, left: PANEL_W + PANEL_GAP })}

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
              <Pressy onPress={back} label="Close the map" style={{ width: 40, height: 40, borderRadius: 20, ...glass, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={16} color={t.colors.ink} />
              </Pressy>
              <View style={{ flex: 1, minWidth: 0 }}>
                <RNText accessibilityRole="header" style={tx('800', 19, t.colors.ink, { letterSpacing: -0.3 })} numberOfLines={1}>
                  {title}
                </RNText>
                <RNText style={tx('600', 12.5, t.colors.muted)} numberOfLines={1}>
                  {sub}
                </RNText>
              </View>
            </View>
            {tiles ? <StatTiles tiles={tiles} tone={mode} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              {chips}
              <View style={{ flex: 1 }} />
              <Segmented label="How far" value={radius} onChange={(r) => (setRadius(r), close())} options={reaches.map((r) => ({ value: r, label: `${r} km` }))} />
            </View>
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
            <MapNotes tone={mode} />
          </View>
        </View>

        <View pointerEvents="box-none" style={{ position: 'absolute', left: PANEL_W + PANEL_GAP * 2, right: 76, top: PANEL_GAP + insets.top, alignItems: 'center' }}>
          {searchButton}
        </View>
      </View>
    );
  }

  // Phones: the map fills the screen; one sheet holds the list, a picked job becomes one card.
  const topBar = insets.top + 106;
  const sheetHigh = Math.max(SHEET_LOW + 120, screenH - topBar - 190);
  const bottom = (pickedHelper ? HELPER_H : pickedJob ? CARD_H : SHEET_LOW) + insets.bottom;
  const here = pickedJob && step ? { title: `${areaName(pickedJob.loc_label)} area`, sub: `${step.here} ${step.here === 1 ? words.one : words.many} here · ${farText(pickedJob.km)} from you` } : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.surface2 }}>
      {map({ top: topBar, bottom: bottom + 16 })}

      {/* Top bar: what this map shows, how far it reaches, and the filters */}
      <View style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 10, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressy onPress={back} label="Close the map" style={{ width: 44, height: 44, borderRadius: 22, ...glass, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={18} color={t.colors.ink} />
          </Pressy>
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
        {reachOpen ? (
          <View style={{ alignSelf: 'flex-end', ...glass, borderRadius: 16, padding: 4, gap: 2, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
            {reaches.map((r) => (
              <Pressy
                key={r}
                onPress={() => (setRadius(r), setReachOpen(false), close())}
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
          low={SHEET_LOW}
          high={sheetHigh}
          bottomInset={insets.bottom}
          header={
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <RNText style={tx('800', 18, t.colors.ink, { letterSpacing: -0.3 })} numberOfLines={1}>
                  {loading ? 'Looking around…' : `${count} ${count === 1 ? words.one : words.many} nearby`}
                </RNText>
                {sheetUp ? null : (
                  <RNText style={tx('600', 12, t.colors.muted)}>{count > 0 ? 'Pull up to see them all' : sub}</RNText>
                )}
              </View>
              <Pressy
                onPress={() => setSheetUp((v) => !v)}
                label={sheetUp ? 'Show the map' : 'Show the list'}
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
                  <MapNotes tone={mode} />
                </View>
              </ScrollView>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16, gap: 12 }}>
              {tiles ? <StatTiles tiles={tiles} tone={mode} /> : empty}
              <MapNotes tone={mode} legend={false} />
            </View>
          )}
        </MapSheet>
      )}
    </View>
  );
}
