'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { getAccessToken, refreshAccess } from '../../lib/client';

interface NetworkInfo {
  id: string;
  label: string;
  asset: string;
}
interface Pack {
  id: string;
  bloom: number;
  gems?: number;
  usdCents: number;
  tag?: string;
}
interface VipPlan {
  id: string;
  days: number;
  bloom: number;
  tag?: string;
}
interface GemPack {
  id: string;
  gems: number;
  bloom: number;
  tag?: string;
}
interface Settings {
  wallets: Record<string, string>;
  packs: Pack[];
  orderMinutes: number;
  vipPlans: VipPlan[];
  gemPacks: GemPack[];
  networks: NetworkInfo[];
}
interface Standing {
  reputation: number;
  tier: { name: string };
  vip: boolean;
  vipUntil: string | null;
}
interface Order {
  id: string;
  username: string;
  pack: string;
  bloom: number;
  gems: number;
  kind: 'order' | 'deposit';
  fromLinkedWallet: boolean;
  paidAt: string | null;
  usd: string;
  network: string;
  networkLabel: string;
  asset: string;
  amount: string;
  address: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  txHash: string | null;
  explorer: string | null;
  note: string | null;
}
interface Totals {
  paidOrders: number;
  usd: string;
  bloom: number;
  gems: number;
  fromLinkedWallets: number;
}

/** fetch as the signed-in admin; the error message (or null) and the body. */
async function call<T>(path: string, init: RequestInit = {}): Promise<{ data: T | null; error: string | null }> {
  let token = getAccessToken() ?? (await refreshAccess());
  if (!token) {
    return { data: null, error: 'Sign in first' };
  }
  const send = (t: string) => fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init.headers, Authorization: `Bearer ${t}` } });
  let response = await send(token);
  if (response.status === 401) {
    token = await refreshAccess();
    if (!token) {
      return { data: null, error: 'Sign in first' };
    }
    response = await send(token);
  }
  const body = await response.json().catch(() => ({}));
  return response.ok ? { data: body as T, error: null } : { data: null, error: (body as { error?: string }).error ?? `Error ${response.status}` };
}

const STATUSES = ['', 'pending', 'confirming', 'paid', 'expired', 'cancelled'];

