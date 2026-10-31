import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { MEDIA } from '@taskdrop/rules';
import { readBytes } from './readBytes';
import { currentUserId } from './supabase';
import { callApi } from './gateway';

/** What a file is for. The server records it and checks it again before the file is attached to anything. */
export type UploadPurpose = 'task' | 'proof' | 'avatar' | 'chat';

/** Pictures go to ImageKit: the server hands over a signed, one-time upload token. */
type ImageKitTarget = {
  provider: 'imagekit';
  id: string;
  upload: {
    url: string;
    publicKey: string;
    token: string;
    expire: number;
    signature: string;
    folder: string;
    fileName: string;
    mime: string;
    maxBytes: number;
  };
};
/** Everything else (and pictures, when ImageKit is not set up) goes to Supabase Storage with a one-time URL. */
type StorageTarget = { path: string; url: string };

const isImageKit = (t: ImageKitTarget | StorageTarget): t is ImageKitTarget => (t as ImageKitTarget).provider === 'imagekit';

/** The picture types the server accepts, from whatever the device reports. Null when it is something else. */
function imageMimeFor(mimeType: string): string | null {
  const m = mimeType.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'image/jpeg';
  if (m === 'image/png' || m === 'image/webp' || m === 'image/heic' || m === 'image/heif') return m;
  return null;
}

/**
 * Ask the server where a new file goes, then send it there, and return what
 * to store on the record: "media:<id>" for a picture in ImageKit, a storage
 * path for anything else. The server picks the folder, the name and the
 * provider; this side only knows a one-time token or URL.
 */
async function storeFile(
  purpose: UploadPurpose,
  kind: 'image' | 'video' | 'file',
  picked: { uri: string; mimeType: string },
  ext: string,
): Promise<string> {
  const imageMime = kind === 'image' ? imageMimeFor(picked.mimeType) : null;
  let target: ImageKitTarget | StorageTarget;
  try {
    target = await callApi<ImageKitTarget | StorageTarget>('createUpload', {
      purpose,
      ext,
      // A picture of a type the server does not take for ImageKit is sent as before.
      ...(imageMime ? { kind: 'image', mime: imageMime } : kind === 'image' ? {} : { kind }),
    });
  } catch (e) {
    throw new MediaError(e instanceof Error ? e.message : 'Could not upload that file. Please try again.');
  }

  if (isImageKit(target)) return putToImageKit(target, picked);

  const body = await readBytes(picked.uri);
  if (body.byteLength > MAX_BYTES) {
    throw new MediaError(`That file is too big. The limit is ${MAX_BYTES / 1024 / 1024} MB.`);
  }
  return putToStorage(target, body, picked.mimeType);
}

