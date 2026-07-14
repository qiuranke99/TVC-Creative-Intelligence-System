import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { ContractError } from './errors.mjs';
import { validateAttempt, validateTake } from './contracts.mjs';
import { immutableSnapshot } from './utils.mjs';

const MAX_PNG_DECOMPRESSED_BYTES = 512 * 1024 * 1024;

export async function verifyMediaFile(projectRoot, relativePath, expectedHash) {
  const absolutePath = await resolveContainedFile(projectRoot, relativePath);
  const handle = await open(absolutePath, 'r');
  let bytes;
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) fail('UNSAFE_MEDIA_FILE', 'Opened media target is not a regular file.', { relativePath });
    bytes = await handle.readFile();
    const currentCanonical = await realpath(absolutePath);
    const rootCanonical = await realpath(path.resolve(projectRoot));
    assertContained(rootCanonical, currentCanonical, 'MEDIA_PATH_ESCAPE');
    const current = await lstat(absolutePath);
    if (!sameFileIdentity(opened, current)) fail('MEDIA_PATH_RACE', 'Media file identity changed during inspection.', { relativePath });
  } finally {
    await handle.close();
  }
  if (bytes.length === 0) fail('EMPTY_MEDIA', 'Media file is empty.', { relativePath });
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== expectedHash.toLowerCase()) {
    fail('MEDIA_HASH_MISMATCH', 'Actual media bytes do not match the registered hash.', { relativePath, expectedHash, actualHash });
  }
  const media = inspectStructure(bytes);
  return immutableSnapshot({ relative_path: normalize(relativePath), byte_length: bytes.length, sha256: actualHash, ...media });
}

export async function verifyAttemptMedia(projectRoot, attemptRecord) {
  const attempt = validateAttempt(attemptRecord);
  if (!attempt.output_path || !attempt.output_hash) fail('ATTEMPT_OUTPUT_REQUIRED', 'Attempt has no bound media output.');
  const media = await verifyMediaFile(projectRoot, attempt.output_path, attempt.output_hash);
  if (attempt.status === 'SELECTED') validateIndependentInspection(attempt.inspection, attempt.selected_by);
  return immutableSnapshot({ attempt, media });
}

export async function verifyTakeMedia(projectRoot, takeRecord) {
  const take = validateTake(takeRecord);
  const media = await verifyMediaFile(projectRoot, take.media_path, take.media_hash);
  if (take.status === 'SELECTED') validateIndependentInspection(take.inspection, take.selected_by);
  return immutableSnapshot({ take, media });
}

async function resolveContainedFile(projectRoot, relativePath) {
  if (typeof relativePath !== 'string' || path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath)) {
    fail('UNSAFE_MEDIA_PATH', 'Media path must be project-relative.', { relativePath });
  }
  const rootAbsolute = path.resolve(projectRoot);
  const candidate = path.resolve(rootAbsolute, relativePath);
  assertContained(rootAbsolute, candidate, 'UNSAFE_MEDIA_PATH');
  const rootCanonical = await realpath(rootAbsolute);
  const candidateStats = await lstat(candidate);
  if (candidateStats.isSymbolicLink() || !candidateStats.isFile()) {
    fail('UNSAFE_MEDIA_FILE', 'Media target must be a regular non-symlink file.', { relativePath });
  }
  const candidateCanonical = await realpath(candidate);
  assertContained(rootCanonical, candidateCanonical, 'MEDIA_PATH_ESCAPE');
  return candidateCanonical;
}

function assertContained(root, candidate, code) {
  const relative = path.relative(root, candidate);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) return;
  fail(code, 'Resolved media path escapes the project root.', { root, candidate });
}

function inspectStructure(bytes) {
  if (isPng(bytes)) return inspectPng(bytes);
  if (isJpeg(bytes)) return inspectJpeg(bytes);
  if (isGif(bytes)) return inspectGif(bytes);
  if (isWebp(bytes)) return inspectWebp(bytes);
  if (isWav(bytes)) return inspectWav(bytes);
  if (isMp4(bytes)) return inspectMp4(bytes);
  fail('UNRECOGNIZED_MEDIA', 'Media bytes do not match a supported image, audio or video structure.');
}

function isPng(bytes) {
  return bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function inspectPng(bytes) {
  let offset = 8;
  let ihdr = null;
  let paletteSeen = false;
  let paletteEntries = 0;
  let imageDataStarted = false;
  let imageDataEnded = false;
  let terminalSeen = false;
  const imageData = [];
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) fail('MALFORMED_PNG', 'PNG chunk header or CRC is truncated.');
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) fail('MALFORMED_PNG', 'PNG chunk type is invalid.');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > bytes.length) fail('MALFORMED_PNG', `PNG ${type} chunk is truncated.`);
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = crc32(bytes.subarray(offset + 4, dataEnd));
    if (expectedCrc !== actualCrc) fail('MALFORMED_PNG', `PNG ${type} CRC is invalid.`);

    if (!ihdr) {
      if (type !== 'IHDR' || length !== 13) fail('MALFORMED_PNG', 'PNG must begin with a 13-byte IHDR chunk.');
      ihdr = inspectPngHeader(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IHDR') {
      fail('MALFORMED_PNG', 'PNG contains more than one IHDR chunk.');
    } else if (type === 'PLTE') {
      if (paletteSeen || imageDataStarted || length === 0 || length % 3 !== 0 || length > 768) {
        fail('MALFORMED_PNG', 'PNG palette uniqueness, placement or size is invalid.');
      }
      paletteSeen = true;
      paletteEntries = length / 3;
    } else if (type === 'IDAT') {
      if (imageDataEnded) fail('MALFORMED_PNG', 'PNG IDAT chunks must be consecutive.');
      imageDataStarted = true;
      imageData.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      if (length !== 0 || !imageDataStarted || chunkEnd !== bytes.length) fail('MALFORMED_PNG', 'PNG IEND placement is invalid.');
      terminalSeen = true;
    } else {
      if ((type.charCodeAt(0) & 0x20) === 0) fail('MALFORMED_PNG', `PNG contains unsupported critical chunk ${type}.`);
      if (imageDataStarted) imageDataEnded = true;
    }
    offset = chunkEnd;
    if (terminalSeen) break;
  }
  if (!ihdr || !terminalSeen || offset !== bytes.length) fail('MALFORMED_PNG', 'PNG is missing complete IHDR/IDAT/IEND structure.');
  if (ihdr.colorType === 3 && !paletteSeen) fail('MALFORMED_PNG', 'Indexed PNG requires a PLTE chunk.');
  if (ihdr.colorType === 3 && paletteEntries > 2 ** ihdr.bitDepth) fail('MALFORMED_PNG', 'PNG palette has more entries than its indexed bit depth permits.');
  if ([0, 4].includes(ihdr.colorType) && paletteSeen) fail('MALFORMED_PNG', 'Grayscale PNG cannot contain a PLTE chunk.');
  const expectedInflatedBytes = expectedPngScanlineBytes(ihdr);
  if (expectedInflatedBytes > MAX_PNG_DECOMPRESSED_BYTES) {
    fail('UNSUPPORTED_PNG_SIZE', 'PNG decompressed scanlines exceed the bounded structural-verification limit.', {
      expected_bytes: expectedInflatedBytes,
      maximum_bytes: MAX_PNG_DECOMPRESSED_BYTES,
    });
  }
  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(imageData), { maxOutputLength: expectedInflatedBytes + 1 });
  } catch {
    fail('MALFORMED_PNG', 'PNG IDAT zlib stream cannot be decompressed.');
  }
  validatePngScanlines(inflated, ihdr);
  return {
    media_type: 'image/png', width: ihdr.width, height: ihdr.height,
    bit_depth: ihdr.bitDepth, color_type: ihdr.colorType, structural_validation: 'PASS',
  };
}

