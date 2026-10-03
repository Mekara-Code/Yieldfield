import { authenticate } from '../../../../../lib/auth';
import { prisma } from '../../../../../lib/db';
import { json, problem } from '../../../../../lib/http';
import { checkOrder, publicOrder } from '../../../../../lib/shop';

export const runtime = 'nodejs';

/** An order, looked for on the chain first: pending, expired, confirming or paid (then credits says the farm's new total). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const { id } = await context.params;
  let order = await prisma.payment.findFirst({ where: { id, userId: claims.userId } });
  if (!order) {
    return problem(404, 'No such order');
  }
  try {
    order = await checkOrder(order);
  } catch {
    // the chain's API is slow or down: the order as it stands; the game asks again shortly
  }
  const farm = order.status === 'paid' ? await prisma.farm.findUnique({ where: { userId: claims.userId }, select: { credits: true } }) : null;
  return json(publicOrder(order, farm?.credits));
}
