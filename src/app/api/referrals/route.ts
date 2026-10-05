import { authenticate } from '../../../lib/auth';
import { json, problem, publicOrigin } from '../../../lib/http';
import { referralView } from '../../../lib/referrals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The signed-in player's invitations: their link, who came, who bought VIP, what it paid (settled first). */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  return json(await referralView(claims.userId, publicOrigin(request)));
}
