import { authenticate } from '../../../../lib/auth';
import { createDiscordRequest, discordConfig } from '../../../../lib/discord';
import { clientAddress, json, problem, publicOrigin, rateLimited } from '../../../../lib/http';

export const runtime = 'nodejs';

/**
 * Starts linking Discord for the signed-in player: open url (Discord asks them), then ask
 * GET /api/wallet/requests/{code} until it's done (address: the Discord name).
 */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Sign in first');
  }
  if (!discordConfig.configured) {
    return problem(503, 'Linking Discord isn\'t set up on this server yet');
  }
  if (rateLimited(`discord:${clientAddress(request)}`, 20)) {
    return problem(429, 'Too many tries: wait a few minutes');
  }
  const made = await createDiscordRequest(claims.userId);
  return json({ code: made.code, url: `${publicOrigin(request)}/api/discord/start?code=${made.code}`, expiresAt: made.expiresAt.toISOString() }, 201);
}
