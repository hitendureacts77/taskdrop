import {
  deleteFile, extensionFor, fileDetails, IMAGE_SIZES, IMAGE_TYPES, type ImageSize, MAX_IMAGE_BYTES, signedUrl, uploadAuth,
  UPLOAD_URL, userFolder,
} from "../_shared/imagekit.ts";
import { type Ctx, type Op, OpError, bad, oneOf, rows, str, take, uuid } from "./core.ts";

/**
 * Files. The server decides where a file goes, so the bucket layout, folders and
 * naming rules are not in the app. Every call runs as the caller, so the
 * database's own checks still apply.
 *
 * Two homes, and the app does not need to care which:
 *
 *   Pictures   go straight to ImageKit (when it is configured). The app gets a
 *              one-time upload token, uploads, then calls attachMedia so the
 *              server can check with ImageKit that the file really is there. A
 *              picture is referred to as "media:<id>" from then on, and shown
 *              through signMedia, which returns a signed, expiring CDN URL.
 *   Everything else (videos, documents, and pictures from an app that does not
 *   ask for ImageKit) goes to Supabase Storage with a one-time upload URL, as
 *   it always has, and is referred to by its storage path.
 *
 * Every upload is recorded in the media table (migration 109).
 */

const BUCKET = "task-media";
/** An hour is long enough to look at a task and short enough not to be shared. */
const SIGNED_URL_SECONDS = 60 * 60;

const random = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

const PURPOSES = ["task", "proof", "avatar", "chat"] as const;
const SIZES = Object.keys(IMAGE_SIZES) as ImageSize[];

/** The path's first folder must be the caller's own id. */
function ownPath(userId: string, path: string): string {
  if (!path.startsWith(`${userId}/`) || path.includes("..")) throw bad("path");
  return path;
}

const MEDIA_REF = /^media:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** True for a reference to a registered picture ("media:<id>"), as opposed to a storage path. */
export const isMediaRef = (v: unknown): v is string => typeof v === "string" && v.startsWith("media:");

/**
 * Throws unless `ref` is a picture the caller uploaded, finished uploading (so
 * ImageKit confirmed it) and uploaded for one of `purposes`. Used before a
 * reference is saved on a task, a profile, a proof or a message, so nobody can
 * point their own record at someone else's picture.
 */
export async function assertOwnImage(ctx: Ctx, ref: unknown, purposes: readonly string[]): Promise<void> {
  const m = typeof ref === "string" ? MEDIA_REF.exec(ref) : null;
  if (!m) throw bad("media");
  const found = rows(
    await ctx.db
      .from("media")
      .select("id")
      .eq("id", m[1].toLowerCase())
      .eq("owner", ctx.userId)
      .eq("status", "attached")
      .eq("kind", "image")
      .in("purpose", purposes),
  );
  if (found.length === 0) throw bad("media");
}

