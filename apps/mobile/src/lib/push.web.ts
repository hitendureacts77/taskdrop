/**
 * Phone notifications, web build. The browser's own Notification API is all
 * a tab can use, so the native modules (expo-notifications, expo-device) are
 * left out of the web bundle entirely. See push.ts for the native side.
 */

/** Whether this browser may show alerts: 'ask' means it has not been asked yet. */
export type PushPermission = 'granted' | 'denied' | 'ask' | 'unsupported';

export async function pushPermission(): Promise<PushPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission === 'default' ? 'ask' : Notification.permission;
}

/** Once signed in. A tab has nothing to register, and it never asks here (see push.ts). */
export async function setupPush(): Promise<void> {}

/** Ask the browser now, after the person tapped "Turn on alerts". True when alerts are on. */
export async function askForPush(): Promise<boolean> {
  try {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'default') await Notification.requestPermission();
    return Notification.permission === 'granted';
  } catch {
    return false; /* no notifications in this browser */
  }
}

/** Show a notification row when the tab is in the background. */
export async function showLocal(n: { title: string; body: string | null; id: string; task_id: string | null }) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      new Notification(n.title, { body: n.body ?? undefined, tag: n.id });
    }
  } catch {
    /* ignore */
  }
}

/** Taps on a browser notification just focus the tab; nothing to route. */
export function onNotificationTap(_cb: (data: { taskId?: string | null }) => void): () => void {
  return () => {};
}
