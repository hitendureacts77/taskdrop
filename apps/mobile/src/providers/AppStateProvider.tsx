import React, {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';

/**
 * Global app state shared across screens — mirrors the design's single-component
 * model (balance/escrow, task progress, sent bids) plus the toast + confetti
 * feedback system. Money is in minor units (paise) to match @taskdrop/rules and
 * formatINR.
 */

export type OrderRow = {
  role: 'worker' | 'poster';
  bucket: number;
  state: string;
  title: string;
  price: string;
  meta: string;
  tone?: 'accent' | 'gold' | 'signal' | 'blue' | 'violet' | 'neutral';
};

export type TaskCtx = {
  title: string;
  price: string;
  escrow?: string;
  who?: string;
  payMeta?: string;
};

type AppState = {
  balance: number; // paise
  escrow: number;
  clearing: number;
  doneMap: Record<string, number>; // title -> 0|1|2
  startMap: Record<string, boolean>;
  startedAt: Record<string, number>;
  myBids: OrderRow[];
  openTask: TaskCtx | null;
  toast: string | null;
  burst: boolean;
};

type AppStateCtx = AppState & {
  flash: (msg: string) => void;
  celebrate: (msg?: string) => void;
  roll: (key: 'balance' | 'escrow' | 'clearing', target: number) => void;
  setOpenTask: (t: TaskCtx | null) => void;
  startTask: (title: string) => void;
  setDone: (title: string, level: number) => void;
  addBid: (row: OrderRow) => void;
  doneOf: (title: string) => number;
  startedOf: (title: string) => boolean;
};

const Ctx = createContext<AppStateCtx | null>(null);

const INITIAL: AppState = {
  balance: 820000, // ₹8,200
  escrow: 463500, // ₹4,635
  clearing: 360000, // ₹3,600
  doneMap: { 'Photograph a flat before I rent it': 1 },
  startMap: { 'Assemble a wardrobe': true },
  startedAt: { 'Assemble a wardrobe': Date.now() - 9678000 },
  myBids: [],
  openTask: null,
  toast: null,
  burst: false,
};

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<AppState>(INITIAL);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const flash = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setS((p) => ({ ...p, toast: msg }));
    toastTimer.current = setTimeout(() => setS((p) => ({ ...p, toast: null })), 2200);
  }, []);

  const celebrate = useCallback(
    (msg?: string) => {
      if (burstTimer.current) clearTimeout(burstTimer.current);
      setS((p) => ({ ...p, burst: true }));
      burstTimer.current = setTimeout(() => {
        setS((p) => ({ ...p, burst: false }));
        if (msg) flash(msg);
      }, 900);
    },
    [flash],
  );

  const roll = useCallback((key: 'balance' | 'escrow' | 'clearing', target: number) => {
    if (rollTimers.current[key]) clearInterval(rollTimers.current[key]);
    const steps = 24;
    let i = 0;
    setS((p) => {
      const from = p[key];
      rollTimers.current[key] = setInterval(() => {
        i += 1;
        const t = i / steps;
        const eased = 1 - Math.pow(1 - t, 3);
        const val = Math.round(from + (target - from) * eased);
        setS((q) => ({ ...q, [key]: i >= steps ? target : val }));
        if (i >= steps) clearInterval(rollTimers.current[key]!);
      }, 22);
      return p;
    });
  }, []);

  const setOpenTask = useCallback((t: TaskCtx | null) => setS((p) => ({ ...p, openTask: t })), []);
  const startTask = useCallback(
    (title: string) =>
      setS((p) => ({
        ...p,
        startMap: { ...p.startMap, [title]: true },
        startedAt: { ...p.startedAt, [title]: Date.now() },
        doneMap: { ...p.doneMap, [title]: 0 },
      })),
    [],
  );
  const setDone = useCallback(
    (title: string, level: number) =>
      setS((p) => ({ ...p, doneMap: { ...p.doneMap, [title]: level } })),
    [],
  );
  const addBid = useCallback((row: OrderRow) => setS((p) => ({ ...p, myBids: [...p.myBids, row] })), []);
  const doneOf = useCallback((title: string) => s.doneMap[title] ?? 0, [s.doneMap]);
  const startedOf = useCallback((title: string) => !!s.startMap[title], [s.startMap]);

  const value = useMemo<AppStateCtx>(
    () => ({
      ...s,
      flash,
      celebrate,
      roll,
      setOpenTask,
      startTask,
      setDone,
      addBid,
      doneOf,
      startedOf,
    }),
    [s, flash, celebrate, roll, setOpenTask, startTask, setDone, addBid, doneOf, startedOf],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp must be used inside AppStateProvider');
  return c;
}
