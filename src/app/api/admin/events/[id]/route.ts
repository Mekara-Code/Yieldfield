import { z } from 'zod';
import { authenticate } from '../../../../../lib/auth';
import { listEvents, updateEvent, wolfSettings } from '../../../../../lib/events';
import { DEFAULT_WOLF } from '../../../../../lib/game/defs';
import { json, problem, readBody } from '../../../../../lib/http';
import { isAdmin } from '../../../../../lib/players';

export const runtime = 'nodejs';

const Stat = z.number().int().min(1).max(10_000_000);
const Change = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  power: Stat.optional(),
  health: Stat.optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(120).nullable().optional(),
  /** Called off (it won't happen, or stops now and counts as cancelled). */
  cancel: z.boolean().optional(),
  /** Ends now (it happened). */
  endNow: z.boolean().optional(),
});

/** Changes a wolf event: its wolf's power or health (on every farm at once), its times, or ends or cancels it. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await authenticate(request);
  if (!(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const body = await readBody(request, Change);
  if ('response' in body) {
    return body.response;
  }
  const { id } = await params;
  const { startsAt, endsAt, ...rest } = body.data;
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    return problem(400, 'It must end after it starts');
  }
  const updated = await updateEvent(id, { ...rest, startsAt: startsAt ? new Date(startsAt) : undefined, endsAt: endsAt ? new Date(endsAt) : undefined });
  if (!updated) {
    return problem(404, 'No such event');
  }
  return json({ settings: await wolfSettings(), defaults: DEFAULT_WOLF, events: await listEvents(), now: new Date().toISOString() });
}
