import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyAttemptMedia, verifyMediaFile } from '../src/tcis/media-verification.mjs';
import {
  minimalAnimatedWebp,
  minimalStructuredJpeg,
  minimalStructuredMp4,
  onePixelPng,
} from './helpers/media-fixtures.mjs';

const png = onePixelPng;
const signatureLieMp4 = Buffer.from('0000000066747970000000006d6f6f760000000000000000', 'hex');

test('actual media verification binds contained bytes, hash and structure', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tcis-media-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'media'));
  await writeFile(path.join(root, 'media', 'one.png'), png);
  const hash = createHash('sha256').update(png).digest('hex');
  const verified = await verifyMediaFile(root, 'media/one.png', hash);
  assert.equal(verified.media_type, 'image/png');
  assert.equal(verified.width, 1);
  assert.equal(verified.structural_validation, 'PASS');
});

test('PNG rejects duplicate PLTE but accepts a zero-length IDAT before compressed image data', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tcis-media-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'media'));
  const duplicatePalette = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAA1BMVEUAAACnej3aAAAAA1BMVEUAAACnej3aAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
    'base64',
  );
  const emptyThenNonemptyIdat = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAElEQVQ1rwYeAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
    'base64',
  );
  await writeFile(path.join(root, 'media', 'duplicate-plte.png'), duplicatePalette);
  await writeFile(path.join(root, 'media', 'empty-idat.png'), emptyThenNonemptyIdat);
  await assert.rejects(
    () => verifyMediaFile(root, 'media/duplicate-plte.png', sha256(duplicatePalette)),
    { code: 'MALFORMED_PNG' },
  );
  const verified = await verifyMediaFile(root, 'media/empty-idat.png', sha256(emptyThenNonemptyIdat));
  assert.equal(verified.media_type, 'image/png');
  assert.equal(verified.width, 1);
});

test('media verification rejects path escape, bad hash and malformed bytes', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tcis-media-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'media'));
  await writeFile(path.join(root, 'media', 'bad.png'), Buffer.from('not media'));
  await assert.rejects(() => verifyMediaFile(root, '../outside.png', 'a'.repeat(64)), { code: 'UNSAFE_MEDIA_PATH' });
  await assert.rejects(() => verifyMediaFile(root, 'media/bad.png', 'a'.repeat(64)), { code: 'MEDIA_HASH_MISMATCH' });
  const signatureLiePng = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(signatureLiePng, 0);
  signatureLiePng.writeUInt32BE(13, 8); signatureLiePng.write('IHDR', 12, 'ascii');
  signatureLiePng.writeUInt32BE(1, 16); signatureLiePng.writeUInt32BE(1, 20); signatureLiePng.write('IEND', 29, 'ascii');
  await writeFile(path.join(root, 'media', 'signature-lie.png'), signatureLiePng);
  await assert.rejects(
    () => verifyMediaFile(root, 'media/signature-lie.png', createHash('sha256').update(signatureLiePng).digest('hex')),
    { code: 'MALFORMED_PNG' },
  );
  const signatureLieJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0xff, 0xd9]);
  await writeFile(path.join(root, 'media', 'signature-lie.jpg'), signatureLieJpeg);
  await assert.rejects(
    () => verifyMediaFile(root, 'media/signature-lie.jpg', createHash('sha256').update(signatureLieJpeg).digest('hex')),
    { code: 'MALFORMED_JPEG' },
  );
  await writeFile(path.join(root, 'media', 'signature-lie.mp4'), signatureLieMp4);
  const fakeHash = createHash('sha256').update(signatureLieMp4).digest('hex');
  await assert.rejects(() => verifyMediaFile(root, 'media/signature-lie.mp4', fakeHash), { code: 'MALFORMED_MP4' });
  const fakeWebp = Buffer.from('52494646080000005745425056503820', 'hex');
  await writeFile(path.join(root, 'media', 'signature-lie.webp'), fakeWebp);
  await assert.rejects(
    () => verifyMediaFile(root, 'media/signature-lie.webp', createHash('sha256').update(fakeWebp).digest('hex')),
    { code: 'MALFORMED_WEBP' },
  );
  const fakeWav = Buffer.alloc(44);
  fakeWav.write('RIFF', 0, 'ascii'); fakeWav.writeUInt32LE(36, 4); fakeWav.write('WAVE', 8, 'ascii');
  await writeFile(path.join(root, 'media', 'signature-lie.wav'), fakeWav);
  await assert.rejects(
    () => verifyMediaFile(root, 'media/signature-lie.wav', createHash('sha256').update(fakeWav).digest('hex')),
    { code: 'MALFORMED_WAV' },
  );
});

