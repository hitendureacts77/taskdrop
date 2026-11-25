import { useEffect, useState } from 'react';
import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { workersNear, type NearbyWorker } from '../data/extras';
import { pickedPlaceName } from '../lib/place';
import { presenceOf } from '../lib/presence';
import { useMyArea } from '../lib/useMyArea';
import { Icon } from './Icon';
import { Shimmer } from './kit';
import { JobsMap, type JobPin } from './JobsMap';
import { activeFirst, personPin } from './mapPins';
import { LocationSheet } from './LocationSheet';
import { MapStrip, STRIP_HEIGHT } from './MapStrip';
import { cardSurface } from './ui';
import { Pressy, tx } from './primitives';

/** The reach of Hire Home's helpers card, in km (the same as the old "Helpers near you" map). */
const NEAR_KM = 5;

/**
 * Hire Home's map card (task 1.19 H): the same short live strip as Earn's "Open the map" card, in jade, with
 * helpers round the poster's area. Soft circles show the area, never the spot (plan D11). Any tap opens the
 * full helpers map, where the services, faces and the helper sheet live. Without an area it is one line that
 * opens the area picker. Never an empty box.
 */
export function HelpersNearHero() {
  const t = useTheme();
  const { go } = useNav();
  const { area, loaded, choose } = useMyArea();
  const [list, setList] = useState<NearbyWorker[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pickPlace, setPickPlace] = useState(false);

  useEffect(() => {
    if (!area) {
      setList(loaded ? [] : null);
      return;
    }
    let alive = true;
    setList(null);
    const at = Date.now();
    void workersNear(area, NEAR_KM, 12)
      .then((r) => alive && (setNow(at), setList(activeFirst(r, at))))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [area, loaded]);

  const openMap = () => (area ? go('nearMap', { mode: 'people', centre: { lat: area.lat, lng: area.lng }, radiusKm: NEAR_KM }) : go('explore'));

  let body: React.ReactNode;
  if (!area && !loaded) {
    body = <Shimmer height={STRIP_HEIGHT} />;
  } else if (!area) {
    body = (
      <Pressy
        onPress={() => setPickPlace(true)}
        label="Set your area to see helpers near you"
        style={[cardSurface(t), { paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }]}
      >
        <Icon name="pin" size={18} color={t.colors.accentDeep} />
        <View style={{ flex: 1 }}>
          <RNText style={tx('800', 14, t.colors.ink)}>Set your area</RNText>
          <RNText style={tx('500', 12.5, t.colors.muted, { marginTop: 1 })} numberOfLines={1}>See helpers near you</RNText>
        </View>
        <Icon name="chevronRight" size={16} color={t.colors.muted} />
      </Pressy>
    );
  } else if (list === null) {
    body = <Shimmer height={STRIP_HEIGHT} />;
  } else {
    const name = pickedPlaceName(area.label) ?? area.label;
    const pins = list.map((w) => personPin(w, now)).filter((p): p is JobPin => p !== null);
    const live = list.filter((w) => presenceOf(w.last_seen_at, now).online).length;
    const nearest = list.reduce((m, w) => Math.min(m, w.km), Infinity);
    const nearestText = Number.isFinite(nearest) ? (nearest < 1 ? '< 1 km' : `${nearest.toFixed(nearest < 10 ? 1 : 0)} km`) : '';
    const n = list.length;
    body = (
      <MapStrip
        testID="home-helpers-map"
        map={<JobsMap me={area} pins={pins} selectedId={null} onSelect={openMap} height={STRIP_HEIGHT} ringKm={NEAR_KM} tone="people" bare />}
        kicker={'NEAR ' + (name || 'YOU').toUpperCase()}
        title={n === 0 ? `No helpers within ${NEAR_KM} km yet` : `${n} ${n === 1 ? 'helper' : 'helpers'} within ${NEAR_KM} km`}
        sub={
          n === 0
            ? 'Post a task: people online can still send offers'
            : [live > 0 ? `${live} active now` : null, nearestText ? `nearest ${nearestText} away` : null].filter(Boolean).join(' · ')
        }
        subMuted={n === 0}
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
