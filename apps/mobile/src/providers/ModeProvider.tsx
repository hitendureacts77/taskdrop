import React, { createContext, useContext, useMemo, useState } from 'react';

export type Mode = 'worker' | 'poster';

type ModeCtx = { mode: Mode; setMode: (m: Mode) => void; toggle: () => void };

const Ctx = createContext<ModeCtx | null>(null);

export function ModeProvider({
  children,
  initial = 'worker',
}: {
  children: React.ReactNode;
  initial?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initial);
  const value = useMemo<ModeCtx>(
    () => ({ mode, setMode, toggle: () => setMode(mode === 'worker' ? 'poster' : 'worker') }),
    [mode],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMode() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useMode must be used inside ModeProvider');
  return c;
}
