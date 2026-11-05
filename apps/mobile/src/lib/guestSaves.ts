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

/** Which account the phone's guest saves were handed to (the guest's own sign-in from the pop-up, B31). */
const OWNER_KEY = 'taskdrop.guest.saves.owner.v1';

let movedFor: string | null = null;

/** The guest signed in from the pop-up: their saves may move into this account (when Home next opens). */
export async function allowGuestSaves(userId: string): Promise<void> {
  try {
    if ((await listGuestSaves()).length > 0) await AsyncStorage.setItem(OWNER_KEY, userId);
  } catch {
    // Not handed over: the saves stay on the phone and are dropped at the next sign-in.
  }
}

/**
 * Someone signed in without coming from the guest's pop-up: the guest's saves are not theirs, so they go.
 * Saves already handed to this same account (`keepFor`) are kept until Home moves them.
 */
export async function dropGuestSaves(keepFor?: string | null): Promise<void> {
  try {
    const owner = await AsyncStorage.getItem(OWNER_KEY);
    if (keepFor && owner === keepFor) return;
    await AsyncStorage.multiRemove([KEY, OWNER_KEY]);
  } catch {
    // Left on the phone: never moved into an account they were not handed to.
  }
}

/**
 * Once per account on this run of the app: copy the phone's saves into the account, then forget them, but only
 * when they were handed to this account (allowGuestSaves). `save` is the data layer's `setSaved`.
 */
export async function moveGuestSaves(userId: string, save: (taskId: string, saved: boolean) => Promise<void>): Promise<void> {
  if (movedFor === userId) return;
  movedFor = userId;
  try {
    if ((await AsyncStorage.getItem(OWNER_KEY)) !== userId) {
      // Not (yet) handed to this account: the sign-in may still be settling, so Home asks again later.
      movedFor = null;
      return;
    }
    const ids = await listGuestSaves();
    if (ids.length > 0) await Promise.all(ids.map((id) => save(id, true).catch(() => {})));
    await AsyncStorage.multiRemove([KEY, OWNER_KEY]);
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
