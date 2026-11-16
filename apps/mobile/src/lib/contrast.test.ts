import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio, over } from './contrast.ts';
import { dark, light, onHero } from '../theme.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8');
const AA = 4.5;
const WHITE = '#FFFFFF';
const atLeast = (fg: string | [number, number, number], bg: string | [number, number, number], what: string) => {
  const r = contrastRatio(fg, bg);
  assert.ok(r >= AA, `${what}: ${r.toFixed(2)}:1 is under ${AA}:1`);
};

// The Earn hero's lightest stop lives in ThemeProvider (React Native), so it is read from the source.
const workerHeroFrom = (theme: 'light' | 'dark') => {
  const src = read('../providers/ThemeProvider.tsx');
  const block = src.slice(src.indexOf(`  ${theme}: {`, src.indexOf('const WORKER_ACCENT')));
  return /heroFrom: '(#[0-9A-Fa-f]{6})'/.exec(block)![1]!;
};

test('the measure itself: known pairs', () => {
  assert.equal(contrastRatio(WHITE, '#000000').toFixed(1), '21.0');
  assert.ok(contrastRatio(WHITE, '#57D1AE') < 2, 'white on the dark-theme light jade is the B174 failure');
  assert.ok(contrastRatio(WHITE, '#F08A66') < 3, 'white on the dark-theme light coral is the B174 failure');
});

test('B174: the selected idea chip uses the filled-button pair in both themes', () => {
  for (const p of [light, dark]) atLeast(p.onBtn, p.btn, `${p === light ? 'light' : 'dark'} btn`);
  const src = read('../components/HomeSections.tsx');
  assert.ok(!src.includes("backgroundColor: on ? t.colors.accentDeep"), 'the chip fill must not be accentDeep (light jade in dark)');
});

test('B174: count badges and the NEW tag are white on the deep coral fill', () => {
  for (const p of [light, dark]) atLeast(WHITE, p.signalFill, 'white on signalFill');
  for (const f of ['../components/HomeSections.tsx', '../components/BottomTabBar.tsx', '../components/kit.tsx', '../components/SideNav.tsx']) {
    assert.ok(!/backgroundColor: t\.colors\.signalDeep/.test(read(f)), `${f} fills a white-text badge with signalDeep`);
  }
});

test('B174: the URGENT tag is the deep coral on the card and on its soft badge', () => {
  for (const p of [light, dark]) {
    atLeast(p.signalDeep, p.surface, 'URGENT on the card');
    atLeast(p.signalDeep, p.signalSoft, 'URGENT badge');
  }
});

test('B174: letters on the hero art circles', () => {
  atLeast(onHero.letter, WHITE, 'hero letter');
});

test('B174: day chips and small white text stay readable on every hero gradient stop', () => {
  const stops = [light.heroFrom, light.heroMid, light.heroTo, dark.heroFrom, dark.heroMid, dark.heroTo];
  for (const s of stops) {
    atLeast(onHero.text, over(onHero.chip, s), `day chip on ${s}`);
    atLeast(onHero.text, over(onHero.chipHover, s), `hovered day chip on ${s}`);
  }
  for (const s of [workerHeroFrom('light'), workerHeroFrom('dark')]) atLeast(onHero.text, s, `Earn hero text on ${s}`);
});
