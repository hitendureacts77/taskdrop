import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether this device has shown "How TaskDrop works" to one person. `key` comes from walkSeenKey (lib/walkthrough.ts):
 * one per account and one for the guest, so a new account on a phone that has seen it before still gets it once.
 * Reinstalling clears it, so a new install shows it again.
 */
export async function loadIntroSeen(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === '1';
  } catch {
    // Unreadable: treat as seen, so a broken store can never trap anyone on the intro.
    return true;
  }
}

export async function saveIntroSeen(key: string | null): Promise<void> {
  if (!key) return;
  try {
    await AsyncStorage.setItem(key, '1');
  } catch {
    // Not remembered: the intro shows once more next start, which is harmless.
  }
}
