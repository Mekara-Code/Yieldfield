import Link from 'next/link';
import type { BoardEntry, BoardId, BoardInfo } from '../lib/leaderboard';
import { BoardIcon } from './BoardIcons';

/** The leaderboards' pieces: a farmer's portrait, a board's best few (the home page), the podium and the list (/leaderboard). */

const PORTRAITS = new Set(['diana', 'arellah', 'arash']);

export function Avatar({ name, character, size = 40 }: { name: string; character: string | null; size?: number }) {
  const who = character?.toLowerCase() ?? '';
  if (PORTRAITS.has(who)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="avatar" src={`/brand/characters/${who}.jpg`} alt={character ?? ''} width={size} height={size} style={{ width: size, height: size }} />
    );
  }
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="avatar initial" style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, hsl(${hue} 55% 46%), hsl(${(hue + 40) % 360} 60% 32%))` }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Name({ entry }: { entry: BoardEntry }) {
  return (
    <span className={`farmer${entry.vip ? ' vip' : ''}`}>
      {entry.username}
      {entry.vip && <span className="vip-badge">VIP</span>}
      {entry.playing && <span className="live-dot" title="Playing now" />}
    </span>
  );
}

export function value(n: number) {
  return n.toLocaleString('en-US');
}

const MEDALS = ['gold', 'silver', 'bronze'];

/** A board's best few, as a card (the home page). */
export function BoardCard({ info, entries }: { info: BoardInfo; entries: BoardEntry[] }) {
  return (
    <article className={`board-card board-${info.id}`}>
      <header>
        <span className="board-icon">
          <BoardIcon board={info.id} size={34} />
        </span>
        <div>
          <h3>{info.title}</h3>
          <p>{info.blurb}</p>
        </div>
      </header>
      {entries.length ? (
        <ol>
          {entries.slice(0, 5).map((e) => (
            <li key={e.username} className={e.rank <= 3 ? MEDALS[e.rank - 1] : undefined}>
              <span className="rank">{e.rank}</span>
              <Avatar name={e.username} character={e.character} size={34} />
              <span className="who">
                <Name entry={e} />
                <small>{e.detail}</small>
              </span>
              <span className="score">
                {value(e.value)} <small>{info.unit}</small>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="board-empty">No one yet: the first place is yours.</p>
      )}
      <Link className="board-more" href={`/leaderboard?board=${info.id}`}>
        See the whole board →
      </Link>
    </article>
  );
}

/** The tabs over the full board. */
export function BoardTabs({ boards, current }: { boards: BoardInfo[]; current: BoardId }) {
  return (
    <nav className="board-tabs" aria-label="Leaderboards">
      {boards.map((b) => (
        <Link key={b.id} href={`/leaderboard?board=${b.id}`} className={b.id === current ? 'active' : undefined} aria-current={b.id === current ? 'page' : undefined}>
          <BoardIcon board={b.id} size={22} />
          {b.title}
        </Link>
      ))}
    </nav>
  );
}

/** The best three on their steps, the first in the middle. */
export function Podium({ info, entries }: { info: BoardInfo; entries: BoardEntry[] }) {
  const order = [entries[1], entries[0], entries[2]];
  return (
    <div className="podium">
      {order.map((e, i) => {
        const place = [2, 1, 3][i];
        return (
          <div key={place} className={`step step-${place}${e ? '' : ' empty'}`}>
            {e ? (
              <>
                {place === 1 && (
                  <svg className="crown" viewBox="0 0 64 40" aria-hidden="true">
                    <path d="M4,36 L8,8 L22,22 L32,2 L42,22 L56,8 L60,36 Z" fill="url(#crownGold)" stroke="#a86a10" strokeWidth="2.5" strokeLinejoin="round" />
                    <defs>
                      <linearGradient id="crownGold" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#fff1b0" />
                        <stop offset="1" stopColor="#f0a72a" />
                      </linearGradient>
                    </defs>
                  </svg>
                )}
                <Avatar name={e.username} character={e.character} size={place === 1 ? 104 : 80} />
                <Name entry={e} />
                <span className="podium-score">
                  {value(e.value)} <small>{info.unit}</small>
                </span>
                <span className="podium-detail">{e.detail}</span>
              </>
            ) : (
              <span className="podium-open">Open</span>
            )}
            <div className="block">{place}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Everyone after the podium. */
export function BoardList({ info, entries }: { info: BoardInfo; entries: BoardEntry[] }) {
  return (
    <ol className="board-list" start={4}>
      {entries.map((e) => (
        <li key={e.username}>
          <span className="rank">{e.rank}</span>
          <Avatar name={e.username} character={e.character} size={40} />
          <span className="who">
            <Name entry={e} />
            <small>
              Level {e.level} · {e.detail}
            </small>
          </span>
          <span className="score">
            {value(e.value)} <small>{info.unit}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}
