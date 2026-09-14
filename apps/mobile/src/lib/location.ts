import { Platform, Linking } from 'react-native';
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
  /** Refused, and the OS will not ask again — only Settings can undo it. */
  | 'blocked'
  /** Location is switched off for the whole device, not just for us. */
  | 'services-off'
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

/**
 * Whether the browser has already refused and will not ask again.
 *
 * expo-location on web reports canAskAgain: true even once the origin is
 * blocked, so a refusal there looks re-askable when it is not, and the app
 * offers a button that can never work. The Permissions API knows the truth.
 */
async function webPermanentlyDenied(): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  try {
    const status = await navigator.permissions.query({
      name: 'geolocation' as PermissionName,
    });
    return status.state === 'denied';
  } catch {
    // Not every browser exposes it; fall back to treating it as re-askable.
    return false;
  }
}

/** What the OS currently thinks, without asking the user anything. */
export async function locationPermission(): Promise<{
  granted: boolean;
  canAskAgain: boolean;
}> {
  try {
    const p = await Location.getForegroundPermissionsAsync();
    // Same correction as in resolveCurrentPlace: on web, canAskAgain lies once
    // the origin is blocked, and a caller using this to decide what to show
    // would promise a prompt that will never appear.
    if (!p.granted && (await webPermanentlyDenied())) {
      return { granted: false, canAskAgain: false };
    }
    return { granted: p.granted, canAskAgain: p.canAskAgain };
  } catch {
    return { granted: false, canAskAgain: false };
  }
}

/**
 * Read the device position.
 *
 * Two things make this feel instant rather than laggy, and both are what the
 * delivery apps do:
 *
 *   1. The last known fix is handed back straight away through onPartial. The
 *      phone almost always has one, it arrives in milliseconds, and it is close
 *      enough to put the map in the right place while the real fix lands.
 *   2. The precise fix is asked for at High accuracy, not Balanced. Balanced is
 *      about 100m, which in a city is the wrong building — and this pin is the
 *      thing a worker has to navigate to.
 *
 * The failure kinds are separated because the fix for each one is different,
 * and "Could not read your location" tells nobody what to do next.
 */
export async function resolveCurrentPlace(opts?: {
  /** Called with a rough position the moment one is available, if one is. */
  onPartial?: (at: { lat: number; lng: number }) => void;
}): Promise<PickedPlace> {
  let granted = false;
  let canAskAgain = true;
  try {
    // Ask what we already have before prompting: re-prompting someone who has
    // already said yes is a dialog for nothing.
    const existing = await Location.getForegroundPermissionsAsync();
    if (existing.granted) {
      granted = true;
    } else if (await webPermanentlyDenied()) {
      canAskAgain = false;
    } else if (existing.canAskAgain) {
      const asked = await Location.requestForegroundPermissionsAsync();
      granted = asked.granted;
      canAskAgain = asked.canAskAgain;
    } else {
      canAskAgain = false;
    }
  } catch {
    throw new LocationError('unavailable', 'This device cannot share a location');
  }

  if (!granted) {
    throw canAskAgain
      ? new LocationError(
          'denied',
          'Location access was declined. You can search for the area instead.',
        )
      : new LocationError(
          'blocked',
          Platform.OS === 'web'
            ? 'This site is blocked from seeing your location.'
            : 'Location is turned off for TaskDrop. Turn it back on in settings, or search for the area instead.',
        );
  }

  // Location switched off device-wide otherwise reads as a permission problem,
  // and sends people to the wrong settings screen looking for it.
  try {
    if (!(await Location.hasServicesEnabledAsync())) {
      throw new LocationError(
        'services-off',
        'Location is switched off on this device. Turn it on and try again.',
      );
    }
  } catch (e) {
    if (e instanceof LocationError) throw e;
    // Not reliable on every platform; not a reason to stop.
  }

  // The instant half. A fix up to a couple of minutes old is fine for centring
  // a map, and the precise one is right behind it.
  if (opts?.onPartial) {
    try {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
      if (last) opts.onPartial({ lat: last.coords.latitude, lng: last.coords.longitude });
    } catch {
      /* no cached fix is normal on a fresh install */
    }
  }

  let coords: { latitude: number; longitude: number };
  try {
    // Without a ceiling this can hang indefinitely on a cold GPS fix.
    const pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      15_000,
    );
    coords = pos.coords;
  } catch (e) {
    if (e instanceof LocationError) throw e;
    throw new LocationError('timeout', 'Could not get a fix — try again, or search for the area');
  }

  const { latitude, longitude } = coords;
  const label = await describeCoords(latitude, longitude);
  return { label, lat: latitude, lng: longitude };
}

/**
 * Open the OS settings page for this app, so a blocked permission has a way
 * back. There is no equivalent on the web — a page cannot open its own
 * permission settings — which is why the copy differs there.
 */
export async function openLocationSettings(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
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
