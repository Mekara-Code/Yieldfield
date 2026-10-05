import type { Metadata } from 'next';
import { BoardIcon } from '../../components/BoardIcons';
import { BoardList, BoardTabs, Podium } from '../../components/Boards';
import { board, BOARDS, isBoard } from '../../lib/leaderboard';
import '../landing.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Leaderboards' };

export default async function Leaderboard({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const params = await searchParams;
  const id = isBoard(params.board) ? params.board : 'farmers';
  const info = BOARDS.find((b) => b.id === id)!;
  const entries = await board(id, 50);
  return (
    <div className="landing lb-page">
      <section className="lb-hero">
        <div className="l-kicker">Hall of fame</div>
        <h1 className="lb-title">Leaderboards</h1>
        <p>The valley&apos;s best farmers, herds and fortunes, as they stand right now.</p>
      </section>
      <div className="lb-body">
        <BoardTabs boards={BOARDS} current={id} />
        <section className={`lb-board board-${id}`}>
          <header className="lb-board-head">
            <span className="board-icon big">
              <BoardIcon board={id} size={46} />
            </span>
            <div>
              <h2>{info.title}</h2>
              <p>{info.blurb}</p>
            </div>
          </header>
          {entries.length ? (
            <>
              <Podium info={info} entries={entries.slice(0, 3)} />
              {entries.length > 3 && <BoardList info={info} entries={entries.slice(3)} />}
            </>
          ) : (
            <p className="board-empty big">No one on this board yet. Play a little and the first place is yours.</p>
          )}
        </section>
      </div>
    </div>
  );
}
