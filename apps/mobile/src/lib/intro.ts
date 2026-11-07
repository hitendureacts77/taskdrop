import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether this device has shown the intro (the walkthrough a new install opens
 * on, before sign-in). Written when the person leaves it either way: makes an
 * account or skips. Reinstalling clears it, so a new install shows it again.
 */
const KEY = 'taskdrop.intro.v1';

export async function loadIntroSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    // Unreadable: treat as seen, so a broken store can never trap anyone on the intro.
    return true;
  }
}

export async function saveIntroSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // Not remembered: the intro shows once more next start, which is harmless.
  }
}
