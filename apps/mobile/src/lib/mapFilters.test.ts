import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FILTERS, changedFilters, filterJobs, jobsSummary, parseSavedFilters } from './mapFilters.ts';

const KONDAPUR = { lat: 17.4699, lng: 78.3578 };
const job = (id: string, lat: number | null, lng: number | null, rupees: number, created = '2026-11-09T08:00:00Z') => ({
  id,
  loc_lat: lat,
  loc_lng: lng,
  benchmark_minor: rupees * 100,
  created_at: created,
});
// About 2 km, 8 km and 40 km from Kondapur, then two from-home jobs.
const near = job('near', 17.45, 78.36, 500, '2026-11-09T09:00:00Z');
const mid = job('mid', 17.43, 78.42, 1200);
const far = job('far', 17.8, 78.4, 3000);
const home1 = job('home1', null, null, 800, '2026-11-09T10:00:00Z');
const home2 = job('home2', null, null, 300);
const pinned = [near, mid, far];
const remote = [home1, home2];

test('the distance is measured from the chosen place, and from-home jobs ride along', () => {
  const ids = filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, km: 10 }).map((j) => j.id);
  assert.deepEqual(ids, ['mid', 'home1', 'near', 'home2']);
});

test('a wider distance takes in the far job', () => {
  const ids = filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, km: 50 }).map((j) => j.id);
  assert.ok(ids.includes('far'));
});

test('in person drops the from-home jobs; from home drops every pinned one', () => {
  assert.deepEqual(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, work: 'local' }).map((j) => j.id), ['mid', 'near']);
  assert.deepEqual(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, work: 'remote' }).map((j) => j.id), ['home1', 'home2']);
});

test('the pay floor and the three orders', () => {
  assert.deepEqual(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, minPay: 1000 }).map((j) => j.id), ['mid']);
  assert.deepEqual(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, sort: 'near' }).map((j) => j.id), ['near', 'mid', 'home1', 'home2']);
  assert.deepEqual(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, sort: 'new' }).map((j) => j.id), ['home1', 'near', 'mid', 'home2']);
});

test('with no place yet only from-home jobs can show', () => {
  assert.deepEqual(filterJobs(pinned, remote, null, DEFAULT_FILTERS).map((j) => j.id), ['home1', 'home2']);
});

test('saved filters are read safely', () => {
  assert.deepEqual(parseSavedFilters(null), DEFAULT_FILTERS);
  assert.deepEqual(parseSavedFilters('not json'), DEFAULT_FILTERS);
  assert.deepEqual(parseSavedFilters('{"km":250,"minPay":777,"work":"remote","sort":"new"}'), { km: 100, minPay: 0, work: 'remote', sort: 'new' });
});

test('the Filters badge counts pay, work type and order', () => {
  assert.equal(changedFilters(DEFAULT_FILTERS), 0);
  assert.equal(changedFilters({ ...DEFAULT_FILTERS, km: 50 }), 0);
  assert.equal(changedFilters({ ...DEFAULT_FILTERS, minPay: 500, work: 'remote' }), 2);
});

test('the summary line', () => {
  assert.equal(jobsSummary(4, 3, 10, 'all'), '4 jobs within 10 km · 3 from home');
  assert.equal(jobsSummary(1, 0, 5, 'all'), '1 job within 5 km');
  assert.equal(jobsSummary(4, 3, 10, 'remote'), '3 jobs you can do from home');
});
