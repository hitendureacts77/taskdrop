import { useEffect, useState } from 'react';
import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { attachPosters, type TaskWithPoster } from '../data/api';
import { tasksNear } from '../data/extras';
import { taskToFeedRow } from '../lib/openTask';
import { roughPlace } from '../lib/place';
import { useMyArea } from '../lib/useMyArea';
import { Icon } from './Icon';
import { Shimmer, rupees } from './kit';
import { JobsMap, type JobPin } from './JobsMap';
import { jobPin } from './mapPins';
import { LocationSheet } from './LocationSheet';
import { cardSurface } from './ui';
import { Pressy, tx } from './primitives';

const RADII = [3, 10, 25, 50];
/** The strip is short on purpose: a taste of the map, the full one is a tap away. */
const STRIP_HEIGHT = 150;

/**
 * The top of Find work: a short live map strip of open jobs round the area they
 * chose (price pins), with what is near over its left side and "Open the map".
 * Without an area it is one line that opens the area picker. Never an empty box.
 */
export function JobsNearHero({ onOpenMap }: { onOpenMap?: () => void }) {
  const t = useTheme();
  const { go } = useNav();
  const { area, loaded, choose } = useMyArea();
  const [radius, setRadius] = useState(25);
  const [rows, setRows] = useState<(TaskWithPoster & { km: number })[] | null>(null);
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
    void tasksNear(area, radius, 40)
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

  const name = area ? (roughPlace(area.label)?.split(',')[0] ?? area.label) : null;
  const pins = (rows ?? []).map((r) => jobPin(r, at)).filter((x): x is JobPin => x !== null);
  const openMap = () => {
    if (onOpenMap) onOpenMap();
    else if (area) go('nearMap', { mode: 'jobs', centre: { lat: area.lat, lng: area.lng }, radiusKm: radius });
  };
  const nextRadius = () => setRadius((r) => RADII[(RADII.indexOf(r) + 1) % RADII.length]!);

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
      <View style={{ height: STRIP_HEIGHT, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2 }}>
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
        />
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            maxWidth: '78%',
            paddingVertical: 14,
            paddingHorizontal: 16,
            gap: 3,
            justifyContent: 'center',
            backgroundColor: t.colors.surface,
            opacity: 0.96,
            borderTopRightRadius: 20,
            borderBottomRightRadius: 20,
          }}
        >
          <RNText style={tx('800', 10.5, t.colors.accentDeep, { letterSpacing: 0.6 })} numberOfLines={1}>
            {'NEAR ' + (name ?? 'YOU').toUpperCase()}
          </RNText>
          <Pressy onPress={nextRadius} label={`Change the distance, now ${radius} km`} style={{ alignSelf: 'flex-start' }}>
            <RNText style={tx('800', 17, t.colors.ink, { letterSpacing: -0.3 })} numberOfLines={1}>
              {rows.length === 0 ? `No jobs within ${radius} km` : `${rows.length} ${rows.length === 1 ? 'job' : 'jobs'} within ${radius} km`}
            </RNText>
          </Pressy>
          {rows.length > 0 ? (
            <RNText style={tx('600', 12, t.colors.text)} numberOfLines={1}>
              {`Best offer ${rupees(best / 100)}${nearestText ? ` · nearest ${nearestText} away` : ''}`}
            </RNText>
          ) : (
            <RNText style={tx('500', 12, t.colors.muted)} numberOfLines={1}>Tap the distance to widen it, or try remote work</RNText>
          )}
          <Pressy
            onPress={openMap}
            label="Open the map"
            style={{ marginTop: 6, alignSelf: 'flex-start', height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: t.colors.btn, justifyContent: 'center' }}
          >
            <RNText style={tx('800', 12.5, t.colors.onBtn)}>Open the map</RNText>
          </Pressy>
        </View>
      </View>
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
