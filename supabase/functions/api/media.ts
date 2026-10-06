import { type Op, OpError, bad, oneOf, str } from "./core.ts";

/**
 * Files. The server decides where a file goes and hands back a one-time upload
 * URL, so the bucket layout and naming rules are not in the app. Every call
 * runs as the caller, so the storage policies (first folder = your own id)
 * still apply.
 */

const BUCKET = "task-media";
/** An hour is long enough to look at a task and short enough not to be shared. */
const SIGNED_URL_SECONDS = 60 * 60;

const random = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

/** The path's first folder must be the caller's own id. */
function ownPath(userId: string, path: string): string {
  if (!path.startsWith(`${userId}/`) || path.includes("..")) throw bad("path");
  return path;
}

export const MEDIA_OPS: Record<string, Op> = {
  /** A fresh path in the caller's folder and a signed URL to PUT the bytes to. */
  createUpload: async ({ db, userId }, a) => {
    const purpose = oneOf(a, "purpose", ["task", "proof", "avatar", "chat"]);
    const ext = str(a, "ext", 5).toLowerCase();
    if (!/^[a-z0-9]{1,5}$/.test(ext)) throw bad("ext");
    const prefix = purpose === "proof" ? "proof-" : "";
    const path = `${userId}/${prefix}${Date.now()}-${random()}.${ext}`;
    const res = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (res.error || !res.data?.signedUrl) throw new OpError("Could not start the upload", "UPLOAD");
    return { path, url: res.data.signedUrl as string };
  },

  /** Viewable URLs for stored paths: { [path]: url }. Paths that cannot be signed are left out. */
  signMedia: async ({ db }, a) => {
    const raw = a.paths;
    if (!Array.isArray(raw) || raw.length > 200 || raw.some((p) => typeof p !== "string" || p.length > 300)) {
      throw bad("paths");
    }
    const paths = [...new Set(raw as string[])].filter(Boolean);
    if (paths.length === 0) return {};
    const res = await db.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    const out: Record<string, string> = {};
    for (const row of (res.data ?? []) as { path: string | null; signedUrl: string | null }[]) {
      if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
    }
    return out;
  },

  /** Best effort -- a file left behind is untidy, not broken. Only your own files. */
  removeMedia: async ({ db, userId }, a) => {
    await db.storage.from(BUCKET).remove([ownPath(userId, str(a, "path", 300))]);
    return null;
  },
};

