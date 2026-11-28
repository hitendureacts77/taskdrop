import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isKnownPath, nameForScreen, NOT_FOUND_TITLE, pageFromAddress, pathForEntry, pathForStack, routeFromAddress, SITE_TITLE, titleForScreen } from './webAddress.ts';
import { WebHistory, type HistoryHost } from './webHistory.ts';

test('B171: /privacy, /terms, /support and /copyright open their page on load', () => {
  assert.equal(pageFromAddress('/privacy', ''), 'privacy');
  assert.equal(pageFromAddress('/terms/', ''), 'terms');
  assert.equal(pageFromAddress('/Support', ''), 'support');
  assert.equal(pageFromAddress('/copyright', '?utm=x'), 'copyright');
  // The old ?page= links still work.
  assert.equal(pageFromAddress('/', '?page=terms'), 'terms');
});

test('B171: unknown paths and other pages still go Home', () => {
  assert.equal(pageFromAddress('/', ''), null);
  assert.equal(pageFromAddress('/nonexistent-page-xyz', ''), null);
  assert.equal(pageFromAddress('/.env', ''), null);
  assert.equal(pageFromAddress('/privacy/extra', ''), null);
  assert.equal(pageFromAddress('/', '?page=wallet'), null);
});

const TASK = '0b7c1f3e-2d4a-4c8b-9e6f-1a2b3c4d5e6f';
const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

test('board fix: the main screens open from their own address', () => {
  assert.deepEqual(routeFromAddress('/'), { screen: 'home', params: {} });
  assert.deepEqual(routeFromAddress(`/task/${TASK}`), { screen: 'taskDetail', params: { taskId: TASK } });
  assert.deepEqual(routeFromAddress(`/task/${TASK.toUpperCase()}/`), { screen: 'taskDetail', params: { taskId: TASK } });
  assert.deepEqual(routeFromAddress(`/profile/${USER}`), { screen: 'publicProfile', params: { userId: USER } });
  assert.deepEqual(routeFromAddress('/find-work'), { screen: 'explore', params: {}, mode: 'worker' });
  assert.deepEqual(routeFromAddress('/explore'), { screen: 'explore', params: {} });
  const screens: Record<string, string> = {
    '/map': 'nearMap', '/my-tasks': 'myTasks', '/my-work': 'orders', '/wallet': 'wallet', '/messages': 'inbox',
    '/notifications': 'notifications', '/profile': 'profile', '/post': 'aiPost', '/terms': 'terms', '/privacy/': 'privacy',
  };
  for (const [path, screen] of Object.entries(screens)) assert.equal(routeFromAddress(path)?.screen, screen, path);
  // The old links still open their screen.
  assert.deepEqual(routeFromAddress('/', `?task=${TASK}`), { screen: 'taskDetail', params: { taskId: TASK } });
  assert.equal(routeFromAddress('/', '?page=terms')?.screen, 'terms');
  // Anything else is "Page not found": a made-up id, a phone number, another path.
  for (const p of ['/task/123', '/task/9876543210', `/task/${TASK}/x`, '/profile/someone', '/Wallet', '/screen/home', '/.env']) {
    assert.equal(routeFromAddress(p), null, p);
  }
});

test('board fix: each main screen writes its address, ids only', () => {
  assert.equal(pathForEntry('taskDetail', { row: { id: TASK, title: 'Fix a tap', meta: 'Indiranagar' } }), `/task/${TASK}`);
  assert.equal(pathForEntry('taskDetail', { unavailable: true, taskId: TASK }), `/task/${TASK}`);
  // A demo row with no real id has no address (it keeps the one under it).
  assert.equal(pathForEntry('taskDetail', { row: { id: 'demo-1' } }), null);
  assert.equal(pathForEntry('publicProfile', { userId: USER, role: 'worker' }), `/profile/${USER}`);
  assert.equal(pathForEntry('explore', {}, 'worker'), '/find-work');
  assert.equal(pathForEntry('explore', {}, 'poster'), '/explore');
  assert.equal(pathForEntry('orders', {}), '/my-work');
  assert.equal(pathForEntry('wallet', {}), '/wallet');
  assert.equal(pathForEntry('privacy', {}), '/privacy');
  assert.equal(pathForEntry('compare', { task: { id: TASK } }), null);
  // Every address a screen writes opens that same screen again.
  for (const [screen, params] of [['taskDetail', { taskId: TASK }], ['publicProfile', { userId: USER }], ['myTasks', {}], ['inbox', {}], ['aiPost', {}], ['nearMap', {}]] as const) {
    assert.equal(routeFromAddress(pathForEntry(screen, params)!)?.screen, screen, screen);
  }
});

