import { z } from 'zod';
import { authenticate } from '../../../../lib/auth';
import { json, problem, readBody } from '../../../../lib/http';
import { claimTask, TaskError } from '../../../../lib/tasks';

export const runtime = 'nodejs';

const Body = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), id: z.string().regex(/^(t\d{1,2}|all)$/) });

/** A task done: its reputation is added and its experience returned (for the game to add), once. */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  try {
    return json(await claimTask(claims.userId, body.data.day, body.data.id));
  } catch (error) {
    return problem(error instanceof TaskError ? error.status : 500, (error as Error).message);
  }
}
