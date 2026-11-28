/**
 * The browser's history for the web app's screen stack (board fix "Back, refresh and links"). Used only by
 * providers/NavProvider.tsx (web); the phone apps never load it.
 *
 * Every history entry the app makes carries a key; the key points at the whole screen stack as it was then
 * (kept here, in memory: params hold whole objects, which cannot go in history.state). Browser Back or Forward
 * to a known key puts that stack back exactly. An entry with no known key (made before a reload, or forgotten at
 * sign-out) is rebuilt from its address by the caller.
 *
 * The in-app back button uses the browser's own Back when the entry behind is the stack it wants, so the two
 * always agree. history.back() lands a moment later (popstate); a push or replace asked for in between waits for it.
 */

export type Snapshot<E> = readonly E[];

/** What webHistory needs from `window`: a fake in tests. */
export type HistoryHost = {
  history: { state: unknown; pushState(s: unknown, t: string, url?: string): void; replaceState(s: unknown, t: string, url?: string): void; back(): void };
  location: { pathname: string; search: string; hash: string };
};

type State = { td: string };
const keyOf = (state: unknown): string | null =>
  state && typeof state === 'object' && typeof (state as State).td === 'string' ? (state as State).td : null;

/** Pop result: the stack to show, 'ignore' (the app asked for this Back and already shows it), or 'unknown'. */
export type PopResult<E> = { stack: Snapshot<E> } | 'ignore' | 'unknown';

export class WebHistory<E> {
  private seq = 0;
  private readonly prefix = Math.random().toString(36).slice(2, 8);
  private snaps = new Map<string, Snapshot<E>>();
  private prevOf = new Map<string, string | undefined>();
  private current: string | null = null;
  private waitingFor: string | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: (() => void)[] = [];

  private readonly host: HistoryHost;
  private readonly pathOf: (stack: Snapshot<E>) => string;

  constructor(host: HistoryHost, pathOf: (stack: Snapshot<E>) => string) {
    this.host = host;
    this.pathOf = pathOf;
    this.reloaded = keyOf(host.history.state) !== null;
  }

  private nextKey(): string {
    this.seq += 1;
    return `${this.prefix}-${this.seq}`;
  }

  private later(op: () => void): void {
    if (this.waitingFor) this.queue.push(op);
    else op();
  }

  private flush(): void {
    this.waitingFor = null;
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = null;
    const ops = this.queue;
    this.queue = [];
    ops.forEach((op) => op());
  }

  /**
   * The entry the page opened on. Keeps its query and hash (a sign-in or payment return may still need them), less
   * the old link parameters ?task= and ?page=, whose screen the caller opens on top.
   */
  start(stack: Snapshot<E>): void {
    const key = this.nextKey();
    this.snaps.set(key, stack);
    this.prevOf.set(key, undefined);
    this.current = key;
    const query = new URLSearchParams(this.host.location.search);
    query.delete('task');
    query.delete('page');
    const search = query.toString();
    // A reload keeps the address until its screen opens (the caller replaces this entry, so Back is unchanged).
    const path = this.reloaded ? this.host.location.pathname : this.pathOf(stack);
    this.host.history.replaceState({ td: key } satisfies State, '', path + (search ? `?${search}` : '') + this.host.location.hash);
  }

  /**
   * True when the page opened on an entry this app made before (a reload, or Back/Forward into the site from
   * another page): its screen is then rebuilt in that same entry, never with a new one, so Back keeps its place.
   */
  readonly reloaded: boolean;

  /** A new entry on top: browser Back returns to the current one. */
  push(stack: Snapshot<E>): void {
    this.later(() => {
      const key = this.nextKey();
      this.snaps.set(key, stack);
      this.prevOf.set(key, this.current ?? undefined);
      this.current = key;
      this.host.history.pushState({ td: key } satisfies State, '', this.pathOf(stack));
    });
  }

  /** The current entry now shows this stack (Back skips what it showed before). */
  replace(stack: Snapshot<E>): void {
    this.later(() => {
      const key = this.nextKey();
      this.snaps.set(key, stack);
      this.prevOf.set(key, this.current ? this.prevOf.get(this.current) : undefined);
      this.current = key;
      this.host.history.replaceState({ td: key } satisfies State, '', this.pathOf(stack));
    });
  }

  /** Re-write the current address without a new entry (the mode changed /explore to /find-work). */
  retitle(stack: Snapshot<E>): void {
    this.later(() => {
      const path = this.pathOf(stack);
      if (this.host.location.pathname === path) return;
      if (this.current) this.snaps.set(this.current, stack);
      this.host.history.replaceState(this.host.history.state, '', path);
    });
  }

  /**
   * The in-app back button, with `target` the stack it leads to. When the entry behind is exactly that stack, the
   * browser goes Back (so browser Back and the app's back agree); otherwise the current entry is replaced.
   */
  back(target: Snapshot<E>): void {
    const prev = this.current ? this.prevOf.get(this.current) : undefined;
    const snap = prev ? this.snaps.get(prev) : undefined;
    if (!this.waitingFor && prev && snap && sameStack(snap, target)) {
      this.waitingFor = prev;
      this.current = prev;
      // If the browser never answers (it should at once), carry on rather than hold every later move.
      this.waitTimer = setTimeout(() => this.flush(), 1000);
      this.host.history.back();
      return;
    }
    this.replace(target);
  }

  /** Browser Back or Forward landed on an entry. */
  onPop(state: unknown): PopResult<E> {
    const key = keyOf(state);
    if (this.waitingFor) {
      const asked = key === this.waitingFor;
      this.flush();
      if (asked) return 'ignore';
    }
    const snap = key ? this.snaps.get(key) : undefined;
    if (key && snap) {
      this.current = key;
      return { stack: snap };
    }
    this.current = null;
    return 'unknown';
  }

  /** Signed out: no stack from before may come back through Back; those entries are rebuilt from their address. */
  forget(): void {
    this.later(() => this.forgetNow());
  }

  private forgetNow(): void {
    const keep = this.current ? this.snaps.get(this.current) : undefined;
    this.snaps.clear();
    this.prevOf.clear();
    if (this.current && keep) {
      this.snaps.set(this.current, keep);
      this.prevOf.set(this.current, undefined);
    }
  }
}

/** The same screens, entry for entry (the entries are the same objects when a stack comes back). */
export function sameStack<E>(a: Snapshot<E>, b: Snapshot<E>): boolean {
  return a.length === b.length && a.every((e, i) => e === b[i]);
}