function inspectPngHeader(header) {
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8];
  const colorType = header[9];
  const compression = header[10];
  const filter = header[11];
  const interlace = header[12];
  const validDepths = {
    0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16],
  };
  if (width === 0 || height === 0 || !validDepths[colorType]?.includes(bitDepth)
    || compression !== 0 || filter !== 0 || ![0, 1].includes(interlace)) {
    fail('MALFORMED_PNG', 'PNG IHDR values are invalid.');
  }
  return { width, height, bitDepth, colorType, interlace };
}

function validatePngScanlines(inflated, header) {
  if (inflated.length !== expectedPngScanlineBytes(header)) {
    fail('MALFORMED_PNG', 'PNG decompressed data has trailing or missing scanline bytes.');
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  const passes = header.interlace === 0
    ? [[0, 0, 1, 1]]
    : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  let offset = 0;
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = header.width <= startX ? 0 : Math.ceil((header.width - startX) / stepX);
    const passHeight = header.height <= startY ? 0 : Math.ceil((header.height - startY) / stepY);
    if (passWidth === 0 || passHeight === 0) continue;
    const rowBytes = Math.ceil((passWidth * channels * header.bitDepth) / 8);
    for (let row = 0; row < passHeight; row += 1) {
      if (offset >= inflated.length || inflated[offset] > 4 || offset + 1 + rowBytes > inflated.length) {
        fail('MALFORMED_PNG', 'PNG decompressed scanline structure is invalid.');
      }
      offset += 1 + rowBytes;
    }
  }
}

function expectedPngScanlineBytes(header) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  const passes = header.interlace === 0
    ? [[0, 0, 1, 1]]
    : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  let total = 0;
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = header.width <= startX ? 0 : Math.ceil((header.width - startX) / stepX);
    const passHeight = header.height <= startY ? 0 : Math.ceil((header.height - startY) / stepY);
    if (passWidth === 0 || passHeight === 0) continue;
    const rowBytes = Math.ceil((passWidth * channels * header.bitDepth) / 8);
    total += passHeight * (1 + rowBytes);
    if (!Number.isSafeInteger(total)) return Number.POSITIVE_INFINITY;
  }
  return total;
}

const CRC32_TABLE = Object.freeze(Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
}));

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function isJpeg(bytes) {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
}

function inspectJpeg(bytes) {
  let offset = 2;
  let frame = null;
  let scanCount = 0;
  let ended = false;
  const quantizationTables = new Set();
  const huffmanTables = new Set();
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  const arithmeticSofMarkers = new Set([0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) fail('MALFORMED_JPEG', 'JPEG marker alignment is invalid.');
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) fail('MALFORMED_JPEG', 'JPEG ends inside marker fill bytes.');
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      fail('MALFORMED_JPEG', 'JPEG contains a misplaced standalone marker.');
    }
    if (marker === 0xd9) {
      ended = offset === bytes.length;
      break;
    }
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) fail('MALFORMED_JPEG', 'JPEG segment length is truncated.');
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) fail('MALFORMED_JPEG', 'JPEG segment length is invalid.');
    const dataStart = offset + 2;
    const segmentEnd = offset + length;
    if (marker === 0xdb) parseJpegQuantizationTables(bytes, dataStart, segmentEnd, quantizationTables);
    if (marker === 0xc4) parseJpegHuffmanTables(bytes, dataStart, segmentEnd, huffmanTables);
    if (sofMarkers.has(marker)) {
      if (frame) fail('MALFORMED_JPEG', 'JPEG contains multiple frame headers.');
      frame = parseJpegFrame(bytes, marker, dataStart, segmentEnd);
    }
    if (marker !== 0xda) {
      offset = segmentEnd;
      continue;
    }

    if (!frame) fail('MALFORMED_JPEG', 'JPEG scan header precedes a frame header.');
    if (arithmeticSofMarkers.has(frame.marker)) fail('MALFORMED_JPEG', 'Arithmetic-coded JPEG is outside the supported structural-verification profile.');
    validateJpegScan(bytes, dataStart, segmentEnd, frame, quantizationTables, huffmanTables);
    scanCount += 1;
    offset = segmentEnd;
    let scanEntropyBytes = 0;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        scanEntropyBytes += 1;
        offset += 1;
        continue;
      }
      if (offset + 1 >= bytes.length) fail('MALFORMED_JPEG', 'JPEG entropy data ends after a marker prefix.');
      const next = bytes[offset + 1];
      if (next === 0x00) {
        scanEntropyBytes += 1;
        offset += 2;
        continue;
      }
      if (next === 0xff) {
        offset += 1;
        continue;
      }
      if (next >= 0xd0 && next <= 0xd7) {
        offset += 2;
        continue;
      }
      break;
    }
    if (scanEntropyBytes === 0) fail('MALFORMED_JPEG', 'JPEG scan entropy payload is empty.');
  }
  if (!ended || !frame || scanCount === 0) {
    fail('MALFORMED_JPEG', 'JPEG requires a complete frame, non-empty scan data, and terminal EOI.');
  }
  return { media_type: 'image/jpeg', width: frame.width, height: frame.height, scan_count: scanCount, structural_validation: 'PASS' };
}

function parseJpegQuantizationTables(bytes, start, end, tables) {
  let offset = start;
  let parsed = 0;
  while (offset < end) {
    const descriptor = bytes[offset];
    offset += 1;
    const precision = descriptor >>> 4;
    const tableId = descriptor & 0x0f;
    if (precision > 1 || tableId > 3) fail('MALFORMED_JPEG', 'JPEG quantization table descriptor is invalid.');
    const valueBytes = precision === 0 ? 1 : 2;
    const tableBytes = 64 * valueBytes;
    if (offset + tableBytes > end) fail('MALFORMED_JPEG', 'JPEG quantization table is truncated.');
    for (let index = 0; index < 64; index += 1) {
      const value = valueBytes === 1 ? bytes[offset + index] : bytes.readUInt16BE(offset + (index * 2));
      if (value === 0) fail('MALFORMED_JPEG', 'JPEG quantization table contains a zero divisor.');
    }
    tables.add(tableId);
    parsed += 1;
    offset += tableBytes;
  }
  if (parsed === 0 || offset !== end) fail('MALFORMED_JPEG', 'JPEG DQT segment contains no complete table.');
}

function parseJpegHuffmanTables(bytes, start, end, tables) {
  let offset = start;
  let parsed = 0;
  while (offset < end) {
    if (end - offset < 17) fail('MALFORMED_JPEG', 'JPEG Huffman table header is truncated.');
    const descriptor = bytes[offset];
    const tableClass = descriptor >>> 4;
    const tableId = descriptor & 0x0f;
    if (tableClass > 1 || tableId > 3) fail('MALFORMED_JPEG', 'JPEG Huffman table descriptor is invalid.');
    offset += 1;
    const counts = bytes.subarray(offset, offset + 16);
    offset += 16;
    const symbolCount = counts.reduce((total, count) => total + count, 0);
    if (symbolCount === 0 || symbolCount > 256 || offset + symbolCount > end) {
      fail('MALFORMED_JPEG', 'JPEG Huffman table symbols are empty or truncated.');
    }
    let availableCodes = 1;
    for (const count of counts) {
      availableCodes = (availableCodes * 2) - count;
      if (availableCodes < 0) fail('MALFORMED_JPEG', 'JPEG Huffman table is oversubscribed.');
    }
    const symbols = bytes.subarray(offset, offset + symbolCount);
    if (tableClass === 0 && symbols.some((symbol) => symbol > 15)) fail('MALFORMED_JPEG', 'JPEG DC Huffman table contains an invalid symbol.');
    if (tableClass === 1 && symbols.some((symbol) => (symbol & 0x0f) > 10 || ((symbol & 0x0f) === 0 && ![0, 0xf0].includes(symbol)))) {
      fail('MALFORMED_JPEG', 'JPEG AC Huffman table contains an invalid symbol.');
    }
    tables.add(`${tableClass}:${tableId}`);
    parsed += 1;
    offset += symbolCount;
  }
  if (parsed === 0 || offset !== end) fail('MALFORMED_JPEG', 'JPEG DHT segment contains no complete table.');
}

