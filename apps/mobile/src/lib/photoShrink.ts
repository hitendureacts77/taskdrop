import { readBytes } from './readBytes';
import { fitWithin, SHRINK_QUALITY } from './feedbackLimits';

/**
 * Photos are made smaller before they are uploaded (owner, 25 Nov: only small,
 * compressed files are stored). The longest side becomes at most 1600 pixels
 * and the photo is saved as a JPEG at 70% quality, so a 4 MB camera photo goes
 * up at a few hundred KB and a screenshot or receipt stays readable.
 *
 * Used for feedback photos (plan 1.19 row L). The server still refuses any
 * photo over 1 MB (migration 206), whatever app version sent it.
 */

type Manipulator = typeof import('expo-image-manipulator');

// expo-image-manipulator is a native module. An app installed before it was
// added gets this code by an over-the-air update without the native part, and
// importing it then throws. Load it lazily, and fall back to the picked photo
// (the picker already asks for a lower quality) when it is not there.
let manipulator: Manipulator | null | undefined;
function loadManipulator(): Manipulator | null {
  if (manipulator === undefined) {
    try {
      manipulator = require('expo-image-manipulator') as Manipulator;
    } catch {
      manipulator = null;
    }
  }
  return manipulator;
}

export type ShrunkPhoto = { uri: string; mimeType: 'image/jpeg'; bytes: number };

/**
 * The photo at `uri`, made smaller as a JPEG. Null when it cannot be done here
 * (an older installed app, or a picture this browser cannot read, such as HEIC);
 * the caller then uploads the photo as picked and the 1 MB check decides.
 */
export async function shrinkPhoto(uri: string, size?: { width?: number; height?: number }): Promise<ShrunkPhoto | null> {
  const m = loadManipulator();
  if (!m) return null;
  try {
    let target = size?.width && size?.height ? fitWithin(size.width, size.height) : undefined;
    if (target === undefined) {
      // The picker did not say how big it is: open it once to find out.
      const first = await m.ImageManipulator.manipulate(uri).renderAsync();
      target = fitWithin(first.width, first.height);
    }
    const ctx = m.ImageManipulator.manipulate(uri);
    if (target) ctx.resize(target);
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ compress: SHRINK_QUALITY, format: m.SaveFormat.JPEG });
    const bytes = (await readBytes(saved.uri)).byteLength;
    return { uri: saved.uri, mimeType: 'image/jpeg', bytes };
  } catch {
    return null;
  }
}
