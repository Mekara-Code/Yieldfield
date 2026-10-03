import { authenticate } from '../../../../lib/auth';
import { prisma } from '../../../../lib/db';
import { json, problem } from '../../../../lib/http';
import { isAdmin } from '../../../../lib/players';
import { publicOrder } from '../../../../lib/shop';

export const runtime = 'nodejs';

/** Every order and linked-wallet deposit, newest first (status=pending|paid|expired|confirming to narrow it): the admin's transaction history. */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const status = new URL(request.url).searchParams.get('status') ?? undefined;
  const rows = await prisma.payment.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { username: true } } } });
  const paid = await prisma.payment.aggregate({ where: { status: 'paid' }, _sum: { usdCents: true, bloom: true, gems: true }, _count: true });
  const deposits = await prisma.payment.count({ where: { status: 'paid', note: { contains: 'linked wallet' } } });
  return json({
    orders: rows.map((o) => ({
      ...publicOrder(o),
      username: o.user.username,
      note: o.note,
      usdPrice: o.usdPrice,
      kind: o.pack === 'deposit' ? 'deposit' : 'order',
      fromLinkedWallet: !!o.note?.includes('linked wallet'),
      paidAt: o.paidAt?.toISOString() ?? null,
    })),
    totals: { paidOrders: paid._count, usd: ((paid._sum.usdCents ?? 0) / 100).toFixed(2), bloom: paid._sum.bloom ?? 0, gems: paid._sum.gems ?? 0, fromLinkedWallets: deposits },
  });
}