test('MP4 structural verification requires coherent boxes, a described track, and media data', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tcis-media-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'media'));
  const mp4 = minimalStructuredMp4();
  await writeFile(path.join(root, 'media', 'structured.mp4'), mp4);
  const hash = createHash('sha256').update(mp4).digest('hex');
  const verified = await verifyMediaFile(root, 'media/structured.mp4', hash);
  assert.equal(verified.media_type, 'video/mp4');
  assert.equal(verified.track_count, 1);
  assert.deepEqual(verified.track_types, ['video']);
  const headerOnlyMp4 = Buffer.from(
    'AAAAFGZ0eXBpc29tAAACAGlzb20AAABkbW9vdgAAAFx0cmFrAAAAVG1kaWEAAAAcaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAMG1pbmYAAAAoc3RibAAAACBzdHNkAAAAAAAAAAEAAAAQYXZjMQAAAAAAAAAAAAAADG1kYXQBAgME',
    'base64',
  );
  await writeFile(path.join(root, 'media', 'header-only.mp4'), headerOnlyMp4);
  await assert.rejects(
    () => verifyMediaFile(root, 'media/header-only.mp4', sha256(headerOnlyMp4)),
    { code: 'MALFORMED_MP4' },
  );
});

test('JPEG structural verification requires a frame, scan and entropy payload', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tcis-media-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'media'));
  await writeFile(path.join(root, 'media', 'structured.jpg'), minimalStructuredJpeg);
  const hash = createHash('sha256').update(minimalStructuredJpeg).digest('hex');
  const verified = await verifyMediaFile(root, 'media/structured.jpg', hash);
  assert.equal(verified.media_type, 'image/jpeg');
  assert.equal(verified.width, 1);
  assert.equal(verified.scan_count, 1);
  const emptyDqt = Buffer.from('/9j/2wAC/8AACwgAAQABAQERAP/aAAgBAQAAPwAB/9k=', 'base64');
  await writeFile(path.join(root, 'media', 'empty-dqt.jpg'), emptyDqt);
  await assert.rejects(
    () => verifyMediaFile(root, 'media/empty-dqt.jpg', sha256(emptyDqt)),
    { code: 'MALFORMED_JPEG' },
  );
});

test('GIF and WAV structural verification require complete image/audio payloads', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tcis-media-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'media'));
  const gif = Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex');
  const wav = minimalPcmWav();
  await writeFile(path.join(root, 'media', 'one.gif'), gif);
  await writeFile(path.join(root, 'media', 'one.wav'), wav);
  const verifiedGif = await verifyMediaFile(root, 'media/one.gif', createHash('sha256').update(gif).digest('hex'));
  const verifiedWav = await verifyMediaFile(root, 'media/one.wav', createHash('sha256').update(wav).digest('hex'));
  assert.equal(verifiedGif.width, 1);
  assert.equal(verifiedGif.frame_count_at_least, 1);
  assert.equal(verifiedWav.sample_rate, 8000);
  assert.ok(verifiedWav.duration_seconds > 0);
  const inconsistentWav = Buffer.from(wav);
  inconsistentWav.writeUInt32LE(1, 28);
  await writeFile(path.join(root, 'media', 'inconsistent.wav'), inconsistentWav);
  await assert.rejects(
    () => verifyMediaFile(root, 'media/inconsistent.wav', createHash('sha256').update(inconsistentWav).digest('hex')),
    { code: 'MALFORMED_WAV' },
  );
  const emptyGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACADs=', 'base64');
  const incompleteWaveFormat = Buffer.from('UklGRigAAABXQVZFZm10IBEAAAABAAEAQB8AAEAfAAABAAgA/wBkYXRhAQAAAIAA', 'base64');
  await writeFile(path.join(root, 'media', 'empty-lzw.gif'), emptyGif);
  await writeFile(path.join(root, 'media', 'incomplete-wave-format.wav'), incompleteWaveFormat);
  await assert.rejects(
    () => verifyMediaFile(root, 'media/empty-lzw.gif', sha256(emptyGif)),
    { code: 'MALFORMED_GIF' },
  );
  await assert.rejects(
    () => verifyMediaFile(root, 'media/incomplete-wave-format.wav', sha256(incompleteWaveFormat)),
    { code: 'MALFORMED_WAV' },
  );
});

