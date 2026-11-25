/**
 * How big a feedback attachment may be (plan 1.19 row L, migration 206).
 * Owner, 25 Nov: only small, compressed files are stored. Photos are made
 * smaller before they go up (lib/photoShrink.ts) and may be 1 MB at most;
 * a PDF may be 2 MB. The server checks the same limits when the feedback is
 * saved; these only spare a wasted upload and give the reason in plain words.
 */

export const FEEDBACK_FILES_MAX = 3;
export const FEEDBACK_PHOTO_MAX_BYTES = 1024 * 1024;
export const FEEDBACK_PDF_MAX_BYTES = 2 * 1024 * 1024;
/** What the picker asks for, so a photo is already lighter where it cannot be made smaller afterwards. */
export const FEEDBACK_PICK_QUALITY = 0.6;

/** A photo is redrawn so its longest side is at most this many pixels, as a JPEG at this quality. */
export const SHRINK_MAX_SIDE = 1600;
export const SHRINK_QUALITY = 0.7;

/** The size to draw a photo at so its longest side is at most `max`; null when it is already small enough. */
export function fitWithin(
  width: number,
  height: number,
  max: number = SHRINK_MAX_SIDE,
): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  const longest = Math.max(width, height);
  if (longest <= max) return null;
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/** The plain-language reason a feedback file is too big, or null when it fits. A PDF is named by its file name. */
export function feedbackTooBig(kind: 'image' | 'file', bytes: number, name?: string): string | null {
  if (kind === 'image') {
    return bytes > FEEDBACK_PHOTO_MAX_BYTES
      ? `That photo is ${mb(bytes)} MB even after making it smaller. Photos can be up to 1 MB.`
      : null;
  }
  return bytes > FEEDBACK_PDF_MAX_BYTES ? `${name?.trim() || 'That PDF'} is ${mb(bytes)} MB. PDFs can be up to 2 MB.` : null;
}
