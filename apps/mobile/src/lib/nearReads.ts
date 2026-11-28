import { attachPosters, type TaskWithPoster } from '../data/api';
import { tasksNear, workersNear, type NearbyWorker } from '../data/extras';
import { FIND_WORK_LIMIT } from './findWorkRead';
import { PEOPLE_READ_CAP } from './presence';

/**
 * The one read behind every "near you" number on Home and the Find work card (feedback board: the numbers on one
 * screen disagreed). Two screens asking for the same place and distance within a few seconds share one answer, so
 * the same figure shows everywhere at the same moment. Failed reads are not kept.
 */
const TTL_MS = 20_000;
const cache = new Map<string, { at: number; p: Promise<unknown> }>();

function shared<T>(key: string, read: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p as Promise<T>;
  const p = read();
  cache.set(key, { at: Date.now(), p });
  p.catch(() => {
    if (cache.get(key)?.p === p) cache.delete(key);
  });
  return p;
}

const spot = (a: { lat: number; lng: number }) => `${a.lat.toFixed(4)},${a.lng.toFixed(4)}`;

export type NearJob = TaskWithPoster & { km: number };

/** Open jobs within `km` of a place, nearest first, with their posters: Find work's own read. */
export const readNearJobs = (at: { lat: number; lng: number }, km: number): Promise<NearJob[]> =>
  shared(`jobs:${spot(at)}:${km}`, async () => {
    const rows = await tasksNear(at, km, FIND_WORK_LIMIT);
    const withPeople = await attachPosters(rows);
    return withPeople.map((x, i) => ({ ...x, km: rows[i]!.km }));
  });

/** The most helpers counted within the Hire Home distance. */
export const NEAR_PEOPLE_LIMIT = PEOPLE_READ_CAP;

/** Helpers within `km` of a place, active ones first is the caller's choice: the raw list, nearest data included. */
export const readNearPeople = (at: { lat: number; lng: number }, km: number): Promise<NearbyWorker[]> =>
  shared(`people:${spot(at)}:${km}`, () => workersNear(at, km, NEAR_PEOPLE_LIMIT));

/** For tests: forget everything read. */
export const clearNearReads = () => cache.clear();
