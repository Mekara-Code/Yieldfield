import { z } from 'zod';
import { authenticate } from '../../../../lib/auth';
import { performAction } from '../../../../lib/game/engine';
import { json, problem, readBody } from '../../../../lib/http';
import { hub } from '../../../../lib/hub';

export const runtime = 'nodejs';

const Plot = z.number().int().min(0).max(255);
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('clock'), hour: z.number().min(0).max(30), selected: z.string().max(32).optional() }),
  z.object({ type: z.enum(['till', 'water', 'harvest', 'buy_plot']), plot: Plot }),
  z.object({ type: z.literal('plant'), plot: Plot, crop: z.string().max(32) }),
  z.object({ type: z.literal('build'), building: z.string().max(32) }),
  z.object({ type: z.literal('buy_seeds'), crop: z.string().max(32), count: z.number().int().min(1).max(99) }),
  z.object({ type: z.literal('buy_animal'), kind: z.enum(['Chicken', 'Sheep', 'Cow']) }),
  z.object({ type: z.enum(['milk', 'shear', 'feed', 'leather']), animal: Id }),
  z.object({ type: z.enum(['collect_eggs', 'sell_all', 'eat', 'marry']) }),
  z.object({ type: z.literal('trade'), trader: z.string().max(16) }),
  z.object({ type: z.literal('sleep'), passedOut: z.boolean().optional() }),
  z.object({ type: z.literal('buy_vip'), plan: z.string().max(24) }),
  z.object({ type: z.literal('buy_gems'), pack: z.string().max(24) }),
  z.object({ type: z.literal('speedup'), target: z.enum(['plot', 'product', 'wool']), id: z.string().max(40) }),
]);

const Body = z.object({ id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/), action: ActionSchema });

/**
 * Does one thing on the farm (src/lib/game/rules.ts), as the server: { ok, state, wallet, notices, result, tasks, now }
 * once it's stored; 422 { error, state } if it can't be done now; the same id again is not done twice.
 */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  const result = await performAction(claims.userId, body.data.id, body.data.action);
  if (result.status === 200 && body.data.action.type !== 'clock') {
    hub.toUser(claims.userId, { type: 'farm:update', revision: result.body.revision, state: result.body.state, wallet: result.body.wallet, now: result.body.now }, 'web');
  }
  return json(result.body, result.status);
}
