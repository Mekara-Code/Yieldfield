import { authenticate } from '../../../../lib/auth';
import { json, problem } from '../../../../lib/http';
import { listingsOf } from '../../../../lib/market';

export const runtime = 'nodejs';

/** The listings of one thing (?key=Wheat, or Cow@1 for cows of levels 10-19), cheapest first. */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const key = new URL(request.url).searchParams.get('key') ?? '';
  if (!/^[A-Za-z]{1,24}(@\d{1,2})?$/.test(key)) {
    return problem(400, 'Which thing?');
  }
  return json({ key, listings: await listingsOf(key, claims.userId) });
}
