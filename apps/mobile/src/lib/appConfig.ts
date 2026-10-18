import { AppState } from 'react-native';
import { appPlatform, appVersion } from './appInfo';
import { reportError } from './errors';

/**
 * What the admin panel has switched for this app: maintenance, a newer
 * version required, an announcement banner, and which features are on.
 *
 * Read from the public `app-config` function at start-up, whenever the app
 * comes back to the foreground, every few minutes, and straight away when a
 * server call comes back refused because of a switch. The server enforces
 * every switch itself; this only decides what the screens show. If the answer
 * cannot be fetched, the last good one stays, and at first everything is on --
 * an outage of the switches must not lock people out.
 *
 * Mirrors AppConfig in supabase/functions/_shared/controls.ts.
 */
export type AppConfig = {
  maintenance: { on: boolean; message: string | null };
  update: { required: boolean; minVersion: string | null; url: string | null };
  features: {
    signups: boolean;
    signInPhone: boolean;
    signInGoogle: boolean;
    signInApple: boolean;
    signInPassword: boolean;
    posting: boolean;
    bidding: boolean;
    topups: boolean;
    withdrawals: boolean;
    promotions: boolean;
    chatPhotos: boolean;
  };
  banner: { text: string; level: 'info' | 'warning' | 'critical'; link: string | null } | null;
};

export const OPEN_CONFIG: AppConfig = {
  maintenance: { on: false, message: null },
  update: { required: false, minVersion: null, url: null },
  features: {
    signups: true,
    signInPhone: true,
    signInGoogle: true,
    signInApple: true,
    signInPassword: true,
    posting: true,
    bidding: true,
    topups: true,
    withdrawals: true,
    promotions: true,
    chatPhotos: true,
  },
  banner: null,
};

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** Whatever came back, made safe: anything missing or odd means "on", never "off". */
export function normaliseConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object') return OPEN_CONFIG;
  const r = raw as Record<string, unknown>;
  const obj = (k: string) => (r[k] && typeof r[k] === 'object' ? (r[k] as Record<string, unknown>) : {});
  const m = obj('maintenance');
  const u = obj('update');
  const f = obj('features');
  const feature = (k: keyof AppConfig['features']) => (typeof f[k] === 'boolean' ? (f[k] as boolean) : true);
  const b = r.banner && typeof r.banner === 'object' ? (r.banner as Record<string, unknown>) : null;
  const level = b?.level === 'warning' || b?.level === 'critical' ? b.level : 'info';
  return {
    maintenance: { on: m.on === true, message: text(m.message) },
    update: { required: u.required === true, minVersion: text(u.minVersion), url: text(u.url) },
    features: {
      signups: feature('signups'),
      signInPhone: feature('signInPhone'),
      signInGoogle: feature('signInGoogle'),
      signInApple: feature('signInApple'),
      signInPassword: feature('signInPassword'),
      posting: feature('posting'),
      bidding: feature('bidding'),
      topups: feature('topups'),
      withdrawals: feature('withdrawals'),
      promotions: feature('promotions'),
      chatPhotos: feature('chatPhotos'),
    },
    banner: b && text(b.text) ? { text: text(b.text)!, level, link: text(b.link) } : null,
  };
}

let current: AppConfig = OPEN_CONFIG;
const listeners = new Set<() => void>();

export const getAppConfig = () => current;

export function subscribeAppConfig(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

let inflight: Promise<void> | null = null;

/** Ask again. `fresh` skips the browser's one-minute cache (used after a server refusal). */
export function refreshAppConfig(fresh = false): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const base = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
      if (!base) return;
      const q = new URLSearchParams({ forceFunctionRegion: 'ap-south-1' });
      if (appPlatform) q.set('platform', appPlatform);
      if (appVersion) q.set('version', appVersion);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetch(`${base}/functions/v1/app-config?${q}`, {
          headers: { apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '' },
          cache: fresh ? 'no-store' : 'default',
          signal: ctl.signal,
        });
        if (!res.ok) return;
        const next = normaliseConfig(await res.json());
        if (!sameJson(next, current)) {
          current = next;
          for (const fn of [...listeners]) fn();
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      reportError(e, 'app-config');
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const POLL_MS = 5 * 60_000;

/** Fetch now, then keep it fresh. Returns a stop function. */
export function startAppConfig(): () => void {
  void refreshAppConfig();
  const timer = setInterval(() => void refreshAppConfig(), POLL_MS);
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void refreshAppConfig();
  });
  return () => {
    clearInterval(timer);
    sub.remove();
  };
}
