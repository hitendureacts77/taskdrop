import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { pickNativeSpeech, speechErrorMessage, transcriptOf, type NativeSpeech } from './speechNative';

/**
 * Voice typing for the composer's mic button.
 *
 * On the web this is the browser's own SpeechRecognition (Chrome, Edge,
 * Safari). On Android and iOS it is the phone's own recognizer (Google on
 * Android) through the `expo-speech-recognition` native module. An installed
 * app built before that module was added, and Expo Go, do not have it: there
 * `supported` is false and the mic is simply not drawn -- a button that does
 * nothing is worse than no button.
 *
 * `onText(text, partial)`: with `{ interim: true }` the words arrive while the
 * person speaks (`partial` true), each call replacing the one before, and end
 * with one call where `partial` is false. Without it only the final words
 * arrive.
 */

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Looked up once. `requireOptionalNativeModule` returns null (never throws)
// when this build has no such native module; the try/catch in
// pickNativeSpeech covers anything else going wrong on an older build.
let nativeSpeech: NativeSpeech | null | undefined;
function getNativeSpeech(): NativeSpeech | null {
  if (Platform.OS === 'web') return null;
  if (nativeSpeech === undefined) {
    nativeSpeech = pickNativeSpeech(() => requireOptionalNativeModule('ExpoSpeechRecognition'));
  }
  return nativeSpeech;
}

// Indian English understands the mix of English and Hindi words people
// actually use when describing a job.
const LANG = 'en-IN';

export function useVoiceInput(
  onText: (text: string, partial: boolean) => void,
  onError?: (msg: string) => void,
  options?: { interim?: boolean },
) {
  const native = getNativeSpeech();
  const supported = native !== null || recognitionCtor() !== null;
  const interim = options?.interim === true;
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const subs = useRef<{ remove: () => void }[]>([]);
  const lastPartial = useRef<string | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  const errCb = useRef(onError);
  errCb.current = onError;

  const clearSubs = () => {
    for (const s of subs.current) s.remove();
    subs.current = [];
  };

  useEffect(
    () => () => {
      rec.current?.stop();
      if (subs.current.length) {
        clearSubs();
        try {
          getNativeSpeech()?.abort?.();
        } catch {
          // Nothing to stop.
        }
      }
    },
    [],
  );

  const startNative = useCallback(
    async (m: NativeSpeech) => {
      let granted = false;
      try {
        granted = (await m.requestPermissionsAsync()).granted;
      } catch {
        granted = false;
      }
      if (!granted) {
        errCb.current?.('Allow the microphone in your phone settings to use voice typing');
        return;
      }
      clearSubs();
      lastPartial.current = null;
      const finish = () => {
        // A session that ends on words still marked partial closes them, so
        // the caller always gets its final call.
        if (lastPartial.current !== null) cb.current(lastPartial.current, false);
        lastPartial.current = null;
        clearSubs();
        setListening(false);
      };
      subs.current = [
        m.addListener('result', ((e: Parameters<typeof transcriptOf>[0]) => {
          const text = transcriptOf(e);
          if (!text) return;
          if (e?.isFinal) {
            lastPartial.current = null;
            cb.current(text, false);
          } else if (interim) {
            lastPartial.current = text;
            cb.current(text, true);
          }
        }) as (e: never) => void),
        m.addListener('error', ((e: { error?: string }) => {
          const msg = speechErrorMessage(e?.error);
          if (msg) errCb.current?.(msg);
        }) as (e: never) => void),
        m.addListener('end', finish as (e: never) => void),
      ];
      try {
        m.start({ lang: LANG, interimResults: interim, continuous: false, addsPunctuation: true });
        setListening(true);
      } catch {
        clearSubs();
        setListening(false);
        errCb.current?.('Voice typing is not available on this phone');
      }
    },
    [interim],
  );

  const toggle = useCallback(() => {
    const m = getNativeSpeech();
    if (m) {
      if (listening) {
        try {
          m.stop();
        } catch {
          setListening(false);
        }
        return;
      }
      void startNative(m);
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = LANG;
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const alt = e.results[i]?.[0];
        if (alt) parts.push(alt.transcript);
      }
      const text = parts.join(' ').trim();
      if (text) cb.current(text, false);
    };
    r.onerror = (e) => {
      if (e.error && e.error !== 'no-speech' && e.error !== 'aborted') {
        errCb.current?.(e.error === 'not-allowed' ? 'Allow the microphone to use voice typing' : 'Voice typing stopped');
      }
    };
    r.onend = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening, startNative]);

  return { supported, listening, toggle };
}
