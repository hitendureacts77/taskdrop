import test from 'node:test';
import assert from 'node:assert/strict';
import { listenForSmsCode, sixDigits } from './webOtp.web.ts';

test('sixDigits takes only a plain six-digit code', () => {
  assert.equal(sixDigits('123456'), '123456');
  assert.equal(sixDigits(' 654321 '), '654321');
  assert.equal(sixDigits('12345'), null);
  assert.equal(sixDigits('1234567'), null);
  assert.equal(sixDigits('12a456'), null);
  assert.equal(sixDigits(123456), null);
  assert.equal(sixDigits(undefined), null);
});

test('listenForSmsCode does nothing where WebOTP is missing', () => {
  // Node has no window: the stop function exists and is safe to call.
  const stop = listenForSmsCode(() => assert.fail('no code expected'));
  stop();
});

test('listenForSmsCode fills the code the browser hands back, and stops cleanly', async () => {
  const g = globalThis as Record<string, unknown>;
  const hadWindow = 'window' in g;
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let seen: AbortSignal | null = null;
  g.window = { OTPCredential: function OTPCredential() {} };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      credentials: {
        get: (o: { otp: { transport: string[] }; signal: AbortSignal }) => {
          assert.deepEqual(o.otp.transport, ['sms']);
          seen = o.signal;
          return Promise.resolve({ code: '424242' });
        },
      },
    },
  });
  try {
    const code = await new Promise<string>((resolve) => {
      const stop = listenForSmsCode(resolve);
      // Stopping after the answer still clears the timer.
      setTimeout(stop, 0);
    });
    assert.equal(code, '424242');
    await new Promise((r) => setTimeout(r, 5));
    assert.equal((seen as AbortSignal | null)?.aborted, true);
  } finally {
    if (!hadWindow) delete g.window;
    if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc);
  }
});
