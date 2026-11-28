// Photon (photon.komoot.io): a free OpenStreetMap search with no key, used when
// Nominatim refuses this server. Nominatim answered 403 to every call from the
// Edge Functions from 27 Nov 2026, so guests could not search an area and no
// area name came back for a dropped pin. Pure helpers here, so they can be tested.

/** India's rough bounding box (west, south, east, north), like Nominatim's countrycodes=in. */
export const INDIA_BBOX = "68,6,98,37";

export type PhotonProps = {
  name?: string;
  locality?: string;
  district?: string;
  city?: string;
  county?: string;
  state?: string;
  countrycode?: string;
};
export type PhotonFeature = { properties?: PhotonProps; geometry?: { coordinates?: unknown } };

/** "Ward 104 Kondapur" is how OpenStreetMap names Hyderabad's wards; people know the area as "Kondapur". */
export function plainArea(s: string | undefined): string {
  return (s ?? "").replace(/^ward\s*(no\.?\s*)?\d+\s*/i, "").replace(/\s+/g, " ").trim();
}

function point(f: PhotonFeature): { lat: number; lng: number } | null {
  const c = f.geometry?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const lng = Number(c[0]);
  const lat = Number(c[1]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** Search results in the same shape as the Nominatim search: an Indian place, with a short readable label. */
export function photonPlaces(features: PhotonFeature[], q: string): { label: string; lat: number; lng: number }[] {
  const out: { label: string; lat: number; lng: number }[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const p = f.properties ?? {};
    if (p.countrycode && p.countrycode.toUpperCase() !== "IN") continue;
    const at = point(f);
    if (!at) continue;
    const parts = [p.name, plainArea(p.locality) || plainArea(p.district), p.city || p.county, p.state]
      .map((x) => (x ?? "").trim())
      .filter(Boolean);
    const unique = parts.filter((x, i) => parts.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
    const label = unique.slice(0, 3).join(", ") || q;
    const k = label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ label, ...at });
    if (out.length >= 6) break;
  }
  return out;
}

/** A short area name for a point (an area, not a door), or null. */
export function photonAreaName(features: PhotonFeature[]): string | null {
  const p = features[0]?.properties;
  if (!p) return null;
  const area = plainArea(p.locality) || plainArea(p.district);
  const city = p.city || p.county || "";
  const name = [area, city].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ");
  return name || plainArea(p.name) || null;
}
