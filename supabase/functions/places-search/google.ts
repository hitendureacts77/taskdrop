// Google as the BACKUP place search (task 1.21 row F3). OpenStreetMap's Nominatim and Photon both answer 403 to
// the Supabase servers since 27 Nov 2026, so when both refuse, places-search asks Google (capped per day by
// public.take_places_backup, migration 243). Pure helpers here, so they can be tested.

export type GooglePlace = {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: { longText?: string; types?: string[] }[];
};

/** Search results in the same shape as the OpenStreetMap search: a short label and a point. */
export function googlePlaces(places: GooglePlace[], q: string, tidy: (s: string) => string): { label: string; lat: number; lng: number; via: "google" }[] {
  return places
    .map((p) => ({
      label: tidy(p.formattedAddress ?? p.displayName?.text ?? q) || q,
      lat: Number(p.location?.latitude),
      lng: Number(p.location?.longitude),
      via: "google" as const,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .slice(0, 6);
}

/** "Madhapur, Hyderabad" from the nearest place's address parts: an area, not a door. Null when there is none. */
export function googleAreaName(places: GooglePlace[]): string | null {
  const parts = places[0]?.addressComponents ?? [];
  const of = (type: string) => parts.find((c) => c.types?.includes(type))?.longText?.trim() ?? "";
  const area = of("sublocality_level_1") || of("neighborhood") || of("sublocality");
  const city = of("locality") || of("administrative_area_level_3");
  const name = [area, city].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ");
  return name || null;
}

/** Which service the results came from, so the app credits the right one ("Results from Google" / OpenStreetMap). */
export function sourceOf(places: { via?: string }[]): "google" | "osm" {
  return places.some((p) => p.via === "google") ? "google" : "osm";
}
