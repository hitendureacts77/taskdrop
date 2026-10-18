/**
 * ImageKit, the small part of it TaskDrop uses.
 *
 * Images are uploaded straight from the phone or browser to ImageKit and shown
 * through ImageKit's CDN. The private key never leaves the server, so the three
 * things that need it are done here:
 *
 *   * signing an upload (a one-time token the app hands to ImageKit),
 *   * signing a picture's URL, so only someone TaskDrop approved can open it,
 *   * asking ImageKit about, or deleting, a file.
 *
 * Every file is uploaded as private, which means ImageKit refuses an unsigned
 * URL no matter how the account's own settings are set.
 *
 * No Deno imports on purpose, so this can be tested from Node. Web Crypto and
 * fetch exist in both.
 */

export type ImageKitConfig = {
  /** Safe to give to the app; ImageKit needs it on every upload. */
  publicKey: string;
  /** Server only. Never log it, return it or put it in a client bundle. */
  privateKey: string;
  /** e.g. https://ik.imagekit.io/your_id (no trailing slash). */
  urlEndpoint: string;
  /** The top-level folder for this deployment: local, beta or prod. */
  env: string;
};

export type Fetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";
export const API_URL = "https://api.imagekit.io/v1";

/** How long an upload token may be used. ImageKit allows at most an hour. */
export const UPLOAD_TOKEN_SECONDS = 30 * 60;

/** Most an image may weigh. The app compresses before it uploads; this is the server's own limit. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** What may be uploaded as a picture. HEIC is what iPhones take; ImageKit converts it on delivery. */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

/** The sizes the app asks for. `at_max` fits the picture inside the box without enlarging it. */
export const IMAGE_SIZES = {
  thumb: { w: 200, h: 200 },
  card: { w: 640, h: 640 },
  full: { w: 1600, h: 1600 },
} as const;
export type ImageSize = keyof typeof IMAGE_SIZES;

/** Signed URLs last at least this long, and are rounded so every request in the same hour gets the same URL. */
export const URL_SECONDS = 60 * 60;

const enc = new TextEncoder();

/** Lowercase hex HMAC-SHA1, which is what ImageKit checks both uploads and URLs with. */
export async function hmacSha1Hex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The folder a person's pictures live in. The id is a UUID, so nothing here can climb out. */
export function userFolder(cfg: Pick<ImageKitConfig, "env">, userId: string): string {
  return `/${cfg.env}/u/${userId}`;
}

/** The file extension a picture of this type gets. */
export function extensionFor(mime: string): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    default: return "jpg";
  }
}

export type UploadAuth = { token: string; expire: number; signature: string };

/** A one-time token, its expiry and the signature ImageKit checks (HMAC-SHA1 of token + expire). */
export async function uploadAuth(cfg: ImageKitConfig, nowMs: number, token = crypto.randomUUID()): Promise<UploadAuth> {
  const expire = Math.floor(nowMs / 1000) + UPLOAD_TOKEN_SECONDS;
  return { token, expire, signature: await hmacSha1Hex(cfg.privateKey, `${token}${expire}`) };
}

/**
 * When a signed URL stops working: the end of the hour after the next one. That
 * is between one and two hours away, and identical for everyone who asks within
 * the same clock hour, which is what lets the app and the browser keep the picture.
 */
export function urlExpiry(nowMs: number): number {
  const hour = Math.floor(nowMs / 1000 / URL_SECONDS);
  return (hour + 2) * URL_SECONDS;
}

/** The transformation segment for a size, e.g. `tr:w-640,h-640,c-at_max,q-80,f-auto`. */
export function transformationFor(size: ImageSize): string {
  const { w, h } = IMAGE_SIZES[size];
  return `tr:w-${w},h-${h},c-at_max,q-80,f-auto`;
}

const encodePath = (p: string) => p.split("/").map((s) => encodeURIComponent(s)).join("/");

/**
 * A signed, expiring URL for a private file. ImageKit signs the part of the URL
 * after the endpoint, followed by the expiry, with HMAC-SHA1 and the private key.
 * `filePath` is the path ImageKit reported on upload, e.g. /local/u/<uid>/<id>.jpg.
 */