test('WebP rejects a header-only VP8L stream and accepts a coherent animated VP8X container', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tcis-media-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'media'));
  const headerOnlyVp8l = Buffer.from('UklGRhIAAABXRUJQVlA4TAUAAAAvAAAAAAA=', 'base64');
  await writeFile(path.join(root, 'media', 'header-only.webp'), headerOnlyVp8l);
  await writeFile(path.join(root, 'media', 'animated.webp'), minimalAnimatedWebp);
  await assert.rejects(
    () => verifyMediaFile(root, 'media/header-only.webp', sha256(headerOnlyVp8l)),
    { code: 'MALFORMED_WEBP' },
  );
  const verified = await verifyMediaFile(root, 'media/animated.webp', sha256(minimalAnimatedWebp));
  assert.equal(verified.media_type, 'image/webp');
  assert.equal(verified.width, 1);
  assert.equal(verified.height, 1);
  assert.equal(verified.frame_count, 1);
});

test('selected attempt requires independent structured inspection of actual bytes', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tcis-media-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'media'));
  await writeFile(path.join(root, 'media', 'one.png'), png);
  const hash = createHash('sha256').update(png).digest('hex');
  const attempt = {
    schema_version: '1.0.0', project_id: 'PRJ-1', attempt_id: 'AT-1', artifact_id: 'ART-1', status: 'SELECTED',
    tool: 'codex_native_imagegen', request_hash: 'a'.repeat(64), reference_ids: [], output_path: 'media/one.png', output_hash: hash,
    inspection: { passed: true, inspector: 'creative_lead', checks: ['actual_file_seen'] }, selected_by: 'client_owner',
  };
  const verified = await verifyAttemptMedia(root, attempt);
  assert.equal(verified.media.sha256, hash);
  await assert.rejects(() => verifyAttemptMedia(root, { ...attempt, selected_by: 'creative_lead' }), { code: 'INDEPENDENT_SELECTION_REQUIRED' });
  await assert.rejects(
    () => verifyAttemptMedia(root, { ...attempt, inspection: { ...attempt.inspection, inspector: '' } }),
    { code: 'MEDIA_INSPECTION_REQUIRED' },
  );
  await assert.rejects(
    () => verifyAttemptMedia(root, { ...attempt, inspection: { ...attempt.inspection, inspector: '   ' } }),
    { code: 'MEDIA_INSPECTION_REQUIRED' },
  );
  await assert.rejects(() => verifyAttemptMedia(root, { ...attempt, selected_by: '' }), { code: 'STRING_REQUIRED' });
  await assert.rejects(() => verifyAttemptMedia(root, { ...attempt, selected_by: '   ' }), { code: 'STRING_REQUIRED' });
  await assert.rejects(
    () => verifyAttemptMedia(root, { ...attempt, selected_by: 'Creative Lead' }),
    { code: 'INDEPENDENT_SELECTION_REQUIRED' },
  );
});

function minimalPcmWav() {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(1, 2);
  format.writeUInt32LE(8000, 4);
  format.writeUInt32LE(8000, 8);
  format.writeUInt16LE(1, 12);
  format.writeUInt16LE(8, 14);
  const body = Buffer.concat([Buffer.from('WAVE'), riffChunk('fmt ', format), riffChunk('data', Buffer.from([128]))]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function riffChunk(type, payload) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
