import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Reads the two files as text so it runs in Node without React Native.
const here = (f: string) => new URL(f, import.meta.url);
const types = readFileSync(here('../providers/navTypes.ts'), 'utf8');
const registry = readFileSync(here('./registry.tsx'), 'utf8');

test('every screen name has a screen, so nobody lands on the placeholder', () => {
  const union = types.match(/export type ScreenName\s*=([\s\S]*?);/)?.[1] ?? '';
  const names = [...union.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]!);
  assert.ok(names.length > 30, 'found the screen names');
  const registered = new Set([...registry.matchAll(/^\s+([a-zA-Z]+):\s/gm)].map((m) => m[1]!));
  assert.deepEqual(names.filter((n) => !registered.has(n)), []);
});
