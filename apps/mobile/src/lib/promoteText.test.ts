import test from 'node:test';
import assert from 'node:assert/strict';
import {
  timeLeftText,
  whenText,
  surfaceBars,
  daysLabel,
  endText,
  campaignEndIso,
  moneyText,
  campaignTotalMinor,
  limitsFrom,
  parseBudget,
  clampBudget,
  raisedBudget,
  estimateText,
  busyNote,
  estimateNote,
  payNote,
  confirmCopy,
  runsUntilText,
  refusalProblem,
  agoText,
  spanText,
  promoState,
  isPausedToday,
  costPerOfferMinor,
  ranLongerText,
  alertedText,
} from './promoteText.ts';

// Tue 25 Nov 2026, 10:00 local.
const NOW = new Date(2026, 10, 25, 10, 0, 0).getTime();
const LIMITS = limitsFrom();

test('time left reads in days and hours, then hours, then minutes', () => {
  assert.equal(timeLeftText(new Date(NOW + (2 * 1440 + 5 * 60) * 60000).toISOString(), NOW), '2 days 5 h left');
  assert.equal(timeLeftText(new Date(NOW + 1440 * 60000).toISOString(), NOW), '1 day left');
  assert.equal(timeLeftText(new Date(NOW + 130 * 60000).toISOString(), NOW), '2 h 10 min left');
  assert.equal(timeLeftText(new Date(NOW + 12 * 60000).toISOString(), NOW), '12 min left');
  assert.equal(timeLeftText(new Date(NOW - 1000).toISOString(), NOW), 'Ended');
  assert.equal(timeLeftText(null, NOW), '');
});

test('when text says today, tomorrow or the date', () => {
  assert.equal(whenText(new Date(2026, 10, 25, 16, 30).toISOString(), NOW), 'today at 4:30 pm');
  assert.equal(whenText(new Date(2026, 10, 26, 0, 5).toISOString(), NOW), 'tomorrow at 12:05 am');
  assert.equal(whenText(new Date(2026, 10, 28, 9, 0).toISOString(), NOW), '28 Nov at 9:00 am');
  assert.equal(whenText(null, NOW), '');
});

test('end text names the day the way people say it', () => {
  assert.equal(endText(new Date(2026, 10, 25, 18, 0).toISOString(), NOW), 'today 6 pm');
  assert.equal(endText(new Date(2026, 10, 26, 18, 30).toISOString(), NOW), 'tomorrow 6:30 pm');
  assert.equal(endText(new Date(2026, 10, 27, 18, 0).toISOString(), NOW), 'Fri 6 pm');
  assert.equal(endText(new Date(2026, 11, 2, 9, 0).toISOString(), NOW), 'next Wed 9 am');
  assert.equal(endText(new Date(2026, 11, 20, 0, 0).toISOString(), NOW), '20 Dec 12 am');
  assert.equal(endText(null, NOW), '');
  assert.equal(endText('nonsense', NOW), '');
});

test('a campaign bought now ends the chosen days later', () => {
  assert.equal(campaignEndIso(3, NOW), new Date(NOW + 3 * 86400000).toISOString());
});

test('surface bars skip zeros, sort big first and show each place as a share', () => {
  const bars = surfaceBars({ list: 10, map: 40, home: 0, other: 99, alert: 50 });
  assert.deepEqual(bars.map((b) => [b.label, b.count, b.pct]), [['Alert', 50, 50], ['Map', 40, 40], ['Find work', 10, 10]]);
  assert.equal(surfaceBars({ list: 1 }, true)[0]!.label, 'Helpers');
  assert.deepEqual(surfaceBars({}), []);
});

test('days read singular and plural', () => {
  assert.equal(daysLabel(1), '1 day');
  assert.equal(daysLabel(7), '7 days');
});

test('money keeps whole rupees whole and shows paise otherwise', () => {
  assert.equal(moneyText(24000), '₹240');
  assert.equal(moneyText(53), '₹0.53');
  assert.equal(moneyText(100000), '₹1,000');
  assert.equal(moneyText(Number.NaN), '₹0');
});

test('the total is the day budget times the days', () => {
  assert.equal(campaignTotalMinor(8000, 3), 24000);
});

