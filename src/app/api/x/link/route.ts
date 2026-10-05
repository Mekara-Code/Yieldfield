import { authenticate } from '../../../../lib/auth';
import { clientAddress, json, problem, publicOrigin, rateLimited } from '../../../../lib/http';
import { createXRequest, xConfig } from '../../../../lib/xtasks';

export const runtime = 'nodejs';

/** Starts linking X for the signed-in player: open url, X asks them, and comes back to the farm page. */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Sign in first');
  }
  if (!xConfig.configured) {
    return problem(503, 'Linking X isn\'t set up on this server yet');
  }
  if (rateLimited(`x:${clientAddress(request)}`, 20)) {
    return problem(429, 'Too many tries: wait a few minutes');
  }
  const made = await createXRequest(claims.userId);
  return json({ url: `${publicOrigin(request)}/api/x/start?code=${made.code}` }, 201);
}
