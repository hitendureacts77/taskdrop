import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

/**
 * Phone notifications.
 *
 * Two routes, so a notification arrives whichever way the app is running:
 *
 *  - Remote push. An installed build with an EAS project id registers an Expo
 *    push token; the database sends every new notification row to it
 *    (migration 051), so it arrives even with the app closed.
 *  - Local. While the app is open, the realtime feed of notification rows is
 *    shown as a system notification by the app itself. This is what works in
 *    Expo Go and in a browser tab, where remote push is not available.
 *
 * When remote push is registered, the local route stands down, so nothing is
 * shown twice.
 */

let remoteRegistered = false;
let configured = false;

function configure() {
  if (configured || Platform.OS === 'web') return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('default', {
      name: 'Task updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#0E8F72',
    }).catch(() => {});
  }
}

function projectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return fromExtra ?? Constants.easConfig?.projectId ?? null;
}

/** Ask for permission once signed in, and register for remote push when possible. */
export async function setupPush(): Promise<void> {
  if (Platform.OS === 'web') {
    // Browsers only allow the prompt after a user gesture on some platforms;
    // asking here is harmless where it is not allowed.
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch {
      /* no notifications in this browser */
    }
    return;
  }

  configure();
  try {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;

    const id = projectId();
    // Remote push needs a real device and an EAS project. Expo Go on Android
    // has no remote push at all, so this throws there; local still works.
    if (!Device.isDevice || !id) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    const { error } = await supabase.rpc('register_push_token' as never, {
      p_token: token,
      p_platform: Platform.OS,
    } as never);
    if (!error) remoteRegistered = true;
  } catch {
    /* local notifications still cover the app while it is open */
  }
}

/** Show one notification row on the device, unless remote push already will. */
export async function showLocal(n: { title: string; body: string | null; id: string; task_id: string | null }) {
  if (remoteRegistered) return;
  if (Platform.OS === 'web') {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        new Notification(n.title, { body: n.body ?? undefined, tag: n.id });
      }
    } catch {
      /* ignore */
    }
    return;
  }
  configure();
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: n.title,
        body: n.body ?? '',
        sound: 'default',
        data: { notificationId: n.id, taskId: n.task_id },
      },
      trigger: null,
    });
  } catch {
    /* permission denied: the in-app bell still has it */
  }
}

/** Call back when the person taps a notification. Returns an unsubscribe. */
export function onNotificationTap(cb: (data: { taskId?: string | null }) => void): () => void {
  if (Platform.OS === 'web') return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    cb((res.notification.request.content.data ?? {}) as { taskId?: string | null });
  });
  return () => sub.remove();
}
