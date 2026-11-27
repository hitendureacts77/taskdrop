import type { JobPin } from '../components/MapPinLayer';

/**
 * Dev and e2e only (plan D33 step E): thousands of made-up pins round Bengaluru, so the speed of the map
 * can be measured without a database that big.
 *
 * The gate has two locks, and both must be open:
 *  1. the BUILD was made with EXPO_PUBLIC_E2E_FAKE_PINS=1 (Expo writes EXPO_PUBLIC_ values in at build time,
 *     so a normal and a production build have `undefined` here and the bundler drops the whole branch), and
 *  2. the page address carries `?fakepins=<count>` (ignored without lock 1).
 * The production build guard (scripts/web-env-guard.mjs) is not told about this flag: never set it on a deploy.
 */
export function fakePinCount(search: string | undefined): number {
  if (process.env.EXPO_PUBLIC_E2E_FAKE_PINS !== '1') return 0;
  const n = Number(new URLSearchParams(search ?? '').get('fakepins'));
  return Number.isInteger(n) && n > 0 ? Math.min(n, 20_000) : 0;
}

/** The same numbers every time (mulberry32), so two runs draw the same map. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CENTRE = { lat: 12.9716, lng: 77.5946 };
const OFFERS = [199, 250, 349, 499, 650, 800, 1200, 1800, 2500, 4000];
const AREAS = ['Koramangala', 'Indiranagar', 'Whitefield', 'Jayanagar', 'HSR Layout', 'Hebbal', 'Marathahalli', 'Yelahanka'];

/**
 * `count` job pins spread over about 30 km round the city centre, thicker near the middle. Coordinates are
 * rounded to three places like the real ones (the server rounds a pin to about 100 m). Roughly one in ten is fresh.
 */
export function makeFakePins(count: number, seed = 33): JobPin[] {
  const rnd = rng(seed);
  const pins: JobPin[] = [];
  for (let i = 0; i < count; i++) {
    const r = 0.27 * Math.pow(rnd(), 1.6); // degrees, about 30 km at most
    const a = rnd() * Math.PI * 2;
    const lat = Math.round((CENTRE.lat + r * Math.sin(a)) * 1000) / 1000;
    const lng = Math.round((CENTRE.lng + (r * Math.cos(a)) / Math.cos((CENTRE.lat * Math.PI) / 180)) * 1000) / 1000;
    const amount = OFFERS[Math.floor(rnd() * OFFERS.length)]!;
    pins.push({
      id: `fake-${i}`,
      lat,
      lng,
      label: `₹${amount}`,
      amount,
      fresh: rnd() < 0.1,
      area: AREAS[Math.floor(rnd() * AREAS.length)],
      title: `Fake task ${i + 1}`,
    });
  }
  return pins;
}