export async function signedUrl(cfg: ImageKitConfig, filePath: string, size: ImageSize, nowMs: number): Promise<string> {
  const endpoint = cfg.urlEndpoint.replace(/\/+$/, "");
  const rest = `${transformationFor(size)}${encodePath(filePath.startsWith("/") ? filePath : `/${filePath}`)}`;
  const expiry = urlExpiry(nowMs);
  const signature = await hmacSha1Hex(cfg.privateKey, `${rest}${expiry}`);
  return `${endpoint}/${rest}?ik-t=${expiry}&ik-s=${signature}`;
}

// ------------------------------------------------------------------ the API --

const basic = (cfg: ImageKitConfig) => ({ Authorization: `Basic ${btoa(`${cfg.privateKey}:`)}`, Accept: "application/json" });

/** What ImageKit says about a stored file; only the fields we check. */
export type FileDetails = {
  fileId: string;
  filePath: string;
  fileType?: string;
  mime?: string;
  size?: number;
  isPrivateFile?: boolean;
};

/** A file by id, or null when ImageKit has no such file. Throws on any other failure so the caller can retry. */
export async function fileDetails(cfg: ImageKitConfig, fetcher: Fetch, fileId: string): Promise<FileDetails | null> {
  const res = await fetcher(`${API_URL}/files/${encodeURIComponent(fileId)}/details`, { headers: basic(cfg) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ImageKit file details: HTTP ${res.status}`);
  return (await res.json()) as FileDetails;
}

/** Deletes a file. A file that is already gone counts as deleted. Throws on any other failure. */
export async function deleteFile(cfg: ImageKitConfig, fetcher: Fetch, fileId: string): Promise<void> {
  const res = await fetcher(`${API_URL}/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: basic(cfg) });
  if (res.ok || res.status === 404) return;
  throw new Error(`ImageKit delete: HTTP ${res.status}`);
}

/**
 * The id of the file at an exact path, or null if there is none. Used to clean up
 * a picture that was uploaded but never attached, so we never learned its id.
 */
export async function findFileId(cfg: ImageKitConfig, fetcher: Fetch, filePath: string): Promise<string | null> {
  const slash = filePath.lastIndexOf("/");
  const folder = filePath.slice(0, slash) || "/";
  const name = filePath.slice(slash + 1);
  const query = new URLSearchParams({ path: folder, searchQuery: `name = "${name.replace(/"/g, "")}"`, limit: "5" });
  const res = await fetcher(`${API_URL}/files?${query}`, { headers: basic(cfg) });
  if (!res.ok) throw new Error(`ImageKit list: HTTP ${res.status}`);
  const list = (await res.json()) as FileDetails[];
  return list.find((f) => f.filePath === filePath)?.fileId ?? null;
}

// ------------------------------------------------------------------- config --

/**
 * ImageKit's settings from wherever secrets live (`get` is secrets.ts's secret()),
 * or null when they are not all set. Without them pictures keep going to Supabase
 * Storage, so a deployment with no ImageKit account yet works as it always did.
 *
 *   IMAGEKIT_PUBLIC_KEY    public_...  (safe to give to the app)
 *   IMAGEKIT_PRIVATE_KEY   private_... (server only)
 *   IMAGEKIT_URL_ENDPOINT  https://ik.imagekit.io/<your id>
 *   IMAGEKIT_ENV           local | beta | prod  (the top folder; default local)
 */
export async function configFrom(get: (name: string) => Promise<string>): Promise<ImageKitConfig | null> {
  const [publicKey, privateKey, urlEndpoint, env] = await Promise.all([
    get("IMAGEKIT_PUBLIC_KEY"),
    get("IMAGEKIT_PRIVATE_KEY"),
    get("IMAGEKIT_URL_ENDPOINT"),
    get("IMAGEKIT_ENV"),
  ]);
  if (!publicKey || !privateKey || !/^https:\/\/ik\.imagekit\.io\/.+/.test(urlEndpoint)) return null;
  const folder = env || "local";
  if (!/^[a-z0-9_-]+$/.test(folder)) return null;
  return { publicKey, privateKey, urlEndpoint: urlEndpoint.replace(/\/+$/, ""), env: folder };
}
