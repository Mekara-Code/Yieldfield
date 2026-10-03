import { authenticate } from '../../../../lib/auth';
import { prisma } from '../../../../lib/db';
import { json, problem } from '../../../../lib/http';
import { isNetwork, NETWORKS } from '../../../../lib/networks';

export const runtime = 'nodejs';

const REASONS: Record<string, string> = {
  pack: 'Bought a pack',
  deposit: 'Deposit from a linked wallet',
  admin: 'Given by the admins',
  tasks: 'All of the day\'s tasks done',
  speedup: 'Sped up',
  buy_gems: 'Bought gems',
  buy_vip: 'Bought VIP',
  marry: 'The matchmaker',
  character: 'Changed character',
  market_buy: 'Bought on the market',
  market_sale: 'Sold on the market',
  migration: 'From before',
};

/** The player's history: their crypto purchases (orders paid and wallet deposits) and every BLOOM and gem change. */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const [payments, ledger] = await Promise.all([
    prisma.payment.findMany({ where: { userId: claims.userId, status: 'paid' }, orderBy: { paidAt: 'desc' }, take: 50 }),
    prisma.currencyLog.findMany({ where: { userId: claims.userId }, orderBy: { createdAt: 'desc' }, take: 80 }),
  ]);
  return json({
    purchases: payments.map((p) => {
      const network = isNetwork(p.network) ? NETWORKS[p.network] : null;
      return {
        id: p.id,
        kind: p.pack === 'deposit' ? 'deposit' : 'pack',
        bloom: p.bloom,
        gems: p.gems,
        usd: (p.usdCents / 100).toFixed(2),
        coin: network?.label ?? p.network,
        amount: `${p.amount} ${network?.asset ?? ''}`.trim(),
        txHash: p.txHash,
        explorer: p.txHash && network ? network.explorer + p.txHash : null,
        note: p.note,
        at: (p.paidAt ?? p.createdAt).toISOString(),
      };
    }),
    ledger: ledger.map((l) => ({
      id: l.id.toString(),
      currency: l.currency,
      change: l.change,
      balance: l.balance,
      reason: l.reason,
      what: REASONS[l.reason] ?? l.reason.replace(/_/g, ' '),
      at: l.createdAt.toISOString(),
    })),
  });
}
