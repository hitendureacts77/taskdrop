import test from 'node:test';
import assert from 'node:assert/strict';
import {
  posterEscrowCharge,
  workerNetPayout,
  platformRevenue,
  postStartCancelFine,
  clearAt,
  autoCompleteAt,
  distanceKm,
  formatDistance,
  describeLeadTime,
  quickDeadlines,
  formatAddress,
  addressTagLabel,
  MIN_SIGNUP_AGE,
  parseBirthDate,
  ageOn,
  isoDay,
} from './index.ts';

// All amounts in minor units (paise). ₹1000 = 100000.
const RS_1000 = 100_000;

test('poster escrow charge adds the 3% service fee', () => {
  assert.equal(posterEscrowCharge(RS_1000), 103_000);
});

test('worker net payout deducts the 10% commission', () => {
  assert.equal(workerNetPayout(RS_1000), 90_000);
});

test('platform revenue = 10% commission + 3% poster fee', () => {
  assert.equal(platformRevenue(RS_1000), 13_000);
});

test('post-start cancel fine is 5% of the locked value', () => {
  assert.equal(postStartCancelFine(RS_1000), 5_000);
});

test('rounding stays integer for odd amounts', () => {
  // ₹333.33 -> 33333 paise; 90% = 29999.7 -> 30000 (rounded)
  assert.equal(workerNetPayout(33_333), 30_000);
  assert.equal(Number.isInteger(workerNetPayout(33_333)), true);
});

test('clearAt adds exactly 7 days', () => {
  const completed = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(clearAt(completed).toISOString(), '2026-01-08T00:00:00.000Z');
});

test('autoCompleteAt adds exactly 3 days', () => {
  const workDone = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(autoCompleteAt(workDone).toISOString(), '2026-01-04T00:00:00.000Z');
});

// --- distance ---------------------------------------------------------------

test('distance is null when either side has not shared a location', () => {
  const bengaluru = { lat: 12.9716, lng: 77.5946 };
  assert.equal(distanceKm({ lat: null, lng: null }, bengaluru), null);
  assert.equal(distanceKm(bengaluru, { lat: 12.9, lng: null }), null);
});

test('distance between two known points is the great-circle distance', () => {
  // Indiranagar -> Koramangala is roughly 5 km apart.
  const km = distanceKm({ lat: 12.9784, lng: 77.6408 }, { lat: 12.9352, lng: 77.6245 });
  assert.ok(km !== null && km > 4 && km < 6, `expected ~5 km, got ${km}`);
});

test('distance formats the way people say it, and stays null when unknown', () => {
  assert.equal(formatDistance(null), null);
  assert.equal(formatDistance(0.4), '400 m');
  assert.equal(formatDistance(4.23), '4.2 km');
  assert.equal(formatDistance(12.6), '13 km');
});

// --- deadline phrasing ------------------------------------------------------

test('lead time is phrased the way people think about it', () => {
  const now = new Date('2026-09-14T10:00:00');
  const at = (h: number) => new Date(now.getTime() + h * 3600 * 1000);
  assert.equal(describeLeadTime(at(-1), now), 'That time has already passed');
  assert.equal(describeLeadTime(new Date(now.getTime() + 30 * 60000), now), 'in about 30 minutes');
  assert.equal(describeLeadTime(at(1), now), 'in about 1 hour');
  assert.equal(describeLeadTime(at(6), now), 'in about 6 hours');
  assert.equal(describeLeadTime(at(24), now), 'in about 1 day');
  assert.equal(describeLeadTime(at(24 * 30), now), 'in about 4 weeks');
});

test('no quick deadline is ever already in the past', () => {
  // 9pm: "this evening" has gone, so it must not be offered.
  const late = new Date('2026-09-14T21:00:00');
  const choices = quickDeadlines(late);
  assert.ok(!choices.some((c) => c.label === 'This evening'));
  for (const c of choices) {
    assert.ok(c.at.getTime() > late.getTime(), `${c.label} is in the past`);
  }
});

test('this weekend means the coming Saturday, not today when it is Saturday', () => {
  const saturday = new Date('2026-09-19T08:00:00');
  assert.equal(saturday.getDay(), 6);
  const weekend = quickDeadlines(saturday).find((c) => c.label === 'This weekend');
  assert.ok(weekend);
  assert.equal(weekend.at.getDate(), 26);
});

