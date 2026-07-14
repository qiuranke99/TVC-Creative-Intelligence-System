import { deflateSync } from 'node:zlib';

const table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

export const onePixelPng = createPng({ width: 1, height: 1, rgba: [0, 0, 0, 255] });

export const minimalStructuredJpeg = Buffer.from([
  0xff, 0xd8,
  0xff, 0xdb, 0x00, 0x43, 0x00,
  ...Array(64).fill(0x01),
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xc4, 0x00, 0x26,
  0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  0x3f,
  0xff, 0xd9,
]);

export const minimalAnimatedWebp = Buffer.from(
  'UklGRloAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAAAAAAAAABBTk1GLgAAAAAAAAAAAAAAAAAAAGQAAABWUDggFgAAADABAJ0BKgEAAQABQCYlpAADcAD++5Q=',
  'base64',
);

export function minimalStructuredMp4() {
  const mediaPayload = Buffer.from([1, 2, 3, 4]);
  const ftyp = isoBox('ftyp', Buffer.from('69736f6d0000020069736f6d', 'hex'));
  let moov = movieBox(0, mediaPayload.length);
  const mediaOffset = ftyp.length + moov.length + 8;
  moov = movieBox(mediaOffset, mediaPayload.length);
  return Buffer.concat([ftyp, moov, isoBox('mdat', mediaPayload)]);
}

function createPng({ width, height, rgba }) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * ((width * 4) + 1));
  for (let row = 0; row < height; row += 1) {
    const start = row * ((width * 4) + 1);
    scanlines[start] = 0;
    for (let column = 0; column < width; column += 1) {
      Buffer.from(rgba).copy(scanlines, start + 1 + (column * 4));
    }
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function movieBox(mediaOffset, sampleSize) {
  const movieHeader = Buffer.alloc(100);
  movieHeader.writeUInt32BE(1000, 12);
  movieHeader.writeUInt32BE(1000, 16);
  movieHeader.writeUInt32BE(0x00010000, 20);
  movieHeader.writeUInt16BE(0x0100, 24);
  writeIdentityMatrix(movieHeader, 36);
  movieHeader.writeUInt32BE(2, 96);

  const trackHeader = Buffer.alloc(84);
  trackHeader.writeUIntBE(0x000007, 1, 3);
  trackHeader.writeUInt32BE(1, 12);
  trackHeader.writeUInt32BE(1000, 20);
  writeIdentityMatrix(trackHeader, 40);
  trackHeader.writeUInt32BE(0x00010000, 76);
  trackHeader.writeUInt32BE(0x00010000, 80);

  const mediaHeader = Buffer.alloc(24);
  mediaHeader.writeUInt32BE(1000, 12);
  mediaHeader.writeUInt32BE(1000, 16);

  const handler = Buffer.alloc(24);
  handler.write('vide', 8, 'ascii');

  const sampleEntryHeader = Buffer.alloc(78);
  sampleEntryHeader.writeUInt16BE(1, 6);
  sampleEntryHeader.writeUInt16BE(1, 24);
  sampleEntryHeader.writeUInt16BE(1, 26);
  sampleEntryHeader.writeUInt32BE(0x00480000, 28);
  sampleEntryHeader.writeUInt32BE(0x00480000, 32);
  sampleEntryHeader.writeUInt16BE(1, 40);
  sampleEntryHeader.writeUInt16BE(0x0018, 74);
  sampleEntryHeader.writeInt16BE(-1, 76);
  const avcConfig = Buffer.from([1, 0x42, 0, 0x1e, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0, 0x1e, 1, 0, 2, 0x68, 0xce]);
  const sampleEntry = isoBox('avc1', Buffer.concat([sampleEntryHeader, isoBox('avcC', avcConfig)]));
  const stsd = isoBox('stsd', Buffer.concat([fullBoxHeader(), uint32(1), sampleEntry]));
  const stts = isoBox('stts', Buffer.concat([fullBoxHeader(), uint32(1), uint32(1), uint32(1000)]));
  const stsc = isoBox('stsc', Buffer.concat([fullBoxHeader(), uint32(1), uint32(1), uint32(1), uint32(1)]));
  const stsz = isoBox('stsz', Buffer.concat([fullBoxHeader(), uint32(sampleSize), uint32(1)]));
  const stco = isoBox('stco', Buffer.concat([fullBoxHeader(), uint32(1), uint32(mediaOffset)]));
  const sampleTable = isoBox('stbl', Buffer.concat([stsd, stts, stsc, stsz, stco]));

  const videoMediaHeader = isoBox('vmhd', Buffer.concat([Buffer.from([0, 0, 0, 1]), Buffer.alloc(8)]));
  const selfContainedUrl = isoBox('url ', Buffer.from([0, 0, 0, 1]));
  const dataReference = isoBox('dref', Buffer.concat([fullBoxHeader(), uint32(1), selfContainedUrl]));
  const dataInformation = isoBox('dinf', dataReference);
  const mediaInformation = isoBox('minf', Buffer.concat([videoMediaHeader, dataInformation, sampleTable]));
  const media = isoBox('mdia', Buffer.concat([isoBox('mdhd', mediaHeader), isoBox('hdlr', handler), mediaInformation]));
  const track = isoBox('trak', Buffer.concat([isoBox('tkhd', trackHeader), media]));
  return isoBox('moov', Buffer.concat([isoBox('mvhd', movieHeader), track]));
}

function isoBox(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function fullBoxHeader() {
  return Buffer.alloc(4);
}

function uint32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function writeIdentityMatrix(bytes, offset) {
  bytes.writeUInt32BE(0x00010000, offset);
  bytes.writeUInt32BE(0x00010000, offset + 16);
  bytes.writeUInt32BE(0x40000000, offset + 32);
}
