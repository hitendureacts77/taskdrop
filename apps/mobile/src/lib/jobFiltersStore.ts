import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_FILTERS, FILTERS_KEY, parseSavedFilters, type MapFilters } from './mapFilters';

/**
 * The one set of Find work filters (plan D27, task 1.17) that the map and the list both read, so a filter
 * set on one is already set on the other. Kept on this device; read once per launch.
 */
let current: MapFilters = DEFAULT_FILTERS;
let loaded = false;
// Set once a filter is chosen, so a slow read of the saved filters cannot overwrite it.
let touched = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function load() {
  if (loaded) return;
  loaded = true;
  void AsyncStorage.getItem(FILTERS_KEY)
    .then((v) => {
      if (!v || touched) return;
      current = parseSavedFilters(v);
      emit();
    })
    .catch(() => {});
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const get = () => current;

/** Use these filters now, everywhere, and keep them on this device. */
export function setJobFilters(f: MapFilters) {
  touched = true;
  current = f;
  emit();
  void AsyncStorage.setItem(FILTERS_KEY, JSON.stringify(f)).catch(() => {});
}

/** The filters in use, for the map and the list alike. */
export function useJobFilters(): MapFilters {
  return useSyncExternalStore(subscribe, get, get);
}
