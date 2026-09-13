import * as Location from 'expo-location';

/**
 * Reading the device's location, in one place.
 *
 * Both the location picker and the search screen need this; the search screen
 * used to just claim "Using your location" without asking for it.
 */

export type PickedPlace = { label: string; lat: number; lng: number };

export async function resolveCurrentPlace(): Promise<PickedPlace> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Location permission was declined');

  const pos = await Location.getCurrentPositionAsync({});
  const { latitude, longitude } = pos.coords;

  let label = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  try {
    // Reverse geocoding isn't available on web; the coordinates stand in there.
    const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (place) {
      const parts = [place.name ?? place.street, place.city ?? place.subregion, place.region]
        .filter(Boolean)
        .join(', ');
      if (parts) label = parts;
    }
  } catch {
    /* keep the coordinate label */
  }

  return { label, lat: latitude, lng: longitude };
}