async function putToStorage(target: StorageTarget, body: ArrayBuffer | Uint8Array | Blob, contentType: string): Promise<string> {
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
 * Upload a picture straight to ImageKit, then tell the server it is there so it
 * can check with ImageKit and mark it usable. Returns the "media:<id>" reference.
 */
async function putToImageKit(target: ImageKitTarget, picked: { uri: string; mimeType: string }): Promise<string> {
  const u = target.upload;
  const form = new FormData();
  const bytes = await readBytes(picked.uri);
  if (bytes.byteLength > u.maxBytes) {
    throw new MediaError(`That photo is too big. The limit is ${Math.round(u.maxBytes / 1024 / 1024)} MB.`);
  }
  if (Platform.OS === 'web') {
    // The browser picker gives a blob: URL; the bytes become a file part.
    form.append('file', new Blob([bytes as BlobPart], { type: u.mime }), u.fileName);
  } else {
    // Expo's fetch (SDK 57) does not take React Native's { uri, name, type } part
    // ("Unsupported FormDataPart implementation"). It accepts a Blob or any object
    // with name, type and bytes(), so the bytes we just read go in as that. The
    // cast is because the DOM typings do not know this shape.
    form.append('file', { name: u.fileName, type: u.mime, bytes: async () => bytes } as unknown as Blob);
  }
  form.append('fileName', u.fileName);
  form.append('folder', u.folder);
  form.append('publicKey', u.publicKey);
  form.append('token', u.token);
  form.append('expire', String(u.expire));
  form.append('signature', u.signature);
  form.append('useUniqueFileName', 'false');
  form.append('isPrivateFile', 'true');

  let res: Response;
  try {
    // No content-type header: fetch adds the multipart boundary itself.
    res = await fetch(u.url, { method: 'POST', body: form });
  } catch {
    throw new MediaError('Could not reach TaskDrop. Check your connection and try again.');
  }
  const stored = res.ok ? ((await res.json().catch(() => null)) as { fileId?: string } | null) : null;
  if (!stored?.fileId) throw new MediaError('Could not upload that photo. Please try again.');

  try {
    const attached = await callApi<{ ref: string }>('attachMedia', { id: target.id, fileId: stored.fileId });
    return attached.ref;
  } catch (e) {
    throw new MediaError(e instanceof Error ? e.message : 'Could not upload that photo. Please try again.');
  }
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
 *
 * 'any' lets the gallery return a photo or a video, whichever is picked.
 */
export async function pickMedia(
  wanted: 'image' | 'video' | 'any',
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
    mediaTypes: wanted === 'any' ? ['images', 'videos'] : wanted === 'video' ? ['videos'] : ['images'],
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
  const kind: 'image' | 'video' =
    wanted !== 'any' ? wanted : asset.type === 'video' || asset.mimeType?.startsWith('video/') ? 'video' : 'image';
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
 * A file dropped onto the page (web only), checked the same way the picker's
 * result is, so it can go through uploadMedia like any other. `wanted` is what
 * the drop area takes; anything else gets a plain-language error.
 */
export async function pickedFromFile(file: File, wanted: 'image' | 'video' | 'any' = 'any'): Promise<PickedMedia> {
  const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : null;
  if (!kind || (wanted !== 'any' && kind !== wanted)) {
    throw new MediaError(wanted === 'image' ? 'Drop a photo here.' : wanted === 'video' ? 'Drop a video here.' : 'Drop a photo or a video here.');
  }
  if (file.size > MAX_BYTES) {
    throw new MediaError(`That file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB.`);
  }
  const uri = URL.createObjectURL(file);
  let seconds: number | undefined;
  if (kind === 'video') {
    seconds = await new Promise<number | undefined>((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? Math.round(v.duration) : undefined);
      v.onerror = () => resolve(undefined);
      v.src = uri;
    });
    if (seconds != null && seconds > MEDIA.MAX_VIDEO_SECONDS) {
      URL.revokeObjectURL(uri);
      throw new MediaError(`That video is ${seconds}s. Keep it to ${MEDIA.MAX_VIDEO_SECONDS}s or under.`);
    }
    // Same rule as the picker: an unknown length counts as the cap.
    if (seconds == null) seconds = MEDIA.MAX_VIDEO_SECONDS;
  }
  return { kind, uri, mimeType: file.type, seconds, bytes: file.size };
}


/**
 * Put the file in the bucket and return what the task row should store.
 *
 * The path starts with the uploader's id because the storage policy checks
 * exactly that: the first folder must be auth.uid(), so nobody can write into
 * anyone else's space.
 */
export async function uploadMedia(picked: PickedMedia, purpose: UploadPurpose = 'task'): Promise<TaskMedia> {
  const userId = await currentUserId();
  if (!userId) throw new MediaError('Sign in before attaching a file.');
  if (picked.bytes > MAX_BYTES) {
    throw new MediaError(`That file is too big. The limit is ${MAX_BYTES / 1024 / 1024} MB.`);
  }

  const ext = extensionFor(picked.mimeType, picked.kind === 'video' ? 'mp4' : 'jpg');
  const path = await storeFile(purpose, picked.kind, picked, ext);

  return { kind: picked.kind, path, seconds: picked.seconds };
}

/** Best effort — a file left behind is untidy, not broken. */
export async function removeMedia(path: string): Promise<void> {
  await callApi('removeMedia', { path }).catch(() => {});
}

/**
 * How big a picture to ask for. A thumbnail should not download a full photo:
 * thumb for avatars and small tiles, card for feed cards and chat bubbles, full
 * for looking at a picture properly. Files that are not pictures ignore it.
 */
export type ImageSize = 'thumb' | 'card' | 'full';

/** An hour is long enough to look at a task and short enough not to be shared. */
const SIGNED_URL_SECONDS = 60 * 60;

/**
 * Signed URLs are reused until shortly before they expire. Signing mints a new
 * token each time, and a new token is a new URL -- so without this, every
 * visit to a screen re-downloaded every photo and avatar on it, and they
 * flickered in. The same URL lets the browser and the image cache keep them.
 * A picture at one size and the same picture at another are different URLs, so
 * they are cached separately.
 */
const REUSE_MS = (SIGNED_URL_SECONDS - 10 * 60) * 1000;
const signed = new Map<string, { url: string; at: number }>();
const pending = new Map<string, Promise<string | null>>();

const cacheKey = (path: string, size: ImageSize) => `${size}|${path}`;

function cached(path: string, size: ImageSize): string | null {
  const hit = signed.get(cacheKey(path, size));
  return hit && Date.now() - hit.at < REUSE_MS ? hit.url : null;
}

/** A viewable URL for one stored path, or null if it cannot be signed. */
export async function signedMediaUrl(path: string, size: ImageSize = 'card'): Promise<string | null> {
  const hit = cached(path, size);
  if (hit) return hit;
  const key = cacheKey(path, size);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const p = (async () => {
    const urls = await callApi<Record<string, string>>('signMedia', { paths: [path], size }).catch(() => ({}) as Record<string, string>);
    const url = urls[path];
    if (!url) return null;
    signed.set(key, { url, at: Date.now() });
    return url;
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** The URL for a path if it is already signed, for a first paint with no wait. */
export function peekSignedUrl(path: string | null | undefined, size: ImageSize = 'card'): string | null {
  return path ? cached(path, size) : null;
}

/**
 * Signed URLs for many paths in one round trip, keyed by path. Paths signed
 * recently come from the cache; only the rest are asked for.
 *
 * A list of tasks would otherwise make one request per thumbnail, which is the
 * difference between a feed that loads and a feed that crawls.
 */
export async function signedMediaUrls(paths: string[], size: ImageSize = 'card'): Promise<Record<string, string>> {
  const wanted = [...new Set(paths.filter(Boolean))];
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const p of wanted) {
    const hit = cached(p, size);
    if (hit) out[p] = hit;
    else missing.push(p);
  }
  if (missing.length === 0) return out;

  let urls: Record<string, string>;
  try {
    urls = await callApi<Record<string, string>>('signMedia', { paths: missing, size });
  } catch {
    return out;
  }
  const now = Date.now();
  for (const [p, url] of Object.entries(urls)) {
    out[p] = url;
    signed.set(cacheKey(p, size), { url, at: now });
  }
  return out;
}

/**
 * What to hand expo-image for a signed URL. The signature in the query string
 * changes every hour but the picture does not, so the image is cached under the
 * URL without its query: it survives a re-sign instead of downloading again.
 */
export function imageSource(url: string): { uri: string; cacheKey: string } {
  return { uri: url, cacheKey: url.split('?')[0] };
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
  const fromName = picked.name?.split('.').pop()?.toLowerCase();
  const ext = kind === 'file' ? (fromName && fromName.length <= 5 ? fromName : 'pdf') : extensionFor(picked.mimeType, kind === 'video' ? 'mp4' : 'jpg');
  const path = await storeFile('proof', kind, picked, ext);
  return { path, kind, name: picked.name ?? (kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : 'Document') };
}
