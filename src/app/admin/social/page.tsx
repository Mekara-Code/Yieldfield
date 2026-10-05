'use client';

import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { apiResult } from '../../../lib/client';

/** Admins: the X tasks (the game's page, the post to like, coins for each step) and the invitation rewards. */

type Task = 'connect' | 'follow' | 'like' | 'share';
interface Referrals {
  coinsPerInvite: number;
  maxRewarded: number;
  groupSize: number;
  bloomPerGroup: number;
  activeLevel: number;
}
interface XSettings {
  enabled: boolean;
  handle: string;
  pageId: string;
  postUrl: string;
  coins: Record<Task, number>;
}
interface Overview {
  referrals: Referrals;
  x: XSettings;
  xSetup: { link: boolean; check: boolean };
  stats: { invited: number; rewards: { kind: string; total: number; count: number }[]; claims: { task: string; coins: number; count: number }[] };
}

const TASKS: { id: Task; label: string }[] = [
  { id: 'connect', label: '1. Link their X account' },
  { id: 'follow', label: '2. Follow the page (checked)' },
  { id: 'like', label: '3. Like the post (checked)' },
  { id: 'share', label: '4. Post their farm card (checked)' },
];

export default function SocialAdmin() {
  const [data, setData] = useState<Overview | null>(null);
  const [denied, setDenied] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [x, setX] = useState<XSettings | null>(null);
  const [ref, setRef] = useState<Referrals | null>(null);
  const [busy, setBusy] = useState(false);

  const take = (d: Overview) => {
    setData(d);
    setX(d.x);
    setRef(d.referrals);
  };
  const load = useCallback(async () => {
    const result = await apiResult<Overview>('/api/admin/social');
    if (result.data) {
      take(result.data);
    } else {
      setDenied(result.error ?? 'Signed out');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (denied) {
    return (
      <section className="card" style={{ maxWidth: 520, margin: '40px auto' }}>
        <h2>Social</h2>
        <p className="muted">{denied.startsWith('Signed out') ? 'Sign in with an admin account first.' : denied}</p>
        <Link className="button" href="/">
          Sign in
        </Link>
      </section>
    );
  }
  if (!data || !x || !ref) {
    return <p className="muted" style={{ textAlign: 'center', marginTop: 60 }}>Loading…</p>;
  }

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await apiResult<Overview>('/api/admin/social', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x, referrals: ref }) });
    setBusy(false);
    if (result.data) {
      take(result.data);
      setMessage(result.data.x.handle && !result.data.x.pageId ? 'Saved, but the page\'s id couldn\'t be found from its name (X\'s API): enter the id by hand' : 'Saved');
    } else {
      setMessage(result.error ?? 'Not saved');
    }
  };
  const num = (value: string) => Math.max(0, Math.floor(Number(value) || 0));
  const reward = (kind: string) => data.stats.rewards.find((r) => r.kind === kind);
  return (
    <div className="admin">
      <div className="row-head">
        <h1>Social: X and invitations</h1>
        <Link className="button quiet" href="/admin">
          Shop admin
        </Link>
      </div>
      {message && (
        <p className="notice" onClick={() => setMessage(null)}>
          {message}
        </p>
      )}
      <form onSubmit={save} className="grid">
        <section className="card">
          <h2>Tasks on X</h2>
          <p className="small muted">
            Linking X: {data.xSetup.link ? 'ready' : 'needs X_CLIENT_ID and X_CLIENT_SECRET'}. Checking follows and likes:{' '}
            {data.xSetup.check ? 'ready (needs X\'s Basic API plan or above)' : 'needs X_BEARER_TOKEN'}. The X app\'s callback: <code>{typeof window !== 'undefined' ? window.location.origin : ''}/api/x/callback</code>
          </p>
          <label className="check">
            <input type="checkbox" checked={x.enabled} onChange={(e) => setX({ ...x, enabled: e.target.checked })} /> Open the tasks to players
          </label>
          <label htmlFor="x-handle">The game&apos;s page (@name)</label>
          <input id="x-handle" value={x.handle} placeholder="BattleBloomGame" onChange={(e) => setX({ ...x, handle: e.target.value, pageId: '' })} />
          <label htmlFor="x-id">Its numeric id (found from the name when saved, if X&apos;s API allows)</label>
          <input id="x-id" value={x.pageId} placeholder="1234567890" onChange={(e) => setX({ ...x, pageId: e.target.value })} />
          <label htmlFor="x-post">The post to like</label>
          <input id="x-post" value={x.postUrl} placeholder="https://x.com/BattleBloomGame/status/…" onChange={(e) => setX({ ...x, postUrl: e.target.value })} />
          <h3 className="sub">Coins for each step</h3>
          {TASKS.map((t) => (
            <div key={t.id} className="admin-row">
              <label htmlFor={`x-${t.id}`}>{t.label}</label>
              <input id={`x-${t.id}`} type="number" min={0} value={x.coins[t.id]} onChange={(e) => setX({ ...x, coins: { ...x.coins, [t.id]: num(e.target.value) } })} />
              <span className="small muted">
                {data.stats.claims.find((c) => c.task === t.id)?.count ?? 0} done ·{' '}
                {(data.stats.claims.find((c) => c.task === t.id)?.coins ?? 0).toLocaleString()} coins paid
              </span>
            </div>
          ))}
        </section>
        <section className="card">
          <h2>Invitations</h2>
          <p className="small muted">
            {data.stats.invited.toLocaleString()} players were invited · {(reward('coins')?.total ?? 0).toLocaleString()} coins and {(reward('bloom')?.total ?? 0).toLocaleString()} BLOOM paid
          </p>
          <label htmlFor="r-coins">Coins for each invited player who plays</label>
          <input id="r-coins" type="number" min={0} value={ref.coinsPerInvite} onChange={(e) => setRef({ ...ref, coinsPerInvite: num(e.target.value) })} />
          <label htmlFor="r-level">…once they reach level</label>
          <input id="r-level" type="number" min={1} value={ref.activeLevel} onChange={(e) => setRef({ ...ref, activeLevel: Math.max(1, num(e.target.value)) })} />
          <label htmlFor="r-max">Invited players who earn rewards (each player)</label>
          <input id="r-max" type="number" min={0} value={ref.maxRewarded} onChange={(e) => setRef({ ...ref, maxRewarded: num(e.target.value) })} />
          <label htmlFor="r-group">BLOOM for every … invited players who bought VIP</label>
          <input id="r-group" type="number" min={1} value={ref.groupSize} onChange={(e) => setRef({ ...ref, groupSize: Math.max(1, num(e.target.value)) })} />
          <label htmlFor="r-bloom">…this much BLOOM</label>
          <input id="r-bloom" type="number" min={0} value={ref.bloomPerGroup} onChange={(e) => setRef({ ...ref, bloomPerGroup: num(e.target.value) })} />
          <button className="button wide" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </section>
      </form>
    </div>
  );
}
