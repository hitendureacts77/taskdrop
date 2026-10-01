import { File } from 'expo-file-system';

/**
 * A picked file's raw bytes, native build. React Native's fetch does not
 * reliably read a file:// URI, so this goes through expo-file-system.
 *
 * Imported statically on purpose: a lazy import() here is a separate bundle
 * request in development, and when that request fails (a tunnel hiccup) the
 * upload died with "Cannot read property 'reload' of undefined".
 */
export async function readBytes(uri: string): Promise<Uint8Array> {
  return await new File(uri).bytes();
}
