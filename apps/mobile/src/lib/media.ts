import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { MEDIA } from '@taskdrop/rules';
import { readBytes } from './readBytes';
import { currentUserId } from './supabase';
import { callApi } from './gateway';

/**
 * Ask the server where a new file goes, then send the bytes there. The server
 * picks the bucket and the path; this side only knows the one-time URL.
 */
async function putFile(purpose: 'task' | 'proof', ext: string, body: ArrayBuffer | Uint8Array | Blob, contentType: string): Promise<string> {
  let target: { path: string; url: string };
  try {
    target = await callApi<{ path: string; url: string }>('createUpload', { purpose, ext });
  } catch (e) {
    throw new MediaError(e instanceof Error ? e.message : 'Could not upload that file. Please try again.');
  }
  let res: Response;
  try {
    res = await fetch(target.url, {
      method: 'PUT',
      headers: { 'content-type': contentType, 'x-upsert': 'false', 'cache-control': 'max-age=3600' },
      body: body as BodyInit,
    });
  } catch {
    throw new MediaError('Could not reach TaskDrop. Check your connection and try again.');
  }
  if (!res.ok) throw new MediaError('Could not upload that file. Please try again.');
  return target.path;
}

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
export async function pickMedia(
  kind: 'image' | 'video',
  source: 'library' | 'camera' = 'library',
): Promise<PickedMedia | null> {
  // The web picker is a plain <input type=file>, which needs no permission and
  // has none to ask for.
  if (Platform.OS !== 'web') {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        throw new MediaError('Camera access was declined. You can pick from your gallery instead.');
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        throw new MediaError('Photo access was declined. You can still post without a photo.');
      }
    }
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: kind === 'video' ? ['videos'] : ['images'],
    quality: 0.8,
    allowsMultipleSelection: false,
    // The camera stops recording at the cap, so a clip can never be too long.
    videoMaxDuration: MEDIA.MAX_VIDEO_SECONDS,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
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


/**
 * Put the file in the bucket and return what the task row should store.
 *
 * The path starts with the uploader's id because the storage policy checks
 * exactly that: the first folder must be auth.uid(), so nobody can write into
 * anyone else's space.
 */
export async function uploadMedia(picked: PickedMedia): Promise<TaskMedia> {
  const userId = await currentUserId();
  if (!userId) throw new MediaError('Sign in before attaching a file.');

  const body = await readBytes(picked.uri);
  if (body.byteLength > MAX_BYTES) {
    throw new MediaError(`That file is too big. The limit is ${MAX_BYTES / 1024 / 1024} MB.`);
  }

  const ext = extensionFor(picked.mimeType, picked.kind === 'video' ? 'mp4' : 'jpg');
  const path = await putFile('task', ext, body, picked.mimeType);

  return { kind: picked.kind, path, seconds: picked.seconds };
}

/** Best effort — a file left behind is untidy, not broken. */
export async function removeMedia(path: string): Promise<void> {
  await callApi('removeMedia', { path }).catch(() => {});
}

/** An hour is long enough to look at a task and short enough not to be shared. */
const SIGNED_URL_SECONDS = 60 * 60;

/**
 * Signed URLs are reused until shortly before they expire. Signing mints a new
 * token each time, and a new token is a new URL -- so without this, every
 * visit to a screen re-downloaded every photo and avatar on it, and they
 * flickered in. The same URL lets the browser and the image cache keep them.
 */
const REUSE_MS = (SIGNED_URL_SECONDS - 10 * 60) * 1000;
const signed = new Map<string, { url: string; at: number }>();
const pending = new Map<string, Promise<string | null>>();

function cached(path: string): string | null {
  const hit = signed.get(path);
  return hit && Date.now() - hit.at < REUSE_MS ? hit.url : null;
}

/** A viewable URL for one stored path, or null if it cannot be signed. */
export async function signedMediaUrl(path: string): Promise<string | null> {
  const hit = cached(path);
  if (hit) return hit;
  const inFlight = pending.get(path);
  if (inFlight) return inFlight;
  const p = (async () => {
    const urls = await callApi<Record<string, string>>('signMedia', { paths: [path] }).catch(() => ({}) as Record<string, string>);
    const url = urls[path];
    if (!url) return null;
    signed.set(path, { url, at: Date.now() });
    return url;
  })().finally(() => pending.delete(path));
  pending.set(path, p);
  return p;
}

/** The URL for a path if it is already signed, for a first paint with no wait. */
export function peekSignedUrl(path: string | null | undefined): string | null {
  return path ? cached(path) : null;
}

/**
 * Signed URLs for many paths in one round trip, keyed by path. Paths signed
 * recently come from the cache; only the rest are asked for.
 *
 * A list of tasks would otherwise make one request per thumbnail, which is the
 * difference between a feed that loads and a feed that crawls.
 */
export async function signedMediaUrls(paths: string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(paths.filter(Boolean))];
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const p of wanted) {
    const hit = cached(p);
    if (hit) out[p] = hit;
    else missing.push(p);
  }
  if (missing.length === 0) return out;

  let urls: Record<string, string>;
  try {
    urls = await callApi<Record<string, string>>('signMedia', { paths: missing });
  } catch {
    return out;
  }
  const now = Date.now();
  for (const [p, url] of Object.entries(urls)) {
    out[p] = url;
    signed.set(p, { url, at: now });
  }
  return out;
}

// ---------------------------------------------------------- proof of work --

/** A file attached as proof of work: a photo, a video or a document. */
export type ProofFile = { path: string; kind: 'image' | 'video' | 'file'; name: string };

/** A picked document, before upload. */
export type PickedDocument = { uri: string; mimeType: string; name: string; bytes: number };

const DOC_TYPES = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

/** Open the document picker (PDF, Word, Excel, PowerPoint, text). Straight off a press. */
export async function pickDocument(): Promise<PickedDocument | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: DOC_TYPES, copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const bytes = a.size ?? 0;
  if (bytes > MAX_BYTES) {
    throw new MediaError(`That file is ${(bytes / 1024 / 1024).toFixed(0)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB.`);
  }
  return { uri: a.uri, mimeType: a.mimeType ?? 'application/octet-stream', name: a.name, bytes };
}

/** Upload a proof file (photo, video or document) into the uploader's folder. */
export async function uploadProofFile(
  picked: { uri: string; mimeType: string; name?: string },
  kind: ProofFile['kind'],
): Promise<ProofFile> {
  const userId = await currentUserId();
  if (!userId) throw new MediaError('Sign in before attaching a file.');
  const body = await readBytes(picked.uri);
  if (body.byteLength > MAX_BYTES) {
    throw new MediaError(`That file is too big. The limit is ${MAX_BYTES / 1024 / 1024} MB.`);
  }
  const fromName = picked.name?.split('.').pop()?.toLowerCase();
  const ext = kind === 'file' ? (fromName && fromName.length <= 5 ? fromName : 'pdf') : extensionFor(picked.mimeType, kind === 'video' ? 'mp4' : 'jpg');
  const path = await putFile('proof', ext, body, picked.mimeType);
  return { path, kind, name: picked.name ?? (kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : 'Document') };
}
