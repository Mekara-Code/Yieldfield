import { authenticate } from '../../../../lib/auth';
import { FarmEventSchema, recentEvents, recordEvent } from '../../../../lib/farm';
import { json, problem, readBody } from '../../../../lib/http';
import { hub } from '../../../../lib/hub';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  return json({ events: await recentEvents(claims.userId) });
}

export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const body = await readBody(request, FarmEventSchema);
  if ('response' in body) {
    return body.response;
  }
  const event = await recordEvent(claims.userId, body.data);
  hub.toUser(claims.userId, { type: 'farm:event', event }, 'web');
  return json({ event }, 201);
}
