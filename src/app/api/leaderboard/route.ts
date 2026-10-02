import { topFarms } from '../../../lib/leaderboard';
import { json } from '../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return json({ farms: await topFarms() });
}