function parseJpegFrame(bytes, marker, start, end) {
  if (end - start < 9) fail('MALFORMED_JPEG', 'JPEG frame header is truncated.');
  const precision = bytes[start];
  const height = bytes.readUInt16BE(start + 1);
  const width = bytes.readUInt16BE(start + 3);
  const componentCount = bytes[start + 5];
  if (![8, 12, 16].includes(precision) || width === 0 || height === 0 || componentCount === 0 || end - start !== 6 + (3 * componentCount)) {
    fail('MALFORMED_JPEG', 'JPEG frame dimensions, precision or component table are invalid.');
  }
  const components = new Map();
  let offset = start + 6;
  for (let index = 0; index < componentCount; index += 1) {
    const componentId = bytes[offset];
    const sampling = bytes[offset + 1];
    const quantizationTable = bytes[offset + 2];
    const horizontalSampling = sampling >>> 4;
    const verticalSampling = sampling & 0x0f;
    if (components.has(componentId) || horizontalSampling < 1 || horizontalSampling > 4 || verticalSampling < 1 || verticalSampling > 4 || quantizationTable > 3) {
      fail('MALFORMED_JPEG', 'JPEG frame component descriptor is invalid.');
    }
    components.set(componentId, { quantizationTable });
    offset += 3;
  }
  return { marker, width, height, precision, components };
}

function validateJpegScan(bytes, start, end, frame, quantizationTables, huffmanTables) {
  if (end - start < 6) fail('MALFORMED_JPEG', 'JPEG scan header is truncated.');
  const componentCount = bytes[start];
  if (componentCount === 0 || componentCount > frame.components.size || end - start !== 4 + (2 * componentCount)) {
    fail('MALFORMED_JPEG', 'JPEG scan component table is invalid.');
  }
  const lossless = [0xc3, 0xc7].includes(frame.marker);
  const scanComponents = new Set();
  let offset = start + 1;
  for (let index = 0; index < componentCount; index += 1) {
    const componentId = bytes[offset];
    const selectors = bytes[offset + 1];
    const dcTable = selectors >>> 4;
    const acTable = selectors & 0x0f;
    const component = frame.components.get(componentId);
    if (!component || scanComponents.has(componentId) || dcTable > 3 || acTable > 3) fail('MALFORMED_JPEG', 'JPEG scan component selector is invalid.');
    if (!lossless && !quantizationTables.has(component.quantizationTable)) fail('MALFORMED_JPEG', 'JPEG scan references an undefined quantization table.');
    if (!huffmanTables.has(`0:${dcTable}`) || (!lossless && !huffmanTables.has(`1:${acTable}`))) {
      fail('MALFORMED_JPEG', 'JPEG scan references an undefined Huffman table.');
    }
    scanComponents.add(componentId);
    offset += 2;
  }
  const spectralStart = bytes[offset];
  const spectralEnd = bytes[offset + 1];
  const approximation = bytes[offset + 2];
  if (frame.marker === 0xc0 && (spectralStart !== 0 || spectralEnd !== 63 || approximation !== 0)) {
    fail('MALFORMED_JPEG', 'Baseline JPEG scan parameters are invalid.');
  }
}

function isGif(bytes) {
  return bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
}

function inspectGif(bytes) {
  if (bytes.length < 14) fail('MALFORMED_GIF', 'GIF is truncated.');
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  if (width === 0 || height === 0) fail('MALFORMED_GIF', 'GIF logical screen dimensions are invalid.');
  const packed = bytes[10];
  let offset = 13;
  if ((packed & 0x80) !== 0) offset += 3 * (2 ** ((packed & 0x07) + 1));
  if (offset > bytes.length) fail('MALFORMED_GIF', 'GIF global color table is truncated.');
  let imageCount = 0;
  let terminated = false;
  while (offset < bytes.length) {
    const marker = bytes[offset];
    if (marker === 0x3b) {
      terminated = offset === bytes.length - 1;
      break;
    }
    if (marker === 0x21) {
      if (offset + 2 > bytes.length) fail('MALFORMED_GIF', 'GIF extension header is truncated.');
      offset = readGifSubBlocks(bytes, offset + 2).nextOffset;
      continue;
    }
    if (marker === 0x2c) {
      if (offset + 10 > bytes.length) fail('MALFORMED_GIF', 'GIF image descriptor is truncated.');
      const imageLeft = bytes.readUInt16LE(offset + 1);
      const imageTop = bytes.readUInt16LE(offset + 3);
      const imageWidth = bytes.readUInt16LE(offset + 5);
      const imageHeight = bytes.readUInt16LE(offset + 7);
      if (imageWidth === 0 || imageHeight === 0 || imageLeft + imageWidth > width || imageTop + imageHeight > height) {
        fail('MALFORMED_GIF', 'GIF image dimensions are invalid.');
      }
      const imagePacked = bytes[offset + 9];
      offset += 10;
      if ((imagePacked & 0x80) !== 0) offset += 3 * (2 ** ((imagePacked & 0x07) + 1));
      if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8) fail('MALFORMED_GIF', 'GIF LZW code size is invalid.');
      const minimumCodeSize = bytes[offset];
      const imageData = readGifSubBlocks(bytes, offset + 1);
      validateGifLzw(imageData.data, minimumCodeSize, imageWidth * imageHeight);
      offset = imageData.nextOffset;
      imageCount += 1;
      continue;
    }
    fail('MALFORMED_GIF', 'GIF contains an unknown or misplaced block marker.');
  }
  if (!terminated || imageCount === 0) fail('MALFORMED_GIF', 'GIF requires at least one image and a terminal trailer.');
  return { media_type: 'image/gif', width, height, frame_count_at_least: imageCount, structural_validation: 'PASS' };
}

function readGifSubBlocks(bytes, start) {
  let offset = start;
  const blocks = [];
  while (offset < bytes.length) {
    const size = bytes[offset];
    offset += 1;
    if (size === 0) return { data: Buffer.concat(blocks), nextOffset: offset };
    if (offset + size > bytes.length) fail('MALFORMED_GIF', 'GIF data sub-block is truncated.');
    blocks.push(bytes.subarray(offset, offset + size));
    offset += size;
  }
  fail('MALFORMED_GIF', 'GIF data sub-blocks have no terminator.');
}

