/**
 * A picked file's raw bytes, web build. The picker hands back a blob: or
 * data: URI, which fetch reads fine; expo-file-system does not exist here.
 */
export async function readBytes(uri: string): Promise<Uint8Array> {
  const res = await fetch(uri);
  return new Uint8Array(await res.arrayBuffer());
}
