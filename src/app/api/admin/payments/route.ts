import { authenticate } from '../../../../lib/auth';
import { prisma } from '../../../../lib/db';
import { json, problem } from '../../../../lib/http';
import { isAdmin } from '../../../../lib/players';
import { publicOrder } from '../../../../lib/shop';

export const runtime = 'nodejs';

/** Every order, newest first (status=pending|paid|expired|confirming to narrow it). */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const status = new URL(request.url).searchParams.get('status') ?? undefined;
  const rows = await prisma.payment.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { username: true } } } });
  const paid = await prisma.payment.aggregate({ where: { status: 'paid' }, _sum: { usdCents: true, bloom: true }, _count: true });
  return json({
    orders: rows.map((o) => ({ ...publicOrder(o), username: o.user.username, note: o.note, usdPrice: o.usdPrice })),
    totals: { paidOrders: paid._count, usd: ((paid._sum.usdCents ?? 0) / 100).toFixed(2), bloom: paid._sum.bloom ?? 0 },
  });
}
