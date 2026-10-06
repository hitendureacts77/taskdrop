import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { reportError } from './errors';

/**
 * Live "something changed" pings on this person's own private channel.
 *
 * A ping carries no data, only what to re-ask for ("a message on task X",
 * "notification Y"); the app then asks the server for it. Nothing about
 * tables or columns is named here, and only the signed-in person can join
 * their own channel (the server checks).
 *
 * One channel per person, shared by every listener: the header, the bell and
 * an open chat all listen at once.
 */
export type Ping = { kind: 'message'; taskId: string; id?: undefined } | { kind: 'notification'; id: string; taskId?: undefined };

type Listener = (ping: Ping) => void;

const listeners = new Set<Listener>();
let channel: RealtimeChannel | null = null;
let channelFor: string | null = null;
let opening: Promise<void> | null = null;

async function open(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id ?? null;
  if (!uid || channelFor === uid) return;
  if (channel) await supabase.removeChannel(channel);
  // Private channels authorise with the signed-in token; supabase-js keeps it fresh.
  await supabase.realtime.setAuth();
  channelFor = uid;
  channel = supabase
    .channel(`user:${uid}`, { config: { private: true } })
    .on('broadcast', { event: 'ping' }, ({ payload }) => {
      const ping = payload as Ping;
      for (const fn of [...listeners]) {
        try {
          fn(ping);
        } catch (e) {
          reportError(e, 'live');
        }
      }
    })
    .subscribe();
}

async function close(): Promise<void> {
  if (!channel) return;
  const c = channel;
  channel = null;
  channelFor = null;
  await supabase.removeChannel(c);
}

function ensureOpen(): void {
  opening = (opening ?? Promise.resolve())
    .then(open)
    .catch((e) => reportError(e, 'live'));
}

// A new sign-in gets its own channel; signing out closes it.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    void close();
  } else if (event === 'SIGNED_IN' && listeners.size > 0) {
    ensureOpen();
  }
});

/** Listen for pings. Returns an unsubscribe function; the channel closes with the last listener. */
export function subscribeLive(fn: Listener): () => void {
  listeners.add(fn);
  ensureOpen();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) void close();
  };
}
