'use client';

/**
 * Reads an APK's version (versionCode, versionName) in the browser, without loading the whole file:
 * the zip's directory from its end, then AndroidManifest.xml (inflated) and Android's binary XML in it.
 */

export interface ApkVersion {
  versionCode: number;
  versionName: string;
  packageName: string;
}

const VERSION_CODE_ATTR = 0x0101021b;
const VERSION_NAME_ATTR = 0x0101021c;

async function bytes(file: Blob, start: number, end: number) {
  return new DataView(await file.slice(start, end).arrayBuffer());
}

/** The bytes of one entry of the zip, inflated. */
async function zipEntry(file: Blob, wanted: string): Promise<ArrayBuffer | null> {
  const tailSize = Math.min(file.size, 66_000);
  const tail = await bytes(file, file.size - tailSize, file.size);
  let eocd = -1;
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return null;
  }
  const dirSize = tail.getUint32(eocd + 12, true);
  const dirOffset = tail.getUint32(eocd + 16, true);
  const dir = await bytes(file, dirOffset, dirOffset + dirSize);
  const decoder = new TextDecoder();
  for (let p = 0; p + 46 <= dir.byteLength && dir.getUint32(p, true) === 0x02014b50; ) {
    const method = dir.getUint16(p + 10, true);
    const compressed = dir.getUint32(p + 20, true);
    const nameLength = dir.getUint16(p + 28, true);
    const extraLength = dir.getUint16(p + 30, true);
    const commentLength = dir.getUint16(p + 32, true);
    const local = dir.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLength));
    if (name === wanted) {
      const header = await bytes(file, local, local + 30);
      const start = local + 30 + header.getUint16(26, true) + header.getUint16(28, true);
      const data = file.slice(start, start + compressed);
      if (method === 0) {
        return data.arrayBuffer();
      }
      if (method === 8) {
        return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      }
      return null;
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** The manifest element's version and package from Android's binary XML. */
function readManifest(buffer: ArrayBuffer): ApkVersion | null {
  const view = new DataView(buffer);
  if (view.getUint16(0, true) !== 0x0003) {
    return null;
  }
  let strings: string[] = [];
  let resourceIds: number[] = [];
  for (let p = view.getUint16(2, true); p + 8 <= view.byteLength; ) {
    const type = view.getUint16(p, true);
    const headerSize = view.getUint16(p + 2, true);
    const size = view.getUint32(p + 4, true);
    if (size < 8) {
      break;
    }
    if (type === 0x0001) {
      // The string pool: UTF-8 or UTF-16 strings, each found by its offset.
      const count = view.getUint32(p + 8, true);
      const utf8 = (view.getUint32(p + 16, true) & 0x100) !== 0;
      const stringsStart = p + view.getUint32(p + 20, true);
      strings = [];
      for (let i = 0; i < count; i++) {
        let s = stringsStart + view.getUint32(p + headerSize + i * 4, true);
        if (utf8) {
          s += view.getUint8(s) & 0x80 ? 2 : 1;
          let length = view.getUint8(s);
          if (length & 0x80) {
            length = ((length & 0x7f) << 8) | view.getUint8(s + 1);
            s += 2;
          } else {
            s += 1;
          }
          strings.push(new TextDecoder().decode(new Uint8Array(buffer, s, length)));
        } else {
          let length = view.getUint16(s, true);
          if (length & 0x8000) {
            length = ((length & 0x7fff) << 16) | view.getUint16(s + 2, true);
            s += 4;
          } else {
            s += 2;
          }
          let text = '';
          for (let c = 0; c < length; c++) {
            text += String.fromCharCode(view.getUint16(s + c * 2, true));
          }
          strings.push(text);
        }
      }
    } else if (type === 0x0180) {
      resourceIds = [];
      for (let q = p + headerSize; q + 4 <= p + size; q += 4) {
        resourceIds.push(view.getUint32(q, true));
      }
    } else if (type === 0x0102) {
      const ext = p + 16;
      const name = strings[view.getUint32(ext + 4, true)];
      if (name === 'manifest') {
        const attrStart = view.getUint16(ext + 8, true);
        const attrSize = view.getUint16(ext + 10, true);
        const attrCount = view.getUint16(ext + 12, true);
        const out: ApkVersion = { versionCode: 0, versionName: '', packageName: '' };
        for (let a = 0; a < attrCount; a++) {
          const at = ext + attrStart + a * attrSize;
          const nameIndex = view.getUint32(at + 4, true);
          const attrName = strings[nameIndex] ?? '';
          const id = resourceIds[nameIndex];
          const raw = view.getUint32(at + 8, true);
          const dataType = view.getUint8(at + 15);
          const data = view.getUint32(at + 16, true);
          if (attrName === 'versionCode' || id === VERSION_CODE_ATTR) {
            out.versionCode = data;
          } else if (attrName === 'versionName' || id === VERSION_NAME_ATTR) {
            out.versionName = dataType === 0x03 ? strings[data] ?? '' : raw !== 0xffffffff ? strings[raw] ?? '' : String(data);
          } else if (attrName === 'package') {
            out.packageName = raw !== 0xffffffff ? strings[raw] ?? '' : '';
          }
        }
        return out;
      }
    }
    p += size;
  }
  return null;
}

/** The APK's version, or null if it can't be read (not an APK, or packed in a way this doesn't follow). */
export async function readApkVersion(file: Blob): Promise<ApkVersion | null> {
  try {
    const manifest = await zipEntry(file, 'AndroidManifest.xml');
    return manifest ? readManifest(manifest) : null;
  } catch {
    return null;
  }
}
