'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, apiResult } from '../../lib/client';
import { BloomIcon, CoinIcon } from '../../components/Bloom';

/** The farm page's invitations (the player's link, who came, what it paid) and tasks on X. */

interface Referrals {
  link: string;
  settings: { coinsPerInvite: number; maxRewarded: number; groupSize: number; bloomPerGroup: number; activeLevel: number };
  invited: number;
  active: number;
  vip: number;
  vipTowardNext: number;
  rewardsLeft: number;
  earned: { coins: number; bloom: number };
  invitees: { username: string; joinedAt: string; level: number; vip: boolean; rewarded: boolean; coinsPaid: boolean }[];
  rewards: { kind: string; amount: number; note: string | null; at: string }[];
}

interface XTasks {
  open: boolean;
  canLink: boolean;
  canCheck: boolean;
  handle: string;
  postUrl: string;
  coins: Record<'connect' | 'follow' | 'like' | 'share', number>;
  account: { username: string; name: string | null; avatar: string | null } | null;
  done: Record<'connect' | 'follow' | 'like' | 'share', boolean>;
  earned: number;
}

const n = (value: number) => value.toLocaleString('en-US');

function shareText(link: string) {
  return `I'm farming in Battle Bloom 🌱 Come grow crops and raise animals with me: ${link}`;
}

