import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Mode = 'worker' | 'poster';

type ModeCtx = { mode: Mode; setMode: (m: Mode) => void; toggle: () => void };

const Ctx = createContext<ModeCtx | null>(null);

/** Where the last chosen mode is kept, so Hire / Earn survives closing the app. */
const STORAGE_KEY = 'taskdrop.mode';

export function ModeProvider({
  children,
  initial = 'worker',
}: {
  children: React.ReactNode;
  initial?: Mode;
}) {
  const [mode, setModeState] = useState<Mode>(initial);
  // Set once the person picks a mode this session, so a slow read of the saved
  // value can never override a choice they have just made.
  const chosen = useRef(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (alive && !chosen.current && (saved === 'worker' || saved === 'poster')) setModeState(saved);
      })
      .catch(() => {
        /* nothing saved, or storage unavailable: keep the default */
      });
    return () => {
      alive = false;
    };
  }, []);

  const setMode = useCallback((m: Mode) => {
    chosen.current = true;
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {
      /* the choice still applies for this session */
    });
  }, []);

  const value = useMemo<ModeCtx>(
    () => ({ mode, setMode, toggle: () => setMode(mode === 'worker' ? 'poster' : 'worker') }),
    [mode, setMode],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMode() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useMode must be used inside ModeProvider');
  return c;
}
