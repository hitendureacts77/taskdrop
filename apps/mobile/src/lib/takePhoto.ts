import { pickMedia, type PickedMedia } from './media';

/**
 * A photo taken now with the camera, never from the gallery (a City Hunt find,
 * D19). Native: expo-image-picker's launchCameraAsync, through pickMedia. The
 * web build uses takePhoto.web.ts. Must be called straight off a press.
 */
export function takePhoto(): Promise<PickedMedia | null> {
  return pickMedia('image', 'camera');
}
