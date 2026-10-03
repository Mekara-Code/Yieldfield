import { z } from 'zod';
import { authenticate } from '../../../../../lib/auth';
import { prisma } from '../../../../../lib/db';
import { json, problem, readBody } from '../../../../../lib/http';
import { isAdmin } from '../../../../../lib/players';
import { adminCredit, checkOrder, publicOrder, ShopError } from '../../../../../lib/shop';

export const runtime = 'nodejs';

const Body = z.object({ action: z.enum(['check', 'credit', 'cancel']), txHash: z.string().trim().max(120).optional() });

/** check: look on the chain now; credit: mark paid by hand (with the tx if known); cancel: close it. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const claims = await authenticate(request);
  if (!claims || !(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  const { id } = await context.params;
  const order = await prisma.payment.findUnique({ where: { id } });
  if (!order) {
    return problem(404, 'No such order');
  }
  try {
    if (body.data.action === 'check') {
      return json(publicOrder(await checkOrder({ ...order, checkedAt: null })));
    }
    if (body.data.action === 'credit') {
      return json(publicOrder(await adminCredit(id, body.data.txHash, claims.username)));
    }
    if (order.status === 'paid') {
      return problem(409, 'Already paid');
    }
    return json(publicOrder(await prisma.payment.update({ where: { id }, data: { status: 'cancelled', note: `cancelled by ${claims.username}` } })));
  } catch (error) {
    return problem(error instanceof ShopError ? error.status : 502, (error as Error).message);
  }
}
