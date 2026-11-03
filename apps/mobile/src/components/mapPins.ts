import type { Profile, Task } from '../data/api';
import type { NearbyWorker } from '../data/extras';
import { isFresh } from '../lib/mapMotion';
import { presenceOf } from '../lib/presence';
import { roughPlace } from '../lib/place';
import { rupees } from './kit';
import type { JobPin } from './JobsMap';

/**
 * A task on the map: its price (as text and in rupees, so an area can show its
 * biggest offer), its area and title, whether it was posted a few minutes ago,
 * and, when the poster is known, their first name and face for the zoomed-in pin.
 */
export function jobPin(task: Task & { poster?: Profile | null }, now: number, label?: string): JobPin | null {
  if (task.loc_lat == null || task.loc_lng == null) return null;
  const p = task.poster;
  return {
    id: task.id,
    lat: task.loc_lat,
    lng: task.loc_lng,
    label: label ?? rupees(task.benchmark_minor / 100),
    amount: task.benchmark_minor / 100,
    fresh: isFresh(task.created_at, now),
    area: areaName(task.loc_label),
    title: task.title,
    who: p ? firstName(p.display_name || p.username) : undefined,
    face: p
      ? { initials: initialsOf(p.display_name || p.username), live: presenceOf(p.last_seen_at, now).online, photo: p.avatar_url }
      : undefined,
  };
}

/** "Asha" from "Asha Rao" or "@asha_r". */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').replace(/^@/, '').trim().split(/\s+/)[0] || 'Someone';
}

/** Two letters for a face with no photo. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').replace(/^@/, '').trim().split(/\s+/).filter(Boolean);
  const two = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2);
  return two.toUpperCase();
}

/** The skill a helper leads with, as people say it ("deep_cleaning" -> "Deep cleaning"). */
export function mainSkill(skills: string[] | null | undefined): string {
  const first = (skills ?? [])[0];
  if (!first) return 'Helper';
  const words = first.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "4.8" once someone has a review, otherwise nothing. */
export function ratingOf(w: Pick<NearbyWorker, 'worker_rating_avg' | 'worker_rating_count'>): string | null {
  return w.worker_rating_count > 0 ? Number(w.worker_rating_avg).toFixed(1) : null;
}

/** A helper on a poster's map: face (photo or initials), first name, main skill and rating, and their area. */
export function personPin(w: NearbyWorker, now: number): JobPin | null {
  if (w.loc_lat == null || w.loc_lng == null) return null;
  const rating = ratingOf(w);
  return {
    id: w.id,
    lat: w.loc_lat,
    lng: w.loc_lng,
    label: rating ? `${mainSkill(w.skills)} ★ ${rating}` : mainSkill(w.skills),
    name: firstName(w.display_name || w.username),
    area: areaName(w.loc_label),
    face: { initials: initialsOf(w.display_name || w.username), live: presenceOf(w.last_seen_at, now).online, photo: w.avatar_url },
  };
}

/** People with TaskDrop open come first, then nearest. */
export function activeFirst(list: NearbyWorker[], now: number): NearbyWorker[] {
  const live = (w: NearbyWorker) => (presenceOf(w.last_seen_at, now).online ? 0 : 1);
  return [...list].sort((a, b) => live(a) - live(b) || a.km - b.km);
}

/** "Madhapur" from a saved place, never a street. */
export function areaName(label: string | null | undefined): string {
  return (label ? roughPlace(label)?.split(',')[0] : null) || 'Nearby';
}

export function farText(km: number): string {
  return km < 1 ? 'under 1 km' : `~${km.toFixed(km < 10 ? 1 : 0)} km`;
}
