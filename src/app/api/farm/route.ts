import { authenticate } from '../../../lib/auth';
import { loadGame } from '../../../lib/game/engine';
import { json, problem } from '../../../lib/http';
import { checkOpenOrders } from '../../../lib/shop';
import { scanDeposits } from '../../../lib/wallets';

export const runtime = 'nodejs';

/** The player's farm as the server keeps it, their BLOOM and gems, the server's clock and the game's rules (state null: no farm yet). */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  // A pack paid for while the game was closed is credited now (bounded, so the farm still loads if a chain is slow).
  // So is anything sent from one of the player's linked wallets.
  await Promise.race([Promise.all([checkOpenOrders(claims.userId), scanDeposits(claims.userId).catch(() => [])]), new Promise((resolve) => setTimeout(resolve, 4000))]);
  return json(await loadGame(claims.userId));
}

/** The game no longer saves its farm: the server keeps it, changed only by actions (POST /api/farm/act). */
export async function PUT() {
  return problem(410, 'The farm is kept by the server now: update the game');
}
