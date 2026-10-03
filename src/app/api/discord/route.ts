import { authenticate } from '../../../lib/auth';
import { discordConfig, unlinkDiscord } from '../../../lib/discord';
import { json, problem } from '../../../lib/http';

export const runtime = 'nodejs';

/** Whether linking Discord is set up here. */
export async function GET() {
  return json({ configured: discordConfig.configured });
}

/** Unlinks the player's Discord (its reputation goes with it). */
export async function DELETE(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  await unlinkDiscord(claims.userId);
  return json({ ok: true });
}
