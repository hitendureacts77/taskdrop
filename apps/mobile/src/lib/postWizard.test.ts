import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESUME_WINDOW_MS,
  STALE_AFTER_MS,
  adopt,
  isStale,
  normalize,
  ownerMatches,
  resumable,
  validateSnapshot,
  type WizardSnapshot,
} from './postWizard.ts';

const NOW = Date.parse('2026-11-04T10:00:00Z');

function snap(over: Partial<WizardSnapshot> = {}): WizardSnapshot {
  return {
    v: 1,
    owner: 'guest',
    savedAt: NOW,
    phase: 'review',
    reached: 7,
    prompt: 'Fix the side stand of my scooter',
    questions: [{ question: 'Which scooter?', options: ['Activa', 'Jupiter'] }],
    askedFor: 'Fix the side stand of my scooter',
    answers: [{ question: 'Which scooter?', answer: 'Activa' }],
    brief: {
      title: 'Fix scooter side stand',
      summary: 'Side stand is loose',
      bullets: ['Activa'],
      category: 'Repairs',
      pillar: 'local',
      skills: ['mechanic'],
      difficulty: 'easy',
      budgetMinInr: 200,
    } as unknown as WizardSnapshot['brief'],
    writtenFrom: '["Fix the side stand of my scooter",[],"professional"]',
    title: 'Fix scooter side stand',
    description: 'The side stand on my Activa is loose and needs fixing.',
    category: 'Repairs',
    style: 'professional' as WizardSnapshot['style'],
    media: { kind: 'image', path: 'u1/abc.jpg' },
    whenKey: 'custom',
    customDue: '2026-11-06T12:00:00.000Z',
    budget: 450,
    topUpStop: 1,
    split: 2,
    mode: 'bids',
    place: { label: 'Indiranagar, Bengaluru', lat: 12.97, lng: 77.64 },
    placeSource: 'home',
    remote: false,
    opts: { flash: false, liveAnswer: false, crewSize: 0, repeat: 'week', preferWorker: null, wantPhotos: true, photosPublic: false },
    draftId: null,
    submitAfterAuth: true,
    ...over,
  };
}

test('a snapshot survives a JSON round trip unchanged', () => {
  const s = snap();
  assert.deepEqual(validateSnapshot(JSON.parse(JSON.stringify(s))), s);
  assert.deepEqual(validateSnapshot(JSON.stringify(s)), s);
});

test('a wrong version or a bad shape is refused', () => {
  assert.equal(validateSnapshot({ ...snap(), v: 2 }), null);
  assert.equal(validateSnapshot(null), null);
  assert.equal(validateSnapshot('not json'), null);
  assert.equal(validateSnapshot([]), null);
  assert.equal(validateSnapshot({ ...snap(), phase: 'nowhere' }), null);
  assert.equal(validateSnapshot({ ...snap(), reached: 99 }), null);
  assert.equal(validateSnapshot({ ...snap(), answers: [{ question: 1 }] }), null);
  assert.equal(validateSnapshot({ ...snap(), split: 7 }), null);
  assert.equal(validateSnapshot({ ...snap(), owner: '' }), null);
  assert.equal(validateSnapshot({ ...snap(), customDue: 'soon' }), null);
  // Media is a bucket path only, never a link.
  assert.equal(validateSnapshot({ ...snap(), media: { kind: 'image', path: 'https://x.test/a.jpg' } }), null);
  assert.equal(validateSnapshot({ ...snap(), opts: { ...snap().opts, repeat: 'daily' } }), null);
});

test('older than a week is stale', () => {
  assert.equal(isStale(snap(), NOW), false);
  assert.equal(isStale(snap({ savedAt: NOW - STALE_AFTER_MS + 1000 }), NOW), false);
  assert.equal(isStale(snap({ savedAt: NOW - STALE_AFTER_MS - 1000 }), NOW), true);
});

test('post-when-back only within two hours of the press', () => {
  assert.equal(resumable(snap(), NOW + 60_000), true);
  assert.equal(resumable(snap(), NOW + RESUME_WINDOW_MS + 1000), false);
  assert.equal(resumable(snap({ submitAfterAuth: false }), NOW), false);
  assert.equal(resumable(null, NOW), false);
});

test('a picked date already gone becomes today', () => {
  const past = normalize(snap({ customDue: '2026-11-03T12:00:00.000Z' }), NOW);
  assert.equal(past.whenKey, 'today');
  assert.equal(past.customDue, null);
  const future = normalize(snap(), NOW);
  assert.equal(future.whenKey, 'custom');
  assert.equal(future.customDue, '2026-11-06T12:00:00.000Z');
  assert.equal(normalize(snap({ customDue: null }), NOW).whenKey, 'today');
  // A preset choice keeps no picked date.
  assert.equal(normalize(snap({ whenKey: 'week' }), NOW).customDue, null);
  // Reached is never behind the step shown.
  assert.equal(normalize(snap({ phase: 'budget', reached: 1 }), NOW).reached, 4);
});

test('owner rules: guest snapshots may be adopted, one account never sees another', () => {
  const guest = snap();
  const a = snap({ owner: 'user-a' });
  assert.equal(ownerMatches(guest, 'guest'), true);
  assert.equal(ownerMatches(guest, 'user-a'), true);
  assert.equal(ownerMatches(a, 'user-a'), true);
  assert.equal(ownerMatches(a, 'user-b'), false);
  assert.equal(ownerMatches(a, 'guest'), false);
  assert.equal(ownerMatches(guest, null), false);
  assert.equal(adopt(guest, 'user-a').owner, 'user-a');
  assert.equal(adopt(a, 'user-b').owner, 'user-a');
});
