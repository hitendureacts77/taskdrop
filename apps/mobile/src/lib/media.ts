import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { MEDIA } from '@taskdrop/rules';
import { supabase } from './supabase';

/**
 * Attaching a photo or a video to a task.
 *
 * The bucket is private, so nothing here ever hands out a permanent URL. An
 * upload returns a storage *path*, which is what the task row stores, and
 * anything that wants to show the file asks for a short-lived signed URL at
 * the moment it renders. That is the whole reason a stranger cannot walk the
 * bucket and collect photographs of people's front doors.
 *
 * Reading the picked file's bytes is the one genuinely platform-split part:
 * expo-file-system does not exist on web, and React Native's fetch does not
 * reliably read a file:// URI. So each platform uses the thing that works.
 */

const BUCKET = 'task-media';

/** Matches the bucket's own limit, so a reject happens before the upload. */
const MAX_BYTES = 50 * 1024 * 1024;

export type TaskMedia = {
  kind: 'image' | 'video';
  /** Path within the bucket. Never a URL — those are signed on demand. */
  path: string;
  /** Videos only, and always <= MEDIA.MAX_VIDEO_SECONDS. */
  seconds?: number;
};

/** A picked file, before it has been uploaded anywhere. */
export type PickedMedia = {
  kind: 'image' | 'video';
  /** Local URI, for showing a preview while the upload runs. */
  uri: string;
  mimeType: string;
  seconds?: number;
  bytes: number;
};

export class MediaError extends Error {}

function extensionFor(mimeType: string, fallback: string): string {
  const known: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
  };
  return known[mimeType] ?? fallback;
}

/**
 * Open the device's picker.
 *
 * Must be called straight off a press: on web the browser refuses a file
 * dialog that is not tied to a user gesture, and there is no error to catch
 * when it does — the dialog simply never appears.
 */
export async function pickMedia(kind: 'image' | 'video'): Promise<PickedMedia | null> {
  // The web picker is a plain <input type=file>, which needs no permission and
  // has none to ask for.
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      throw new MediaError('Photo access was declined. You can still post without a photo.');
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: kind === 'video' ? ['videos'] : ['images'],
    quality: 0.8,
    allowsMultipleSelection: false,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0]!;
  const mimeType = asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg');
  const bytes = asset.fileSize ?? 0;

  if (bytes > MAX_BYTES) {
    throw new MediaError(
      `That file is ${(bytes / 1024 / 1024).toFixed(0)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB.`,
    );
  }

  let seconds: number | undefined;
  if (kind === 'video') {
    // duration is milliseconds, and is null when the platform cannot tell.
    seconds = asset.duration != null ? Math.round(asset.duration / 1000) : undefined;
    if (seconds != null && seconds > MEDIA.MAX_VIDEO_SECONDS) {
      throw new MediaError(
        `That video is ${seconds}s. Keep it to ${MEDIA.MAX_VIDEO_SECONDS}s or under.`,
      );
    }
    // A video row without a duration fails validation later, so rather than
    // letting the post break at submit, treat an unknown length as the cap.
    if (seconds == null) seconds = MEDIA.MAX_VIDEO_SECONDS;
  }

  return { kind, uri: asset.uri, mimeType, seconds, bytes };
}

/** The picked file's raw bytes, by whichever route this platform supports. */
async function readBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    // Here the picker hands back a blob: or data: URI, which fetch reads fine.
    const res = await fetch(uri);
    return new Uint8Array(await res.arrayBuffer());
  }
  // expo-file-system is native-only, which is why this is not the web path.
  const { File } = await import('expo-file-system');
  return await new File(uri).bytes();
}

/**
 * Put the file in the bucket and return what the task row should store.
 *
 * The path starts with the uploader's id because the storage policy checks
 * exactly that: the first folder must be auth.uid(), so nobody can write into
 * anyone else's space.
 */
export async function uploadMedia(picked: PickedMedia): Promise<TaskMedia> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new MediaError('Sign in before attaching a file.');

  const body = await readBytes(picked.uri);
  if (body.byteLength > MAX_BYTES) {
    throw new MediaError(`That file is too big. The limit is ${MAX_BYTES / 1024 / 1024} MB.`);
  }

  const ext = extensionFor(picked.mimeType, picked.kind === 'video' ? 'mp4' : 'jpg');
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType: picked.mimeType, upsert: false });
  if (error) throw new MediaError(error.message);

  return { kind: picked.kind, path, seconds: picked.seconds };
}

/** Best effort — a file left behind is untidy, not broken. */
export async function removeMedia(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}

/** An hour is long enough to look at a task and short enough not to be shared. */
const SIGNED_URL_SECONDS = 60 * 60;

/** A viewable URL for one stored path, or null if it cannot be signed. */
export async function signedMediaUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Signed URLs for many paths in one round trip, keyed by path.
 *
 * A list of tasks would otherwise make one request per thumbnail, which is the
 * difference between a feed that loads and a feed that crawls.
 */
export async function signedMediaUrls(paths: string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(paths.filter(Boolean))];
  if (wanted.length === 0) return {};

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(wanted, SIGNED_URL_SECONDS);
  if (error || !data) return {};

  const out: Record<string, string> = {};
  for (const row of data) {
    if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  }
  return out;
}
