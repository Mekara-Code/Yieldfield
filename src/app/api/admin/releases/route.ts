import { z } from 'zod';
import { authenticate } from '../../../../lib/auth';
import { json, problem, readBody } from '../../../../lib/http';
import { isAdmin } from '../../../../lib/players';
import { createRelease, latestRelease, listReleases, storageOptions } from '../../../../lib/releases';

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

const NewRelease = z.object({
  versionCode: z.number().int().min(1).max(2_100_000_000),
  versionName: z.string().trim().min(1).max(40),
  notes: z.string().trim().max(2000).optional(),
  url: z.string().trim().min(1).max(2000),
  size: z.number().int().min(0).max(2_147_000_000).optional(),
  storage: z.enum(['link', 'blob', 'disk']),
  mandatory: z.boolean().default(false),
  /** Patches to it from earlier versions (their files put here or on Blob first). */
  deltas: z
    .array(z.object({ from: z.number().int().min(1), url: z.string().trim().min(1).max(2000), size: z.number().int().min(1).max(2_147_000_000) }))
    .max(10)
    .default([]),
  /** Its content packs (each pakchunk's files, put here or on Blob first). */
  contentPacks: z
    .array(
      z.object({
        chunk: z.number().int().min(1),
        files: z.array(z.object({ name: z.string().trim().min(1).max(200), size: z.number().int().min(0), sha1: z.string().regex(/^[0-9a-f]{40}$/), url: z.string().trim().min(1).max(2000) })).min(1).max(8),
      }),
    )
    .max(2000)
    .default([]),
});

/** Publishes a version: from now on the game offers it to every copy with a smaller versionCode. */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims || !(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const body = await readBody(request, NewRelease);
  if ('response' in body) {
    return body.response;
  }
  const { url, storage, versionCode } = body.data;
  if (storage === 'link' && !/^https?:\/\//i.test(url)) {
    return problem(400, 'The link must start with http:// or https://');
  }
  if (storage === 'disk' && !url.startsWith('/downloads/')) {
    return problem(400, 'A file on this server is at /downloads/<name>');
  }
  if (body.data.deltas.some((d) => d.from >= versionCode)) {
    return problem(400, 'A patch must be from an earlier version');
  }
  const live = await latestRelease();
  if (live && versionCode <= live.versionCode) {
    return problem(400, `The version code must be bigger than the one players are offered now (${live.versionName}, code ${live.versionCode})`);
  }
  await createRelease({ ...body.data, createdBy: claims.username });
  return answer();
}
