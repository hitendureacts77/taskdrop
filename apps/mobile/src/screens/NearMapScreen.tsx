import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, Image, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { attachPosters, type TaskWithPoster } from '../data/api';
import { tasksNear, workersNear, type NearbyWorker } from '../data/extras';
import { JobsMap, mapWords, type JobPin } from '../components/JobsMap';
import { FaceDisc } from '../components/MapMarkers';
import { activeFirst, areaName, farText, firstName, initialsOf, jobPin, mainSkill, personPin, ratingOf } from '../components/mapPins';
import { TopUpBadge } from '../components/TopUpBadge';
import { categoryIcon } from '../components/WorkCard';
import { Icon } from '../components/Icon';
import { rupees } from '../components/kit';
import { Pressy, tx } from '../components/primitives';
import { PresenceLabel } from '../components/PresenceDot';
import { taskToFeedRow } from '../lib/openTask';
import { isFresh } from '../lib/mapMotion';
import { presenceOf } from '../lib/presence';
import { useLayout } from '../lib/layout';

const CARD_W = 290;
const GAP = 10;
const RAIL_H = 176;
/** On a wide browser the map fills the page; the bars over it keep a readable width. */
const WIDE_TOP_BAR = 640;
const WIDE_RAIL = 900;
/** Enough to fill a big city's 5-10 km without the map turning to noise (clusters take the rest). */
const MAX_ITEMS = 60;
/** The "₹1,000+" filter. */
const HIGH_PAY = 1000;

type Job = TaskWithPoster & { km: number; fresh: boolean };

