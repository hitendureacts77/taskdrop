// node --experimental-strip-types --test apps/mobile/src/lib/taskLink.test.ts
// B148: a task link that does not exist says so, with a way back, instead of silently opening Home.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TASK_UNAVAILABLE, taskLinkTarget } from './taskLink.ts';

const rough = (l: string | null) => (l ? l.split(',').slice(-2).join(',').trim() : null);

test('B148 a missing task opens the "not available" page', () => {
  assert.deepEqual(taskLinkTarget(null, rough), { screen: 'taskDetail', params: { unavailable: true } });
  assert.deepEqual(taskLinkTarget(undefined, rough), { screen: 'taskDetail', params: { unavailable: true } });
});

test('B148 a real task still opens on its page, with only the rough area', () => {
  const to = taskLinkTarget({ id: 'a', title: 'Fix a tap', description: 'Leaks', loc_label: 'Flat 2, Kondapur, Hyderabad', benchmark_minor: 50000 }, rough);
  assert.equal(to.screen, 'taskDetail');
  assert.ok('row' in to.params);
  const row = (to.params as { row: Record<string, unknown> }).row;
  assert.equal(row.title, 'Fix a tap');
  assert.equal(row.meta, 'Kondapur, Hyderabad');
});

test('B148 the shared-link handler and the task page use it', () => {
  // The web navigator opens /task/<id> and ?task=<id> links (providers/NavProvider.tsx).
  const host = readFileSync(new URL('../providers/NavProvider.tsx', import.meta.url), 'utf8');
  // A failed read lands on the same page, not silently on Home: the one call gets null when the read throws.
  const handler = host.slice(host.indexOf('async function taskEntry'), host.indexOf('export function NavProvider'));
  assert.equal((handler.match(/taskLinkTarget\(/g) ?? []).length, 1);
  assert.match(handler, /catch \{\s*task = null;/);
  const page = readFileSync(new URL('../screens/TaskDetailScreen.tsx', import.meta.url), 'utf8');
  assert.match(page, /TASK_UNAVAILABLE/);
  assert.match(page, /params\.unavailable === true/);
  assert.equal(TASK_UNAVAILABLE, 'That task is not available');
});