/** What a file in Supabase Storage is, by its extension, for the registry. */
function kindFromExt(ext: string): "image" | "video" | "file" {
  if (["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "m4v"].includes(ext)) return "video";
  return "file";
}

const uploadFailed = (message = "Could not start the upload") => new OpError(message, "UPLOAD");

export const MEDIA_OPS: Record<string, Op> = {
  /**
   * Where a new file goes.
   *
   * With `kind: "image"` and a `mime` type, and ImageKit configured: an upload
   * token for ImageKit, signed here. The app uploads to `upload.url`, then calls
   * attachMedia. Anything else: a fresh path in the caller's Supabase folder and
   * a signed URL to PUT the bytes to ({ path, url }), the original behaviour.
   */
  createUpload: async (ctx, a) => {
    const { db, userId } = ctx;
    const purpose = oneOf(a, "purpose", PURPOSES);

    if (a.kind === "image" && ctx.imagekit) {
      const cfg = ctx.imagekit;
      const mime = oneOf(a, "mime", IMAGE_TYPES);
      const id = crypto.randomUUID();
      const fileName = `${id}.${extensionFor(mime)}`;
      const folder = userFolder(cfg, userId);
      take(await db.rpc("media_begin", {
        p_id: id, p_provider: "imagekit", p_purpose: purpose, p_kind: "image", p_mime: mime, p_path: `${folder}/${fileName}`,
      }), () => uploadFailed());
      const auth = await uploadAuth(cfg, (ctx.now?.() ?? new Date()).getTime());
      return {
        provider: "imagekit",
        id,
        ref: `media:${id}`,
        upload: {
          url: UPLOAD_URL,
          publicKey: cfg.publicKey,
          ...auth,
          folder,
          fileName,
          mime,
          maxBytes: MAX_IMAGE_BYTES,
        },
      };
    }

    const ext = str(a, "ext", 5).toLowerCase();
    if (!/^[a-z0-9]{1,5}$/.test(ext)) throw bad("ext");
    const prefix = purpose === "proof" ? "proof-" : "";
    const path = `${userId}/${prefix}${Date.now()}-${random()}.${ext}`;
    const res = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (res.error || !res.data?.signedUrl) throw uploadFailed();
    // Recorded for the registry. Best effort: an upload must not fail because
    // the registry could not be written (it is a ledger, not a gate, here).
    const kind = a.kind === "video" || a.kind === "file" || a.kind === "image" ? a.kind : kindFromExt(ext);
    const logged = await db.rpc("media_begin", {
      p_id: crypto.randomUUID(), p_provider: "supabase", p_purpose: purpose, p_kind: kind, p_mime: null, p_path: path,
    });
    if (logged.error) console.error("api: could not record upload", logged.error.message);
    return { path, url: res.data.signedUrl as string };
  },

  /**
   * "The picture is uploaded." Asks ImageKit whether the file is where we told
   * the app to put it, is private, is a picture and is not too big, and only then
   * marks it usable. Returns { ref } to save on the task, profile, proof or message.
   */
  attachMedia: async (ctx, a) => {
    const cfg = ctx.imagekit;
    if (!cfg) throw uploadFailed("Photo uploads are not available right now");
    const id = uuid(a, "id").toLowerCase();
    const fileId = str(a, "fileId", 100);
    if (!/^[A-Za-z0-9_-]+$/.test(fileId)) throw bad("fileId");
    const fetcher = ctx.fetcher ?? (fetch as unknown as NonNullable<Ctx["fetcher"]>);

    const row = rows<{ id: string; path: string; provider: string; status: string; provider_file_id: string | null }>(
      await ctx.db.from("media").select("id, path, provider, status, provider_file_id").eq("id", id).eq("owner", ctx.userId),
    )[0];
    if (!row || row.provider !== "imagekit") throw bad("id");
    if (row.status === "attached" && row.provider_file_id === fileId) return { ref: `media:${row.id}` };
    if (row.status !== "pending") throw new OpError("That upload can no longer be used", "UPLOAD");

    let details;
    try {
      details = await fileDetails(cfg, fetcher, fileId);
    } catch (e) {
      console.error("api: ImageKit check failed", e);
      throw uploadFailed("Could not check your photo. Please try again.");
    }
    // It must be the file we named, in the caller's own folder: a fileId that
    // points anywhere else is somebody else's, or a file we never told them to make.
    if (!details || details.filePath !== row.path) throw new OpError("We could not find that upload. Please try again.", "UPLOAD");

    const size = Number(details.size ?? 0);
    if (details.fileType !== "image" || details.isPrivateFile !== true || size <= 0 || size > MAX_IMAGE_BYTES) {
      // The file is ours (same path) but not acceptable: take it down.
      await deleteFile(cfg, fetcher, fileId).catch((e) => console.error("api: could not remove a rejected upload", e));
      await ctx.db.rpc("media_discard", { p_ref: `media:${row.id}` });
      throw new OpError("That file cannot be used. Please choose a photo.", "UPLOAD");
    }

    const ref = take<string>(await ctx.db.rpc("media_attach", { p_id: row.id, p_provider_file_id: fileId, p_bytes: size }));
    return { ref, bytes: size };
  },

  /**
   * Viewable URLs for stored files: { [path or ref]: url }. A "media:<id>" ref
   * becomes a signed ImageKit URL at the size asked for (thumb, card or full;
   * full when not said, which is what an older app expects); a storage path is
   * signed by Supabase as before. Anything the caller may not open is left out.
   */
  signMedia: async (ctx, a) => {
    const raw = a.paths;
    if (!Array.isArray(raw) || raw.length > 200 || raw.some((p) => typeof p !== "string" || p.length > 300)) {
      throw bad("paths");
    }
    const size = oneOf(a, "size", SIZES, "full");
    const paths = [...new Set(raw as string[])].filter(Boolean);
    if (paths.length === 0) return {};
    const out: Record<string, string> = {};

    const refs = paths.filter(isMediaRef);
    const plain = paths.filter((p) => !isMediaRef(p));

    if (plain.length > 0) {
      const res = await ctx.db.storage.from(BUCKET).createSignedUrls(plain, SIGNED_URL_SECONDS);
      for (const row of (res.data ?? []) as { path: string | null; signedUrl: string | null }[]) {
        if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
      }
    }

    if (refs.length > 0 && ctx.imagekit) {
      const cfg = ctx.imagekit;
      const found = take<{ ref: string; provider: string; path: string }[] | null>(
        await ctx.db.rpc("media_resolve", { p_refs: refs }),
      ) ?? [];
      const now = (ctx.now?.() ?? new Date()).getTime();
      for (const f of found) {
        if (f.provider === "imagekit") out[f.ref] = await signedUrl(cfg, f.path, size, now);
      }
    }
    return out;
  },

  /**
   * Best effort -- a file left behind is untidy, not broken. Only your own
   * files. A "media:<id>" ref is only discarded while nothing uses it; the
   * picture itself leaves ImageKit a little later, in the background.
   */
  removeMedia: async ({ db, userId }, a) => {
    const path = str(a, "path", 300);
    if (isMediaRef(path)) {
      await db.rpc("media_discard", { p_ref: path });
      return null;
    }
    await db.storage.from(BUCKET).remove([ownPath(userId, path)]);
    return null;
  },
};
