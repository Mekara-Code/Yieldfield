import { z } from 'zod';
import { authenticate } from '../../../../../lib/auth';
import { json, problem, readBody } from '../../../../../lib/http';
import { isAdmin } from '../../../../../lib/players';
import { blobFiles, filesInUse, removeUnusedBlobs } from '../../../../../lib/releases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Blob store for /admin/updates: its files (?prefix= for some), how full it is, and the content pack files
 * versions already have (by SHA-1). Before uploading, the page uses a file that's there already (the same name
 * and size: a publish tried before and cut off) and a pack file another version has, instead of a second copy.
 */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const prefix = new URL(request.url).searchParams.get('prefix') ?? undefined;
  const [blobs, inUse] = await Promise.all([blobFiles(prefix), filesInUse()]);
  return json({ ...blobs, packFiles: inUse.bySha1, limit: 1024 * 1048576 });
}

const Remove = z.object({ urls: z.array(z.string().url()).max(1000).optional() });

/** Removes the files no version uses (those given, or all such): what was removed. */
export async function DELETE(request: Request) {
  const claims = await authenticate(request);
  if (!(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const body = await readBody(request, Remove);
  if ('response' in body) {
    return body.response;
  }
  return json({ removed: await removeUnusedBlobs(body.data.urls) });
}
