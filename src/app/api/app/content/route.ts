import { json, problem } from '../../../../lib/http';
import { releasePacks } from '../../../../lib/releases';

export const runtime = 'nodejs';

/**
 * The content packs of the game of version ?code= (for ?platform=, android by default): each pack's files with
 * their sizes and SHA-1s, which the game downloads, checks and mounts when it first needs one of its looks.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const code = Number(query.get('code'));
  if (!Number.isInteger(code) || code < 1) {
    return problem(400, 'Which version? (?code=)');
  }
  const packs = await releasePacks(code, query.get('platform') || 'android');
  if (!packs) {
    return problem(404, `Version code ${code} isn't published`);
  }
  return json({ code, packs }, 200, { 'Cache-Control': 'no-store' });
}
