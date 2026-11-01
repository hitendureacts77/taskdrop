// node --test scripts/check-exposed-files.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { PATHS, verdict } from './check-exposed-files.mjs';

const HOME = '<!DOCTYPE html><html><body><div id="root"></div></body></html>';

test('a refusal or a redirect serves no file', () => {
  for (const s of [404, 403, 401, 410, 301, 302, 308]) assert.equal(verdict(s, 'text/html', '', HOME), 'not found', String(s));
});

test('the app front page returned for an unknown path is safe', () => {
  assert.equal(verdict(200, 'text/html; charset=utf-8', HOME, HOME), 'front page');
  assert.equal(verdict(200, 'text/html', '<!doctype html><html><body>Not found page</body></html>', HOME), 'front page');
});

test('anything else with status 200 is a leak', () => {
  assert.equal(verdict(200, 'text/plain', 'SOME_KEY=abc', HOME), 'EXPOSED');
  assert.equal(verdict(200, 'application/json', '{"name":"x"}', HOME), 'EXPOSED');
  assert.equal(verdict(200, 'text/html', '<!doctype html>\nSECRET_KEY=abcd1234', HOME), 'EXPOSED');
  assert.equal(verdict(200, 'text/html', '<!doctype html>[core]\n\trepositoryformatversion = 0', HOME), 'EXPOSED');
  assert.equal(verdict(200, 'application/octet-stream', '', HOME), 'EXPOSED');
});

test('the list covers the files the plan names', () => {
  for (const p of ['/.env', '/.git/config']) assert.ok(PATHS.includes(p), p);
  assert.ok(PATHS.some((p) => p.endsWith('.map')));
  assert.ok(PATHS.some((p) => /backup|dump|\.bak/.test(p)));
});
