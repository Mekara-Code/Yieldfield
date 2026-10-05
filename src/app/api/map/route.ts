import { z } from 'zod';
import { authenticate } from '../../../lib/auth';
import { problem, readBody } from '../../../lib/http';
import { mapAnswer } from '../../../lib/map/respond';
import { attack, build, collect, mapMe, rename, resolve } from '../../../lib/map/world';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Id = z.string().regex(/^[a-z0-9]{10,40}$/);
const Name = z.string().max(40);
const Body = z.discriminatedUnion('type', [
  z.object({ type: z.literal('attack'), farm: Id }),
  z.object({ type: z.literal('resolve'), battle: Id, choice: z.enum(['plunder', 'capture']) }),
  z.object({ type: z.literal('build'), x: z.number().int().min(0).max(999), y: z.number().int().min(0).max(999), name: Name.optional() }),
  z.object({ type: z.literal('collect') }),
  z.object({ type: z.literal('rename'), farm: Id, name: Name }),
]);

/** The player on the world map (src/lib/map/world.ts): whether they may use it, their embassy, farms, reports and the rules. */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  return mapAnswer(claims.userId, () => mapMe(claims.userId));
}

/** Does one thing on the map: attack a farm, plunder or capture it after a win, build a farm, bring the harvest home, rename a farm. */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  const userId = claims.userId;
  const a = body.data;
  return mapAnswer(userId, async () => {
    switch (a.type) {
      case 'attack':
        return attack(userId, a.farm);
      case 'resolve':
        return resolve(userId, a.battle, a.choice);
      case 'build':
        return build(userId, a.x, a.y, a.name || undefined);
      case 'collect':
        return collect(userId);
      case 'rename':
        return rename(userId, a.farm, a.name);
    }
  });
}
