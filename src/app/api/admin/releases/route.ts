import { authenticate } from '../../../../lib/auth';
import { json, problem, readBody } from '../../../../lib/http';
import { isAdmin } from '../../../../lib/players';
import { listReleases, NewReleaseSchema, publishRelease, storageOptions } from '../../../../lib/releases';

export const runtime = 'nodejs';

async function answer() {
  return json({ releases: await listReleases(), storage: storageOptions() });
}

/** Every version published (newest first) and where files can be put from here. */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  return answer();
}

/** Publishes a version: from now on the game offers it to every copy with a smaller versionCode. */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims || !(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const body = await readBody(request, NewReleaseSchema);
  if ('response' in body) {
    return body.response;
  }
  const refused = await publishRelease(body.data, claims.username);
  if (refused) {
    return problem(400, refused);
  }
  return answer();
}
