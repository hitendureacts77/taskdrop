import AsyncStorage from '@react-native-async-storage/async-storage';
import { GUEST_AREA_KEY, parseGuestArea, serializeGuestArea, type GuestArea } from './guestArea';

/** The guest's area on this device. One key, shared by Home, the maps and the post flow. */
export async function readGuestArea(): Promise<GuestArea | null> {
  return parseGuestArea(await AsyncStorage.getItem(GUEST_AREA_KEY).catch(() => null));
}

export async function saveGuestArea(area: GuestArea): Promise<void> {
  await AsyncStorage.setItem(GUEST_AREA_KEY, serializeGuestArea(area)).catch(() => {});
}