/** Open tasks by area for the "Best-paying areas" tray: each area's biggest offer, highest first. */
function bestAreas(jobs: Job[]) {
  const by = new Map<string, { name: string; top: Job; count: number; km: number }>();
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

type Point = { lat: number; lng: number };
const isPoint = (v: unknown): v is Point =>
  typeof v === 'object' && v !== null && typeof (v as Point).lat === 'number' && typeof (v as Point).lng === 'number';

/**
 * The full-screen map, after Snap Map (plans D11, D12). A worker sees each
 * area's biggest offer, and zoomed in every task with its price, poster and
 * title; a poster sees helpers as faces, grouped by area, spread out once
 * zoomed in. With nothing picked, a tray at the bottom shows everyone nearby as
 * faces (people) or the best-paying areas (jobs); tapping one flies the map
 * there. Once something is picked, a rail of cards takes its place: swiping it
 * moves the map to that card and marks it. Opened from the expand button on a
 * Home map with { mode: 'jobs' | 'people', centre, radiusKm }.
 */
export function NearMapScreen() {
  const t = useTheme();
  const { params, back, go } = useNav();
  const insets = useSafeAreaInsets();
  const { desktop, tablet } = useLayout();
  const wide = desktop || tablet;
  const mode = params.mode === 'people' ? 'people' : 'jobs';
  const centre = isPoint(params.centre) ? params.centre : null;
  const radiusKm = typeof params.radiusKm === 'number' ? params.radiusKm : 5;
  const words = mapWords(mode);

  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [people, setPeople] = useState<NearbyWorker[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  // "Active now" for helpers, "₹1,000+" for jobs.
  const [narrow, setNarrow] = useState(false);
  const rail = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    if (!centre) return;
    let alive = true;
    const at = Date.now();
    if (mode === 'jobs') {
      // Posters ride along so the zoomed-in map shows who posted each task.
      void tasksNear(centre, radiusKm, MAX_ITEMS)
        .then(async (r) => {
          const withPeople = await attachPosters(r);
          if (alive) {
            setNow(at);
            setJobs(withPeople.map((x, i) => ({ ...x, km: r[i]!.km, fresh: isFresh(x.created_at, at) })));
          }
        })
        .catch(() => alive && setJobs([]));
    } else {
      void workersNear(centre, radiusKm, MAX_ITEMS)
        .then((r) => alive && (setNow(at), setPeople(activeFirst(r, at))))
        .catch(() => alive && setPeople([]));
    }
    return () => {
      alive = false;
    };
    // The centre arrives as a fresh object each time; its numbers are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, centre?.lat, centre?.lng, radiusKm]);

  const shownJobs = useMemo(() => (jobs ?? []).filter((j) => !narrow || j.benchmark_minor >= HIGH_PAY * 100), [jobs, narrow]);
  const shownPeople = useMemo(() => (people ?? []).filter((w) => !narrow || presenceOf(w.last_seen_at, now).online), [people, narrow, now]);
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
  const live = (people ?? []).filter((w) => presenceOf(w.last_seen_at, now).online).length;

  const scrollToCard = (id: string) => {
    const i = ids.indexOf(id);
    if (i >= 0) rail.current?.scrollTo({ x: i * (CARD_W + GAP), animated: true });
  };
  const pickFromMap = (id: string | null) => {
    setPicked(id);
    // The rail mounts when something is picked; give it a frame before scrolling.
    if (id) setTimeout(() => scrollToCard(id), 0);
  };
  const pickCard = (id: string) => {
    setPicked(id);
    setFocus(id);
  };
  const flyToFirst = (id: string) => {
    pickCard(id);
    setTimeout(() => scrollToCard(id), 0);
  };
  const onRailStop = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / (CARD_W + GAP));
    const id = ids[Math.max(0, Math.min(ids.length - 1, i))];
    if (id && id !== picked) pickCard(id);
  };

  const topBar = insets.top + 106;
  const bottom = RAIL_H + insets.bottom + 16;
  const title = mode === 'jobs' ? 'Work near you' : 'Helpers near you';
  const sub = loading
    ? 'Looking around…'
    : count === 0
      ? `No ${words.many} within ${radiusKm} km yet`
      : `${count} ${count === 1 ? words.one : words.many} within ${radiusKm} km${mode === 'people' && live > 0 ? ` · ${live} active now` : ''}`;
  const bestJob = areas[0]?.top ?? null;
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

  const cardFrame = (on: boolean) => ({
    width: CARD_W,
    borderRadius: 20,
    backgroundColor: t.colors.surface,
    borderWidth: 2,
    borderColor: on ? (mode === 'people' ? t.colors.purple : t.colors.accent) : t.colors.line,
    padding: 14,
    gap: 10,
  });

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.surface2 }}>
      <JobsMap
        me={centre}
        pins={pins}
        selectedId={picked}
        onSelect={pickFromMap}
        ringKm={radiusKm}
        tone={mode}
        focusId={focus}
        fill={{ top: topBar, bottom }}
      />

      {/* Top bar: what this map shows, and one filter */}
      <View style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 10, gap: 10, maxWidth: wide ? WIDE_TOP_BAR : undefined }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressy
            onPress={back}
            label="Close the map"
            style={{ width: 44, height: 44, borderRadius: 22, ...glass, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={18} color={t.colors.ink} />
          </Pressy>
          <View style={{ flex: 1, height: 44, borderRadius: 22, ...glass, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <RNText style={tx('800', 14, t.colors.ink)} numberOfLines={1}>
                {title}
              </RNText>
              <RNText style={tx('600', 11, t.colors.muted)} numberOfLines={1}>
                {sub}
              </RNText>
            </View>
            {mode === 'jobs' && bestJob ? (
              <View style={{ height: 32, paddingHorizontal: 10, borderRadius: 16, backgroundColor: t.colors.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <RNText style={tx('700', 12, t.colors.accentDeep)}>Best</RNText>
                <RNText style={tx('800', 12.5, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{rupees(bestJob.benchmark_minor / 100)}</RNText>
              </View>
            ) : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {chip('All', !narrow, () => setNarrow(false))}
          {mode === 'jobs' ? chip(`${rupees(HIGH_PAY)}+`, narrow, () => setNarrow(true)) : chip('Active now', narrow, () => setNarrow(true), '#22C55E')}
          {picked !== null && ids.includes(picked) ? chip(mode === 'jobs' ? 'Best areas' : 'Everyone', false, () => setPicked(null)) : null}
        </View>
      </View>

      {/* Cards: swipe sideways; the map follows */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 12, height: RAIL_H, maxWidth: wide ? WIDE_RAIL : undefined }}>
        {!centre ? (
          <View style={[cardFrame(false), { marginHorizontal: 16, width: undefined }]}>
            <RNText style={tx('700', 14, t.colors.ink)}>Set your area on Home to see what is near you</RNText>
          </View>
        ) : picked === null || !ids.includes(picked) ? (
          <View style={{ marginHorizontal: 12, height: RAIL_H, borderRadius: 24, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, paddingTop: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16 }}>
              <RNText style={tx('800', 16, t.colors.ink)}>{mode === 'jobs' ? 'Best-paying areas' : 'Everyone nearby'}</RNText>
              <RNText style={tx('600', 11.5, t.colors.muted)}>{mode === 'jobs' ? 'highest offer first' : 'active now first'}</RNText>
            </View>
            {mode === 'people' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 16, marginTop: 3 }}>
                <Icon name="lock" size={11} color={t.colors.muted} />
                <RNText style={tx('600', 11.5, t.colors.muted)}>{words.privacy}</RNText>
              </View>
            ) : null}
            {!loading && count === 0 ? (
              <RNText style={tx('600', 13, t.colors.muted, { paddingHorizontal: 16, marginTop: 14 })}>
                {narrow ? 'Nothing matches this filter yet. Tap All to see everyone.' : `No ${words.many} within ${radiusKm} km yet.`}
              </RNText>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, gap: mode === 'jobs' ? 10 : 14 }}>
              {mode === 'jobs'
                ? areas.map((a, i) => (
                    <Pressy
                      key={a.name}
                      onPress={() => flyToFirst(a.top.id)}
                      label={`${a.name}, biggest offer ${rupees(a.top.benchmark_minor / 100)}, ${a.count} ${a.count === 1 ? 'task' : 'tasks'}, ${farText(a.km)}`}
                      style={{ width: 140, padding: 12, borderRadius: 16, backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: i === 0 ? t.colors.accent : t.colors.line, gap: 6 }}
                    >
                      <RNText style={tx('700', 12.5, t.colors.text)} numberOfLines={1}>
                        {a.name}
                      </RNText>
                      <RNText style={tx('800', 20, t.colors.ink, { fontVariant: ['tabular-nums'], letterSpacing: -0.4 })}>{rupees(a.top.benchmark_minor / 100)}</RNText>
                      <View style={{ height: 4, borderRadius: 2, backgroundColor: t.colors.line, overflow: 'hidden' }}>
                        <View style={{ width: `${Math.round((100 * a.top.benchmark_minor) / (areas[0]!.top.benchmark_minor || 1))}%`, height: 4, borderRadius: 2, backgroundColor: t.colors.accent }} />
                      </View>
                      <RNText style={tx('600', 11, t.colors.muted)} numberOfLines={1}>
                        {a.count} {a.count === 1 ? 'task' : 'tasks'} · {farText(a.km)}
                      </RNText>
                    </Pressy>
                  ))
                : shownPeople.map((w) => {
                    const on = presenceOf(w.last_seen_at, now).online;
                    return (
                      <Pressy
                        key={w.id}
                        onPress={() => flyToFirst(w.id)}
                        label={`${w.display_name}, ${mainSkill(w.skills)}${on ? ', active now' : ''}`}
                        style={{ width: 60, alignItems: 'center', gap: 6 }}
                      >
                        <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 2.5, borderColor: on ? '#22C55E' : t.colors.line, alignItems: 'center', justifyContent: 'center' }}>
                          <FaceDisc face={{ initials: initialsOf(w.display_name || w.username), live: false, photo: w.avatar_url }} seed={w.id} size={46} rimWidth={0} />
                        </View>
                        <RNText style={tx('700', 11.5, t.colors.ink)} numberOfLines={1}>
                          {firstName(w.display_name || w.username)}
                        </RNText>
                      </Pressy>
                    );
                  })}
            </ScrollView>
          </View>
        ) : (
          <ScrollView
            ref={rail}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={CARD_W + GAP}
            decelerationRate="fast"
            onMomentumScrollEnd={onRailStop}
            contentContainerStyle={{ paddingHorizontal: 16, gap: GAP, alignItems: 'flex-end' }}
          >
            {mode === 'jobs'
              ? shownJobs.map((j) => {
                  const on = picked === j.id;
                  return (
                    <View key={j.id} style={cardFrame(on)}>
                      <Pressable onPress={() => pickCard(j.id)} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                        <View style={{ width: 42, height: 42, borderRadius: 999, backgroundColor: t.colors.accentSoft, borderWidth: 1.5, borderColor: t.colors.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name={categoryIcon(j.category ?? '')} size={18} color={t.colors.accentDeep} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={1}>
                            {j.title}
                          </RNText>
                          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
                            {areaName(j.loc_label)} area · {farText(j.km)}
                            {j.poster ? ` · by ${firstName(j.poster.display_name || j.poster.username)}` : ''}
                          </RNText>
                        </View>
                      </Pressable>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <RNText style={tx('800', 19, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{rupees(j.benchmark_minor / 100)}</RNText>
                        <TopUpBadge pct={j.topup_pct} compact />
                        {j.fresh ? (
                          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: t.colors.accentSoft }}>
                            <RNText style={tx('800', 10.5, t.colors.accentDeep)}>Just posted</RNText>
                          </View>
                        ) : null}
                      </View>
                      <Pressy
                        onPress={() => go('taskDetail', { row: taskToFeedRow(j) })}
                        style={{ height: 40, borderRadius: 12, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <RNText style={tx('800', 13.5, t.colors.onBtn)}>Open task</RNText>
                      </Pressy>
                    </View>
                  );
                })
              : shownPeople.map((w) => {
                  const on = picked === w.id;
                  const rating = ratingOf(w);
                  return (
                    <View key={w.id} style={cardFrame(on)}>
                      <Pressable onPress={() => pickCard(w.id)} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                        <View style={{ width: 44, height: 44, borderRadius: 999, backgroundColor: t.colors.purpleSoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {w.avatar_url ? (
                            <Image source={{ uri: w.avatar_url }} style={{ width: 44, height: 44 }} accessibilityIgnoresInvertColors />
                          ) : (
                            <RNText style={tx('800', 14, t.colors.purpleDeep)}>{initialsOf(w.display_name || w.username)}</RNText>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <RNText style={tx('800', 14.5, t.colors.ink)} numberOfLines={1}>
                            {w.display_name}
                            <RNText style={tx('700', 12, t.colors.muted)}>
                              {rating ? `  ★ ${rating} · ${w.worker_rating_count} review${w.worker_rating_count === 1 ? '' : 's'}` : '  New'}
                            </RNText>
                          </RNText>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                            <PresenceLabel lastSeen={w.last_seen_at} />
                            <RNText style={tx('400', 12, t.colors.muted, { flexShrink: 1 })} numberOfLines={1}>
                              · {areaName(w.loc_label)} area · {farText(w.km)}
                            </RNText>
                          </View>
                        </View>
                      </Pressable>
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', height: 24, overflow: 'hidden' }}>
                        {(w.skills ?? []).slice(0, 3).map((s) => (
                          <View key={s} style={{ height: 24, paddingHorizontal: 9, borderRadius: 999, backgroundColor: t.colors.purpleSoft, justifyContent: 'center' }}>
                            <RNText style={tx('700', 11.5, t.colors.purpleDeep)}>{mainSkill([s])}</RNText>
                          </View>
                        ))}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressy
                          onPress={() => go('publicProfile', { userId: w.id })}
                          style={{ flex: 1, height: 40, borderRadius: 12, borderWidth: 1.5, borderColor: t.colors.line, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center' }}
                        >
                          <RNText style={tx('700', 13, t.colors.ink)}>View profile</RNText>
                        </Pressy>
                        <Pressy
                          onPress={() => go('aiPost')}
                          style={{ flex: 1, height: 40, borderRadius: 12, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}
                        >
                          <RNText style={tx('800', 13, t.colors.onBtn)}>Post a task</RNText>
                        </Pressy>
                      </View>
                    </View>
                  );
                })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}
