import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Each "how it works" sheet (City Hunt, Hunt as a finder, Plan a big day) opens
 * by itself the first time a person meets that feature. The memory is per
 * account (or guest) on this device: a reminder, not a record, so it never
 * reaches the server, and a failed read only means the sheet may show once
 * more. Same pattern as lib/safetyCard.ts.
 */

const KEY = (which: string, owner: string) => `taskdrop.explainerSeen.${which}.${owner}`;

/** Whether this person still has to see the sheet. Fails open: if storage cannot be read, show it. */
export async function needsExplainer(which: string, owner: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY(which, owner))) === null;
  } catch {
    return true;
  }
}

export async function markExplainerSeen(which: string, owner: string): Promise<void> {
  await AsyncStorage.setItem(KEY(which, owner), '1').catch(() => {});
}
