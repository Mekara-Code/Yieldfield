import { allBoards, board, BOARDS, isBoard, topFarms } from '../../../lib/leaderboard';
import { json } from '../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/leaderboard?board=farmers|cows|sheep|hens|coins|bloom[&take=50]: one board.
 * Without ?board: every board's best five, and the richest farms as before (farms).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get('board');
  if (isBoard(id)) {
    const info = BOARDS.find((b) => b.id === id)!;
    return json({ ...info, entries: await board(id, Number(params.get('take')) || 50) });
  }
  const [boards, farms] = await Promise.all([allBoards(5), topFarms()]);
  return json({ boards, farms });
}
