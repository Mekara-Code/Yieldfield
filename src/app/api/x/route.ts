import { authenticate } from '../../../lib/auth';
import { json, problem } from '../../../lib/http';
import { unlinkX, xTasksView } from '../../../lib/xtasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The X tasks for the signed-in player: what each pays, which are done, the linked account. */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  return json(await xTasksView(claims.userId));
}

/** Unlinks the player's X account (what it earned stays earned, once). */
export async function DELETE(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  await unlinkX(claims.userId);
  return json({ ok: true });
}
