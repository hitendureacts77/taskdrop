/**
 * Removes the GPS location (and other tags) a phone saves inside an MP4 / MOV
 * file (H38), on the device, before upload.
 *
 * ISO-BMFF stores that data in `udta` (Android and iPhone `(c)xyz`) and `meta`
 * (Apple `com.apple.quicktime.location.ISO6709`) boxes. Each one is renamed to
 * `free` in place and its contents zeroed: the box size does not change, so every chunk offset
 * (stco / co64) stays valid and the video plays as before.
 */
export class VideoMetaError extends Error {}

const MAX_DEPTH = 6;

function fourcc(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
}

function u32(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}

/** Calls `fn(type, bodyStart, end, typeOffset)` for each box in [start, end). Stops on a malformed box. */
function eachBox(
  b: Uint8Array,
  start: number,
  end: number,
  fn: (type: string, bodyStart: number, boxEnd: number, typeAt: number) => void,
): void {
  let pos = start;
  while (pos + 8 <= end) {
    let size = u32(b, pos);
    const type = fourcc(b, pos + 4);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      const hi = u32(b, pos + 8);
      const lo = u32(b, pos + 12);
      if (hi > 0x1fffff) return; // beyond 2^53: not a real file
      size = hi * 0x100000000 + lo;
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) return;
    fn(type, pos + header, pos + size, pos + 4);
    pos += size;
  }
}

const FREE = [0x66, 0x72, 0x65, 0x65];

/** Renames the box to `free` and zeroes its body, so the coordinates are gone from the bytes, not just hidden. */
function freeBox(b: Uint8Array, typeAt: number, bodyStart: number, boxEnd: number): void {
  for (let i = 0; i < 4; i++) b[typeAt + i] = FREE[i]!;
  b.fill(0, bodyStart, boxEnd);
}

function scrub(b: Uint8Array, start: number, end: number, depth: number): void {
  eachBox(b, start, end, (type, bodyStart, boxEnd, typeAt) => {
    if (type === 'udta' || type === 'meta') {
      freeBox(b, typeAt, bodyStart, boxEnd);
    } else if ((type === 'trak' || type === 'mdia') && depth < MAX_DEPTH) {
      scrub(b, bodyStart, boxEnd, depth + 1);
    }
  });
}

/**
 * Throws VideoMetaError unless a whole `moov` box was found and cleaned: a file whose `moov` cannot
 * be reached (garbage, truncated) is refused rather than uploaded with its location.
 */
export function stripVideoLocation(bytes: Uint8Array): Uint8Array {
  let cleaned = false;
  eachBox(bytes, 0, bytes.length, (type, bodyStart, boxEnd, typeAt) => {
    if (type === 'moov') {
      cleaned = true;
      scrub(bytes, bodyStart, boxEnd, 0);
    } else if (type === 'udta' || type === 'meta') {
      freeBox(bytes, typeAt, bodyStart, boxEnd);
    }
  });
  if (!cleaned) throw new VideoMetaError('Not a readable MP4 or MOV file.');
  return bytes;
}

/** The ISO-BMFF family (MP4, MOV, 3GP, M4V) carries the GPS atom; WebM has none and is left alone. */
export function isLocationStrippable(mime: string): boolean {
  const m = mime.toLowerCase().split(';')[0]!.trim();
  return m === 'video/mp4' || m === 'video/quicktime' || m === 'video/3gpp' || m === 'video/3gpp2' || m === 'video/x-m4v';
}
