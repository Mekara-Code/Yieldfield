import { authorizeUrl, DiscordError } from '../../../../lib/discord';
import { publicOrigin } from '../../../../lib/http';

export const runtime = 'nodejs';

/** Sends the player on to Discord's consent page (or back to /discord with why not). */
export async function GET(request: Request) {
  const origin = publicOrigin(request);
  const code = new URL(request.url).searchParams.get('code') ?? '';
  try {
    return Response.redirect(await authorizeUrl(code, origin), 302);
  } catch (error) {
    const message = error instanceof DiscordError ? error.message : 'Something went wrong';
    return Response.redirect(`${origin}/discord?error=${encodeURIComponent(message)}`, 302);
  }
}
