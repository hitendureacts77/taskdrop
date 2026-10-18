import { useSyncExternalStore } from 'react';
import type { NavParams } from '../providers/navTypes';
import type { NativeTab } from './nativeTabs';

/**
 * Screens are passed whole objects (a task row, a quote...), which cannot go
 * in a URL. A screen opened with go('taskDetail', { row }) keeps its params
 * here under a short key, and the route carries only the key.
 */
const EMPTY: NavParams = {};
const pushed = new Map<string, NavParams>();
let counter = 0;

/** Remember a pushed screen's params; returns the key for its route, or undefined when there are none. */
export function putParams(params: NavParams): string | undefined {
  if (Object.keys(params).length === 0) return undefined;
  counter += 1;
  const key = String(counter);
  pushed.set(key, params);
  return key;
}

export function getParams(key: string | undefined): NavParams {
  return (key && pushed.get(key)) || EMPTY;
}

/** A tab has no route of its own per visit, so it keeps the params it was last sent. */
const tabParams = new Map<NativeTab, NavParams>();
const listeners = new Set<() => void>();

export function setTabParams(tab: NativeTab, params: NavParams): void {
  tabParams.set(tab, Object.keys(params).length === 0 ? EMPTY : params);
  listeners.forEach((l) => l());
}

export function useTabParams(tab: NativeTab): NavParams {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => tabParams.get(tab) ?? EMPTY,
  );
}

/** Signed out or another person signed in: nothing from before carries over. */
export function clearParams(): void {
  pushed.clear();
  tabParams.clear();
  listeners.forEach((l) => l());
}
