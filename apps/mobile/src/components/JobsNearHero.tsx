import { useEffect, useState } from 'react';
import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { attachPosters, type TaskWithPoster } from '../data/api';
import { tasksNear } from '../data/extras';
import { taskToFeedRow } from '../lib/openTask';
import { pickedPlaceName } from '../lib/place';
import { useMyArea } from '../lib/useMyArea';
import { FIND_WORK_LIMIT, capped } from '../lib/findWorkRead';
import { KM_STEPS, jobsSummary, matchesJob } from '../lib/mapFilters';
import { setJobFilters, useJobFilters } from '../lib/jobFiltersStore';
import { Icon } from './Icon';
import { Shimmer, rupees } from './kit';
import { JobsMap, type JobPin } from './JobsMap';
import { jobPin } from './mapPins';
import { LocationSheet } from './LocationSheet';
import { cardSurface } from './ui';
import { Pressy, tx } from './primitives';
import { MapStrip, STRIP_HEIGHT } from './MapStrip';

/**
 * The top of Find work: a short live map strip of open jobs round the area they
 * chose (price pins), with what is near over its left side and "Open the map".
 * Without an area it is one line that opens the area picker. Never an empty box.
 */
export function JobsNearHero({ onOpenMap }: { onOpenMap?: () => void }) {
  const t = useTheme();
  const { go } = useNav();
  const { area, loaded, choose } = useMyArea();
  // B170: the distance is the shared Find work one (list and map), not a card-only 25 km, and the count
  // goes through the same filters and words as theirs. The read is the list's size; a full read says "200+".
  const filters = useJobFilters();
  const radius = filters.km;
  const [all, setRows] = useState<(TaskWithPoster & { km: number })[] | null>(null);
  const rows = all ? all.filter((r) => matchesJob(r, filters)) : null;
  const full = all ? capped(all.length, FIND_WORK_LIMIT) : false;
  const [at, setAt] = useState(0);
  const [pickPlace, setPickPlace] = useState(false);

  useEffect(() => {
    if (!area) {
      setRows(loaded ? [] : null);
      return;
    }
    let alive = true;
    setRows(null);
    // Posters ride along so the zoomed-in map can show who posted each task.
    void tasksNear(area, radius, FIND_WORK_LIMIT)
      .then(async (r) => {
        const withPeople = await attachPosters(r);
        if (alive) {
          setAt(Date.now());
          setRows(withPeople.map((x, i) => ({ ...x, km: r[i]!.km })));
        }
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [area, radius, loaded]);

  const name = area ? (pickedPlaceName(area.label) ?? area.label) : null;
  const pins = (rows ?? []).map((r) => jobPin(r, at)).filter((x): x is JobPin => x !== null);
  const openMap = () => {
    if (onOpenMap) onOpenMap();
    else if (area) go('nearMap', { mode: 'jobs', centre: { lat: area.lat, lng: area.lng }, radiusKm: radius });
  };
  const nextRadius = () => setJobFilters({ ...filters, km: KM_STEPS[(KM_STEPS.indexOf(radius) + 1) % KM_STEPS.length]! });

  let body: React.ReactNode;
  if (!area && !loaded) {
    body = <Shimmer height={STRIP_HEIGHT} />;
  } else if (!area) {
    body = (
      <Pressy
        onPress={() => setPickPlace(true)}
        label="Set your area to see jobs and prices near you"
        style={[cardSurface(t), { paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }]}
      >
        <Icon name="pin" size={18} color={t.colors.accentDeep} />
        <View style={{ flex: 1 }}>
          <RNText style={tx('800', 14, t.colors.ink)}>Set your area</RNText>
          <RNText style={tx('500', 12.5, t.colors.muted, { marginTop: 1 })} numberOfLines={1}>See jobs and prices near you</RNText>
        </View>
        <Icon name="chevronRight" size={16} color={t.colors.muted} />
      </Pressy>
    );
  } else if (rows === null) {
    body = <Shimmer height={STRIP_HEIGHT} />;
  } else {
    const best = rows.reduce((m, r) => Math.max(m, r.benchmark_minor), 0);
    const nearest = rows.reduce((m, r) => Math.min(m, r.km), Infinity);
    const nearestText = Number.isFinite(nearest) ? (nearest < 1 ? '< 1 km' : `${nearest.toFixed(nearest < 10 ? 1 : 0)} km`) : '';
    body = (
      <MapStrip
        map={
          <JobsMap
            me={area}
            pins={pins}
            selectedId={null}
            onSelect={(id) => {
              const hit = rows.find((r) => r.id === id);
              if (hit) go('taskDetail', { row: taskToFeedRow(hit) });
            }}
            height={STRIP_HEIGHT}
            ringKm={radius}
            bare
          />
        }
        kicker={'NEAR ' + (name ?? 'YOU').toUpperCase()}
        title={rows.length === 0 ? `No jobs within ${radius} km` : jobsSummary(rows.length, 0, radius, 'local', { near: full })}
        titleLabel={`Change the distance, now ${radius} km`}
        onTitle={nextRadius}
        sub={rows.length > 0 ? `Best offer ${rupees(best / 100)}${nearestText ? ` · nearest ${nearestText} away` : ''}` : 'Tap the distance to widen it, or try remote work'}
        subMuted={rows.length === 0}
        onOpenMap={openMap}
      />
    );
  }

  return (
    <View>
      {body}
      <LocationSheet
        visible={pickPlace}
        askForDetails={false}
        onCancel={() => setPickPlace(false)}
        onPick={(p) => {
          setPickPlace(false);
          void choose(p);
        }}
      />
    </View>
  );
}
