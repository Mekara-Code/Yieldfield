import { authenticate } from '../../../lib/auth';
import { prisma } from '../../../lib/db';
import { json, problem } from '../../../lib/http';
import { isNetwork, NETWORKS } from '../../../lib/networks';
import { qrRows } from '../../../lib/qr';
import { shopSettings } from '../../../lib/shop';
import { bloomForUsd, CHAIN_NETWORKS, CHAINS, isChain, shortAddress } from '../../../lib/wallets';

export const runtime = 'nodejs';

/**
 * The player's linked wallets (and which of the shop's coins each can pay with straight away), the
 * shop's wallets they can send to from them (any amount: credited by itself) and what a dollar buys.
 */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const [wallets, settings] = await Promise.all([prisma.wallet.findMany({ where: { userId: claims.userId }, orderBy: { createdAt: 'asc' } }), shopSettings()]);
  const linked = new Set(wallets.map((w) => w.chain));
  const deposits = CHAINS.flatMap((chain) =>
    CHAIN_NETWORKS[chain]
      .filter((id) => isNetwork(id) && settings.wallets[id])
      .map((id) => ({ network: id, chain, label: NETWORKS[id].label, asset: NETWORKS[id].asset, address: settings.wallets[id]!, ready: linked.has(chain), qr: qrRows(settings.wallets[id]!) })),
  );
  const biggest = [...settings.packs].sort((a, b) => b.usdCents - a.usdCents)[0];
  return json({
    wallets: wallets.map((w) => ({ id: w.id, chain: w.chain, address: w.address, short: shortAddress(w.address), networks: isChain(w.chain) ? CHAIN_NETWORKS[w.chain] : [] })),
    deposits,
    bloomPerUsd: bloomForUsd(1, settings.packs),
    bestBloomPerUsd: biggest ? Math.floor((biggest.bloom * 100) / biggest.usdCents) : 0,
    bestFromUsd: biggest ? (biggest.usdCents / 100).toFixed(2) : null,
  });
}
