import test from 'node:test';
import assert from 'node:assert/strict';
import { BIG_DAY_LINK, EXPLAINERS, HUNT_LINK, fillFee } from './explainers.ts';
import type { Explainer, ExplainerKey } from './explainers.ts';
import { EVENTS } from './bigDays.ts';

const KEYS = Object.keys(EXPLAINERS) as ExplainerKey[];

/** Every string a person can read in an explainer. Scene ids and event keys are not copy, so they are left out. */
function visibleStrings(e: Explainer): string[] {
  return [
    e.title,
    e.subtitle,
    ...e.steps.flatMap((s) => [s.title, s.body]),
    e.whoForTitle,
    ...e.whoFor,
    e.examplesTitle,
    ...e.examples.flatMap((x) => [x.title, x.detail, ...(x.prompt ? [x.prompt] : [])]),
    ...(e.footnote ? [e.footnote] : []),
    e.doneLabel,
  ];
}

test('there are three explainers', () => {
  assert.deepEqual([...KEYS].sort(), ['bigDay', 'hunt', 'huntFinder']);
});

test('each explainer has 3 steps, 3 to 4 "who it is for" lines and at least 3 examples', () => {
  for (const key of KEYS) {
    const e = EXPLAINERS[key];
    assert.equal(e.steps.length, 3, `${key} steps`);
    assert.ok(e.whoFor.length >= 3 && e.whoFor.length <= 4, `${key} whoFor`);
    assert.ok(e.examples.length >= 3, `${key} examples`);
    assert.ok(e.title && e.subtitle && e.doneLabel, `${key} headings`);
  }
});

test('the two Hunt explainers have 4 examples', () => {
  assert.equal(EXPLAINERS.hunt.examples.length, 4);
  assert.equal(EXPLAINERS.huntFinder.examples.length, 4);
});

test('no step, line or example is empty', () => {
  for (const key of KEYS) {
    for (const s of visibleStrings(EXPLAINERS[key])) assert.ok(s.trim().length > 0, key);
  }
});

test('every Big Day example names a real event', () => {
  const keys = new Set(EVENTS.map((e) => e.key as string));
  for (const x of EXPLAINERS.bigDay.examples) {
    assert.ok(x.event, `${x.title} has an event`);
    assert.ok(keys.has(x.event as string), `${x.title}: unknown event ${x.event}`);
  }
  assert.ok(keys.has('birthday'), 'birthday event exists');
});

test('every Hunt example has a ready prompt that starts "Find me " and fits the post box', () => {
  for (const x of EXPLAINERS.hunt.examples) {
    assert.ok(x.prompt, `${x.title} has a prompt`);
    assert.ok(x.prompt.startsWith('Find me '), x.title);
    assert.ok(x.prompt.length <= 1500, x.title);
  }
});

test('finder examples are plain cards: no prompt to use', () => {
  for (const x of EXPLAINERS.huntFinder.examples) assert.equal(x.prompt, undefined, x.title);
});

test('visible words avoid jargon (the scene ids escrow and quotes are not copy and are not checked)', () => {
  const jargon = /escrow|\bbids?\b|\bquotes?\b|algorithm|AI-powered/i;
  for (const key of KEYS) {
    for (const s of visibleStrings(EXPLAINERS[key])) assert.doesNotMatch(s, jargon, `${key}: ${s}`);
  }
  assert.doesNotMatch(`${HUNT_LINK} ${BIG_DAY_LINK}`, jargon);
});

test('copy never suggests tasks are local only', () => {
  for (const key of KEYS) {
    for (const s of visibleStrings(EXPLAINERS[key])) {
      assert.doesNotMatch(s, /only near you|local only|locally only/i, `${key}: ${s}`);
    }
  }
});

test('fillFee puts the live fee in and leaves no placeholder', () => {
  assert.equal(fillFee('{fee}%', 3), '3%');
  assert.equal(fillFee('a {fee}% b {fee}%', 5), 'a 5% b 5%');
  assert.equal(fillFee('no placeholder', 3), 'no placeholder');
  for (const key of KEYS) {
    for (const s of visibleStrings(EXPLAINERS[key])) assert.ok(!fillFee(s, 3).includes('{fee}'), `${key}: ${s}`);
  }
});

test('the Hunt poster explainer shows the service fee', () => {
  assert.ok(EXPLAINERS.hunt.steps.some((s) => s.body.includes('{fee}')));
});

test('the reopen links read as planned', () => {
  assert.equal(HUNT_LINK, 'How a Hunt works');
  assert.equal(BIG_DAY_LINK, 'How Plan a big day works');
});
