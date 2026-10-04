import { z } from 'zod';
import { authenticate } from '../../../../../lib/auth';
import { json, problem, readBody } from '../../../../../lib/http';
import { isAdmin } from '../../../../../lib/players';
import { listReleases, storageOptions, updateRelease } from '../../../../../lib/releases';

export const runtime = 'nodejs';

const Change = z.object({
  /** No longer offered (the version before it is again, if there is one). */
  withdraw: z.boolean().optional(),
  /** Offered again. */
  restore: z.boolean().optional(),
  mandatory: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Replaces its content packs (a version published without them, or with new ones). */
  contentPacks: z
    .array(
      z.object({
        chunk: z.number().int().min(1),
        files: z.array(z.object({ name: z.string().trim().min(1).max(200), size: z.number().int().min(0), sha1: z.string().regex(/^[0-9a-f]{40}$/), url: z.string().trim().min(1).max(2000) })).min(1).max(8),
      }),
    )
    .max(2000)
    .optional(),
});

/** Withdraws a version, brings it back, makes it a must, or changes what's new in it. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await authenticate(request);
  if (!(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const body = await readBody(request, Change);
  if ('response' in body) {
    return body.response;
  }
  const { id } = await params;
  if (!(await updateRelease(id, body.data))) {
    return problem(404, 'No such version');
  }
  return json({ releases: await listReleases(), storage: storageOptions() });
}
