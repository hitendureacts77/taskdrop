import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FILTERS,
  changedFilters,
  cleanPrice,
  dropOptions,
  filterJobs,
  filterList,
  jobsSummary,
  matchesJob,
  narrowsJobs,
  parseSavedFilters,
  priceLabel,
} from './mapFilters.ts';

const KONDAPUR = { lat: 17.4699, lng: 78.3578 };
const NOW = Date.parse('2026-11-11T08:00:00Z');
type Extra = { assignment_mode?: string | null; due_at?: string | null; flag?: string | null };
const job = (id: string, lat: number | null, lng: number | null, rupees: number, created = '2026-11-09T08:00:00Z', extra: Extra = {}) => ({
  id,
  loc_lat: lat,
  loc_lng: lng,
  benchmark_minor: rupees * 100,
  created_at: created,
  ...extra,
});
// About 2 km, 8 km and 40 km from Kondapur, then two remote jobs.
const near = job('near', 17.45, 78.36, 500, '2026-11-09T09:00:00Z', { assignment_mode: 'auto', flag: 'urgent' });
const mid = job('mid', 17.43, 78.42, 1200, '2026-11-09T08:00:00Z', { due_at: '2026-11-11T20:00:00Z' });
const far = job('far', 17.8, 78.4, 3000);
const home1 = job('home1', null, null, 800, '2026-11-09T10:00:00Z', { assignment_mode: 'auto', due_at: '2026-11-20T10:00:00Z' });
const home2 = job('home2', null, null, 300);
const pinned = [near, mid, far];
const remote = [home1, home2];
const ids = (rows: { id: string }[]) => rows.map((j) => j.id);

test('the distance is measured from the chosen place, and remote jobs ride along', () => {
  assert.deepEqual(ids(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, km: 10 }, NOW)), ['mid', 'home1', 'near', 'home2']);
  assert.ok(ids(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, km: 50 }, NOW)).includes('far'));
});

test('Nearby drops the remote jobs; Remote drops every pinned one', () => {
  assert.deepEqual(ids(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, work: 'local' }, NOW)), ['mid', 'near']);
  assert.deepEqual(ids(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, work: 'remote' }, NOW)), ['home1', 'home2']);
});

test('the price range is inclusive at both ends, and 0 leaves an end open', () => {
  assert.deepEqual(ids(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, minPay: 1000 }, NOW)), ['mid']);
  assert.deepEqual(ids(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, maxPay: 500 }, NOW)), ['near', 'home2']);
  assert.deepEqual(ids(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, minPay: 300, maxPay: 800 }, NOW)), ['home1', 'near', 'home2']);
});

test('the three orders', () => {
  assert.deepEqual(ids(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, sort: 'near' }, NOW)), ['near', 'mid', 'home1', 'home2']);
  assert.deepEqual(ids(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, sort: 'new' }, NOW)), ['home1', 'near', 'mid', 'home2']);
});

test('Auto-hire and Open to counter offers: one on keeps that kind, both on keeps both', () => {
  const all = { ...DEFAULT_FILTERS, km: 50 };
  assert.deepEqual(ids(filterJobs(pinned, remote, KONDAPUR, { ...all, auto: true }, NOW)).sort(), ['home1', 'near']);
  assert.deepEqual(ids(filterJobs(pinned, remote, KONDAPUR, { ...all, offers: true }, NOW)).sort(), ['far', 'home2', 'mid']);
  assert.equal(filterJobs(pinned, remote, KONDAPUR, { ...all, auto: true, offers: true }, NOW).length, 5);
});

test('Due in 24 hours keeps urgent jobs and ones due by tomorrow', () => {
  assert.deepEqual(ids(filterJobs(pinned, remote, KONDAPUR, { ...DEFAULT_FILTERS, km: 50, dueSoon: true }, NOW)).sort(), ['mid', 'near']);
  assert.equal(matchesJob(home1, { ...DEFAULT_FILTERS, dueSoon: true }, NOW), false);
});

