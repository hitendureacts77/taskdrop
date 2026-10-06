import { Platform } from 'react-native';
import { reportError } from './errors';

/**
 * Catches what an error boundary cannot: a throw inside an event handler, a
 * timer, or a promise nobody awaited. Left alone, a fatal one of those closes
 * the app on a phone, and on the web leaves a raw error in the console for
 * anyone to read.
 *
 * Call once, before the app registers. A crash in native code (Java/Obj-C) is
 * outside JavaScript's reach and cannot be handled here.
 */
export function installGlobalErrorHandlers(): void {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    window.addEventListener('unhandledrejection', (ev) => {
      reportError(ev.reason, 'unhandledrejection');
      ev.preventDefault();
    });
    window.addEventListener('error', (ev) => {
      reportError(ev.error ?? ev.message, 'window.error');
    });
    return;
  }

  type Handler = (error: unknown, isFatal?: boolean) => void;
  const utils = (globalThis as { ErrorUtils?: { setGlobalHandler?: (h: Handler) => void; getGlobalHandler?: () => Handler } })
    .ErrorUtils;
  if (!utils?.setGlobalHandler) return;

  const previous = utils.getGlobalHandler?.();
  utils.setGlobalHandler((error, isFatal) => {
    reportError(error, isFatal ? 'fatal' : 'js');
    // Development keeps React Native's red box so the bug is seen and fixed.
    // A release build carries on instead of closing on the customer.
    if (__DEV__) previous?.(error, isFatal);
  });
}