test('limits come from the quote or the shared defaults', () => {
  assert.deepEqual(LIMITS, { minRupees: 20, maxRupees: 1000 });
  assert.deepEqual(limitsFrom(5000, 20000), { minRupees: 50, maxRupees: 200 });
});

test('a typed budget must be whole rupees within the limits', () => {
  assert.deepEqual(parseBudget('', LIMITS), { rupees: null, error: null });
  assert.deepEqual(parseBudget('₹1,000', LIMITS), { rupees: 1000, error: null });
  assert.deepEqual(parseBudget('80', LIMITS), { rupees: 80, error: null });
  assert.equal(parseBudget('10', LIMITS).error, 'The smallest daily budget is ₹20.');
  assert.equal(parseBudget('1001', LIMITS).error, 'The biggest daily budget is ₹1,000.');
  assert.equal(parseBudget('12.5', LIMITS).error, 'Use whole rupees, like 80.');
  assert.equal(parseBudget('abc', LIMITS).rupees, null);
});

test('a start value is kept inside the limits', () => {
  assert.equal(clampBudget(80, LIMITS), 80);
  assert.equal(clampBudget(5, LIMITS), 20);
  assert.equal(clampBudget(5000, LIMITS), 1000);
});

test('the raised budget is the next quick amount, or double, under the cap', () => {
  assert.equal(raisedBudget(80, LIMITS), 150);
  assert.equal(raisedBudget(150, LIMITS), 300);
  assert.equal(raisedBudget(400, LIMITS), 800);
  assert.equal(raisedBudget(700, LIMITS), 1000);
  assert.equal(raisedBudget(1000, LIMITS), null);
});

test('the estimate reads as a range of top shows a day', () => {
  assert.equal(estimateText(8000, 60), '90 to 140 top shows a day');
  assert.equal(estimateText(0, 60), 'About 0 top shows a day');
});

test('the busy note appears only when others promote, and says the price', () => {
  assert.equal(busyNote(0, 5, 110), null);
  assert.deepEqual(busyNote(23, 5, 110), {
    title: 'Busy here right now.',
    body: '23 others are promoting within 5 km, so a top show costs about ₹1.10 here.',
  });
  assert.equal(busyNote(15, 5, null)!.body, '15 others are promoting within 5 km, so a top show can cost more here.');
  assert.equal(busyNote(6, 5, 55), null, 'a few others at the usual price is not busy');
});

test('the estimate note offers a bigger budget when busy and the usual price when quiet', () => {
  const base = { areaKm: 5, areaPriceMinor: 110, remote: false, service: false };
  assert.equal(estimateNote({ ...base, others: 23, raisedRupees: 150 }), '₹150 a day would get about 100 to 140.');
  assert.equal(estimateNote({ ...base, others: 23, raisedRupees: null }), '');
  assert.equal(estimateNote({ ...base, others: 0, raisedRupees: null }), 'No one else is promoting within 5 km right now · usual price here ₹1.10 per top show');
  assert.equal(estimateNote({ ...base, areaPriceMinor: 55, others: 6, raisedRupees: 150 }), '6 others promoting within 5 km · usual price here ₹0.55 per top show');
  assert.match(estimateNote({ ...base, areaPriceMinor: null, others: 0, raisedRupees: null }), /₹0\.60 per top show/);
  assert.equal(estimateNote({ ...base, remote: true, others: 0, raisedRupees: null }), 'Shown to workers anywhere.');
  assert.equal(estimateNote({ ...base, remote: true, service: true, others: 0, raisedRupees: null }), 'Shown to customers anywhere.');
});

test('the pay note and the confirm box say it cannot be stopped or refunded', () => {
  assert.equal(payNote(24000, 3), "You pay ₹240 now. It runs all 3 days and can't be stopped or refunded.");
  assert.equal(payNote(8000, 1), "You pay ₹80 now. It runs for 1 day and can't be stopped or refunded.");
  const c = confirmCopy(24000, 3, new Date(2026, 10, 27, 18, 0).toISOString(), NOW);
  assert.equal(c.title, 'Pay ₹240 and start?');
  assert.equal(c.confirm, 'Pay ₹240');
  assert.equal(c.message, "It runs for all 3 days, until Fri 6 pm. Once it starts you can't stop it or get the money back.");
  assert.match(confirmCopy(8000, 1, 'bad', NOW).message, /^It runs for 1 day\. Once it starts/);
});

