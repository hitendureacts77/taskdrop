import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A guest's saved tasks (design D15, decision 24): kept on the phone as a list of task ids,
 * then moved into the account with `setSaved` when it is made. Every read and write is
 * best-effort: if storage is unavailable, saving simply does not stick.
 */

const KEY = 'taskdrop.guest.saves.v1';

export async function listGuestSaves(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const rows: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? rows.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function setGuestSaved(taskId: string, saved: boolean): Promise<void> {
  try {
    const rest = (await listGuestSaves()).filter((x) => x !== taskId);
    await AsyncStorage.setItem(KEY, JSON.stringify(saved ? [taskId, ...rest] : rest));
  } catch {
    // Not kept on this phone; the screen still shows the change until it is left.
  }
}

let movedFor: string | null = null;

/**
 * Once per new account on this run of the app: copy the phone's saves into the account, then forget them.
 * `save` is the data layer's `setSaved`.
 */
export async function moveGuestSaves(userId: string, save: (taskId: string, saved: boolean) => Promise<void>): Promise<void> {
  if (movedFor === userId) return;
  movedFor = userId;
  try {
    const ids = await listGuestSaves();
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => save(id, true).catch(() => {})));
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Left on the phone; tried again next time the app opens.
    movedFor = null;
  }
}

/** The tasks behind a guest's saved ids, newest save first. A task that is gone is skipped. */
export async function loadGuestSavedTasks<T>(fetchTask: (id: string) => Promise<T | null>): Promise<T[]> {
  const ids = await listGuestSaves();
  const rows: (T | null)[] = await Promise.all(ids.map((id): Promise<T | null> => fetchTask(id).catch(() => null)));
  return rows.filter((r): r is T => r !== null);
}
