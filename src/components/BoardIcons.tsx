import type { BoardId } from '../lib/leaderboard';
import { BloomIcon, CoinIcon } from './Bloom';

/** The leaderboards' marks: wheat for the farmers, the animals' heads, a coin, a BLOOM flower. */

function Wheat({ size }: { size: number }) {
  const grains = [0, 1, 2, 3].flatMap((i) => [
    <ellipse key={`l${i}`} cx="-9" cy={-8 - i * 15} rx="7" ry="11" transform={`rotate(-30 -9 ${-8 - i * 15})`} />,
    <ellipse key={`r${i}`} cx="9" cy={-8 - i * 15} rx="7" ry="11" transform={`rotate(30 9 ${-8 - i * 15})`} />,
  ]);
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <g transform="translate(0 40)">
        <path d="M0,4 L0,-74" stroke="#b97a12" strokeWidth="6" strokeLinecap="round" />
        <g fill="#f5c04a" stroke="#b97a12" strokeWidth="3">
          {grains}
          <ellipse cx="0" cy="-74" rx="7" ry="12" />
        </g>
      </g>
    </svg>
  );
}

function Cow({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <path d="M-30,-28 C-46,-34 -50,-22 -40,-16 Z M30,-28 C46,-34 50,-22 40,-16 Z" fill="#e9d9c4" stroke="#6b4a2e" strokeWidth="4" />
      <path d="M-22,-34 L-30,-46 M22,-34 L30,-46" stroke="#e8e0d0" strokeWidth="7" strokeLinecap="round" />
      <rect x="-30" y="-36" width="60" height="58" rx="26" fill="#fbf7f0" stroke="#6b4a2e" strokeWidth="4" />
      <path d="M-30,-14 C-18,-20 -12,-30 -14,-36 L-24,-34 C-30,-28 -32,-20 -30,-14 Z" fill="#3a2a1e" />
      <path d="M14,-36 C20,-28 26,-22 30,-20 L30,-30 C26,-36 20,-38 14,-36 Z" fill="#3a2a1e" />
      <ellipse cx="0" cy="22" rx="26" ry="18" fill="#f4a9a8" stroke="#6b4a2e" strokeWidth="4" />
      <ellipse cx="-9" cy="22" rx="4" ry="5" fill="#6b4a2e" />
      <ellipse cx="9" cy="22" rx="4" ry="5" fill="#6b4a2e" />
      <circle cx="-12" cy="-8" r="5" fill="#2a1d14" />
      <circle cx="12" cy="-8" r="5" fill="#2a1d14" />
    </svg>
  );
}

function Sheep({ size }: { size: number }) {
  const puffs = [
    [-24, -24], [0, -32], [24, -24], [-32, -2], [32, -2], [-24, 20], [24, 20],
  ];
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <g fill="#ffffff" stroke="#9a8f86" strokeWidth="3">
        {puffs.map(([x, y]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r="16" />
        ))}
      </g>
      <ellipse cx="-30" cy="-6" rx="12" ry="6" fill="#3b3330" transform="rotate(25 -30 -6)" />
      <ellipse cx="30" cy="-6" rx="12" ry="6" fill="#3b3330" transform="rotate(-25 30 -6)" />
      <ellipse cx="0" cy="6" rx="20" ry="26" fill="#3b3330" />
      <circle cx="-8" cy="0" r="4" fill="#fff" />
      <circle cx="8" cy="0" r="4" fill="#fff" />
      <path d="M-6,22 Q0,26 6,22" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Hen({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <path d="M-14,-34 C-20,-46 -8,-52 -2,-44 C2,-54 16,-50 12,-40 C20,-40 22,-30 14,-28 Z" fill="#ef4444" stroke="#a51d2d" strokeWidth="3" />
      <path d="M0,-34 C26,-34 36,-12 36,6 C36,30 20,42 0,42 C-20,42 -36,30 -36,6 C-36,-12 -26,-34 0,-34 Z" fill="#fffaf0" stroke="#c9a77c" strokeWidth="4" />
      <circle cx="-12" cy="-6" r="5" fill="#2a1d14" />
      <circle cx="12" cy="-6" r="5" fill="#2a1d14" />
      <path d="M-9,6 L9,6 L0,20 Z" fill="#f59e0b" stroke="#b45309" strokeWidth="3" strokeLinejoin="round" />
      <ellipse cx="-20" cy="10" rx="7" ry="4" fill="#fda4af" opacity="0.8" />
      <ellipse cx="20" cy="10" rx="7" ry="4" fill="#fda4af" opacity="0.8" />
    </svg>
  );
}

export function BoardIcon({ board, size = 28 }: { board: BoardId; size?: number }) {
  switch (board) {
    case 'farmers':
      return <Wheat size={size} />;
    case 'cows':
      return <Cow size={size} />;
    case 'sheep':
      return <Sheep size={size} />;
    case 'hens':
      return <Hen size={size} />;
    case 'coins':
      return <CoinIcon size={size} />;
    case 'bloom':
      return <BloomIcon size={size} />;
  }
}
