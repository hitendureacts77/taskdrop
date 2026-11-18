import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as server from './passwordRules.ts';
import * as app from '../../../apps/mobile/src/lib/passwordRules.ts';

test('a password needs at least 12 characters (ASVS 2.1.1)', () => {
  assert.equal(server.passwordProblem('Short1!'), 'Use at least 12 characters');
  assert.equal(server.passwordProblem('elevenchars'), 'Use at least 12 characters');
  assert.equal(server.passwordProblem('mango river tiles'), null);
});

test('more than 72 bytes is refused (bcrypt reads only 72)', () => {
  assert.equal(server.passwordProblem('a1'.repeat(37)), 'Use at most 72 characters');
  assert.equal(server.passwordProblem('ब'.repeat(25)), 'Use at most 72 characters');
});

test('easy passwords are refused', () => {
  assert.equal(server.passwordProblem('aaaaaaaaaaaaaa'), 'Do not repeat one character');
  assert.equal(server.passwordProblem('123456789012'), 'Too easy to guess');
  assert.equal(server.passwordProblem('Password12345!'), 'Too easy to guess');
  assert.equal(server.passwordProblem('qwerty123456'), 'Too easy to guess');
  assert.equal(server.passwordProblem('seed_ravi_2026x', 'seed_ravi'), 'Do not use your username in the password');
  assert.equal(server.passwordProblem('seed_ravi_2026x', '@Seed_Ravi'), 'Do not use your username in the password');
  assert.equal(server.passwordProblem('blue kettle 42', 'ravi'), null);
});

test('the strength hint grows with length and kinds of characters (ASVS 2.1.8)', () => {
  assert.deepEqual(server.passwordStrength(''), { score: 0, label: '' });
  assert.deepEqual(server.passwordStrength('short'), { score: 0, label: 'Too weak' });
  assert.equal(server.passwordStrength('mangorivertile').label, 'Fair');
  assert.equal(server.passwordStrength('mangorivertiles42').label, 'Good');
  assert.equal(server.passwordStrength('Mango-River-Tiles-42').label, 'Strong');
});

test('the app and the server give the same answers', () => {
  const samples: Array<[string, string | null]> = [
    ['', null], ['Short1!', null], ['mango river tiles', null], ['aaaaaaaaaaaaaa', null], ['123456789012', null],
    ['Password12345!', null], ['seed_ravi_2026x', 'seed_ravi'], ['a1'.repeat(37), null], ['Mango-River-Tiles-42', 'ravi'],
    ['ब'.repeat(25), null], ['098765432109', null], ['taskdrop2026!!', null],
  ];
  for (const [pw, user] of samples) {
    assert.equal(app.passwordProblem(pw, user), server.passwordProblem(pw, user), pw);
    assert.deepEqual(app.passwordStrength(pw, user), server.passwordStrength(pw, user), pw);
  }
  assert.equal(app.PASSWORD_MIN, server.PASSWORD_MIN);
});

const token = (amr: unknown) => {
  const b = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b({ alg: 'HS256' })}.${b({ sub: 'x', amr })}.sig`;
};

test('the amr list is read from the token, and nonsense gives an empty list', () => {
  assert.deepEqual(server.tokenAmr(token([{ method: 'otp', timestamp: 100 }])), [{ method: 'otp', timestamp: 100 }]);
  assert.deepEqual(server.tokenAmr('not-a-token'), []);
  assert.deepEqual(server.tokenAmr(token('otp')), []);
});

test('a text-code or Google sign-in in the last 15 minutes counts as fresh; a password sign-in never does', () => {
  const now = 1_800_000_000;
  assert.equal(server.freshNonPasswordSignIn([{ method: 'otp', timestamp: now - 60 }], now), true);
  assert.equal(server.freshNonPasswordSignIn([{ method: 'oauth', timestamp: now - 899 }], now), true);
  assert.equal(server.freshNonPasswordSignIn([{ method: 'otp', timestamp: now - 901 }], now), false);
  assert.equal(server.freshNonPasswordSignIn([{ method: 'password', timestamp: now - 10 }], now), false);
  // The latest entry decides: a password sign-in after a text code is not fresh.
  assert.equal(server.freshNonPasswordSignIn([{ method: 'otp', timestamp: now - 100 }, { method: 'password', timestamp: now - 10 }], now), false);
  assert.equal(server.freshNonPasswordSignIn([], now), false);
  assert.equal(server.freshNonPasswordSignIn([{ method: 'otp', timestamp: 'soon' }], now), false);
});
