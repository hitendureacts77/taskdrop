import { useEffect } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useNav } from '../providers/NavProvider';
import { subscribeToNotifications } from '../data/extras';
import { onNotificationTap, setupPush, showLocal } from '../lib/push';
import { appPlatform, appVersion, installId, osVersion } from '../lib/appInfo';
import { callApi } from '../lib/gateway';

/**
 * Puts TaskDrop's notifications on the phone: a quote arrived, you were
 * picked, the worker started, work was submitted, payment was released, a new
 * message. Renders nothing.
 */
export function PushBridge() {
  const { userId } = useAuth();
  const { go } = useNav();

  useEffect(() => {
    if (!userId) return;
    // Which platform, app version and OS this install runs, and that it was just seen (admin panel > Devices).
    void installId()
      .then((id) => callApi('recordDevice', { installId: id, platform: appPlatform, appVersion, osVersion: osVersion() }))
      .catch(() => {});
    void setupPush();
    return subscribeToNotifications(userId, (n) => void showLocal(n));
  }, [userId]);

  useEffect(() => onNotificationTap(() => go('notifications')), [go]);

  return null;
}
