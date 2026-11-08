import type { Profile, Task } from '../data/api';
import type { MapPerson, NearbyWorker } from '../data/extras';
import { isFresh } from '../lib/mapMotion';
import { presenceOf } from '../lib/presence';
import { roughPlace } from '../lib/place';
import { rupees } from './kit';
import type { JobPin } from './JobsMap';
import type { IconName } from './Icon';
import { categoryIcon } from './WorkCard';

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
    // A City Hunt pin says so (D19): the reward goes to whoever finds it.
    label: label ?? (task.hunt_until ? `Hunt ${rupees(task.benchmark_minor / 100)}` : rupees(task.benchmark_minor / 100)),
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
  // Letters and digits only, so "Asha (seed poster)" is "AS", not "A(".
  const words = (name ?? '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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

/** "₹399", "₹1.2k", "₹25k": short enough for a pin's tag. */
export function shortPrice(minor: number): string {
  const r = Math.round(minor / 100);
  if (r < 1000) return '₹' + r;
  const k = r / 1000;
  return '₹' + (k >= 10 || Number.isInteger(k) ? Math.round(k) : k.toFixed(1)) + 'k';
}

/** What a helper offers, in a few words: their newest service, else their main skill. */
export function offerOf(w: NearbyWorker): { what: string; price: string | null; icon: IconName; more: number } {
  const s = w.top_service;
  if (s) return { what: s.title.trim() || mainSkill(w.skills), price: shortPrice(s.price_minor), icon: categoryIcon(s.category), more: Math.max(0, (w.service_count ?? 1) - 1) };
  return { what: mainSkill(w.skills), price: null, icon: 'wrench', more: 0 };
}

/**
 * A helper on a poster's map (plan D13): a service icon, what they offer and
 * its price, and their area. Never their name, photo or initials: those show
 * only once the poster taps them.
 */
export function personPin(w: NearbyWorker, now: number): JobPin | null {
  if (w.loc_lat == null || w.loc_lng == null) return null;
  const o = offerOf(w);
  return {
    id: w.id,
    lat: w.loc_lat,
    lng: w.loc_lng,
    label: o.what,
    price: o.price,
    more: o.more,
    area: areaName(w.loc_label),
    face: { initials: '', live: presenceOf(w.last_seen_at, now).online, icon: o.icon },
  };
}

/**
 * A person from "My people" (plan D20): a face with their initials and their first name.
 * Names are allowed here and only here, because these people already finished a task with
 * you. No area and no price: the spot is a rounded cell, never a place name.
 */
export function minePin(p: MapPerson, now: number): JobPin {
  return {
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    label: firstName(p.display_name),
    price: null,
    face: { initials: initialsOf(p.display_name), live: presenceOf(p.last_seen_at, now).online, photo: p.avatar_url },
  };
}

/** People with TaskDrop open come first, then nearest. */
export function activeFirst<T extends { last_seen_at: string | null; km: number }>(list: T[], now: number): T[] {
  const live = (w: T) => (presenceOf(w.last_seen_at, now).online ? 0 : 1);
  return [...list].sort((a, b) => live(a) - live(b) || a.km - b.km);
}

/** "2 jobs together" / "1 job together". */
export function togetherText(jobs: number): string {
  return `${jobs} ${jobs === 1 ? 'job' : 'jobs'} together`;
}

/** "Madhapur" from a saved place, never a street. */
export function areaName(label: string | null | undefined): string {
  return (label ? roughPlace(label)?.split(',')[0] : null) || 'Nearby';
}

/** Straight-line distance in km, for "how far from you" once the map searches somewhere else. */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function farText(km: number): string {
  return km < 1 ? 'under 1 km' : `~${km.toFixed(km < 10 ? 1 : 0)} km`;
}
