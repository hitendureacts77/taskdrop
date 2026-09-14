import { Platform } from 'react-native';
import * as Location from 'expo-location';

/**
 * Everything the app knows about finding places, in one file.
 *
 * Place search goes through three providers, best first:
 *
 *   1. Google Places, when EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is set. Best results
 *      and the one to use in production.
 *   2. OpenStreetMap's Nominatim. No key, works on web and on device, and
 *      returns real coordinates — so the app is genuinely usable out of the box
 *      instead of "add a key first". Low volume only, per their usage policy.
 *   3. The device geocoder, which does not exist on web and is the last resort.
 *
 * The point of the chain is that a result always carries real coordinates.
 * Storing a label with no lat/lng is how "Distance: nearby" ended up being a
 * guess; anything that reaches the database now knows where it is.
 */

/**
 * The address shape and the formatter live in @taskdrop/rules: composing one
 * readable line out of a door, a building and a reverse-geocoded area has more
 * edge cases than it looks (a building named twice in different case, a
 * landmark the user already worded as "opposite the..."), and those belong
 * where they can be tested rather than in a screen.
 */
export type { AddressDetails, AddressTag } from "@taskdrop/rules";
export { formatAddress, addressTagLabel } from "@taskdrop/rules";

export type PickedPlace = {
  /** One line, ready to show. Built by formatAddress when there are details. */
  label: string;
  lat: number | null;
  lng: number | null;
  /** What the pin alone resolved to, kept so the form can be re-edited later. */
  area?: string;
  details?: import("@taskdrop/rules").AddressDetails;
};

const MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

/** Which provider place search will use, for wording the UI honestly. */
export function searchProvider(): 'google' | 'osm' {
  return MAPS_KEY ? 'google' : 'osm';
}

// ---------------------------------------------------------------- current ---

export type LocationFailure =
  | 'denied'
  | 'timeout'
  | 'unavailable'
  | 'unnamed';

export class LocationError extends Error {
  constructor(
    readonly kind: LocationFailure,
    message: string,
  ) {
    super(message);
    this.name = 'LocationError';
  }
}

/** Read the device's position and turn it into something a person recognises. */
export async function resolveCurrentPlace(): Promise<PickedPlace> {
  let granted = false;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    granted = status === 'granted';
  } catch {
    throw new LocationError('unavailable', 'This device cannot share a location');
  }
  if (!granted) {
    throw new LocationError('denied', 'Location permission was declined — you can still type an area');
  }

  let coords: { latitude: number; longitude: number };
  try {
    // Without a ceiling this can hang indefinitely on a cold GPS fix.
    const pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      15_000,
    );
    coords = pos.coords;
  } catch (e) {
    if (e instanceof LocationError) throw e;
    throw new LocationError('timeout', 'Could not get a fix — try again, or type your area');
  }

  const { latitude, longitude } = coords;
  const label = await describeCoords(latitude, longitude);
  return { label, lat: latitude, lng: longitude };
}

/** Best available name for a point; falls back to the coordinates themselves. */
export async function describeCoords(lat: number, lng: number): Promise<string> {
  // Reverse geocoding is not implemented on web.
  if (Platform.OS !== 'web') {
    try {
      const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      const parts = [place?.name ?? place?.street, place?.city ?? place?.subregion, place?.region]
        .filter(Boolean)
        .join(', ');
      if (parts) return parts;
    } catch {
      /* fall through */
    }
  }
  try {
    const res = await withTimeout(
      fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14`,
        { headers: { Accept: 'application/json' } },
      ),
      8000,
    );
    const json = (await res.json()) as { display_name?: string; name?: string };
    const short = json.name ?? json.display_name?.split(',').slice(0, 3).join(', ');
    if (short) return short;
  } catch {
    /* fall through */
  }
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// ----------------------------------------------------------------- search ---

/**
 * Places matching what the user typed. Always resolves — an empty list is a
 * real answer, and the caller keeps the typed text selectable regardless.
 */
export async function searchPlaces(query: string): Promise<PickedPlace[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  if (MAPS_KEY) {
    const viaGoogle = await googlePlaces(q);
    if (viaGoogle.length) return viaGoogle;
  }

  const viaOsm = await openStreetMap(q);
  if (viaOsm.length) return viaOsm;

  // Native only; on web this throws and we simply have nothing to add.
  if (Platform.OS !== 'web') {
    try {
      const hits = await Location.geocodeAsync(q);
      return hits.slice(0, 6).map((h) => ({ label: q, lat: h.latitude, lng: h.longitude }));
    } catch {
      /* nothing more to try */
    }
  }
  return [];
}

/**
 * Google Places. This is the *new* Places API, not the textsearch endpoint —
 * Google no longer enables the legacy one on new projects, so a key that works
 * fine will still answer REQUEST_DENIED there. Different shape too: a POST, the
 * key in a header rather than the query string, and an explicit field mask
 * (you are billed for the fields you ask for, so ask for three).
 */
async function googlePlaces(q: string): Promise<PickedPlace[]> {
  try {
    const res = await withTimeout(
      fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': MAPS_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
        },
        body: JSON.stringify({ textQuery: q, maxResultCount: 6 }),
      }),
      8000,
    );
    const json = (await res.json()) as {
      places?: {
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
      }[];
    };
    return (json.places ?? [])
      .map((r) => ({
        label: r.formattedAddress ?? r.displayName?.text ?? q,
        lat: r.location?.latitude ?? null,
        lng: r.location?.longitude ?? null,
      }))
      .filter((r) => r.lat !== null && r.lng !== null);
  } catch {
    // A refused or misconfigured key is not a dead end — the chain falls
    // through to OpenStreetMap, which needs no key at all.
    return [];
  }
}

async function openStreetMap(q: string): Promise<PickedPlace[]> {
  try {
    const res = await withTimeout(
      fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`,
        { headers: { Accept: 'application/json' } },
      ),
      8000,
    );
    const json = (await res.json()) as
      | { display_name?: string; name?: string; lat?: string; lon?: string }[]
      | null;
    return (json ?? [])
      .map((r) => ({
        // The full display_name is a mouthful; the first few parts read like an address.
        label: r.display_name?.split(',').slice(0, 3).join(', ') ?? r.name ?? q,
        lat: r.lat ? Number(r.lat) : null,
        lng: r.lon ? Number(r.lon) : null,
      }))
      .filter((r) => r.lat !== null && r.lng !== null);
  } catch {
    return [];
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new LocationError('timeout', 'That took too long')), ms),
    ),
  ]);
}
