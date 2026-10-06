import AsyncStorage from '@react-native-async-storage/async-storage';
import { isoDay } from '@taskdrop/rules';
import { callApi } from '../lib/gateway';
import { supabase } from '../lib/supabase';

/**
 * The age check (migration 082). Every account answers "When were you born?"
 * once; the server records it and turns away anyone under MIN_SIGNUP_AGE.
 *
 * A pass is remembered on the device per account, so a signed-in launch does
 * not wait on the network to know it may show the app. A turn-away is
 * remembered per device for a while, so the answer cannot be changed by going
 * back and typing an older year.
 */

export type AgeStatus = 'ok' | 'needed';

const OK_KEY = (userId: string) => `taskdrop.ageOk.${userId}`;
const TURNED_AWAY_KEY = 'taskdrop.ageTurnedAway';
const TURNED_AWAY_FOR_MS = 30 * 24 * 60 * 60 * 1000;

const listeners = new Set<(userId: string, status: AgeStatus) => void>();

/** Hear about an account passing the check (AccessScreen records it mid-sign-up). */
export function onAgeStatus(fn: (userId: string, status: AgeStatus) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function rememberOk(userId: string): Promise<void> {
  await AsyncStorage.setItem(OK_KEY(userId), '1').catch(() => {});
  listeners.forEach((fn) => fn(userId, 'ok'));
}

/** Whether this account still has to answer. Throws when the server cannot be asked. */
export async function ageStatus(userId: string): Promise<AgeStatus> {
  if (await AsyncStorage.getItem(OK_KEY(userId)).catch(() => null)) return 'ok';
  if (await callApi<boolean>('ageStatus')) {
    await rememberOk(userId);
    return 'ok';
  }
  return 'needed';
}

/**
 * Record the signed-in person's date of birth. 'blocked' means they are under
 * the minimum: the server has already deleted or suspended the account, and
 * the caller should sign out.
 */
export async function recordBirthDate(birth: Date): Promise<'ok' | 'blocked'> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Sign in first');
  const data = await callApi<string>('recordBirthDate', { birthDate: isoDay(birth) });
  if (data === 'ok') {
    await rememberOk(auth.user.id);
    return 'ok';
  }
  await turnAwayThisDevice();
  return 'blocked';
}

export async function turnAwayThisDevice(): Promise<void> {
  await AsyncStorage.setItem(TURNED_AWAY_KEY, String(Date.now())).catch(() => {});
}

/** True when someone on this device was turned away by the age check recently. */
export async function turnedAwayOnThisDevice(): Promise<boolean> {
  const at = Number(await AsyncStorage.getItem(TURNED_AWAY_KEY).catch(() => null));
  return Number.isFinite(at) && at > 0 && Date.now() - at < TURNED_AWAY_FOR_MS;
}
