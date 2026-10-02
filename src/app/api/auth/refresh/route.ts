import { refreshTokens } from '../../../../lib/auth';
import { cookie, problem, readBody, REFRESH_COOKIE, RefreshBody, refreshCookie, tokensResponse } from '../../../../lib/http';

export const runtime = 'nodejs';

/** A new access token (and a new refresh token) for the game's saved token or the site's cookie. */
export async function POST(request: Request) {
  const fromCookie = cookie(request, REFRESH_COOKIE);
  let token = fromCookie;
  if (request.headers.get('content-type')?.includes('application/json')) {
    const body = await readBody(request, RefreshBody);
    if ('response' in body) {
      return body.response;
    }
    token = body.data.refreshToken ?? fromCookie;
  }
  if (!token) {
    return problem(401, 'Not signed in');
  }
  const result = await refreshTokens(token);
  if (!result) {
    const response = problem(401, 'Signed out: sign in again');
    if (fromCookie) {
      response.headers.append('Set-Cookie', refreshCookie('', 0));
    }
    return response;
  }
  return tokensResponse(result.tokens, result.client);
}
