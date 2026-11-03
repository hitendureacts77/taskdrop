import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "Staying safe on a job" is shown once, before a person's first in-person job
 * (plan task 4.9). The memory is per account on this device: it is a reminder,
 * not a record, so it never reaches the server, and a failed read only means
 * the card may show once more.
 */

const KEY = (userId: string) => `taskdrop.safetyCardSeen.${userId}`;

/** Whether this account still has to see the card. Fails open: if storage cannot be read, show it. */
export async function needsSafetyCard(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY(userId))) === null;
  } catch {
    return true;
  }
}

export async function markSafetyCardSeen(userId: string): Promise<void> {
  await AsyncStorage.setItem(KEY(userId), '1').catch(() => {});
}
