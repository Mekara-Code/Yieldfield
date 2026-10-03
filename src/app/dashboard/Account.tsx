'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, apiResult } from '../../lib/client';
import { BloomIcon, GemIcon, MONEY } from '../../components/Bloom';

/**
 * The dashboard's account cards: the player's standing (reputation and where it comes from: linked wallets,
 * Discord, VIP), the accounts linked to the farm (link a wallet or Discord here), their skills and combat
 * power, the market (their listings, what's on sale) and their history (purchases and every BLOOM and gem).
 */

export interface Standing {
  reputation: number;
  sources: { base: number; wallets: number; discord: number; vip: number; walletCount: number; discordLinked: boolean; perWallet: number; forDiscord: number; forVip: number };
  tier: { name: string };
  next: { name: string; min: number } | null;
  vip: boolean;
  vipUntil: string | null;
  market: { needs: number; open: boolean };
  perks: { listings: number };
}

export interface MeAccount {
  username: string;
  standing: Standing;
  wallets: { id: string; chain: string; short: string; linkedAt: string }[];
  discord: { name: string | null; linkedAt: string | null } | null;
}

interface SkillDefs {
  skills: { id: string; name: string; about: string }[];
  skillTracks: { id: string; skill: string; part: 'power' | 'time' | 'yield'; max: number; step: number }[];
  skillResetSeconds: number;
}

const CHAINS: Record<string, string> = { evm: 'BNB Chain / Ethereum', tron: 'Tron', ton: 'TON' };

function ago(at: string) {
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
}

