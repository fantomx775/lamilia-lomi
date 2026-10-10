import type { ImageDimensions } from "./image-ratios";

export function readImageDimensionsFromBytes(bytes: Uint8Array): ImageDimensions | null {
  if (isPng(bytes)) {
    return { width: readUint32BigEndian(bytes, 16), height: readUint32BigEndian(bytes, 20) };
  }

  if (isJpeg(bytes)) return readJpegDimensions(bytes);
  if (isWebp(bytes)) return readWebpDimensions(bytes);
  return null;
}

function isPng(bytes: Uint8Array) {
  return bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a &&
    readAscii(bytes, 12, 4) === "IHDR";
}

function isJpeg(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: readUint16BigEndian(bytes, offset + 3),
        width: readUint16BigEndian(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function isJpegStartOfFrame(marker: number) {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
}

function isWebp(bytes: Uint8Array) {
  return bytes.length >= 30 && readAscii(bytes, 0, 4) === "RIFF" && readAscii(bytes, 8, 4) === "WEBP";
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  const chunk = readAscii(bytes, 12, 4);
  if (chunk === "VP8X") {
    return {
      width: 1 + readUint24LittleEndian(bytes, 24),
      height: 1 + readUint24LittleEndian(bytes, 27),
    };
  }
  if (chunk === "VP8 ") {
    if (readAscii(bytes, 23, 3) !== "\x9d\x01\x2a") return null;
    return {
      width: readUint16LittleEndian(bytes, 26) & 0x3fff,
      height: readUint16LittleEndian(bytes, 28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    };
  }
  return null;
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readUint16BigEndian(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}
