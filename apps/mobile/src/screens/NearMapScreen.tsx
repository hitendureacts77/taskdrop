import { useNav } from '../providers/NavProvider';
import { NearMap } from '../components/NearMap';

type Point = { lat: number; lng: number };
const isPoint = (v: unknown): v is Point =>
  typeof v === 'object' && v !== null && typeof (v as Point).lat === 'number' && typeof (v as Point).lng === 'number';

/**
 * The full-screen map as a route (plans D11-D14). The map itself is
 * `components/NearMap`, which the Explore tab also uses (plan D20); this
 * wrapper only reads where it was opened from. Opened from a Home or Explore
 * map with { mode: 'jobs' | 'people', centre, radiusKm }, and closed with its X.
 */
export function NearMapScreen() {
  const { params, back } = useNav();
  return (
    <NearMap
      layer={params.mode === 'people' ? 'people' : 'jobs'}
      centre={isPoint(params.centre) ? params.centre : null}
      {...(typeof params.radiusKm === 'number' ? { radiusKm: params.radiusKm } : {})}
      leading={{ kind: 'close', onPress: back }}
    />
  );
}