function left(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function StandingCard({ me, onChange }: { me: MeAccount; onChange: () => void }) {
  const s = me.standing;
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function linkWallet() {
    setBusy(true);
    const { data, error } = await apiResult<{ url: string }>('/api/wallet/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'link' }) });
    setBusy(false);
    if (data) {
      window.location.href = data.url;
    } else {
      setMessage(error);
    }
  }

  async function linkDiscord() {
    setBusy(true);
    const { data, error } = await apiResult<{ url: string }>('/api/discord/requests', { method: 'POST' });
    setBusy(false);
    if (data) {
      window.location.href = data.url;
    } else {
      setMessage(error);
    }
  }

  async function unlinkDiscord() {
    if (!confirm(`Unlink Discord? Your farm loses its ${s.sources.forDiscord} reputation.`)) {
      return;
    }
    await apiResult('/api/discord', { method: 'DELETE' });
    onChange();
  }

  return (
    <div className="card">
      <h2>Reputation</h2>
      <div className="stat">{s.reputation.toLocaleString()}</div>
      <div className="muted small">
        {s.tier.name}
        {s.next ? ` · ${s.next.min - s.reputation} more for ${s.next.name}` : ''}
      </div>
      <ul className="sources">
        <li>
          <span>
            {s.sources.walletCount} linked wallet{s.sources.walletCount === 1 ? '' : 's'} × {s.sources.perWallet}
          </span>
          <b>{s.sources.wallets}</b>
        </li>
        <li>
          <span>Discord {s.sources.discordLinked ? '(linked)' : '(not linked)'}</span>
          <b>{s.sources.discord}</b>
        </li>
        <li>
          <span>VIP {s.vip && s.vipUntil ? `(until ${new Date(s.vipUntil).toLocaleDateString()})` : '(not VIP)'}</span>
          <b>{s.sources.vip}</b>
        </li>
        {s.sources.base > 0 && (
          <li>
            <span>Given before</span>
            <b>{s.sources.base}</b>
          </li>
        )}
      </ul>
      <p className={`small ${s.market.open ? '' : 'muted'}`}>
        {s.market.open ? `The market is open to you: up to ${s.perks.listings} listings at once.` : `The market takes ${s.market.needs} reputation: VIP gives ${s.sources.forVip}.`}
      </p>

      <h2 style={{ marginTop: 18 }}>Linked accounts</h2>
      {me.wallets.length ? (
        <ul className="linked">
          {me.wallets.map((w) => (
            <li key={w.id}>
              <span className="chain">{CHAINS[w.chain] ?? w.chain}</span> <code>{w.short}</code>
              <span className="muted small"> · +{s.sources.perWallet}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No wallets yet. Payments from a linked wallet are credited by themselves, and each gives {s.sources.perWallet} reputation.</p>
      )}
      <ul className="linked">
        <li>
          <span className="chain">Discord</span>{' '}
          {me.discord ? (
            <>
              <b>{me.discord.name}</b>
              <span className="muted small"> · +{s.sources.forDiscord}</span>
            </>
          ) : (
            <span className="muted small">not linked (+{s.sources.forDiscord} when it is)</span>
          )}
        </li>
      </ul>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button className="button quiet" disabled={busy} onClick={linkWallet}>
          Link a wallet
        </button>
        {me.discord ? (
          <button className="button quiet" onClick={unlinkDiscord}>
            Unlink Discord
          </button>
        ) : (
          <button className="button" disabled={busy} onClick={linkDiscord}>
            Connect Discord
          </button>
        )}
      </div>
      {message && <p className="error small">{message}</p>}
    </div>
  );
}

export function SkillsCard({ skills, free, power, resetAt, defs, now }: { skills: Record<string, number>; free: number; power: number; resetAt: number; defs: SkillDefs; now: number }) {
  const nextReset = resetAt ? resetAt + defs.skillResetSeconds - now : 0;
  return (
    <div className="card">
      <h2>Skills</h2>
      <div className="stat">⚔ {power.toLocaleString()}</div>
      <div className="muted small">
        combat power · {free} skill point{free === 1 ? '' : 's'} to put in (in the game: K)
      </div>
      <div className="skills">
        {defs.skills.map((skill) => (
          <div className="skill" key={skill.id}>
            <b>{skill.name}</b>
            {defs.skillTracks
              .filter((t) => t.skill === skill.id)
              .map((t) => {
                const level = skills[t.id] ?? 0;
                return (
                  <div className="track" key={t.id} title={skill.about}>
                    <span className="muted small">{t.part === 'power' ? `level ${level}` : t.part}</span>
                    {t.part === 'power' ? (
                      <span className="small">+{level * t.step} power</span>
                    ) : (
                      <>
                        <span className="pips">
                          {Array.from({ length: t.max }, (_, i) => (
                            <i key={i} className={i < level ? 'on' : ''} />
                          ))}
                        </span>
                        <span className="small">{level ? `${t.part === 'time' ? '-' : '+'}${level * t.step}%` : ''}</span>
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
      <p className="muted small">{nextReset > 0 ? `Skills can be reset again in ${left(nextReset)}.` : 'Skills can be reset (once every 3 months) to put the points in again.'}</p>
    </div>
  );
}

interface MarketView {
  open: boolean;
  built: boolean;
  allowed: number;
  active: number;
  onSale: { key: string; name: string; listings: number; pieces: number; cheapest: number }[];
  mine: { id: string; name: string; price: number; unit: number; status: string; buyer: string | null; secondsLeft: number; createdAt: string }[];
}

export function MarketCard() {
  const [market, setMarket] = useState<MarketView | null>(null);
  useEffect(() => {
    api<MarketView>('/api/market').then(setMarket);
  }, []);
  if (!market) {
    return null;
  }
  return (
    <div className="card">
      <h2>Market</h2>
      <p className="muted small">
        {!market.built ? 'Build the market stall on your farm to trade. ' : ''}
        {market.open ? `${market.active} of ${market.allowed} listings in use.` : 'Trading takes 600 reputation (VIP gives it).'}
      </p>
      {market.mine.length > 0 && (
        <>
          <h3 className="sub">Your listings</h3>
          <ul className="feed">
            {market.mine.slice(0, 8).map((l) => (
              <li key={l.id}>
                <time>{l.status === 'active' ? left(l.secondsLeft) : l.status}</time>
                <span>
                  {l.name} · <BloomIcon size={13} /> {l.price}
                  {l.status === 'sold' && l.buyer ? ` · to ${l.buyer}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="sub">On sale now</h3>
      {market.onSale.length ? (
        <ul className="feed">
          {market.onSale.slice(0, 10).map((g) => (
            <li key={g.key}>
              <time>{g.pieces}×</time>
              <span>
                {g.name} · from <BloomIcon size={13} /> {g.cheapest} each
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Nothing on sale yet.</p>
      )}
    </div>
  );
}

interface History {
  purchases: { id: string; kind: string; bloom: number; gems: number; usd: string; coin: string; amount: string; explorer: string | null; note: string | null; at: string }[];
  ledger: { id: string; currency: string; change: number; balance: number; what: string; at: string }[];
}

export function HistoryCard() {
  const [history, setHistory] = useState<History | null>(null);
  const load = useCallback(() => api<History>('/api/me/history').then(setHistory), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!history) {
    return null;
  }
  return (
    <div className="card" style={{ gridColumn: 'span 2' }}>
      <h2>History</h2>
      <h3 className="sub">Purchases</h3>
      {history.purchases.length ? (
        <ul className="feed">
          {history.purchases.map((p) => (
            <li key={p.id}>
              <time title={new Date(p.at).toLocaleString()}>{ago(p.at)}</time>
              <span>
                {p.gems > 0 ? (
                  <>
                    <GemIcon size={13} /> {p.gems.toLocaleString()} gems
                  </>
                ) : (
                  <>
                    <BloomIcon size={13} /> {p.bloom.toLocaleString()} {MONEY}
                  </>
                )}{' '}
                · ${p.usd} in {p.amount}
                {p.kind === 'deposit' || p.note?.includes('linked wallet') ? ' · from your linked wallet' : ''}
                {p.explorer && (
                  <>
                    {' '}
                    ·{' '}
                    <a href={p.explorer} target="_blank" rel="noreferrer">
                      transaction ↗
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No purchases yet.</p>
      )}
      <h3 className="sub">BLOOM and gems</h3>
      {history.ledger.length ? (
        <ul className="feed">
          {history.ledger.map((l) => (
            <li key={l.id}>
              <time title={new Date(l.at).toLocaleString()}>{ago(l.at)}</time>
              <span>
                {l.change > 0 ? '+' : ''}
                {l.change.toLocaleString()} {l.currency === 'gems' ? 'gems' : MONEY} · {l.what} · <span className="muted">balance {l.balance.toLocaleString()}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Nothing yet.</p>
      )}
    </div>
  );
}

