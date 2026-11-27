import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocationStrippable, stripVideoLocation, VideoMetaError } from './videoMeta.ts';

const enc = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));
const cat = (...p: Uint8Array[]) => Uint8Array.from(Buffer.concat(p));

function box(type: string, ...body: Uint8Array[]): Uint8Array {
  const payload = cat(...body);
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(enc(type), 4);
  out.set(payload, 8);
  return out;
}

function box64(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 + payload.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 1);
  out.set(enc(type), 4);
  dv.setUint32(8, 0);
  dv.setUint32(12, out.length);
  out.set(payload, 16);
  return out;
}

const gps = enc('\xa9xyz');
const udta = () => box('udta', box('\xa9xyz', enc('\x00\x0e\x15\xc7+12.97+077.59/')));
const mdatBody = enc('MEDIADATA-1234567890');

function sample(bigMdat = false): Uint8Array {
  const moov = box('moov', box('mvhd', new Uint8Array(20)), udta(), box('trak', box('tkhd', new Uint8Array(8)), udta(), box('mdia', box('mdhd', new Uint8Array(8)), box('meta', new Uint8Array(12)))), box('meta', enc('keys ilst com.apple.quicktime.location.ISO6709')));
  return cat(box('ftyp', enc('isom\x00\x00\x02\x00')), moov, bigMdat ? box64('mdat', mdatBody) : box('mdat', mdatBody));
}

const has = (b: Uint8Array, s: Uint8Array | string) => Buffer.from(b).includes(typeof s === 'string' ? Buffer.from(s, 'latin1') : Buffer.from(s));

test('strips location boxes, keeps size and media bytes', () => {
  const input = sample();
  const len = input.length;
  const out = stripVideoLocation(Uint8Array.from(input));
  assert.equal(out.length, len);
  assert.ok(has(input, gps));
  assert.ok(!has(out, 'udta'));
  assert.ok(!has(out, 'meta'));
  // The coordinates themselves are gone from the bytes, not only the box names.
  assert.ok(!has(out, gps) && !has(out, '+12.97+077.59') && !has(out, 'ISO6709'));
  assert.ok(has(out, 'mvhd') && has(out, 'trak') && has(out, 'mdia'));
  assert.ok(has(out, mdatBody));
  assert.ok(has(out, 'free'));
});

test('works with a 64-bit mdat', () => {
  const out = stripVideoLocation(sample(true));
  assert.ok(!has(out, 'udta'));
  assert.ok(has(out, mdatBody));
});

test('frees a top-level udta or meta outside moov', () => {
  const b = cat(box('ftyp', enc('isom0000')), box('moov', box('mvhd', new Uint8Array(4))), udta(), box('meta', new Uint8Array(4)));
  const out = stripVideoLocation(b);
  assert.ok(!has(out, 'udta') && !has(out, 'meta'));
});

test('throws on garbage and truncated input without hanging', () => {
  assert.throws(() => stripVideoLocation(enc('this is not a video at all')), VideoMetaError);
  assert.throws(() => stripVideoLocation(new Uint8Array(0)), VideoMetaError);
  assert.throws(() => stripVideoLocation(new Uint8Array(64)), VideoMetaError);
  const s = sample();
  assert.doesNotThrow(() => stripVideoLocation(Uint8Array.from(s.subarray(0, s.length - 5))));
  assert.throws(() => stripVideoLocation(Uint8Array.from(s.subarray(0, 6))), VideoMetaError);
  // An ftyp with a cut-off moov must be refused, not uploaded with its location.
  const cut = cat(box('ftyp', enc('isom')), box('moov', udta()).subarray(0, 12));
  assert.throws(() => stripVideoLocation(Uint8Array.from(cut)), VideoMetaError);
});

test('only mp4 and quicktime are stripped; webm is left alone', () => {
  assert.equal(isLocationStrippable('video/mp4'), true);
  assert.equal(isLocationStrippable('video/quicktime'), true);
  assert.equal(isLocationStrippable('video/webm'), false);
  assert.equal(isLocationStrippable('video/3gpp'), true);
});
