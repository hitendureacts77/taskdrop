import { useEffect } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useNav } from '../providers/NavProvider';
import { subscribeToNotifications } from '../data/extras';
import { onNotificationTap, setupPush, showLocal } from '../lib/push';

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
    void setupPush();
    return subscribeToNotifications(userId, (n) => void showLocal(n));
  }, [userId]);

  useEffect(() => onNotificationTap(() => go('notifications')), [go]);

  return null;
}
