import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNativeSpeech, speechErrorMessage, transcriptOf } from './speechNative.ts';

const fn = () => undefined;
function fakeModule(available: boolean | (() => boolean)) {
  return {
    start: fn,
    stop: fn,
    requestPermissionsAsync: async () => ({ granted: true }),
    isRecognitionAvailable: typeof available === 'function' ? available : () => available,
    addListener: () => ({ remove: fn }),
  };
}

test('old APK without the native module: no mic, no crash', () => {
  assert.equal(pickNativeSpeech(() => null), null);
  assert.equal(pickNativeSpeech(() => undefined), null);
  assert.equal(
    pickNativeSpeech(() => {
      throw new Error("Cannot find native module 'ExpoSpeechRecognition'");
    }),
    null,
  );
});

test('a module missing a function we call is ignored', () => {
  const m: Record<string, unknown> = fakeModule(true);
  delete m.addListener;
  assert.equal(pickNativeSpeech(() => m), null);
  assert.equal(pickNativeSpeech(() => 'not a module'), null);
});

test('no recognizer on the phone: no mic', () => {
  assert.equal(pickNativeSpeech(() => fakeModule(false)), null);
  assert.equal(
    pickNativeSpeech(() =>
      fakeModule(() => {
        throw new Error('boom');
      }),
    ),
    null,
  );
});

test('module and recognizer present: mic shows', () => {
  const m = fakeModule(true);
  assert.equal(pickNativeSpeech(() => m), m);
});

test('transcript and error text', () => {
  assert.equal(transcriptOf({ isFinal: false, results: [{ transcript: ' fix my tap ' }] }), 'fix my tap');
  assert.equal(transcriptOf({ isFinal: true, results: [] }), '');
  assert.equal(transcriptOf(null), '');
  assert.equal(speechErrorMessage('no-speech'), null);
  assert.equal(speechErrorMessage('aborted'), null);
  assert.equal(speechErrorMessage('not-allowed'), 'Allow the microphone to use voice typing');
  assert.equal(speechErrorMessage('weird'), 'Voice typing stopped');
});