function validateGifLzw(data, minimumCodeSize, expectedPixels) {
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;
  const codeLengths = new Uint32Array(4096);
  let codeSize;
  let nextCode;
  let previousCode;
  let bitOffset = 0;
  let decodedPixels = 0;

  const reset = () => {
    codeLengths.fill(0);
    for (let code = 0; code < clearCode; code += 1) codeLengths[code] = 1;
    codeSize = minimumCodeSize + 1;
    nextCode = endCode + 1;
    previousCode = null;
  };
  reset();

  while (bitOffset + codeSize <= data.length * 8) {
    let code = 0;
    for (let bit = 0; bit < codeSize; bit += 1) {
      const sourceBit = bitOffset + bit;
      code |= ((data[sourceBit >>> 3] >>> (sourceBit & 7)) & 1) << bit;
    }
    bitOffset += codeSize;
    if (code === clearCode) {
      reset();
      continue;
    }
    if (code === endCode) {
      if (decodedPixels !== expectedPixels) fail('MALFORMED_GIF', 'GIF LZW stream ends before producing the declared image.');
      return;
    }
    if (code > nextCode || (code === nextCode && previousCode === null)) {
      fail('MALFORMED_GIF', 'GIF LZW stream contains an invalid dictionary code.');
    }
    const currentLength = code === nextCode ? codeLengths[previousCode] + 1 : codeLengths[code];
    if (currentLength === 0) fail('MALFORMED_GIF', 'GIF LZW stream references an undefined dictionary code.');
    decodedPixels += currentLength;
    if (decodedPixels > expectedPixels) fail('MALFORMED_GIF', 'GIF LZW stream produces more pixels than the image descriptor permits.');
    if (previousCode !== null && nextCode < 4096) {
      codeLengths[nextCode] = codeLengths[previousCode] + 1;
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    previousCode = code;
  }
  fail('MALFORMED_GIF', 'GIF LZW stream is truncated before its EOI code.');
}

function isWebp(bytes) {
  return bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

function inspectWebp(bytes) {
  const declaredLength = bytes.readUInt32LE(4) + 8;
  if (declaredLength !== bytes.length) fail('MALFORMED_WEBP', 'WebP RIFF length does not match the file.');
  const chunks = parseRiffChunks(bytes, 12, 'WEBP');
  const extendedHeaders = chunks.filter((chunk) => chunk.type === 'VP8X');
  if (extendedHeaders.length === 0) {
    const images = chunks.filter((chunk) => ['VP8 ', 'VP8L'].includes(chunk.type));
    if (images.length !== 1 || chunks.some((chunk) => ['ANIM', 'ANMF'].includes(chunk.type))) {
      fail('MALFORMED_WEBP', 'Simple WebP requires exactly one top-level image bitstream.');
    }
    const image = inspectWebpBitstream(bytes, images[0]);
    return { media_type: 'image/webp', width: image.width, height: image.height, structural_validation: 'PASS' };
  }
  if (extendedHeaders.length !== 1 || chunks[0] !== extendedHeaders[0] || extendedHeaders[0].size !== 10) {
    fail('MALFORMED_WEBP', 'Extended WebP requires one leading 10-byte VP8X header.');
  }
  const vp8x = extendedHeaders[0];
  const flags = bytes[vp8x.dataStart];
  if ((flags & 0xc1) !== 0 || !bytes.subarray(vp8x.dataStart + 1, vp8x.dataStart + 4).equals(Buffer.alloc(3))) {
    fail('MALFORMED_WEBP', 'WebP VP8X reserved feature bits are nonzero.');
  }
  const width = 1 + readUInt24LE(bytes, vp8x.dataStart + 4);
  const height = 1 + readUInt24LE(bytes, vp8x.dataStart + 7);
  if (width * height > 0xffffffff) fail('MALFORMED_WEBP', 'WebP VP8X canvas exceeds the format pixel limit.');
  const animationEnabled = (flags & 0x02) !== 0;
  const animations = chunks.filter((chunk) => chunk.type === 'ANIM');
  const frames = chunks.filter((chunk) => chunk.type === 'ANMF');
  const topLevelImages = chunks.filter((chunk) => ['VP8 ', 'VP8L'].includes(chunk.type));
  if (!animationEnabled) {
    if (animations.length > 0 || frames.length > 0 || topLevelImages.length !== 1) {
      fail('MALFORMED_WEBP', 'Static extended WebP has inconsistent animation or image chunks.');
    }
    const image = inspectWebpBitstream(bytes, topLevelImages[0]);
    if (image.width !== width || image.height !== height) fail('MALFORMED_WEBP', 'WebP bitstream dimensions disagree with the VP8X canvas.');
    return { media_type: 'image/webp', width, height, structural_validation: 'PASS' };
  }
  if (animations.length !== 1 || animations[0].size !== 6 || frames.length === 0 || topLevelImages.length > 0
    || chunks.indexOf(animations[0]) > chunks.indexOf(frames[0])) {
    fail('MALFORMED_WEBP', 'Animated WebP requires one ANIM header followed by ANMF frames.');
  }
  for (const frame of frames) inspectWebpAnimationFrame(bytes, frame, width, height);
  return { media_type: 'image/webp', width, height, frame_count: frames.length, structural_validation: 'PASS' };
}

function inspectWebpBitstream(bytes, image) {
  let width;
  let height;
  if (image.type === 'VP8L') {
    if (image.size <= 5 || bytes[image.dataStart] !== 0x2f) fail('MALFORMED_WEBP', 'WebP lossless bitstream is missing its coded image payload.');
    const dimensions = bytes.readUInt32LE(image.dataStart + 1);
    if ((dimensions >>> 29) !== 0) fail('MALFORMED_WEBP', 'WebP lossless bitstream version is unsupported.');
    width = 1 + (dimensions & 0x3fff);
    height = 1 + ((dimensions >>> 14) & 0x3fff);
  } else {
    if (image.size <= 10 || !bytes.subarray(image.dataStart + 3, image.dataStart + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      fail('MALFORMED_WEBP', 'WebP lossy frame header is invalid.');
    }
    const frameTag = bytes.readUIntLE(image.dataStart, 3);
    const keyFrame = (frameTag & 1) === 0;
    const version = (frameTag >>> 1) & 0x07;
    const showFrame = (frameTag & 0x10) !== 0;
    const firstPartitionLength = frameTag >>> 5;
    if (!keyFrame || version > 3 || !showFrame || firstPartitionLength === 0 || 10 + firstPartitionLength > image.size) {
      fail('MALFORMED_WEBP', 'WebP lossy frame tag or first partition is invalid.');
    }
    width = bytes.readUInt16LE(image.dataStart + 6) & 0x3fff;
    height = bytes.readUInt16LE(image.dataStart + 8) & 0x3fff;
  }
  if (width === 0 || height === 0) fail('MALFORMED_WEBP', 'WebP dimensions are invalid.');
  return { width, height };
}

function inspectWebpAnimationFrame(bytes, frame, canvasWidth, canvasHeight) {
  if (frame.size < 16) fail('MALFORMED_WEBP', 'WebP ANMF frame header is truncated.');
  const x = 2 * readUInt24LE(bytes, frame.dataStart);
  const y = 2 * readUInt24LE(bytes, frame.dataStart + 3);
  const width = 1 + readUInt24LE(bytes, frame.dataStart + 6);
  const height = 1 + readUInt24LE(bytes, frame.dataStart + 9);
  const flags = bytes[frame.dataStart + 15];
  if ((flags & 0xfc) !== 0 || x + width > canvasWidth || y + height > canvasHeight) {
    fail('MALFORMED_WEBP', 'WebP ANMF frame geometry or flags are invalid.');
  }
  const frameChunks = parseRiffChunks(bytes, frame.dataStart + 16, 'WEBP', frame.end);
  const images = frameChunks.filter((chunk) => ['VP8 ', 'VP8L'].includes(chunk.type));
  const alphaChunks = frameChunks.filter((chunk) => chunk.type === 'ALPH');
  if (images.length !== 1 || alphaChunks.length > 1 || (alphaChunks.length === 1 && frameChunks.indexOf(alphaChunks[0]) > frameChunks.indexOf(images[0]))) {
    fail('MALFORMED_WEBP', 'WebP ANMF frame requires one image bitstream and optional alpha data.');
  }
  const image = inspectWebpBitstream(bytes, images[0]);
  if (image.width !== width || image.height !== height) fail('MALFORMED_WEBP', 'WebP ANMF dimensions disagree with its image bitstream.');
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function isWav(bytes) {
  return bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE';
}

function inspectWav(bytes) {
  const declaredLength = bytes.readUInt32LE(4) + 8;
  if (declaredLength !== bytes.length) fail('MALFORMED_WAV', 'WAV RIFF length does not match the file.');
  const chunks = parseRiffChunks(bytes, 12, 'WAV');
  const formats = chunks.filter((chunk) => chunk.type === 'fmt ');
  const dataChunks = chunks.filter((chunk) => chunk.type === 'data');
  if (formats.length !== 1 || dataChunks.length !== 1 || formats[0].size < 16 || dataChunks[0].size === 0) {
    fail('MALFORMED_WAV', 'WAV requires one valid fmt chunk and one non-empty data chunk.');
  }
  const format = formats[0];
  const data = dataChunks[0];
  if (format.size !== 16) {
    if (format.size < 18) fail('MALFORMED_WAV', 'WAV extended fmt chunk has no complete cbSize field.');
    const extensionSize = bytes.readUInt16LE(format.dataStart + 16);
    if (format.size !== 18 + extensionSize) fail('MALFORMED_WAV', 'WAV fmt cbSize does not match the chunk payload.');
  }
  const audioFormat = bytes.readUInt16LE(format.dataStart);
  const channels = bytes.readUInt16LE(format.dataStart + 2);
  const sampleRate = bytes.readUInt32LE(format.dataStart + 4);
  const byteRate = bytes.readUInt32LE(format.dataStart + 8);
  const blockAlign = bytes.readUInt16LE(format.dataStart + 12);
  const bitsPerSample = bytes.readUInt16LE(format.dataStart + 14);
  let effectiveFormat = audioFormat;
  if (audioFormat === 0xfffe) {
    if (format.size < 40 || bytes.readUInt16LE(format.dataStart + 16) < 22) fail('MALFORMED_WAV', 'WAV extensible format payload is truncated.');
    const validBitsPerSample = bytes.readUInt16LE(format.dataStart + 18);
    if (validBitsPerSample === 0 || validBitsPerSample > bitsPerSample) fail('MALFORMED_WAV', 'WAV extensible valid-bit count is invalid.');
    const subformat = bytes.subarray(format.dataStart + 24, format.dataStart + 40);
    const pcmTail = Buffer.from('000000001000800000aa00389b71', 'hex');
    if (!subformat.subarray(2).equals(pcmTail)) fail('MALFORMED_WAV', 'WAV extensible subformat GUID is unsupported.');
    effectiveFormat = subformat.readUInt16LE(0);
  }
  const supportedDepth = (effectiveFormat === 1 && [8, 16, 24, 32].includes(bitsPerSample))
    || (effectiveFormat === 3 && [32, 64].includes(bitsPerSample));
  const expectedBlockAlign = channels * (bitsPerSample / 8);
  const expectedByteRate = sampleRate * expectedBlockAlign;
  if (!supportedDepth || channels === 0 || sampleRate === 0
    || !Number.isSafeInteger(expectedBlockAlign) || blockAlign !== expectedBlockAlign
    || byteRate !== expectedByteRate || data.size % blockAlign !== 0) {
    fail('MALFORMED_WAV', 'WAV format values are invalid.');
  }
  return {
    media_type: 'audio/wav', channels, sample_rate: sampleRate, bits_per_sample: bitsPerSample,
    duration_seconds: data.size / byteRate, structural_validation: 'PASS',
  };
}

function parseRiffChunks(bytes, start, context, limit = bytes.length) {
  const chunks = [];
  let offset = start;
  while (offset < limit) {
    if (limit - offset < 8) fail(`MALFORMED_${context}`, `${context} chunk header is truncated.`);
    const type = bytes.toString('ascii', offset, offset + 4);
    if (!/^[\x20-\x7e]{4}$/.test(type)) fail(`MALFORMED_${context}`, `${context} chunk type is invalid.`);
    const size = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const end = dataStart + size;
    if (end > limit) fail(`MALFORMED_${context}`, `${context} chunk ${type} is truncated.`);
    chunks.push({ type, size, dataStart, end });
    if (context === 'WEBP' && size % 2 === 1 && (end >= limit || bytes[end] !== 0)) {
      fail('MALFORMED_WEBP', 'WebP RIFF chunk padding must be a zero byte.');
    }
    offset = end + (size % 2);
  }
  if (offset !== limit) fail(`MALFORMED_${context}`, `${context} chunk padding is invalid.`);
  return chunks;
}

function isMp4(bytes) {
  return bytes.length >= 24 && bytes.toString('ascii', 4, 8) === 'ftyp';
}

function inspectMp4(bytes) {
  const topLevel = parseIsoBoxes(bytes, 0, bytes.length, 'MP4');
  const ftyp = requireSingleIsoBox(topLevel, 'ftyp', 'MP4');
  const moov = requireSingleIsoBox(topLevel, 'moov', 'MP4');
  const mediaData = topLevel.filter((box) => box.type === 'mdat');
  if (ftyp !== topLevel[0]) fail('MALFORMED_MP4', 'MP4 ftyp must be the first top-level box.');
  validateFileTypeBox(bytes, ftyp);
  if (!mediaData.some((box) => box.payloadLength > 0)) fail('MALFORMED_MP4', 'MP4 has no non-empty media data box.');

  const movieChildren = parseIsoBoxes(bytes, moov.payloadStart, moov.end, 'moov');
  inspectMovieHeader(bytes, requireSingleIsoBox(movieChildren, 'mvhd', 'moov'));
  const tracks = movieChildren.filter((box) => box.type === 'trak');
  if (tracks.length === 0) fail('MALFORMED_MP4', 'MP4 moov has no track.');
  const inspectedTracks = tracks.map((track) => inspectMp4Track(bytes, track, mediaData));
  if (new Set(inspectedTracks.map((track) => track.trackId)).size !== inspectedTracks.length) {
    fail('MALFORMED_MP4', 'MP4 track identifiers must be unique.');
  }
  return {
    media_type: 'video/mp4',
    track_count: tracks.length,
    track_types: inspectedTracks.map((track) => track.type),
    structural_validation: 'PASS',
  };
}

function inspectMp4Track(bytes, track, mediaData) {
  const trackChildren = parseIsoBoxes(bytes, track.payloadStart, track.end, 'trak');
  const trackHeader = inspectTrackHeader(bytes, requireSingleIsoBox(trackChildren, 'tkhd', 'trak'));
  const mdia = requireSingleIsoBox(trackChildren, 'mdia', 'trak');
  const mediaChildren = parseIsoBoxes(bytes, mdia.payloadStart, mdia.end, 'mdia');
  const mediaHeader = inspectMediaHeader(bytes, requireSingleIsoBox(mediaChildren, 'mdhd', 'mdia'));
  const hdlr = requireSingleIsoBox(mediaChildren, 'hdlr', 'mdia');
  const minf = requireSingleIsoBox(mediaChildren, 'minf', 'mdia');
  if (hdlr.payloadLength < 24 || bytes[hdlr.payloadStart] !== 0) fail('MALFORMED_MP4', 'MP4 handler box is truncated or has an unsupported version.');
  const handlerType = bytes.toString('ascii', hdlr.payloadStart + 8, hdlr.payloadStart + 12);
  if (!['vide', 'soun'].includes(handlerType)) fail('MALFORMED_MP4', 'MP4 track handler is unsupported.', { handlerType });

  const mediaInfoChildren = parseIsoBoxes(bytes, minf.payloadStart, minf.end, 'minf');
  const expectedMediaHeader = handlerType === 'vide' ? 'vmhd' : 'smhd';
  assertVersionZeroFullBox(
    bytes,
    requireSingleIsoBox(mediaInfoChildren, expectedMediaHeader, 'minf'),
    handlerType === 'vide' ? 12 : 8,
    expectedMediaHeader,
  );
  inspectDataInformation(bytes, requireSingleIsoBox(mediaInfoChildren, 'dinf', 'minf'));
  const stbl = requireSingleIsoBox(mediaInfoChildren, 'stbl', 'minf');
  const sampleTableChildren = parseIsoBoxes(bytes, stbl.payloadStart, stbl.end, 'stbl');
  const descriptionCount = inspectSampleDescriptions(
    bytes,
    requireSingleIsoBox(sampleTableChildren, 'stsd', 'stbl'),
    handlerType,
  );
  const timing = inspectTimeToSample(bytes, requireSingleIsoBox(sampleTableChildren, 'stts', 'stbl'));
  const sampleSizeBoxes = sampleTableChildren.filter((box) => ['stsz', 'stz2'].includes(box.type));
  if (sampleSizeBoxes.length !== 1) fail('MALFORMED_MP4', 'MP4 sample table requires exactly one sample-size box.');
  const sampleSizes = sampleSizeBoxes[0].type === 'stsz'
    ? inspectSampleSizes(bytes, sampleSizeBoxes[0])
    : inspectCompactSampleSizes(bytes, sampleSizeBoxes[0]);
  if (timing.sampleCount !== BigInt(sampleSizes.sampleCount) || timing.duration !== mediaHeader.duration) {
    fail('MALFORMED_MP4', 'MP4 sample timing disagrees with sample count or media duration.');
  }
  const chunkOffsetBoxes = sampleTableChildren.filter((box) => ['stco', 'co64'].includes(box.type));
  if (chunkOffsetBoxes.length !== 1) fail('MALFORMED_MP4', 'MP4 sample table requires exactly one chunk-offset box.');
  const chunkOffsets = inspectChunkOffsets(bytes, chunkOffsetBoxes[0]);
  const sampleToChunk = inspectSampleToChunk(
    bytes,
    requireSingleIsoBox(sampleTableChildren, 'stsc', 'stbl'),
    descriptionCount,
    chunkOffsets.length,
  );
  validateMp4SampleLocations(sampleToChunk, sampleSizes, chunkOffsets, mediaData);
  return { trackId: trackHeader.trackId, type: handlerType === 'vide' ? 'video' : 'audio' };
}

function requireSingleIsoBox(boxes, type, context) {
  const matches = boxes.filter((box) => box.type === type);
  if (matches.length !== 1) fail('MALFORMED_MP4', `${context} requires exactly one ${type} box.`);
  return matches[0];
}

function validateFileTypeBox(bytes, box) {
  if (box.payloadLength < 8 || (box.payloadLength - 8) % 4 !== 0) fail('MALFORMED_MP4', 'MP4 ftyp payload is invalid.');
  const brands = [bytes.toString('ascii', box.payloadStart, box.payloadStart + 4)];
  for (let offset = box.payloadStart + 8; offset < box.end; offset += 4) brands.push(bytes.toString('ascii', offset, offset + 4));
  if (brands.some((brand) => !/^[\x20-\x7e]{4}$/.test(brand))) fail('MALFORMED_MP4', 'MP4 ftyp contains an invalid brand.');
}

function inspectMovieHeader(bytes, box) {
  const layout = versionedIsoLayout(bytes, box, 100, 112, 'mvhd');
  const timescale = bytes.readUInt32BE(box.payloadStart + layout.timescaleOffset);
  const duration = readIsoDuration(bytes, box.payloadStart + layout.durationOffset, layout.version);
  const nextTrackId = bytes.readUInt32BE(box.payloadStart + (layout.version === 0 ? 96 : 108));
  if (timescale === 0 || duration === 0n || nextTrackId === 0) fail('MALFORMED_MP4', 'MP4 movie header timing or next track ID is invalid.');
}

function inspectTrackHeader(bytes, box) {
  const layout = versionedIsoLayout(bytes, box, 84, 96, 'tkhd');
  const trackId = bytes.readUInt32BE(box.payloadStart + (layout.version === 0 ? 12 : 20));
  const duration = readIsoDuration(bytes, box.payloadStart + (layout.version === 0 ? 20 : 28), layout.version);
  if (trackId === 0 || duration === 0n) fail('MALFORMED_MP4', 'MP4 track header identity or duration is invalid.');
  return { trackId, duration };
}

function inspectMediaHeader(bytes, box) {
  const layout = versionedIsoLayout(bytes, box, 24, 36, 'mdhd');
  const timescale = bytes.readUInt32BE(box.payloadStart + layout.timescaleOffset);
  const duration = readIsoDuration(bytes, box.payloadStart + layout.durationOffset, layout.version);
  if (timescale === 0 || duration === 0n) fail('MALFORMED_MP4', 'MP4 media header timing is invalid.');
  return { timescale, duration };
}

function versionedIsoLayout(bytes, box, version0Length, version1Length, type) {
  if (box.payloadLength < 4) fail('MALFORMED_MP4', `MP4 ${type} full-box header is truncated.`);
  const version = bytes[box.payloadStart];
  const requiredLength = version === 0 ? version0Length : version === 1 ? version1Length : 0;
  if (requiredLength === 0 || box.payloadLength < requiredLength) fail('MALFORMED_MP4', `MP4 ${type} version or payload length is invalid.`);
  return {
    version,
    timescaleOffset: version === 0 ? 12 : 20,
    durationOffset: version === 0 ? 16 : 24,
  };
}

function readIsoDuration(bytes, offset, version) {
  return version === 0 ? BigInt(bytes.readUInt32BE(offset)) : bytes.readBigUInt64BE(offset);
}

function inspectDataInformation(bytes, dinf) {
  const children = parseIsoBoxes(bytes, dinf.payloadStart, dinf.end, 'dinf');
  const dref = requireSingleIsoBox(children, 'dref', 'dinf');
  assertVersionZeroFullBox(bytes, dref, 8, 'dref');
  const entryCount = bytes.readUInt32BE(dref.payloadStart + 4);
  const entries = parseIsoBoxes(bytes, dref.payloadStart + 8, dref.end, 'dref');
  if (entryCount === 0 || entryCount !== entries.length || entries.some((entry) => !['url ', 'urn '].includes(entry.type) || entry.payloadLength < 4)) {
    fail('MALFORMED_MP4', 'MP4 data references are invalid.');
  }
}

function inspectSampleDescriptions(bytes, stsd, handlerType) {
  assertVersionZeroFullBox(bytes, stsd, 8, 'stsd');
  const entryCount = bytes.readUInt32BE(stsd.payloadStart + 4);
  const entries = parseIsoBoxes(bytes, stsd.payloadStart + 8, stsd.end, 'stsd');
  const allowedEntries = handlerType === 'vide'
    ? ['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09', 'mp4v']
    : ['mp4a', 'Opus', 'ac-3', 'ec-3'];
  if (entryCount === 0 || entryCount !== entries.length || entries.some((entry) => !allowedEntries.includes(entry.type))) {
    fail('MALFORMED_MP4', 'MP4 sample descriptions do not match the declared track handler.');
  }
  for (const entry of entries) inspectSampleEntry(bytes, entry, handlerType);
  return entryCount;
}

function inspectSampleEntry(bytes, entry, handlerType) {
  const headerLength = handlerType === 'vide' ? 78 : 28;
  if (entry.payloadLength < headerLength || bytes.readUInt16BE(entry.payloadStart + 6) === 0) {
    fail('MALFORMED_MP4', 'MP4 sample entry header is truncated or has no data reference.');
  }
  if (handlerType === 'vide') {
    if (bytes.readUInt16BE(entry.payloadStart + 24) === 0 || bytes.readUInt16BE(entry.payloadStart + 26) === 0) {
      fail('MALFORMED_MP4', 'MP4 visual sample entry dimensions are invalid.');
    }
  } else if (bytes.readUInt16BE(entry.payloadStart + 16) === 0 || bytes.readUInt32BE(entry.payloadStart + 24) === 0) {
    fail('MALFORMED_MP4', 'MP4 audio sample entry channels or sample rate are invalid.');
  }
  const children = parseIsoBoxes(bytes, entry.payloadStart + headerLength, entry.end, entry.type);
  const configType = {
    avc1: 'avcC', avc3: 'avcC', hvc1: 'hvcC', hev1: 'hvcC', av01: 'av1C', vp09: 'vpcC', mp4v: 'esds',
    mp4a: 'esds', Opus: 'dOps', 'ac-3': 'dac3', 'ec-3': 'dec3',
  }[entry.type];
  const config = requireSingleIsoBox(children, configType, entry.type);
  inspectCodecConfiguration(bytes, config, entry.type);
}

function inspectCodecConfiguration(bytes, config, sampleEntryType) {
  if (config.type === 'avcC') return inspectAvcConfiguration(bytes, config, sampleEntryType === 'avc3');
  if (config.type === 'hvcC') return inspectHevcConfiguration(bytes, config, sampleEntryType === 'hev1');
  if (config.type === 'av1C') {
    if (config.payloadLength < 4 || bytes[config.payloadStart] !== 0x81) fail('MALFORMED_MP4', 'MP4 AV1 configuration record is invalid.');
    return;
  }
  if (config.type === 'vpcC') {
    if (config.payloadLength < 12) fail('MALFORMED_MP4', 'MP4 VP codec configuration record is truncated.');
    return;
  }
  if (config.payloadLength === 0 || (config.type === 'esds' && (config.payloadLength < 8 || bytes[config.payloadStart] !== 0))) {
    fail('MALFORMED_MP4', `MP4 ${config.type} codec configuration is empty or truncated.`);
  }
}

function inspectAvcConfiguration(bytes, config, permitsInBandParameters) {
  const start = config.payloadStart;
  if (config.payloadLength < 7 || bytes[start] !== 1 || (bytes[start + 4] & 0xfc) !== 0xfc || (bytes[start + 5] & 0xe0) !== 0xe0) {
    fail('MALFORMED_MP4', 'MP4 AVC configuration record header is invalid.');
  }
  let offset = start + 6;
  const sequenceParameterSets = bytes[start + 5] & 0x1f;
  if (sequenceParameterSets === 0 && !permitsInBandParameters) fail('MALFORMED_MP4', 'MP4 AVC configuration has no sequence parameter set.');
  for (let index = 0; index < sequenceParameterSets; index += 1) {
    if (offset + 2 > config.end) fail('MALFORMED_MP4', 'MP4 AVC sequence parameter set length is truncated.');
    const length = bytes.readUInt16BE(offset);
    offset += 2;
    if (length === 0 || offset + length > config.end || (bytes[offset] & 0x1f) !== 7) fail('MALFORMED_MP4', 'MP4 AVC sequence parameter set is invalid.');
    offset += length;
  }
  if (offset >= config.end) fail('MALFORMED_MP4', 'MP4 AVC picture parameter set count is missing.');
  const pictureParameterSets = bytes[offset];
  offset += 1;
  if (pictureParameterSets === 0 && !permitsInBandParameters) fail('MALFORMED_MP4', 'MP4 AVC configuration has no picture parameter set.');
  for (let index = 0; index < pictureParameterSets; index += 1) {
    if (offset + 2 > config.end) fail('MALFORMED_MP4', 'MP4 AVC picture parameter set length is truncated.');
    const length = bytes.readUInt16BE(offset);
    offset += 2;
    if (length === 0 || offset + length > config.end || (bytes[offset] & 0x1f) !== 8) fail('MALFORMED_MP4', 'MP4 AVC picture parameter set is invalid.');
    offset += length;
  }
  if (offset === config.end) return;
  const extendedProfiles = new Set([44, 83, 86, 100, 110, 118, 122, 128, 134, 135, 138, 139, 144]);
  if (!extendedProfiles.has(bytes[start + 1]) || config.end - offset < 4
    || (bytes[offset] & 0xfc) !== 0xfc || (bytes[offset + 1] & 0xf8) !== 0xf8 || (bytes[offset + 2] & 0xf8) !== 0xf8) {
    fail('MALFORMED_MP4', 'MP4 AVC high-profile configuration extension is invalid.');
  }
  const sequenceParameterSetExtensions = bytes[offset + 3];
  offset += 4;
  for (let index = 0; index < sequenceParameterSetExtensions; index += 1) {
    if (offset + 2 > config.end) fail('MALFORMED_MP4', 'MP4 AVC sequence parameter set extension length is truncated.');
    const length = bytes.readUInt16BE(offset);
    offset += 2;
    if (length === 0 || offset + length > config.end) fail('MALFORMED_MP4', 'MP4 AVC sequence parameter set extension is invalid.');
    offset += length;
  }
  if (offset !== config.end) fail('MALFORMED_MP4', 'MP4 AVC configuration has unsupported trailing bytes.');
}

function inspectHevcConfiguration(bytes, config, permitsInBandParameters) {
  const start = config.payloadStart;
  if (config.payloadLength < 23 || bytes[start] !== 1) fail('MALFORMED_MP4', 'MP4 HEVC configuration record is truncated.');
  const arrayCount = bytes[start + 22];
  if (arrayCount === 0 && !permitsInBandParameters) fail('MALFORMED_MP4', 'MP4 HEVC configuration has no NAL-unit arrays.');
  let offset = start + 23;
  for (let arrayIndex = 0; arrayIndex < arrayCount; arrayIndex += 1) {
    if (offset + 3 > config.end) fail('MALFORMED_MP4', 'MP4 HEVC NAL-unit array header is truncated.');
    const unitCount = bytes.readUInt16BE(offset + 1);
    offset += 3;
    if (unitCount === 0) fail('MALFORMED_MP4', 'MP4 HEVC NAL-unit array is empty.');
    for (let unitIndex = 0; unitIndex < unitCount; unitIndex += 1) {
      if (offset + 2 > config.end) fail('MALFORMED_MP4', 'MP4 HEVC NAL-unit length is truncated.');
      const length = bytes.readUInt16BE(offset);
      offset += 2;
      if (length === 0 || offset + length > config.end) fail('MALFORMED_MP4', 'MP4 HEVC NAL unit is empty or truncated.');
      offset += length;
    }
  }
  if (offset !== config.end) fail('MALFORMED_MP4', 'MP4 HEVC configuration has trailing bytes.');
}

function inspectTimeToSample(bytes, box) {
  assertVersionZeroFullBox(bytes, box, 8, 'stts');
  const entryCount = bytes.readUInt32BE(box.payloadStart + 4);
  if (entryCount === 0 || box.payloadLength !== 8 + (entryCount * 8)) fail('MALFORMED_MP4', 'MP4 time-to-sample table is empty or truncated.');
  let sampleCount = 0n;
  let duration = 0n;
  for (let index = 0; index < entryCount; index += 1) {
    const offset = box.payloadStart + 8 + (index * 8);
    const count = bytes.readUInt32BE(offset);
    const delta = bytes.readUInt32BE(offset + 4);
    if (count === 0 || delta === 0) fail('MALFORMED_MP4', 'MP4 time-to-sample entry is invalid.');
    sampleCount += BigInt(count);
    duration += BigInt(count) * BigInt(delta);
  }
  return { sampleCount, duration };
}

function inspectSampleSizes(bytes, box) {
  assertVersionZeroFullBox(bytes, box, 12, 'stsz');
  const commonSize = bytes.readUInt32BE(box.payloadStart + 4);
  const sampleCount = bytes.readUInt32BE(box.payloadStart + 8);
  const expectedLength = commonSize === 0 ? 12 + (sampleCount * 4) : 12;
  if (sampleCount === 0 || box.payloadLength !== expectedLength) fail('MALFORMED_MP4', 'MP4 sample-size table is empty or truncated.');
  let sizes = null;
  if (commonSize === 0) {
    sizes = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const size = bytes.readUInt32BE(box.payloadStart + 12 + (index * 4));
      if (size === 0) fail('MALFORMED_MP4', 'MP4 sample-size table contains an empty sample.');
      sizes.push(size);
    }
  }
  return { commonSize, sampleCount, sizes };
}

function inspectCompactSampleSizes(bytes, box) {
  assertVersionZeroFullBox(bytes, box, 12, 'stz2');
  const fieldSize = bytes[box.payloadStart + 7];
  const sampleCount = bytes.readUInt32BE(box.payloadStart + 8);
  const packedBytes = fieldSize === 4 ? Math.ceil(sampleCount / 2) : fieldSize === 8 ? sampleCount : fieldSize === 16 ? sampleCount * 2 : -1;
  if (sampleCount === 0 || packedBytes < 0 || box.payloadLength !== 12 + packedBytes) {
    fail('MALFORMED_MP4', 'MP4 compact sample-size table is empty or truncated.');
  }
  const sizes = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const entryOffset = box.payloadStart + 12;
    const size = fieldSize === 4
      ? ((bytes[entryOffset + (index >>> 1)] >>> (index % 2 === 0 ? 4 : 0)) & 0x0f)
      : fieldSize === 8
        ? bytes[entryOffset + index]
        : bytes.readUInt16BE(entryOffset + (index * 2));
    if (size === 0) fail('MALFORMED_MP4', 'MP4 compact sample-size table contains an empty sample.');
    sizes.push(size);
  }
  return { commonSize: 0, sampleCount, sizes };
}

function inspectChunkOffsets(bytes, box) {
  assertVersionZeroFullBox(bytes, box, 8, box.type);
  const entryCount = bytes.readUInt32BE(box.payloadStart + 4);
  const width = box.type === 'stco' ? 4 : 8;
  if (entryCount === 0 || box.payloadLength !== 8 + (entryCount * width)) fail('MALFORMED_MP4', 'MP4 chunk-offset table is empty or truncated.');
  const offsets = [];
  for (let index = 0; index < entryCount; index += 1) {
    const offset = box.payloadStart + 8 + (index * width);
    offsets.push(width === 4 ? BigInt(bytes.readUInt32BE(offset)) : bytes.readBigUInt64BE(offset));
  }
  return offsets;
}

function inspectSampleToChunk(bytes, box, descriptionCount, chunkCount) {
  assertVersionZeroFullBox(bytes, box, 8, 'stsc');
  const entryCount = bytes.readUInt32BE(box.payloadStart + 4);
  if (entryCount === 0 || box.payloadLength !== 8 + (entryCount * 12)) fail('MALFORMED_MP4', 'MP4 sample-to-chunk table is empty or truncated.');
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    const offset = box.payloadStart + 8 + (index * 12);
    const firstChunk = bytes.readUInt32BE(offset);
    const samplesPerChunk = bytes.readUInt32BE(offset + 4);
    const descriptionIndex = bytes.readUInt32BE(offset + 8);
    if ((index === 0 && firstChunk !== 1) || (index > 0 && firstChunk <= entries[index - 1].firstChunk)
      || firstChunk > chunkCount || samplesPerChunk === 0 || descriptionIndex === 0 || descriptionIndex > descriptionCount) {
      fail('MALFORMED_MP4', 'MP4 sample-to-chunk entry is invalid.');
    }
    entries.push({ firstChunk, samplesPerChunk });
  }
  return entries;
}

function validateMp4SampleLocations(sampleToChunk, sampleSizes, chunkOffsets, mediaData) {
  let mappingIndex = 0;
  let sampleIndex = 0;
  for (let chunkIndex = 0; chunkIndex < chunkOffsets.length; chunkIndex += 1) {
    const chunkNumber = chunkIndex + 1;
    if (mappingIndex + 1 < sampleToChunk.length && chunkNumber >= sampleToChunk[mappingIndex + 1].firstChunk) mappingIndex += 1;
    const samplesInChunk = sampleToChunk[mappingIndex].samplesPerChunk;
    if (sampleIndex + samplesInChunk > sampleSizes.sampleCount) fail('MALFORMED_MP4', 'MP4 chunk mapping exceeds the sample-size table.');
    let chunkSize = 0n;
    for (let index = 0; index < samplesInChunk; index += 1) {
      chunkSize += BigInt(sampleSizes.commonSize || sampleSizes.sizes[sampleIndex + index]);
    }
    const chunkStart = chunkOffsets[chunkIndex];
    const chunkEnd = chunkStart + chunkSize;
    const contained = mediaData.some((mdat) => chunkStart >= BigInt(mdat.payloadStart) && chunkEnd <= BigInt(mdat.end));
    if (!contained) fail('MALFORMED_MP4', 'MP4 chunk offset or sample bytes fall outside media data.');
    sampleIndex += samplesInChunk;
  }
  if (sampleIndex !== sampleSizes.sampleCount) fail('MALFORMED_MP4', 'MP4 chunk mapping does not account for every sample.');
}

function assertVersionZeroFullBox(bytes, box, minimumLength, type) {
  if (box.payloadLength < minimumLength || bytes[box.payloadStart] !== 0) {
    fail('MALFORMED_MP4', `MP4 ${type} full-box header is truncated or has an unsupported version.`);
  }
}

function parseIsoBoxes(bytes, start, end, context) {
  const boxes = [];
  let offset = start;
  while (offset < end) {
    if (end - offset < 8) fail('MALFORMED_MP4', `${context} contains a truncated box header.`);
    const declaredSize = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[\x20-\x7e]{4}$/.test(type)) fail('MALFORMED_MP4', `${context} contains an invalid box type.`);
    let headerSize = 8;
    let size = declaredSize;
    if (declaredSize === 1) {
      if (end - offset < 16) fail('MALFORMED_MP4', `${context} contains a truncated extended-size box.`);
      const extended = bytes.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) fail('MALFORMED_MP4', `${context} box size is unsupported.`);
      size = Number(extended);
      headerSize = 16;
    } else if (declaredSize === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) fail('MALFORMED_MP4', `${context} contains an invalid box size.`, { type, size });
    boxes.push({ type, start: offset, end: offset + size, payloadStart: offset + headerSize, payloadLength: size - headerSize });
    offset += size;
  }
  if (offset !== end) fail('MALFORMED_MP4', `${context} box boundaries do not close exactly.`);
  return boxes;
}

