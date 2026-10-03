import { DiscordError, finishDiscord } from '../../../../lib/discord';
import { publicOrigin } from '../../../../lib/http';

export const runtime = 'nodejs';

/** Discord's way back: links the account, then shows /discord (done, or why not). */
export async function GET(request: Request) {
  const origin = publicOrigin(request);
  const params = new URL(request.url).searchParams;
  const state = params.get('state') ?? '';
  if (params.get('error')) {
    return Response.redirect(`${origin}/discord?error=${encodeURIComponent('You said no on Discord: nothing was linked')}`, 302);
  }
  try {
    const name = await finishDiscord(params.get('code') ?? '', state, origin);
    return Response.redirect(`${origin}/discord?linked=${encodeURIComponent(name)}`, 302);
  } catch (error) {
    const message = error instanceof DiscordError ? error.message : 'Something went wrong';
    return Response.redirect(`${origin}/discord?error=${encodeURIComponent(message)}`, 302);
  }
}