test('formatAddress puts the door first and the area last', () => {
  const line = formatAddress(
    { line1: 'Flat 402, 4th floor', line2: 'Casa Rouge' },
    'Road No. 8, Kothaguda, Hyderabad',
  );
  assert.equal(line, 'Flat 402, 4th floor, Casa Rouge, Road No. 8, Kothaguda, Hyderabad');
});

test('formatAddress does not say the building name twice', () => {
  // Reverse geocoding hands back the building the user just typed, in a
  // different case. Saying it again reads like a bug.
  const line = formatAddress(
    { line1: 'Flat 402', line2: 'Casa Rouge B-Block' },
    'Casa Rouge B-Block, CASA ROUGE, Road No. 8, Kothaguda',
  );
  assert.equal(line, 'Flat 402, Casa Rouge B-Block, Road No. 8, Kothaguda');
});

test('formatAddress keeps the landmark as the user worded it', () => {
  // No "near" is bolted on: people write "opposite the park gate" and
  // "near the temple" alike, and only one of those survives a prefix.
  const line = formatAddress(
    { line1: 'H.No 12', landmark: 'opposite the park gate' },
    'Kothaguda, Hyderabad',
  );
  assert.equal(line, 'H.No 12, opposite the park gate, Kothaguda, Hyderabad');
});

test('formatAddress copes with only the required field', () => {
  assert.equal(formatAddress({ line1: 'Flat 402' }), 'Flat 402');
  assert.equal(formatAddress({ line1: '  Flat 402  ' }, '   '), 'Flat 402');
});

test('addressTagLabel names an "other" address, or falls back', () => {
  assert.equal(addressTagLabel({ line1: 'x', tag: 'home' }), 'Home');
  assert.equal(addressTagLabel({ line1: 'x', tag: 'other', tagName: "Mum's flat" }), "Mum's flat");
  assert.equal(addressTagLabel({ line1: 'x', tag: 'other' }), 'Other');
  assert.equal(addressTagLabel({ line1: 'x' }), null);
  assert.equal(addressTagLabel(undefined), null);
});

test('parseBirthDate refuses dates that do not exist or have not happened', () => {
  const today = new Date(2026, 9, 4);
  assert.equal(parseBirthDate('31', '2', '2010', today), null);
  assert.equal(parseBirthDate('29', '2', '2011', today), null);
  assert.equal(isoDay(parseBirthDate('29', '2', '2012', today)!), '2012-02-29');
  assert.equal(parseBirthDate('5', '10', '2026', today), null, 'tomorrow is not a birth date');
  assert.equal(isoDay(parseBirthDate('4', '10', '2026', today)!), '2026-10-04');
  assert.equal(parseBirthDate('1', '1', '1899', today), null);
  assert.equal(parseBirthDate('1', '1', '95', today), null, 'a two-digit year is ambiguous');
  assert.equal(parseBirthDate('', '1', '2000', today), null);
  assert.equal(parseBirthDate('1', '13', '2000', today), null);
});

test('ageOn counts the birthday itself and not a day before', () => {
  const birth = parseBirthDate('4', '10', '2013')!;
  assert.equal(ageOn(birth, new Date(2026, 9, 3)), 12);
  assert.equal(ageOn(birth, new Date(2026, 9, 4)), 13);
  assert.equal(ageOn(birth, new Date(2026, 9, 5)), 13);
  // A 29 February birthday turns a year older on 1 March in common years.
  const leap = parseBirthDate('29', '2', '2012')!;
  assert.equal(ageOn(leap, new Date(2025, 1, 28)), 12);
  assert.equal(ageOn(leap, new Date(2025, 2, 1)), 13);
});

test('the minimum age is a real threshold', () => {
  const today = new Date(2026, 9, 4);
  const justOld = parseBirthDate('4', '10', String(2026 - MIN_SIGNUP_AGE), today)!;
  const justYoung = parseBirthDate('5', '10', String(2026 - MIN_SIGNUP_AGE), today)!;
  assert.ok(ageOn(justOld, today) >= MIN_SIGNUP_AGE);
  assert.ok(ageOn(justYoung, today) < MIN_SIGNUP_AGE);
});
