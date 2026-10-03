/**
 * The game's three currencies and their marks (as in the game): coins (the farm's own money: seeds,
 * animals, selling, tasks), gems (speeding timers up) and BLOOM (bought with crypto: trading between
 * players, the spouse, VIP, gems).
 */
export const MONEY = 'BLOOM';

export function CoinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" aria-label="coins" role="img" style={{ verticalAlign: '-0.15em' }}>
      <circle r="46" fill="#f2b632" stroke="#b97a12" strokeWidth="6" />
      <circle r="30" fill="none" stroke="#ffe08a" strokeWidth="5" />
      <circle cx="-14" cy="-16" r="7" fill="#fff4cc" opacity="0.85" />
    </svg>
  );
}

export function GemIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" aria-label="gems" role="img" style={{ verticalAlign: '-0.15em' }}>
      <polygon points="0,-46 44,0 0,46 -44,0" fill="#3fb6e8" stroke="#1a6f99" strokeWidth="6" strokeLinejoin="round" />
      <polygon points="0,-46 16,0 0,46 -16,0" fill="#8fdcff" opacity="0.7" />
    </svg>
  );
}

export function BloomIcon({ size = 18 }: { size?: number }) {
  const petals = [0, 72, 144, 216, 288];
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" aria-label={MONEY} role="img" style={{ verticalAlign: '-0.15em' }}>
      {petals.map((angle) => (
        <g key={angle} transform={`rotate(${angle - 90})`}>
          <rect x="0" y="-16.5" width="50" height="33" rx="16.5" fill="#ff61a3" stroke="#c7296b" strokeWidth="4" />
          <rect x="15" y="-5" width="24" height="10" rx="5" fill="#ffb8d6" />
        </g>
      ))}
      <circle r="16" fill="#ffcc42" stroke="#db7514" strokeWidth="4" />
      <circle cx="-4" cy="-4" r="5" fill="#fff5cc" opacity="0.9" />
    </svg>
  );
}
