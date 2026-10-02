import { revokeRefreshToken } from '../../../../lib/auth';
import { cookie, json, REFRESH_COOKIE, refreshCookie } from '../../../../lib/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let token = cookie(request, REFRESH_COOKIE);
  try {
    const body = (await request.json()) as { refreshToken?: unknown };
    if (typeof body.refreshToken === 'string') {
      token = body.refreshToken;
    }
  } catch {
    // no body: the site signs out with its cookie
  }
  if (token) {
    await revokeRefreshToken(token);
  }
  return json({ ok: true }, 200, { 'Set-Cookie': refreshCookie('', 0) });
}
