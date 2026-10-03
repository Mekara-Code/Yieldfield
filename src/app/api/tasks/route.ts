import { authenticate } from '../../../lib/auth';
import { json, problem } from '../../../lib/http';
import { dailyTasks } from '../../../lib/tasks';

export const runtime = 'nodejs';

/** Today's tasks (with which are claimed), the bonus for doing them all, and the player's standing. */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  return json(await dailyTasks(claims.userId));
}