test('with no place the map shows only remote jobs, but the list still shows every job', () => {
  assert.deepEqual(ids(filterJobs(pinned, remote, null, DEFAULT_FILTERS, NOW)), ['home1', 'home2']);
  assert.equal(filterList([...pinned, ...remote], null, DEFAULT_FILTERS, NOW).length, 5);
  assert.deepEqual(ids(filterList([...pinned, ...remote], null, { ...DEFAULT_FILTERS, work: 'local' }, NOW)), ['far', 'mid', 'near']);
});

test('with a place the list shows the same jobs as the map', () => {
  const f = { ...DEFAULT_FILTERS, km: 10 };
  assert.deepEqual(ids(filterList([...pinned, ...remote], KONDAPUR, f, NOW)), ids(filterJobs(pinned, remote, KONDAPUR, f, NOW)));
});

test('price labels and clean ranges', () => {
  assert.equal(priceLabel({ minPay: 0, maxPay: 0 }), 'Any price');
  assert.equal(priceLabel({ minPay: 0, maxPay: 300 }), 'Under ₹300');
  assert.equal(priceLabel({ minPay: 5000, maxPay: 0 }), '₹5,000+');
  assert.equal(priceLabel({ minPay: 300, maxPay: 1000 }), '₹300–₹1,000');
  assert.deepEqual(cleanPrice(900, 200), { minPay: 200, maxPay: 900 });
  assert.deepEqual(cleanPrice(-5, 2_000_000), { minPay: 0, maxPay: 1_000_000 });
  assert.deepEqual(cleanPrice(500, 0), { minPay: 500, maxPay: 0 });
});

test('saved filters are read safely, older saves too', () => {
  assert.deepEqual(parseSavedFilters(null), DEFAULT_FILTERS);
  assert.deepEqual(parseSavedFilters('not json'), DEFAULT_FILTERS);
  assert.deepEqual(parseSavedFilters('{"km":250,"minPay":777,"work":"remote","sort":"new"}'), { ...DEFAULT_FILTERS, km: 100, minPay: 777, work: 'remote', sort: 'new' });
  assert.deepEqual(parseSavedFilters('{"minPay":900,"maxPay":100,"auto":true,"dueSoon":"yes"}'), { ...DEFAULT_FILTERS, minPay: 100, maxPay: 900, auto: true });
});

test('the Filters badge and what narrows the jobs', () => {
  assert.equal(changedFilters(DEFAULT_FILTERS), 0);
  assert.equal(changedFilters({ ...DEFAULT_FILTERS, km: 50 }), 0);
  assert.equal(changedFilters({ ...DEFAULT_FILTERS, minPay: 500, maxPay: 900, work: 'remote', auto: true }), 3);
  assert.equal(narrowsJobs({ ...DEFAULT_FILTERS, sort: 'new' }), false);
  assert.equal(narrowsJobs({ ...DEFAULT_FILTERS, dueSoon: true }), true);
});

test('one-tap ways out when little matches', () => {
  const keys = dropOptions({ ...DEFAULT_FILTERS, auto: true, minPay: 500, work: 'local' }).map((o) => o.key);
  assert.deepEqual(keys, ['auto', 'price', 'work', 'km']);
  assert.equal(dropOptions({ ...DEFAULT_FILTERS, km: 100 }).length, 0);
  assert.equal(dropOptions({ ...DEFAULT_FILTERS, work: 'remote' }).some((o) => o.key === 'km'), false);
});

test('the summary line', () => {
  assert.equal(jobsSummary(4, 3, 10, 'all'), '4 jobs within 10 km · 3 remote');
  assert.equal(jobsSummary(1, 0, 5, 'all'), '1 job within 5 km');
  assert.equal(jobsSummary(4, 3, 10, 'remote'), '3 jobs you can do remotely');
});
