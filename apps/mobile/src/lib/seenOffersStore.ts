import AsyncStorage from '@react-native-async-storage/async-storage';
import { markSeen, type SeenOffers } from './seenOffers';

/**
 * Where lib/seenOffers keeps its record: on this device, one record per account, so a second account signed in
 * here never inherits the first one's "seen". Every failure reads as "no record", never as an error on screen.
 */
const key = (userId: string) => `td.seenOffers.v1.${userId}`;

export async function loadSeenOffers(userId: string): Promise<SeenOffers | null> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: SeenOffers = {};
    for (const [id, n] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[id] = n;
    }
    return out;
  } catch {
    return null;
  }
}

export async function saveSeenOffers(userId: string, seen: SeenOffers): Promise<void> {
  await AsyncStorage.setItem(key(userId), JSON.stringify(seen)).catch(() => {});
}

/** The task's offers were just opened with `count` of them. */
export async function noteOffersSeen(userId: string, taskId: string, count: number): Promise<void> {
  const seen = await loadSeenOffers(userId);
  await saveSeenOffers(userId, markSeen(seen, taskId, count));
}
