/**
 * The phone's own speech recognizer (Google on Android, Apple on iOS) through
 * the `expo-speech-recognition` native module.
 *
 * The module is native code, so a JS update (OTA) can reach an installed app
 * that was built before the module was added. On such a build the module is
 * simply not there: `pickNativeSpeech` then returns null and the mic stays
 * hidden. It never throws. Kept free of React Native imports so the fallback
 * can be unit tested in plain node.
 */

export type NativeSpeechResultEvent = {
  isFinal: boolean;
  results: { transcript: string }[];
};

export type NativeSpeechErrorEvent = { error?: string; message?: string };

type Subscription = { remove: () => void };

export type NativeSpeech = {
  start: (options: {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    addsPunctuation?: boolean;
  }) => void;
  stop: () => void;
  abort?: () => void;
  requestPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
  isRecognitionAvailable: () => boolean;
  addListener: (event: string, fn: (e: never) => void) => Subscription;
};

const REQUIRED = ['start', 'stop', 'requestPermissionsAsync', 'isRecognitionAvailable', 'addListener'] as const;

/**
 * Returns the native module only when it is present, has every function we
 * call, and the phone has a speech recognizer. Anything else (module missing
 * from this build, loader throws, no recognizer installed) gives null.
 */
export function pickNativeSpeech(load: () => unknown): NativeSpeech | null {
  let mod: unknown;
  try {
    mod = load();
  } catch {
    return null;
  }
  if (!mod || typeof mod !== 'object') return null;
  const m = mod as Record<string, unknown>;
  for (const key of REQUIRED) {
    if (typeof m[key] !== 'function') return null;
  }
  const speech = mod as NativeSpeech;
  try {
    if (!speech.isRecognitionAvailable()) return null;
  } catch {
    return null;
  }
  return speech;
}

/** Joins the words of one result event into the text to show. */
export function transcriptOf(e: NativeSpeechResultEvent | null | undefined): string {
  const first = e?.results?.[0]?.transcript;
  return typeof first === 'string' ? first.trim() : '';
}

/** Plain message for a recognizer error, or null when it is not worth showing. */
export function speechErrorMessage(code: string | undefined): string | null {
  if (!code || code === 'no-speech' || code === 'aborted' || code === 'speech-timeout') return null;
  if (code === 'not-allowed') return 'Allow the microphone to use voice typing';
  if (code === 'service-not-allowed' || code === 'language-not-supported') return 'Voice typing is not available on this phone';
  if (code === 'network') return 'Voice typing needs internet. Try again';
  return 'Voice typing stopped';
}
