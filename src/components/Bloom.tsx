/** BLOOM, the farm's money: its name and its flower (the same mark as in the game). */
export const MONEY = 'BLOOM';

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
