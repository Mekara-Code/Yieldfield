import { authenticate } from '../../../../lib/auth';
import { problem } from '../../../../lib/http';
import { mapAnswer } from '../../../../lib/map/respond';
import { farmDetail } from '../../../../lib/map/world';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One farm on the map, for its panel: ?id= (who holds it, how strong, what it holds, whether the player can attack it and why not). */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!/^[a-z0-9]{10,40}$/.test(id)) {
    return problem(400, 'No such farm');
  }
  return mapAnswer(claims.userId, () => farmDetail(claims.userId, id));
}
