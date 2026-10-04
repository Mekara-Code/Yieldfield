import { z } from 'zod';
import { authenticate } from '../../../../lib/auth';
import { createEvent, listEvents, saveWolfSettings, wolfSettings } from '../../../../lib/events';
import { DEFAULT_WOLF } from '../../../../lib/game/defs';
import { json, problem, readBody } from '../../../../lib/http';
import { isAdmin } from '../../../../lib/players';

export const runtime = 'nodejs';

/** The wolf events (newest first, with how many wolves and farmers died in each) and the admins' wolf settings. */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  return json({ settings: await wolfSettings(), defaults: DEFAULT_WOLF, events: await listEvents(), now: new Date().toISOString() });
}

const Stat = z.number().int().min(1).max(10_000_000);

const NewEvent = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  startsAt: z.string().datetime({ offset: true }),
  hours: z.number().min(0.25).max(24 * 14),
  power: Stat.optional(),
  health: Stat.optional(),
  note: z.string().trim().max(120).optional(),
});

/** Lets the wolf loose: from startsAt for so many hours, with the given (or the settings') power and health. */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims || !(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const body = await readBody(request, NewEvent);
  if ('response' in body) {
    return body.response;
  }
  const settings = await wolfSettings();
  const startsAt = new Date(body.data.startsAt);
  const endsAt = new Date(startsAt.getTime() + body.data.hours * 3_600_000);
  if (endsAt.getTime() <= Date.now()) {
    return problem(400, 'That would be over already');
  }
  await createEvent({
    name: body.data.name,
    startsAt,
    endsAt,
    power: body.data.power ?? settings.power,
    health: body.data.health ?? settings.health,
    note: body.data.note,
    createdBy: claims.username,
  });
  return json({ settings, defaults: DEFAULT_WOLF, events: await listEvents(), now: new Date().toISOString() });
}

const Settings = z.object({
  power: Stat,
  health: Stat,
  reviveGems: z.number().int().min(0).max(1_000_000),
  rewardXp: z.number().int().min(0).max(1_000_000),
  rewardCoins: z.number().int().min(0).max(1_000_000),
});

/** The wolf settings: a new event's wolf power and health, the gems to come back at once, the reward for killing it. */
export async function PUT(request: Request) {
  const claims = await authenticate(request);
  if (!(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const body = await readBody(request, Settings);
  if ('response' in body) {
    return body.response;
  }
  await saveWolfSettings(body.data);
  return json({ settings: await wolfSettings(), defaults: DEFAULT_WOLF, events: await listEvents(), now: new Date().toISOString() });
}
