import { z } from 'zod';
import { authenticate } from '../../../../lib/auth';
import { clientAddress, json, problem, rateLimited, readBody } from '../../../../lib/http';
import { checkFollow, checkLike, checkShare, XError } from '../../../../lib/xtasks';

export const runtime = 'nodejs';

const Body = z.object({ task: z.enum(['follow', 'like', 'share']), url: z.string().trim().max(300).optional() });

/** Checks a task on X and pays it (once): { ok, paid, coins }, or why not. */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Sign in first');
  }
  if (rateLimited(`xcheck:${claims.userId}`, 12)) {
    return problem(429, 'Wait a minute before checking again');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  try {
    const { task, url } = body.data;
    const result = task === 'follow' ? await checkFollow(claims.userId) : task === 'like' ? await checkLike(claims.userId) : await checkShare(claims.userId, url ?? '');
    return json(result);
  } catch (error) {
    if (error instanceof XError) {
      return problem(422, error.message);
    }
    console.error('[x] check failed', clientAddress(request), error);
    return problem(500, 'Something went wrong');
  }
}