export function InviteCard() {
  const [data, setData] = useState<Referrals | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void api<Referrals>('/api/referrals').then(setData);
  }, []);

  if (!data) {
    return (
      <div className="card social-card">
        <h2>Invite friends</h2>
        <p className="muted small">Loading…</p>
      </div>
    );
  }
  const s = data.settings;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // no clipboard here: the link can still be selected
    }
  };
  const list = showAll ? data.invitees : data.invitees.slice(0, 8);
  return (
    <div className="card social-card invite">
      <h2>Invite friends</h2>
      <p className="muted small">
        Every friend who signs up with your link and reaches level {s.activeLevel} earns you <b>{n(s.coinsPerInvite)} coins</b> (your first {n(s.maxRewarded)} friends).
        Every {s.groupSize} of them who buy VIP earn you <b>{n(s.bloomPerGroup)} BLOOM</b>.
      </p>
      <div className="ref-link">
        <input readOnly value={data.link} onFocus={(e) => e.currentTarget.select()} aria-label="Your invitation link" />
        <button type="button" className="button" onClick={copy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="share-row">
        <a className="button quiet" target="_blank" rel="noreferrer" href={`https://x.com/intent/post?text=${encodeURIComponent(shareText(data.link))}`}>
          Post on X
        </a>
        <a className="button quiet" target="_blank" rel="noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(data.link)}&text=${encodeURIComponent('Farm with me in Battle Bloom!')}`}>
          Telegram
        </a>
        <a className="button quiet" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(shareText(data.link))}`}>
          WhatsApp
        </a>
      </div>
      <div className="ref-stats">
        <div>
          <b>{n(data.invited)}</b>
          <span>invited</span>
        </div>
        <div>
          <b>{n(data.active)}</b>
          <span>played (paid)</span>
        </div>
        <div>
          <b>{n(data.vip)}</b>
          <span>bought VIP</span>
        </div>
        <div>
          <b>
            <CoinIcon size={16} /> {n(data.earned.coins)}
          </b>
          <span>coins earned</span>
        </div>
        <div>
          <b>
            <BloomIcon size={16} /> {n(data.earned.bloom)}
          </b>
          <span>BLOOM earned</span>
        </div>
      </div>
      <div className="small muted">
        Next {n(s.bloomPerGroup)} BLOOM: {data.vipTowardNext} of {s.groupSize} VIP friends
      </div>
      <div className="bar">
        <div style={{ width: `${(100 * data.vipTowardNext) / Math.max(1, s.groupSize)}%`, background: 'var(--gold)' }} />
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        {data.rewardsLeft > 0 ? `${n(data.rewardsLeft)} more friends can still earn you rewards` : `Your first ${n(s.maxRewarded)} friends have been counted: new ones show here without rewards`}
      </div>
      {data.invitees.length > 0 && (
        <table className="ref-table">
          <thead>
            <tr>
              <th>Friend</th>
              <th>Joined</th>
              <th>Level</th>
              <th>VIP</th>
              <th>Reward</th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.username}>
                <td>
                  <b>{i.username}</b>
                </td>
                <td>{new Date(i.joinedAt).toLocaleDateString()}</td>
                <td>{i.level}</td>
                <td>{i.vip ? '★' : '–'}</td>
                <td className="small">{!i.rewarded ? 'past the limit' : i.coinsPaid ? `${n(s.coinsPerInvite)} coins` : `at level ${s.activeLevel}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.invitees.length > 8 && (
        <button type="button" className="button quiet wide" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${n(data.invitees.length)}`}
        </button>
      )}
      {data.rewards.length > 0 && (
        <>
          <h3 className="sub">Rewards received</h3>
          <ul className="ref-rewards">
            {data.rewards.map((r, k) => (
              <li key={k}>
                {r.kind === 'bloom' ? <BloomIcon size={15} /> : <CoinIcon size={15} />}
                <b>
                  +{n(r.amount)} {r.kind === 'bloom' ? 'BLOOM' : 'coins'}
                </b>
                <span className="muted small">{r.note}</span>
                <time className="muted small">{new Date(r.at).toLocaleDateString()}</time>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function XLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ verticalAlign: '-0.15em' }}>
      <path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.9-6.4L6.3 22H3.2l7.3-8.3L1 2h6.3l4.4 5.9L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z" />
    </svg>
  );
}

export function XTasksCard({ username }: { username: string }) {
  const [data, setData] = useState<XTasks | null>(null);
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [postUrl, setPostUrl] = useState('');
  const [link, setLink] = useState('');

  const load = useCallback(() => {
    void api<XTasks>('/api/x').then(setData);
    void api<{ link: string }>('/api/referrals').then((r) => r && setLink(r.link));
  }, []);

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get('x_linked')) {
      setMessage({ text: `Linked ${params.get('x_linked')}`, good: true });
    } else if (params.get('x_error')) {
      setMessage({ text: params.get('x_error')!, good: false });
    }
  }, [load]);

  if (!data) {
    return null;
  }
  if (!data.open) {
    return (
      <div className="card social-card">
        <h2>
          <XLogo /> Battle Bloom on X
        </h2>
        <p className="muted small">Tasks on X open soon: follow the game, like its posts and share your farm card for coins.</p>
      </div>
    );
  }
  const linkX = async () => {
    setBusy('connect');
    const result = await apiResult<{ url: string }>('/api/x/link', { method: 'POST' });
    if (result.data?.url) {
      window.location.href = result.data.url;
    } else {
      setMessage({ text: result.error ?? 'Couldn\'t start', good: false });
      setBusy('');
    }
  };
  const check = async (task: 'follow' | 'like' | 'share') => {
    setBusy(task);
    const result = await apiResult<{ paid: boolean; coins: number }>('/api/x/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(task === 'share' ? { task, url: postUrl } : { task }),
    });
    setBusy('');
    if (result.data) {
      setMessage({ text: result.data.paid ? `Done! +${n(result.data.coins)} coins on your farm` : 'Done (already paid)', good: true });
      load();
    } else {
      setMessage({ text: result.error ?? 'Not yet', good: false });
    }
  };
  const card = `/api/card/${encodeURIComponent(username)}`;
  const tweet = `https://x.com/intent/post?text=${encodeURIComponent(shareText(link))}`;
  const Step = ({ k, title, children, coins }: { k: keyof XTasks['done']; title: string; children: React.ReactNode; coins: number }) => (
    <li className={`x-step${data.done[k] ? ' done' : ''}`}>
      <div className="x-step-head">
        <span className="x-check">{data.done[k] ? '✓' : ''}</span>
        <b>{title}</b>
        <span className="x-coins">
          <CoinIcon size={14} /> {n(coins)}
        </span>
      </div>
      {!data.done[k] && <div className="x-step-body">{children}</div>}
    </li>
  );
  return (
    <div className="card social-card x-card">
      <h2>
        <XLogo /> Battle Bloom on X
      </h2>
      {data.account ? (
        <div className="x-account">
          {data.account.avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.account.avatar} alt="" width={36} height={36} />
          )}
          <span>
            <b>{data.account.name ?? data.account.username}</b> <span className="muted">@{data.account.username}</span>
          </span>
        </div>
      ) : null}
      <ol className="x-steps">
        <Step k="connect" title="Link your X account" coins={data.coins.connect}>
          <button type="button" className="button" disabled={!data.canLink || busy === 'connect'} onClick={linkX}>
            <XLogo /> Link X
          </button>
          {!data.canLink && <span className="muted small"> not set up yet</span>}
        </Step>
        <Step k="follow" title={`Follow @${data.handle || 'the game'}`} coins={data.coins.follow}>
          <a className="button quiet" target="_blank" rel="noreferrer" href={`https://x.com/${data.handle}`}>
            Open the page
          </a>
          <button type="button" className="button" disabled={!data.account || busy === 'follow'} onClick={() => check('follow')}>
            I followed: check
          </button>
        </Step>
        <Step k="like" title="Like the game's post" coins={data.coins.like}>
          <a className="button quiet" target="_blank" rel="noreferrer" href={data.postUrl}>
            Open the post
          </a>
          <button type="button" className="button" disabled={!data.account || busy === 'like'} onClick={() => check('like')}>
            I liked it: check
          </button>
        </Step>
        <Step k="share" title="Post your farm card" coins={data.coins.share}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="x-card-preview" src={card} alt="Your farm card" width={1200} height={630} />
          <div className="share-row">
            <a className="button quiet" href={card} download={`battle-bloom-${username}.png`}>
              Download the card
            </a>
            <a className="button quiet" target="_blank" rel="noreferrer" href={tweet}>
              <XLogo /> Post with your link
            </a>
          </div>
          <p className="muted small">Post it with your invitation link (the card shows up with the link by itself), then paste your post&apos;s address:</p>
          <div className="ref-link">
            <input placeholder="https://x.com/you/status/…" value={postUrl} onChange={(e) => setPostUrl(e.target.value)} />
            <button type="button" className="button" disabled={!data.account || !postUrl || busy === 'share'} onClick={() => check('share')}>
              Check
            </button>
          </div>
        </Step>
      </ol>
      {message && <p className={message.good ? 'x-good' : 'error'}>{message.text}</p>}
      <p className="muted small">
        Earned on X: <CoinIcon size={13} /> {n(data.earned)} coins
      </p>
    </div>
  );
}
