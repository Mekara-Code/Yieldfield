import { json } from '../../../../lib/http';
import { latestRelease, publicRelease } from '../../../../lib/releases';

export const runtime = 'nodejs';

/** The newest version of the game (for ?platform=, android by default), or null: the game offers it to older copies. */
export async function GET(request: Request) {
  const platform = new URL(request.url).searchParams.get('platform') || 'android';
  const row = await latestRelease(platform);
  return json({ release: row ? publicRelease(row) : null, now: Math.floor(Date.now() / 1000) }, 200, { 'Cache-Control': 'no-store' });
}