export default function AdminPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [wallets, setWallets] = useState<Record<string, string>>({});
  const [packs, setPacks] = useState<Pack[]>([]);
  const [minutes, setMinutes] = useState(10);
  const [orders, setOrders] = useState<Order[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [grantName, setGrantName] = useState('');
  const [grantBloom, setGrantBloom] = useState('');
  const [grantCurrency, setGrantCurrency] = useState<'bloom' | 'gems'>('bloom');
  const [vipPlans, setVipPlans] = useState<VipPlan[]>([]);
  const [gemPacks, setGemPacks] = useState<GemPack[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [vipDays, setVipDays] = useState('');
  const [repChange, setRepChange] = useState('');
  const [player, setPlayer] = useState<{ username: string; standing: Standing } | null>(null);

  const loadOrders = useCallback(async (status: string) => {
    const { data } = await call<{ orders: Order[]; totals: Totals }>(`/api/admin/payments${status ? `?status=${status}` : ''}`);
    if (data) {
      setOrders(data.orders);
      setTotals(data.totals);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await call<Settings>('/api/admin/settings');
      if (!data) {
        setDenied(error);
        return;
      }
      setSettings(data);
      setWallets(data.wallets);
      setPacks(data.packs);
      setMinutes(data.orderMinutes);
      setVipPlans(data.vipPlans ?? []);
      setGemPacks(data.gemPacks ?? []);
      await loadOrders('');
    })();
  }, [loadOrders]);

  useEffect(() => {
    if (settings) {
      loadOrders(filter);
    }
  }, [filter, settings, loadOrders]);

  async function save(part: Partial<Pick<Settings, 'wallets' | 'packs' | 'orderMinutes' | 'vipPlans' | 'gemPacks'>>) {
    const { data, error } = await call<Settings>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(part) });
    if (data) {
      setWallets(data.wallets);
      setPacks(data.packs);
      setMinutes(data.orderMinutes);
      setVipPlans(data.vipPlans ?? []);
      setGemPacks(data.gemPacks ?? []);
      setMessage('Saved');
    } else {
      setMessage(error);
    }
  }

  async function act(order: Order, action: 'check' | 'credit' | 'cancel') {
    let txHash: string | undefined;
    if (action === 'credit') {
      const typed = window.prompt(`Credit ${order.bloom} BLOOM to ${order.username} by hand? Paste the transaction hash if you have it:`, order.txHash ?? '');
      if (typed === null) {
        return;
      }
      txHash = typed;
    }
    if (action === 'cancel' && !window.confirm(`Cancel ${order.username}'s order for ${order.bloom} BLOOM?`)) {
      return;
    }
    const { error } = await call(`/api/admin/payments/${order.id}`, { method: 'POST', body: JSON.stringify({ action, txHash }) });
    setMessage(error ?? `${action === 'check' ? 'Checked' : action === 'credit' ? 'Credited' : 'Cancelled'}: ${order.username}`);
    await loadOrders(filter);
  }

  async function giveBloom() {
    const bloom = Number(grantBloom);
    if (!grantName || !Number.isInteger(bloom) || bloom === 0) {
      setMessage('A player name and a whole number of BLOOM');
      return;
    }
    const { data, error } = await call<{ bloom: number; gems: number }>('/api/admin/grant', { method: 'POST', body: JSON.stringify({ username: grantName, amount: bloom, currency: grantCurrency }) });
    const what = grantCurrency === 'bloom' ? 'BLOOM' : 'gems';
    setMessage(error ?? `${bloom > 0 ? 'Gave' : 'Took'} ${Math.abs(bloom)} ${what} ${bloom > 0 ? 'to' : 'from'} ${grantName}: they have ${data?.bloom} BLOOM and ${data?.gems} gems now`);
    if (!error) {
      setGrantBloom('');
    }
  }

  async function adjustPlayer() {
    const days = vipDays ? Number(vipDays) : 0;
    const reputation = repChange ? Number(repChange) : 0;
    if (!playerName || !Number.isInteger(days) || !Number.isInteger(reputation) || (days === 0 && reputation === 0)) {
      setMessage('A player name, and whole numbers of VIP days or reputation');
      return;
    }
    const { data, error } = await call<{ username: string; standing: Standing }>('/api/admin/player', {
      method: 'POST',
      body: JSON.stringify({ username: playerName, ...(days ? { vipDays: days } : {}), ...(reputation ? { reputation } : {}) }),
    });
    if (data) {
      setPlayer(data);
      setVipDays('');
      setRepChange('');
      setMessage(`${data.username}: ${data.standing.tier.name}, ${data.standing.reputation} reputation${data.standing.vip ? `, VIP until ${new Date(data.standing.vipUntil!).toLocaleDateString()}` : ''}`);
    } else {
      setMessage(error);
    }
  }

  if (denied) {
    return (
      <section className="card" style={{ maxWidth: 520, margin: '40px auto' }}>
        <h2>Admin</h2>
        <p className="muted">{denied === 'Sign in first' ? 'Sign in with an admin account first.' : denied}</p>
        <Link className="button" href="/">
          Sign in
        </Link>
      </section>
    );
  }
  if (!settings) {
    return <p className="muted" style={{ textAlign: 'center', marginTop: 60 }}>Loading…</p>;
  }

  return (
    <div className="admin">
      <div className="row-head">
        <h1>Shop admin</h1>
        <Link className="pill" href="/admin/events">
          Events: the wolf →
        </Link>
        <Link className="pill" href="/admin/updates">
          App updates →
        </Link>
        {totals && (
          <span className="pill">
            {totals.paidOrders} paid · ${totals.usd} · {totals.bloom.toLocaleString()} BLOOM · {totals.gems.toLocaleString()} gems · {totals.fromLinkedWallets} from linked wallets
          </span>
        )}
      </div>
      {message && (
        <p className="notice" onClick={() => setMessage(null)}>
          {message}
        </p>
      )}

      <section className="card">
        <h2>Wallets</h2>
        <p className="muted small">Payments go to these addresses. A coin is offered in the game only while it has an address. Use a wallet you control (not an exchange deposit address that needs a memo).</p>
        {settings.networks.map((n) => (
          <div key={n.id}>
            <label htmlFor={`w-${n.id}`}>{n.label}</label>
            <input id={`w-${n.id}`} value={wallets[n.id] ?? ''} placeholder="not accepted" spellCheck={false} onChange={(e) => setWallets({ ...wallets, [n.id]: e.target.value.trim() })} />
          </div>
        ))}
        <button className="button wide" onClick={() => save({ wallets })}>
          Save wallets
        </button>
      </section>

      <section className="card">
        <h2>Packs</h2>
        <p className="muted small">Sold for crypto in the game&apos;s shop. A pack gives BLOOM or gems; a payment from a player&apos;s linked wallet is credited with the pack of their open order by itself.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Id</th>
                <th>Gives</th>
                <th>Amount</th>
                <th>Price (USD)</th>
                <th>Badge</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {packs.map((p, i) => (
                <tr key={i}>
                  <td>
                    <input value={p.id} onChange={(e) => setPacks(packs.map((q, j) => (j === i ? { ...q, id: e.target.value } : q)))} />
                  </td>
                  <td>
                    <select
                      value={(p.gems ?? 0) > 0 ? 'gems' : 'bloom'}
                      onChange={(e) =>
                        setPacks(packs.map((q, j) => (j === i ? (e.target.value === 'gems' ? { ...q, gems: q.gems || q.bloom || 100, bloom: 0 } : { ...q, bloom: q.bloom || q.gems || 100, gems: undefined }) : q)))
                      }
                    >
                      <option value="bloom">BLOOM</option>
                      <option value="gems">gems</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      value={(p.gems ?? 0) > 0 ? p.gems : p.bloom}
                      onChange={(e) => setPacks(packs.map((q, j) => (j === i ? ((q.gems ?? 0) > 0 ? { ...q, gems: Number(e.target.value) } : { ...q, bloom: Number(e.target.value) }) : q)))}
                    />
                  </td>
                  <td>
                    <input type="number" step="0.01" value={(p.usdCents / 100).toFixed(2)} onChange={(e) => setPacks(packs.map((q, j) => (j === i ? { ...q, usdCents: Math.round(Number(e.target.value) * 100) } : q)))} />
                  </td>
                  <td>
                    <input value={p.tag ?? ''} placeholder="—" onChange={(e) => setPacks(packs.map((q, j) => (j === i ? { ...q, tag: e.target.value || undefined } : q)))} />
                  </td>
                  <td>
                    <button className="button quiet" onClick={() => setPacks(packs.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label htmlFor="minutes">Minutes to pay an order</label>
        <input id="minutes" type="number" min={3} max={60} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button className="button quiet" onClick={() => setPacks([...packs, { id: `p${Date.now() % 100000}`, bloom: 100, usdCents: 99 }])}>
            Add a pack
          </button>
          <button className="button" onClick={() => save({ packs, orderMinutes: minutes })}>
            Save packs
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Give BLOOM or gems</h2>
        <p className="muted small">Added to the player&apos;s balance on the server at once (a negative number takes it away, as far as they have it). Written in the books.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input style={{ flex: 2, minWidth: 160 }} placeholder="player name" value={grantName} onChange={(e) => setGrantName(e.target.value)} />
          <input style={{ flex: 1, minWidth: 100 }} type="number" placeholder="amount" value={grantBloom} onChange={(e) => setGrantBloom(e.target.value)} />
          <select value={grantCurrency} onChange={(e) => setGrantCurrency(e.target.value as 'bloom' | 'gems')}>
            <option value="bloom">BLOOM</option>
            <option value="gems">gems</option>
          </select>
          <button className="button" onClick={giveBloom}>
            Give
          </button>
        </div>
      </section>

      <section className="card">
        <h2>VIP plans</h2>
        <p className="muted small">Bought in the game&apos;s journal (J) with BLOOM. VIP: a golden name, +600 reputation while it lasts (the market opens), one more task a day, +5% and bigger orders at the traders.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Id</th>
                <th>Days</th>
                <th>BLOOM</th>
                <th>Badge</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {vipPlans.map((p, i) => (
                <tr key={i}>
                  <td>
                    <input value={p.id} onChange={(e) => setVipPlans(vipPlans.map((q, j) => (j === i ? { ...q, id: e.target.value } : q)))} />
                  </td>
                  <td>
                    <input type="number" value={p.days} onChange={(e) => setVipPlans(vipPlans.map((q, j) => (j === i ? { ...q, days: Number(e.target.value) } : q)))} />
                  </td>
                  <td>
                    <input type="number" value={p.bloom} onChange={(e) => setVipPlans(vipPlans.map((q, j) => (j === i ? { ...q, bloom: Number(e.target.value) } : q)))} />
                  </td>
                  <td>
                    <input value={p.tag ?? ''} placeholder="—" onChange={(e) => setVipPlans(vipPlans.map((q, j) => (j === i ? { ...q, tag: e.target.value || undefined } : q)))} />
                  </td>
                  <td>
                    <button className="button quiet" onClick={() => setVipPlans(vipPlans.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button className="button quiet" onClick={() => setVipPlans([...vipPlans, { id: `vip${Date.now() % 100000}`, days: 30, bloom: 1900 }])}>
            Add a plan
          </button>
          <button className="button" onClick={() => save({ vipPlans })}>
            Save VIP plans
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Gem packs</h2>
        <p className="muted small">Bought in the game (the + by the gems) with BLOOM. Gems speed timers up: 3 gems a minute of growing, milk, eggs or wool left.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Id</th>
                <th>Gems</th>
                <th>BLOOM</th>
                <th>Badge</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {gemPacks.map((p, i) => (
                <tr key={i}>
                  <td>
                    <input value={p.id} onChange={(e) => setGemPacks(gemPacks.map((q, j) => (j === i ? { ...q, id: e.target.value } : q)))} />
                  </td>
                  <td>
                    <input type="number" value={p.gems} onChange={(e) => setGemPacks(gemPacks.map((q, j) => (j === i ? { ...q, gems: Number(e.target.value) } : q)))} />
                  </td>
                  <td>
                    <input type="number" value={p.bloom} onChange={(e) => setGemPacks(gemPacks.map((q, j) => (j === i ? { ...q, bloom: Number(e.target.value) } : q)))} />
                  </td>
                  <td>
                    <input value={p.tag ?? ''} placeholder="—" onChange={(e) => setGemPacks(gemPacks.map((q, j) => (j === i ? { ...q, tag: e.target.value || undefined } : q)))} />
                  </td>
                  <td>
                    <button className="button quiet" onClick={() => setGemPacks(gemPacks.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button className="button quiet" onClick={() => setGemPacks([...gemPacks, { id: `g${Date.now() % 100000}`, gems: 500, bloom: 100 }])}>
            Add a pack
          </button>
          <button className="button" onClick={() => save({ gemPacks })}>
            Save gem packs
          </button>
        </div>
      </section>

      <section className="card">
        <h2>A player&apos;s VIP and reputation</h2>
        <p className="muted small">VIP days add to any VIP still running (negative takes days away). Reputation is added (negative takes it away). The game sees it within a few minutes.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input style={{ flex: 2, minWidth: 160 }} placeholder="player name" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
          <input style={{ flex: 1, minWidth: 100 }} type="number" placeholder="VIP days" value={vipDays} onChange={(e) => setVipDays(e.target.value)} />
          <input style={{ flex: 1, minWidth: 100 }} type="number" placeholder="reputation" value={repChange} onChange={(e) => setRepChange(e.target.value)} />
          <button className="button" onClick={adjustPlayer}>
            Apply
          </button>
        </div>
        {player && (
          <p className="muted small" style={{ marginTop: 10 }}>
            {player.username}: {player.standing.tier.name} · {player.standing.reputation} reputation
            {player.standing.vip && player.standing.vipUntil ? ` · VIP until ${new Date(player.standing.vipUntil).toLocaleDateString()}` : ' · not VIP'}
          </p>
        )}
      </section>

      <section className="card">
        <div className="row-head" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Transactions</h2>
          <div className="tabs" style={{ marginBottom: 0, marginLeft: 'auto' }}>
            {STATUSES.map((s) => (
              <button key={s || 'all'} aria-selected={filter === s} onClick={() => setFilter(s)}>
                {s || 'all'}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table className="orders">
            <thead>
              <tr>
                <th>When</th>
                <th>Player</th>
                <th>Pack</th>
                <th>Amount</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="small">{new Date(o.paidAt ?? o.createdAt).toLocaleString()}</td>
                  <td>{o.username}</td>
                  <td>
                    {o.gems > 0 ? `${o.gems.toLocaleString()} gems` : `${o.bloom.toLocaleString()} BLOOM`} · ${o.usd}
                    <br />
                    <span className="muted small">
                      {o.kind === 'deposit' ? 'deposit' : `pack ${o.pack}`}
                      {o.fromLinkedWallet ? ' · linked wallet' : ''}
                    </span>
                  </td>
                  <td className="small">
                    <b>
                      {o.amount} {o.asset}
                    </b>
                    <br />
                    <span className="muted">{o.networkLabel}</span>
                  </td>
                  <td>
                    <span className={`status ${o.status}`}>{o.status}</span>
                    {o.explorer && (
                      <>
                        <br />
                        <a className="small" href={o.explorer} target="_blank" rel="noreferrer">
                          transaction ↗
                        </a>
                      </>
                    )}
                    {o.note && <div className="muted small">{o.note}</div>}
                  </td>
                  <td className="actions">
                    {o.status !== 'paid' && o.status !== 'cancelled' && (
                      <>
                        <button className="button quiet" onClick={() => act(o, 'check')}>
                          Check
                        </button>
                        <button className="button quiet" onClick={() => act(o, 'credit')}>
                          Credit
                        </button>
                        <button className="button quiet" onClick={() => act(o, 'cancel')}>
                          Cancel
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No transactions
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