test('board fix: a screen with no address keeps the one under it', () => {
  const row = { id: TASK };
  assert.equal(pathForStack([{ screen: 'home', params: {} }, { screen: 'taskDetail', params: { row } }, { screen: 'compare', params: {} }]), `/task/${TASK}`);
  assert.equal(pathForStack([{ screen: 'splash', params: {} }]), '/');
  assert.equal(pathForStack([{ screen: 'home', params: {} }, { screen: 'explore', params: {} }], 'worker'), '/find-work');
});

/** A browser history in memory: back() fires popstate a moment later, as a browser does. */
function fakeBrowser(path = '/') {
  const entries: { state: unknown; url: string }[] = [{ state: null, url: path }];
  let at = 0;
  let onPop: (state: unknown) => void = () => {};
  const host: HistoryHost = {
    history: {
      get state() {
        return entries[at]!.state;
      },
      pushState(state, _t, url) {
        entries.splice(at + 1);
        entries.push({ state, url: url ?? entries[at]!.url });
        at += 1;
      },
      replaceState(state, _t, url) {
        entries[at] = { state, url: url ?? entries[at]!.url };
      },
      back() {
        if (at === 0) return;
        at -= 1;
        queueMicrotask(() => onPop(entries[at]!.state));
      },
    },
    location: {
      get pathname() {
        return entries[at]!.url.split(/[?#]/)[0]!;
      },
      search: '',
      hash: '',
    },
  };
  return {
    host,
    urls: () => entries.map((e) => e.url),
    at: () => at,
    listen: (fn: (state: unknown) => void) => (onPop = fn),
    browserBack: () => {
      at -= 1;
      return entries[at]!.state;
    },
    browserForward: () => {
      at += 1;
      return entries[at]!.state;
    },
  };
}

type E = { screen: string; params: Record<string, unknown> };
const e = (screen: string, params: Record<string, unknown> = {}): E => ({ screen, params });

test('board fix: moving pushes history; browser Back and Forward put each stack back', () => {
  const b = fakeBrowser();
  const h = new WebHistory<E>(b.host, (s) => pathForStack(s, 'worker'));
  const home = [e('home')];
  h.start(home);
  const work = [e('explore')];
  h.push(work);
  const task = [...work, e('taskDetail', { row: { id: TASK } })];
  h.push(task);
  assert.deepEqual(b.urls(), ['/', '/find-work', `/task/${TASK}`]);
  const back1 = h.onPop(b.browserBack());
  assert.ok(typeof back1 === 'object' && back1.stack === work);
  const back2 = h.onPop(b.browserBack());
  assert.ok(typeof back2 === 'object' && back2.stack === home);
  const fwd = h.onPop(b.browserForward());
  assert.ok(typeof fwd === 'object' && fwd.stack === work);
  // An entry made before a reload (no key we know) is rebuilt from its address by the caller.
  assert.equal(h.onPop({ td: 'old-1' }), 'unknown');
  assert.equal(h.onPop(null), 'unknown');
});

test('board fix: the in-app back button uses browser Back, so the two agree', async () => {
  const b = fakeBrowser();
  const h = new WebHistory<E>(b.host, (s) => pathForStack(s));
  const results: unknown[] = [];
  b.listen((state) => results.push(h.onPop(state)));
  const home = [e('home')];
  h.start(home);
  const task = [...home, e('taskDetail', { row: { id: TASK } })];
  h.push(task);
  h.back(task.slice(0, -1));
  // A move asked for before the browser has gone Back waits for it, then lands on top.
  const wallet = [...home, e('wallet')];
  h.push(wallet);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(results, ['ignore']);
  assert.deepEqual(b.urls(), ['/', '/wallet']);
  assert.equal(b.at(), 1);
  // Back when the entry behind is not the stack wanted (a deep link opened alone): the entry is replaced.
  h.replace([e('home'), e('inbox'), e('chat')]);
  h.back([e('home'), e('inbox')]);
  assert.deepEqual(b.urls(), ['/', '/messages']);
});

test('board fix: after sign-out nothing from before comes back through Back', () => {
  const b = fakeBrowser();
  const h = new WebHistory<E>(b.host, (s) => pathForStack(s));
  h.start([e('home')]);
  h.push([e('home'), e('wallet')]);
  h.replace([e('splash')]);
  h.forget();
  assert.equal(h.onPop(b.browserBack()), 'unknown');
});

test('B179: each main screen has its own tab title', () => {
  assert.equal(titleForScreen('wallet'), 'Wallet · TaskDrop');
  assert.equal(titleForScreen('explore', 'worker'), 'Find work · TaskDrop');
  assert.equal(titleForScreen('explore', 'poster'), 'Explore · TaskDrop');
  assert.equal(titleForScreen('privacy'), 'Privacy Policy · TaskDrop');
  assert.equal(titleForScreen('splash'), SITE_TITLE);
  assert.equal(titleForScreen('swipe'), 'Start the work · TaskDrop');
});

test('3.6 T13 #5: every registered screen has its own tab title, never bare "TaskDrop"', () => {
  const registry = readFileSync(new URL('./registry.tsx', import.meta.url), 'utf8');
  const block = registry.slice(registry.indexOf('export const REGISTRY'));
  const screens = [...block.matchAll(/^\s+([a-zA-Z]+): [A-Z]\w+Screen,$/gm)].map((m) => m[1]);
  assert.ok(screens.length > 40, `found only ${screens.length} screens in registry.tsx`);
  for (const s of screens.filter((x) => x !== 'splash')) {
    const title = titleForScreen(s);
    assert.ok(title !== 'TaskDrop' && title !== SITE_TITLE && title.endsWith(' · TaskDrop'), `${s} has no title of its own`);
  }
});

test('3.6 T13 #8: only the real addresses are known; anything else is "Page not found"', () => {
  for (const p of ['/', '', '/index.html', '/get', '/get/', '/terms', '/privacy', '/support/', '/copyright', '/wallet', '/find-work', '/task/0b7c1f3e-2d4a-4c8b-9e6f-1a2b3c4d5e6f']) assert.equal(isKnownPath(p), true, p);
  for (const p of ['/Privacy', '/this-page-does-not-exist-xyz', '/Wallet', '/terms/x', '/sitemap.xml', '/screen/home', '/task/123', '/task/', '/profile/me']) assert.equal(isKnownPath(p), false, p);
  assert.equal(NOT_FOUND_TITLE, 'Page not found · TaskDrop');
});

test('the desktop page header names a screen plainly, and gives null for one with no name', () => {
  assert.equal(nameForScreen('wallet'), 'Wallet');
  assert.equal(nameForScreen('myTasks', 'worker'), 'My work');
  assert.equal(nameForScreen('myTasks', 'poster'), 'My tasks');
  assert.equal(nameForScreen('explore', 'worker'), 'Find work');
  assert.equal(nameForScreen('splash'), null);
});

test('board fix: a reload keeps its address and its place in history', () => {
  const b = fakeBrowser(`/task/${TASK}`);
  b.host.history.replaceState({ td: 'from-before-1' }, '', `/task/${TASK}`);
  const h = new WebHistory<E>(b.host, (s) => pathForStack(s));
  assert.equal(h.reloaded, true);
  h.start([e('home')]);
  assert.deepEqual(b.urls(), [`/task/${TASK}`]);
  h.replace([e('home'), e('taskDetail', { taskId: TASK })]);
  assert.deepEqual(b.urls(), [`/task/${TASK}`]);
  // A fresh visit is not a reload.
  assert.equal(new WebHistory<E>(fakeBrowser().host, (s) => pathForStack(s)).reloaded, false);
});
