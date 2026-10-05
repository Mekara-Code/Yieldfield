import { publicOrigin } from '../../../../lib/http';
import { finishX, XError } from '../../../../lib/xtasks';

export const runtime = 'nodejs';

/** X's way back: links the account (and pays the link task), then the farm page. */
export async function GET(request: Request) {
  const origin = publicOrigin(request);
  const params = new URL(request.url).searchParams;
  if (params.get('error')) {
    return Response.redirect(`${origin}/dashboard?x_error=${encodeURIComponent('You said no on X: nothing was linked')}`, 302);
  }
  try {
    const name = await finishX(params.get('code') ?? '', params.get('state') ?? '', origin);
    return Response.redirect(`${origin}/dashboard?x_linked=${encodeURIComponent(name)}`, 302);
  } catch (error) {
    const message = error instanceof XError ? error.message : 'Something went wrong';
    return Response.redirect(`${origin}/dashboard?x_error=${encodeURIComponent(message)}`, 302);
  }
}
