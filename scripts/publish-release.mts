/**
 * Publishes a version of the game from a release folder (Build/Releases/<version>: the APK, the .yfd patches
 * and packs/), the way /admin/updates does, without signing in: the release store's key (the Blob store's
 * BLOB_READ_WRITE_TOKEN, in .env.local) authorizes it (POST /api/admin/releases/cli).
 *
 * Nothing is uploaded twice: a file already on Blob (the same name and size, from a publish that was cut off)
 * is used as it is, and a content pack file another version has (the same SHA-1) is used again. Second
 * copies of the APK no version uses are removed.
 *
 *   node --env-file=.env.local --import tsx scripts/publish-release.mts --dir ../Build/Releases/1.16 --name 1.16 --code 16 \
 *     [--notes "What's new"] [--mandatory] [--site https://yieldfield-nine.vercel.app] [--dry]
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { put } from '@vercel/blob';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = arg('dir');
const name = arg('name');
const code = Number(arg('code'));
const site = (arg('site') ?? 'https://yieldfield-nine.vercel.app').replace(/\/$/, '');
const notes = arg('notes');
const mandatory = args.includes('--mandatory');
const dry = args.includes('--dry');
const key = process.env.BLOB_READ_WRITE_TOKEN;
if (!dir || !name || !code || !key) {
  console.error('usage: --dir <release folder> --name <1.16> --code <16> (BLOB_READ_WRITE_TOKEN in the environment)');
  process.exit(1);
}

interface BlobFile {
  pathname: string;
  url: string;
  size: number;
  used: boolean;
}

async function call<T>(method: string, body?: unknown): Promise<T> {
  const response = await fetch(`${site}/api/admin/releases/cli`, {
    method,
    headers: { 'x-release-key': key!, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

(async () => {
  const state = await call<{ releases: { versionCode: number; versionName: string; status: string }[]; blobs: { files: BlobFile[]; total: number }; packFiles: Record<string, string> }>('GET');
  console.log(`Blob: ${state.blobs.files.length} files, ${mb(state.blobs.total)}; versions: ${state.releases.map((r) => `${r.versionName} (${r.status})`).join(', ') || 'none'}`);
  const files = state.blobs.files;
  let uploaded = 0;

  /** The file at pathname on Blob: one there already (same name and size), else uploaded now. */
  async function ensure(pathname: string, local: string, contentType: string) {
    const size = (await stat(local)).size;
    const base = pathname.replace(/\.[^.]+$/, '');
    const extension = pathname.slice(base.length);
    const there = files.find((f) => f.pathname.startsWith(`${base}-`) && f.pathname.endsWith(extension) && f.size === size);
    if (there) {
      return there.url;
    }
    if (dry) {
      console.log(`  would upload ${pathname} (${mb(size)})`);
      return `dry:${pathname}`;
    }
    console.log(`  uploading ${pathname} (${mb(size)})`);
    for (let attempt = 1; ; attempt++) {
      try {
        const blob = await put(pathname, await readFile(local), { access: 'public', addRandomSuffix: true, contentType, multipart: size > 8 * 1048576, token: key });
        uploaded += size;
        files.push({ pathname: blob.pathname, url: blob.url, size, used: false });
        return blob.url;
      } catch (error) {
        if (attempt >= 4) {
          throw error;
        }
        console.log(`    failed (${(error as Error).message}): trying again`);
      }
    }
  }

  // The APK.
  const apk = path.join(dir, `BattleBloom-${name}.apk`);
  const apkSize = (await stat(apk)).size;
  const apkUrl = await ensure(`releases/BattleBloom-${name}.apk`, apk, 'application/vnd.android.package-archive');
  console.log(`APK ${mb(apkSize)}: ${apkUrl}`);

  // The patches from earlier versions (their codes from each file's header).
  const deltas: { from: number; url: string; size: number }[] = [];
  for (const entry of (await readdir(dir)).filter((f) => f.endsWith('.yfd')).sort()) {
    const local = path.join(dir, entry);
    const head = (await readFile(local)).subarray(0, 16);
    if (head.subarray(0, 8).toString('latin1') !== 'YFDELTA1') {
      continue;
    }
    const from = head.readUInt32LE(8);
    const to = head.readUInt32LE(12);
    if (to !== code) {
      console.log(`  skipping ${entry}: it patches to code ${to}`);
      continue;
    }
    const size = (await stat(local)).size;
    deltas.push({ from, url: await ensure(`releases/BattleBloom-${from}-to-${to}.yfd`, local, 'application/octet-stream'), size });
    console.log(`patch from code ${from}: ${mb(size)}`);
  }

  // The content packs: each file's SHA-1; one another version has is used again.
  const packsDir = path.join(dir, 'packs');
  const packs = new Map<number, { chunk: number; files: { name: string; size: number; sha1: string; url: string }[] }>();
  let reused = 0;
  for (const entry of (await readdir(packsDir)).sort()) {
    const chunk = Number(/pakchunk(\d+)/i.exec(entry)?.[1] ?? 0);
    if (!chunk) {
      continue;
    }
    const local = path.join(packsDir, entry);
    const bytes = await readFile(local);
    const sha1 = createHash('sha1').update(bytes).digest('hex');
    let url = state.packFiles[sha1];
    if (url) {
      reused++;
    } else {
      url = await ensure(`content/${code}/${entry}`, local, 'application/octet-stream');
    }
    const pack = packs.get(chunk) ?? { chunk, files: [] };
    pack.files.push({ name: entry, size: bytes.length, sha1, url });
    packs.set(chunk, pack);
  }
  console.log(`content packs: ${packs.size} (${[...packs.values()].reduce((n, p) => n + p.files.length, 0)} files, ${reused} used again from earlier versions); uploaded now ${mb(uploaded)}`);

  // Second copies of this APK (an upload tried twice) are removed: only ones no version uses.
  const copies = files.filter((f) => f.pathname.startsWith(`releases/BattleBloom-${name}-`) && f.pathname.endsWith('.apk') && f.size === apkSize && f.url !== apkUrl && !f.used);
  if (copies.length) {
    if (dry) {
      console.log(`would remove ${copies.length} second copy(ies) of the APK (${mb(copies.reduce((s, f) => s + f.size, 0))})`);
    } else {
      const { removed } = await call<{ removed: string[] }>('DELETE', { urls: copies.map((f) => f.url) });
      console.log(`removed ${removed.length} second copy(ies) of the APK (${mb(copies.reduce((s, f) => s + f.size, 0))})`);
    }
  }

  if (dry) {
    console.log('dry run: nothing published');
    return;
  }
  const result = await call<{ releases: { versionCode: number; versionName: string; status: string }[] }>('POST', {
    versionCode: code,
    versionName: name,
    notes,
    url: apkUrl,
    size: apkSize,
    storage: 'blob',
    mandatory,
    deltas,
    contentPacks: [...packs.values()],
  });
  console.log(`published: ${result.releases.map((r) => `${r.versionName} (${r.status})`).join(', ')}`);
})().catch((error) => {
  console.error('FAILED', error.message);
  process.exit(1);
});