function validateIndependentInspection(inspection, selectedBy) {
  if (!inspection || inspection.passed !== true || typeof inspection.inspector !== 'string'
    || inspection.inspector.trim().length === 0 || !Array.isArray(inspection.checks)) {
    fail('MEDIA_INSPECTION_REQUIRED', 'Selected media requires a structured passed inspection.');
  }
  if (!inspection.checks.includes('actual_file_seen')) fail('ACTUAL_MEDIA_NOT_SEEN', 'Inspection must state that the actual file was seen.');
  const inspectorIdentity = canonicalActorIdentity(inspection.inspector);
  const selectorIdentity = canonicalActorIdentity(selectedBy);
  if (!inspectorIdentity || !selectorIdentity) fail('MEDIA_INSPECTION_REQUIRED', 'Selected media requires identifiable inspector and selector actors.');
  if (inspectorIdentity === selectorIdentity) {
    fail('INDEPENDENT_SELECTION_REQUIRED', 'The professional media inspection and final selection must be recorded by different actors.');
  }
}

function canonicalActorIdentity(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return '';
  return value.normalize('NFKC').trim().toLowerCase().replace(/[\s_.:/\\-]+/g, '');
}

function normalize(value) {
  return value.replaceAll('\\', '/');
}

function sameFileIdentity(left, right) {
  if (left.dev !== undefined && left.ino !== undefined && (left.ino !== 0 || right.ino !== 0)) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function fail(code, message, details = {}) {
  throw new ContractError(code, message, details);
}
