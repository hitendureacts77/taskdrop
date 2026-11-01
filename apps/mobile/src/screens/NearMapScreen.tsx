import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, Image, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import type { Task } from '../data/api';
import { tasksNear, workersNear, type NearbyWorker } from '../data/extras';
import { JobsMap, mapWords, type JobPin } from '../components/JobsMap';
import { activeFirst, areaName, farText, initialsOf, jobPin, mainSkill, personPin, ratingOf } from '../components/mapPins';
import { TopUpBadge } from '../components/TopUpBadge';
import { categoryIcon } from '../components/WorkCard';
import { Icon } from '../components/Icon';
import { rupees } from '../components/kit';
import { Pressy, tx } from '../components/primitives';
import { PresenceLabel } from '../components/PresenceDot';
import { taskToFeedRow } from '../lib/openTask';
import { isFresh } from '../lib/mapMotion';

const CARD_W = 290;
const GAP = 10;
const RAIL_H = 176;
/** Enough to fill a big city's 5-10 km without the map turning to noise (clusters take the rest). */
const MAX_ITEMS = 60;

type Point = { lat: number; lng: number };
const isPoint = (v: unknown): v is Point =>
  typeof v === 'object' && v !== null && typeof (v as Point).lat === 'number' && typeof (v as Point).lng === 'number';

/**
 * The full-screen map, like Snap Map (plan D11). A worker sees open tasks with
 * their prices; a poster sees helpers with their main skill, rating and whether
 * they are active now. A rail of cards sits at the bottom: swiping it moves the
 * map to that card's area and marks it; tapping a tag on the map brings its
 * card to the front. Opened from the expand button on a Home map with
 * { mode: 'jobs' | 'people', centre, radiusKm }.
 */
export function NearMapScreen() {
  const t = useTheme();
  const { params, back, go } = useNav();
  const insets = useSafeAreaInsets();
  const mode = params.mode === 'people' ? 'people' : 'jobs';
  const centre = isPoint(params.centre) ? params.centre : null;
  const radiusKm = typeof params.radiusKm === 'number' ? params.radiusKm : 5;
  const words = mapWords(mode);

  const [jobs, setJobs] = useState<(Task & { km: number; fresh: boolean })[] | null>(null);
  const [people, setPeople] = useState<NearbyWorker[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const rail = useRef<ScrollView>(null);

  useEffect(() => {
    if (!centre) return;
    let alive = true;
    const at = Date.now();
    if (mode === 'jobs') {
      void tasksNear(centre, radiusKm, MAX_ITEMS)
        .then((r) => alive && (setNow(at), setJobs(r.map((x) => ({ ...x, fresh: isFresh(x.created_at, at) })))))
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

  const ids = useMemo(() => (mode === 'jobs' ? (jobs ?? []).map((j) => j.id) : (people ?? []).map((p) => p.id)), [mode, jobs, people]);
  const pins = useMemo<JobPin[]>(
    () =>
      mode === 'jobs'
        ? (jobs ?? []).map((j) => jobPin(j, now)).filter((p): p is JobPin => p !== null)
        : (people ?? []).map((w) => personPin(w, now)).filter((p): p is JobPin => p !== null),
    [mode, jobs, people, now],
  );
  const loading = mode === 'jobs' ? jobs === null : people === null;
  const count = ids.length;

  const scrollToCard = (id: string) => {
    const i = ids.indexOf(id);
    if (i >= 0) rail.current?.scrollTo({ x: i * (CARD_W + GAP), animated: true });
  };
  const pickFromMap = (id: string | null) => {
    setPicked(id);
    if (id) scrollToCard(id);
  };
  const pickCard = (id: string) => {
    setPicked(id);
    setFocus(id);
  };
  const onRailStop = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / (CARD_W + GAP));
    const id = ids[Math.max(0, Math.min(ids.length - 1, i))];
    if (id && id !== picked) pickCard(id);
  };

  const topBar = insets.top + 60;
  const bottom = RAIL_H + insets.bottom + 16;
  const title = loading
    ? 'Looking around…'
    : count === 0
      ? `No ${words.many} within ${radiusKm} km yet`
      : `${count} ${count === 1 ? words.one : words.many} within ${radiusKm} km`;

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

      {/* Top bar */}
      <View style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressy
          onPress={back}
          label="Close the map"
          style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: t.colors.bg, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="close" size={18} color={t.colors.ink} />
        </Pressy>
        <View style={{ flex: 1, height: 44, borderRadius: 14, backgroundColor: t.colors.bg, borderWidth: 1, borderColor: t.colors.line, justifyContent: 'center', paddingHorizontal: 14 }}>
          <RNText style={tx('800', 14, t.colors.ink)} numberOfLines={1}>
            {title}
          </RNText>
        </View>
      </View>

      {/* Cards: swipe sideways; the map follows */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 12, height: RAIL_H }}>
        {!centre ? (
          <View style={[cardFrame(false), { marginHorizontal: 16, width: undefined }]}>
            <RNText style={tx('700', 14, t.colors.ink)}>Set your area on Home to see what is near you</RNText>
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
              ? (jobs ?? []).map((j) => {
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
                        onPress={() => go('taskDetail', { row: taskToFeedRow({ ...j, poster: null }) })}
                        style={{ height: 40, borderRadius: 12, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <RNText style={tx('800', 13.5, t.colors.onBtn)}>Open task</RNText>
                      </Pressy>
                    </View>
                  );
                })
              : (people ?? []).map((w) => {
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
