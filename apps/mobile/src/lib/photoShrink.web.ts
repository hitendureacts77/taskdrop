import { fitWithin, SHRINK_QUALITY } from './feedbackLimits';

/**
 * Web build of lib/photoShrink.ts: the browser draws the photo smaller on a
 * canvas (1600 px longest side, JPEG at 70%). The browser does this in well
 * under a second, where the general image library took several seconds on a
 * 12-megapixel photo.
 */

export type ShrunkPhoto = { uri: string; mimeType: 'image/jpeg'; bytes: number };

/** Null when this browser cannot read the picture (HEIC, for example); the photo then goes up as picked. */
export async function shrinkPhoto(uri: string, _size?: { width?: number; height?: number }): Promise<ShrunkPhoto | null> {
  try {
    const picked = await (await fetch(uri)).blob();
    const bitmap = await createImageBitmap(picked);
    const target = fitWithin(bitmap.width, bitmap.height) ?? { width: bitmap.width, height: bitmap.height };
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const g = canvas.getContext('2d');
    if (!g) return null;
    // A transparent screenshot would turn black as a JPEG: give it a white page first.
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, target.width, target.height);
    g.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', SHRINK_QUALITY));
    if (!out) return null;
    return { uri: URL.createObjectURL(out), mimeType: 'image/jpeg', bytes: out.size };
  } catch {
    return null;
  }
}
