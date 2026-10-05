import { authenticate } from '../../../../lib/auth';
import { problem } from '../../../../lib/http';
import { mapAnswer } from '../../../../lib/map/respond';
import { chunks } from '../../../../lib/map/world';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The farms standing in a box of the map's chunks: ?cx0=&cy0=&cx1=&cy1= (16 x 16 squares each, both ends in). */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const query = new URL(request.url).searchParams;
  const [cx0, cy0, cx1, cy1] = ['cx0', 'cy0', 'cx1', 'cy1'].map((k) => Number(query.get(k)));
  if (![cx0, cy0, cx1, cy1].every(Number.isInteger)) {
    return problem(400, 'cx0, cy0, cx1 and cy1 are whole numbers');
  }
  return mapAnswer(claims.userId, () => chunks(claims.userId, cx0, cy0, cx1, cy1));
}
