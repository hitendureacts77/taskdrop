// node --experimental-strip-types --test apps/mobile/src/lib/feedbackLimits.test.ts
// Plan 1.19 row L: feedback photos are made smaller and capped at 1 MB; PDFs at 2 MB.
import assert from 'node:assert/strict';
import test from 'node:test';
import { feedbackTooBig, fitWithin, FEEDBACK_PDF_MAX_BYTES, FEEDBACK_PHOTO_MAX_BYTES } from './feedbackLimits.ts';

test('a big camera photo is drawn with its longest side at 1600, keeping its shape', () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(1170, 2532), { width: 739, height: 1600 });
});

test('a photo already small enough, or of unknown size, is left as it is', () => {
  assert.equal(fitWithin(1600, 900), null);
  assert.equal(fitWithin(800, 600), null);
  assert.equal(fitWithin(0, 0), null);
  assert.equal(fitWithin(Number.NaN, 300), null);
});

test('photos may be 1 MB, PDFs 2 MB, the same as the server (migration 206)', () => {
  assert.equal(FEEDBACK_PHOTO_MAX_BYTES, 1048576);
  assert.equal(FEEDBACK_PDF_MAX_BYTES, 2 * 1048576);
  assert.equal(feedbackTooBig('image', 1048576), null);
  assert.equal(feedbackTooBig('file', 1_500_000, 'bill.pdf'), null);
});

test('too big says how big, and what the limit is, in plain words', () => {
  assert.equal(feedbackTooBig('image', 1_600_000), 'That photo is 1.5 MB even after making it smaller. Photos can be up to 1 MB.');
  assert.equal(feedbackTooBig('file', 6 * 1048576, 'manual.pdf'), 'manual.pdf is 6.0 MB. PDFs can be up to 2 MB.');
  assert.equal(feedbackTooBig('file', 3 * 1048576), 'That PDF is 3.0 MB. PDFs can be up to 2 MB.');
});
