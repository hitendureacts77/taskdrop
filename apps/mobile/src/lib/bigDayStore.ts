import AsyncStorage from '@react-native-async-storage/async-storage';
import { GUEST_DRAFTS_OWNER } from './guest';
import { parsePlans, withPlan, withPosted, withoutPlan, withoutPosted, type BigDayPlan } from './bigDays';

/**
 * Saved big-day plans, kept on this device for this account like drafts (lib/drafts.ts): up to three,
 * a guest's under GUEST_DRAFTS_OWNER until there is an account, and all of them cleared at sign-out.
 * The rules (limit, order, what counts as valid) are in lib/bigDays.ts.
 */
const KEY = (userId: string) => `taskdrop.bigDays.v1.${userId}`;

export async function listBigDays(userId: string): Promise<BigDayPlan[]> {
  try {
    return parsePlans(await AsyncStorage.getItem(KEY(userId)));
  } catch {
    return [];
  }
}

async function write(userId: string, plans: BigDayPlan[]) {
  try {
    await AsyncStorage.setItem(KEY(userId), JSON.stringify(plans));
  } catch {
    // A plan that cannot be kept is not worth an error here; the screen still shows it until it closes.
  }
}

/** Saves a plan (a new one, or an edited one with the same id). Returns the list as kept. */
export async function saveBigDay(userId: string, plan: BigDayPlan): Promise<BigDayPlan[]> {
  const next = withPlan(await listBigDays(userId), plan);
  await write(userId, next);
  return next;
}

export async function removeBigDay(userId: string, planId: string): Promise<BigDayPlan[]> {
  const next = withoutPlan(await listBigDays(userId), planId);
  await write(userId, next);
  return next;
}

/** The writer finished posting a line: remember which task it became. Best-effort. */
export async function markBigDayPosted(userId: string, planId: string, itemId: string, taskId: string): Promise<void> {
  await write(userId, withPosted(await listBigDays(userId), planId, itemId, taskId));
}

/** A line whose task was cancelled goes back to "Not posted". */
export async function releaseBigDayItem(userId: string, planId: string, itemId: string): Promise<void> {
  await write(userId, withoutPosted(await listBigDays(userId), planId, itemId));
}

/** Forget every plan kept for this owner (an account id, or GUEST_DRAFTS_OWNER): sign-out. */
export async function clearBigDays(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY(userId));
  } catch {
    // Left behind: still shown only to that same owner.
  }
}

/** A guest's plans move into the account once there is one, as their drafts do (AuthProvider). */
export async function moveGuestBigDays(userId: string): Promise<void> {
  if (userId === GUEST_DRAFTS_OWNER) return;
  const theirs = await listBigDays(GUEST_DRAFTS_OWNER);
  if (theirs.length === 0) return;
  let mine = await listBigDays(userId);
  for (const p of theirs) mine = withPlan(mine, p);
  await write(userId, mine);
  await clearBigDays(GUEST_DRAFTS_OWNER);
}