test('the live footer names the end', () => {
  assert.equal(runsUntilText(new Date(2026, 10, 27, 18, 0).toISOString(), NOW), "Runs until Fri 6 pm. A paid promotion can't be stopped.");
  assert.equal(runsUntilText(null, NOW), "A paid promotion can't be stopped.");
});

test('server refusals become plain boxes; anything else stays null', () => {
  assert.equal(refusalProblem('That budget is not offered', LIMITS)!.body, 'Pick an amount from ₹20 to ₹1,000 a day.');
  assert.equal(refusalProblem('That campaign length is not offered', LIMITS)!.body, 'Pick 1, 3 or 7 days.');
  assert.equal(refusalProblem('Only an open post can be promoted', LIMITS)!.title, 'This task is no longer open.');
  assert.equal(refusalProblem('Only an open post can be promoted', LIMITS, true)!.title, 'This service is no longer open.');
  assert.equal(refusalProblem('This task already has a campaign running', LIMITS)!.title, 'Already promoted.');
  assert.equal(refusalProblem('boom', LIMITS), null);
});

test('ago and span read in the largest unit', () => {
  assert.equal(agoText(new Date(NOW - 20000).toISOString(), NOW), 'just now');
  assert.equal(agoText(new Date(NOW - 2 * 60000).toISOString(), NOW), '2 min ago');
  assert.equal(agoText(new Date(NOW - 3 * 3600000).toISOString(), NOW), '3 h ago');
  assert.equal(agoText(new Date(NOW - 86400000).toISOString(), NOW), '1 day ago');
  assert.equal(agoText(null, NOW), '');
  const from = new Date(NOW).toISOString();
  assert.equal(spanText(from, new Date(NOW + (3 * 1440 + 5 * 60) * 60000).toISOString()), '3 days 5 h');
  assert.equal(spanText(from, new Date(NOW + 5 * 3600000).toISOString()), '5 h');
  assert.equal(spanText(from, new Date(NOW + 12 * 60000).toISOString()), '12 min');
  assert.equal(spanText(from, new Date(NOW - 1000).toISOString()), '');
  assert.equal(spanText(null, from), '');
});

test('the card state: waiting, empty, live, paused today, ended', () => {
  const base = { status: 'active' as const, spentMinor: 9600, topShows: 182, saw: 410, todaySpentMinor: 3100, todayBudgetMinor: 8000 };
  assert.equal(promoState(base), 'live');
  assert.equal(promoState({ ...base, status: 'pending' }), 'waiting');
  assert.equal(promoState({ ...base, status: 'expired' }), 'ended');
  assert.equal(promoState({ ...base, status: 'cancelled' }), 'ended');
  assert.equal(promoState({ ...base, spentMinor: 0, topShows: 0, saw: 0, todaySpentMinor: 0 }), 'empty');
  assert.equal(promoState({ ...base, todaySpentMinor: 7990 }), 'paused');
  assert.equal(isPausedToday({ ...base, todaySpentMinor: 7980 }), false);
  assert.equal(isPausedToday({ ...base, status: 'expired', todaySpentMinor: 8000 }), false);
});

test('cost per offer divides spend by offers', () => {
  assert.equal(costPerOfferMinor(24000, 8), 3000);
  assert.equal(costPerOfferMinor(24000, 0), null);
});

test('a longer run is explained, an on-time one is not', () => {
  const end = new Date(NOW).toISOString();
  assert.equal(ranLongerText(end, new Date(NOW + 5 * 3600000).toISOString()), 'A quiet day moved its leftover on, so it ran 5 h longer to use the whole budget.');
  assert.equal(ranLongerText(end, end), '');
  assert.equal(ranLongerText(null, end), '');
});

test('the alert line counts workers', () => {
  assert.equal(alertedText(18), 'We also sent one alert to 18 workers nearby.');
  assert.equal(alertedText(1), 'We also sent one alert to 1 worker nearby.');
  assert.equal(alertedText(0), '');
});
