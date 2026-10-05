import { publicOrigin } from '../../../../lib/http';
import { XError, xAuthorizeUrl } from '../../../../lib/xtasks';

export const runtime = 'nodejs';

/** On to X's consent page (or back to the farm page with why not). */
export async function GET(request: Request) {
  const origin = publicOrigin(request);
  try {
    return Response.redirect(await xAuthorizeUrl(new URL(request.url).searchParams.get('code') ?? '', origin), 302);
  } catch (error) {
    const message = error instanceof XError ? error.message : 'Something went wrong';
    return Response.redirect(`${origin}/dashboard?x_error=${encodeURIComponent(message)}`, 302);
  }
}
