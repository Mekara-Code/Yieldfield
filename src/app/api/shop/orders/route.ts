import { z } from 'zod';
import { authenticate } from '../../../../lib/auth';
import { prisma } from '../../../../lib/db';
import { clientAddress, json, problem, rateLimited, readBody } from '../../../../lib/http';
import { qrRows } from '../../../../lib/qr';
import { createOrder, publicOrder, ShopError } from '../../../../lib/shop';

export const runtime = 'nodejs';

const OrderBody = z.object({ pack: z.string().max(24), network: z.string().max(24) });

/** Starts buying a pack: the exact amount of the coin to send, where, and until when. */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  if (rateLimited(`order:${claims.userId}:${clientAddress(request)}`)) {
    return problem(429, 'Too many orders: wait a few minutes');
  }
  const body = await readBody(request, OrderBody);
  if ('response' in body) {
    return body.response;
  }
  try {
    const order = await createOrder(claims.userId, body.data.pack, body.data.network);
    return json({ ...publicOrder(order), qr: qrRows(order.address) }, 201);
  } catch (error) {
    if (error instanceof ShopError) {
      return problem(error.status, error.message);
    }
    return problem(502, (error as Error).message || 'Prices are unavailable right now: try again in a minute');
  }
}

/** The player's last orders. */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const orders = await prisma.payment.findMany({ where: { userId: claims.userId }, orderBy: { createdAt: 'desc' }, take: 20 });
  return json({ orders: orders.map((o) => publicOrder(o)) });
}
