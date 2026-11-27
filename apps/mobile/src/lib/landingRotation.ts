/**
 * The desktop sign-in landing shows two pieces of art (the ripple map and the real app) and swaps them every
 * ROTATE_MS. This is the timing, with no React in it so it can be tested: `select` (a dot click) restarts the
 * wait, `pause` / `resume` stop and restart it while the browser tab is hidden.
 */
export const ROTATE_MS = 20000;

export function nextIndex(i: number, count: number): number {
  return count <= 0 ? 0 : (i + 1) % count;
}

export type RotatorTimers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
};

export function createRotator(opts: {
  count: number;
  ms?: number;
  onChange: (index: number) => void;
  timers?: RotatorTimers;
}) {
  const ms = opts.ms ?? ROTATE_MS;
  const timers: RotatorTimers = opts.timers ?? {
    set: (fn, d) => setTimeout(fn, d),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  let index = 0;
  let id: unknown = null;
  let running = false;

  const arm = () => {
    if (id !== null) timers.clear(id);
    id = timers.set(() => {
      index = nextIndex(index, opts.count);
      opts.onChange(index);
      arm();
    }, ms);
  };
  const pause = () => {
    running = false;
    if (id !== null) timers.clear(id);
    id = null;
  };

  return {
    start() {
      running = true;
      arm();
    },
    pause,
    resume() {
      if (running) return;
      running = true;
      arm();
    },
    /** A dot was clicked: show that one and wait the full time again. */
    select(i: number) {
      index = i;
      opts.onChange(i);
      if (running) arm();
    },
    stop: pause,
    get index() {
      return index;
    },
  };
}
