import { z } from 'zod';
import { json, problem, readBody } from '../../../../../lib/http';
import { blobFiles, filesInUse, listReleases, NewReleaseSchema, publishRelease, releaseKeyOk, removeUnusedBlobs, replaceReleaseFiles } from '../../../../../lib/releases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Publishing from the command line (scripts/publish-release.mts), with the release store's key in an
 * x-release-key header (see releaseKeyOk): the versions, the files on Blob and which content pack files
 * are there already (by SHA-1, so a new version uses them again instead of a second copy).
 */
export async function GET(request: Request) {
  if (!releaseKeyOk(request)) {
    return problem(403, 'Not allowed');
  }
  const [releases, blobs, inUse] = await Promise.all([listReleases(), blobFiles(), filesInUse()]);
  return json({ releases, blobs, packFiles: inUse.bySha1 });
}

/** Publishes a version (as POST /api/admin/releases). */
export async function POST(request: Request) {
  if (!releaseKeyOk(request)) {
    return problem(403, 'Not allowed');
  }
  const body = await readBody(request, NewReleaseSchema);
  if ('response' in body) {
    return body.response;
  }
  const refused = await publishRelease(body.data, 'release script');
  if (refused) {
    return problem(400, refused);
  }
  return json({ releases: await listReleases() });
}

/** Puts a published version's files right (its APK lost and uploaded again, new patches): by its version code. */
export async function PATCH(request: Request) {
  if (!releaseKeyOk(request)) {
    return problem(403, 'Not allowed');
  }
  const body = await readBody(request, NewReleaseSchema);
  if ('response' in body) {
    return body.response;
  }
  if (!(await replaceReleaseFiles(body.data))) {
    return problem(404, `No version with code ${body.data.versionCode}`);
  }
  return json({ releases: await listReleases() });
}

const Remove = z.object({ urls: z.array(z.string().url()).max(1000).optional() });

/** Removes files on Blob no version uses (all of them, or those given): files in use are never removed. */
export async function DELETE(request: Request) {
  if (!releaseKeyOk(request)) {
    return problem(403, 'Not allowed');
  }
  const body = await readBody(request, Remove);
  if ('response' in body) {
    return body.response;
  }
  return json({ removed: await removeUnusedBlobs(body.data.urls) });
}
