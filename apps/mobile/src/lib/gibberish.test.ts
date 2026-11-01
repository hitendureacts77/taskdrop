import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeGibberish } from './gibberish.ts';

test('keyboard mashing from the 2026-10-30 walkthrough is caught', () => {
  for (const s of ['Jdjshrjensjjsks', 'Hdhs', 'Bsnsnms', 'asdfghjkl', 'kkkkkkk', 'qwrt zxcv']) {
    assert.equal(looksLikeGibberish(s), true, s);
  }
});

test('real requests pass, in English, Hinglish and other scripts', () => {
  for (const s of [
    'Fix the side stand of my scooter at home',
    'My scooty brake to be fixed',
    'AC service',
    'PS5 repair',
    'TV wall mount 55 inch',
    'mera fridge theek karo',
    'Need a logo for my bakery',
    'ఇంటి శుభ్రం చేయాలి',
    'घर की सफाई करनी है',
    '1BHK shifting',
    'Strengths and weaknesses essay for my resume',
  ]) {
    assert.equal(looksLikeGibberish(s), false, s);
  }
});
