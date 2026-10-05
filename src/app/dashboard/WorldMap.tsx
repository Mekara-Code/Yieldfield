'use client';

import { useEffect, useState } from 'react';
import { api, itemName } from '../../lib/client';
import { CoinIcon } from '../../components/Bloom';

/** The farm page's world map card: the farm's name and square, the embassy, the farms out there, the latest battles. */

interface MapFarm {
  id: string;
  kind: 'home' | 'outpost' | 'wild';
  name: string;
  x: number;
  y: number;
  biome: string;
  stored: { coins: number; produce: Record<string, number> };
  production: { coins: number };
  shieldUntil: number;
}
interface Report {
  id: string;
  at: number;
  attacking: boolean;
  attacker: string;
  defender: string;
  farm: { name: string; x: number; y: number } | null;
  won: boolean;
  choice: string | null;
  loot: { coins: number } | null;
}
interface MapMe {
  allowed: boolean;
  why: string | null;
  embassy: number;
  embassyMax: number;
  slots: number;
  outposts: number;
  range: number;
  power: number;
  home: { name: string; x: number; y: number };
  farms: MapFarm[];
  reports: Report[];
  rules: { needLevel: number };
}

const n = (value: number) => value.toLocaleString('en-US');
const ago = (at: number) => {
  const s = Math.max(0, Date.now() / 1000 - at);
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

function report(r: Report) {
  const where = r.farm ? `${r.farm.name} (${r.farm.x}, ${r.farm.y})` : 'a farm';
  if (r.attacking) {
    if (!r.won) {
      return `Attacked ${where}: ${r.defender} held`;
    }
    return r.choice === 'capture' ? `Captured ${where} from ${r.defender}` : r.choice === 'plunder' ? `Raided ${where}: ${n(r.loot?.coins ?? 0)} coins` : `Beat ${r.defender} at ${where}`;
  }
  return r.won ? `${r.attacker} attacked ${where}: you held` : r.choice === 'capture' ? `${r.attacker} captured ${where}` : `${r.attacker} raided ${where}`;
}

export function WorldMapCard() {
  const [data, setData] = useState<MapMe | null>(null);
  useEffect(() => {
    void api<MapMe>('/api/map').then(setData);
  }, []);
  if (!data) {
    return null;
  }
  const outposts = data.farms.filter((f) => f.kind !== 'home');
  return (
    <div className="card" style={{ gridColumn: 'span 2' }}>
      <h2>World map</h2>
      <div className="stat" style={{ fontSize: 22 }}>
        {data.home.name}
      </div>
      <div className="muted small">
        Square {data.home.x}, {data.home.y} · {data.embassy ? `Embassy level ${data.embassy} of ${data.embassyMax}: ${data.outposts} of ${data.slots} farms out there, reach ${data.range} squares` : 'No Embassy yet (level 25)'}
      </div>
      {!data.allowed && <p className="muted small">{data.why}. On the map you can build farms, attack other players&apos; farms and plunder or capture them.</p>}
      {outposts.length > 0 && (
        <table className="ref-table" style={{ marginTop: 10 }}>
          <tbody>
            {outposts.map((f) => (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td className="muted">
                  {f.x}, {f.y} · {f.biome}
                </td>
                <td>
                  <CoinIcon size={13} /> {n(f.stored.coins)}
                  {Object.entries(f.stored.produce).map(([id, c]) => ` · ${c} ${itemName(id)}`)}
                </td>
                <td className="muted">{n(f.production.coins)}/h</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.reports.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Battles</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {data.reports.slice(0, 6).map((r) => (
              <li key={r.id} style={{ color: r.won ? undefined : 'var(--danger, #e66)' }}>
                {report(r)} <span className="muted">· {ago(r.at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
