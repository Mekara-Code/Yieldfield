import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { authenticate } from '../../../../../lib/auth';
import { json, problem } from '../../../../../lib/http';
import { isAdmin } from '../../../../../lib/players';
import { RELEASES_DIR, safeFileName, storageOptions } from '../../../../../lib/releases';

export const runtime = 'nodejs';

/**
 * An APK (or a patch, .yfd) put on this server (only when it runs as its own server): the body is the file, streamed to
 * RELEASES_DIR/<name>; it's then at /downloads/<name>. Publishing it is a POST to /api/admin/releases.
 */
export async function PUT(request: Request) {
  if (!storageOptions().disk) {
    return problem(400, 'Files can only be kept on a server of its own (not on Vercel)');
  }
  const claims = await authenticate(request);
  if (!(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  if (!request.body) {
    return problem(400, 'No file');
  }
  const name = safeFileName(new URL(request.url).searchParams.get('name') ?? 'yieldfield.apk');
  await mkdir(RELEASES_DIR, { recursive: true });
  const target = path.join(RELEASES_DIR, name);
  const partial = `${target}.part`;
  try {
    await pipeline(Readable.fromWeb(request.body as import('node:stream/web').ReadableStream), createWriteStream(partial));
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    return problem(500, `Couldn't keep the file: ${(error as Error).message}`);
  }
  const { size } = await stat(target);
  return json({ url: `/downloads/${name}`, size });
}
