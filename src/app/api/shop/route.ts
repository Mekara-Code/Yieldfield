import { authenticate } from '../../../lib/auth';
import { json, problem } from '../../../lib/http';
import { catalog } from '../../../lib/shop';

export const runtime = 'nodejs';

/** The BLOOM packs and the coins they can be paid with (only those whose wallet the admin has set). */
export async function GET(request: Request) {
  if (!(await authenticate(request))) {
    return problem(401, 'Not signed in');
  }
  return json(await catalog());
}
