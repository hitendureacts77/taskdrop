/**
 * Phone notifications, web build. The browser's own Notification API is all
 * a tab can use, so the native modules (expo-notifications, expo-device) are
 * left out of the web bundle entirely. See push.ts for the native side.
 */

/** Ask the browser for permission once signed in. */
export async function setupPush(): Promise<void> {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  } catch {
    /* no notifications in this browser */
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
