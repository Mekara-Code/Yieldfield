import { z } from 'zod';
import { authenticate } from '../../../../lib/auth';
import { clientAddress, json, problem, publicOrigin, rateLimited, readBody } from '../../../../lib/http';
import { qrRows } from '../../../../lib/qr';
import { createRequest } from '../../../../lib/wallets';

export const runtime = 'nodejs';

const Body = z.object({ mode: z.enum(['link', 'login']) });

/**
 * The game starts connecting a wallet: link (to the signed-in player) or login. It opens url (the website)
 * for the player to sign there, shows the short code to compare, and asks GET /api/wallet/requests/{code}.
 */
export async function POST(request: Request) {
  if (rateLimited(`wallet:${clientAddress(request)}`, 30)) {
    return problem(429, 'Too many tries: wait a few minutes');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  const claims = await authenticate(request);
  if (body.data.mode === 'link' && !claims) {
    return problem(401, 'Sign in first');
  }
  const made = await createRequest(body.data.mode, body.data.mode === 'link' ? claims!.userId : null);
  const origin = publicOrigin(request);
  const url = `${origin}/wallet?code=${made.code}`;
  return json({ code: made.code, short: made.short, mode: made.mode, url, qr: qrRows(url), expiresAt: made.expiresAt.toISOString() }, 201);
}
