import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { callApi } from './gateway';
import { appVersion, installId, osVersion } from './appInfo';

type NotificationsModule = typeof import('expo-notifications');

// Since SDK 53, merely importing expo-notifications throws inside Expo Go on
// Android (remote push was removed there). Load it lazily and skip it in that
// one environment; the in-app bell still shows every notification.
const inAndroidExpoGo =
  Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let notificationsModule: NotificationsModule | null | undefined;
function loadNotifications(): NotificationsModule | null {
  if (notificationsModule === undefined) {
    notificationsModule = inAndroidExpoGo ? null : (require('expo-notifications') as NotificationsModule);
  }
  return notificationsModule;
}

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
 *    a browser tab and in Expo Go on iOS, where remote push is not available.
 *    Expo Go on Android gets neither; there the in-app bell is the only route.
 *
 * When remote push is registered, the local route stands down, so nothing is
 * shown twice.
 */

let remoteRegistered = false;
let configured = false;

function configure() {
  if (configured || Platform.OS === 'web') return;
  configured = true;
  const Notifications = loadNotifications();
  if (!Notifications) return;
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

/** Whether this device may show alerts: 'ask' means it has not been asked yet. */
export type PushPermission = 'granted' | 'denied' | 'ask' | 'unsupported';

export async function pushPermission(): Promise<PushPermission> {
  if (Platform.OS === 'web') {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission === 'default' ? 'ask' : Notification.permission;
  }
  const Notifications = loadNotifications();
  if (!Notifications) return 'unsupported';
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    return current.canAskAgain ? 'ask' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/**
 * Once signed in: register for remote push if alerts are already allowed.
 * It never asks. The phone's own question comes from askForPush(), after the
 * person taps "Turn on alerts" (plan item 5: asking at sign-in, before they
 * know why, is how most people end up saying no).
 */
export async function setupPush(): Promise<void> {
  if ((await pushPermission()) === 'granted') await register(false);
}

/** Ask the phone's question now, then register. True when alerts are on. */
export async function askForPush(): Promise<boolean> {
  return register(true);
}

async function register(ask: boolean): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      if (typeof Notification === 'undefined') return false;
      if (ask && Notification.permission === 'default') await Notification.requestPermission();
      return Notification.permission === 'granted';
    } catch {
      return false; /* no notifications in this browser */
    }
  }

  const Notifications = loadNotifications();
  if (!Notifications) return false;
  configure();
  let granted = false;
  try {
    const current = await Notifications.getPermissionsAsync();
    granted = current.granted || (ask && (await Notifications.requestPermissionsAsync()).granted);
    if (!granted) return false;

    const id = projectId();
    // Remote push needs a real device and an EAS project. Expo Go on Android
    // has no remote push at all, so this throws there; local still works.
    if (!Device.isDevice || !id) return true;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await callApi('registerPushToken', {
      token,
      platform: Platform.OS,
      installId: await installId(),
      appVersion,
      osVersion: osVersion(),
    });
    remoteRegistered = true;
  } catch {
    /* local notifications still cover the app while it is open */
  }
  return granted;
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
  const Notifications = loadNotifications();
  if (!Notifications) return;
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
  const Notifications = Platform.OS === 'web' ? null : loadNotifications();
  if (!Notifications) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    cb((res.notification.request.content.data ?? {}) as { taskId?: string | null });
  });
  return () => sub.remove();
}
