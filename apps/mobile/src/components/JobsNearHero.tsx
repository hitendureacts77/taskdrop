import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { attachPosters, type TaskWithPoster } from '../data/api';
import { tasksNear } from '../data/extras';
import { taskToFeedRow } from '../lib/openTask';
import { roughPlace } from '../lib/place';
import { useMyArea } from '../lib/useMyArea';
import { Icon } from './Icon';
import { SectionTitle, Shimmer } from './kit';
import { JobsMap, type JobPin } from './JobsMap';
import { jobPin } from './mapPins';
import { LocationSheet } from './LocationSheet';
import { cardSurface } from './ui';
import { Pressy, tx } from './primitives';

const RADII = [3, 10, 25, 50];

/**
 * The worker's map, the hero of Find work: open jobs round the area they chose,
 * one soft circle per job's area (never its spot) with what it pays. Tap one to
 * open the job; the expand button opens the full-screen map. The area is the
 * one set on Home.
 */
export function JobsNearHero() {
  const t = useTheme();
  const { go } = useNav();
  const { area, loaded, choose } = useMyArea();
  const [radius, setRadius] = useState(10);
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

  const name = area ? roughPlace(area.label)?.split(',')[0] : null;
  const pins = (rows ?? []).map((r) => jobPin(r, at)).filter((x): x is JobPin => x !== null);

  return (
    <View>
      <SectionTitle
        title={name ? `Jobs near ${name}` : 'Jobs near you'}
        icon="pin"
        action={area ? 'Full map' : undefined}
        onAction={() => area && go('nearMap', { mode: 'jobs', centre: { lat: area.lat, lng: area.lng }, radiusKm: radius })}
        style={{ marginTop: 4 }}
      />
      {!area ? (
        loaded ? (
          <Pressy onPress={() => setPickPlace(true)} style={[cardSurface(t), { marginTop: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
            <Icon name="pin" size={18} color={t.colors.accentDeep} />
            <RNText style={tx('600', 13.5, t.colors.ink, { flex: 1 })}>Set your area to see jobs near you on the map</RNText>
            <Icon name="chevronRight" size={16} color={t.colors.muted} />
          </Pressy>
        ) : (
          <Shimmer height={260} style={{ marginTop: 12 }} />
        )
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {RADII.map((km) => (
              <Pressable
                key={km}
                onPress={() => setRadius(km)}
                accessibilityRole="button"
                accessibilityState={{ selected: radius === km }}
                style={({ pressed }) => ({
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: radius === km ? t.colors.accent : t.colors.line,
                  backgroundColor: radius === km ? t.colors.accentSoft : t.colors.surface,
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                })}
              >
                <RNText style={tx(radius === km ? '700' : '600', 13, radius === km ? t.colors.accentDeep : t.colors.text)}>{km} km</RNText>
              </Pressable>
            ))}
          </View>
          {rows === null ? (
            <Shimmer height={280} style={{ marginTop: 12 }} />
          ) : (
            <>
              <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 10 })}>
                {rows.length === 0
                  ? radius < 50
                    ? `No jobs within ${radius} km yet. Widen the radius, or try remote work below.`
                    : 'No jobs within 50 km yet. Try remote work below, or another area.'
                  : `${rows.length} open job${rows.length === 1 ? '' : 's'} within ${radius} km`}
              </RNText>
              <View style={{ marginTop: 12 }}>
                <JobsMap
                  me={area}
                  pins={pins}
                  selectedId={null}
                  onSelect={(id) => {
                    const hit = rows.find((r) => r.id === id);
                    if (hit) go('taskDetail', { row: taskToFeedRow(hit) });
                  }}
                  onExpand={() => go('nearMap', { mode: 'jobs', centre: { lat: area.lat, lng: area.lng }, radiusKm: radius })}
                  height={300}
                  ringKm={radius}
                />
              </View>
            </>
          )}
        </>
      )}
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
