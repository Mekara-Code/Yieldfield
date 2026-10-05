'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';

/**
 * Connecting a wallet for the game: the game opens this page with its request's code; the player
 * signs a message with their wallet (EVM: MetaMask, Trust, OKX...; Tron: TronLink; TON: any TON
 * Connect wallet) and goes back to the game, which is waiting for it.
 */

interface Challenge {
  mode: 'link' | 'login';
  short: string;
  status: string;
  message: string;
  nonce: string;
  expiresAt: string;
  username: string | null;
}

export interface Signed {
  chain: 'evm' | 'tron' | 'ton';
  address: string;
  signature?: string;
  proof?: unknown;
}

declare global {
  interface Window {
    ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
    tronLink?: { request: (args: { method: string }) => Promise<unknown> };
    tronWeb?: { defaultAddress?: { base58?: string }; trx: { signMessageV2: (message: string) => Promise<string> } };
  }
}

const TonButton = dynamic(() => import('./TonButton'), { ssr: false, loading: () => <button className="button wide" disabled>TON wallet…</button> });

/** This page opened inside a wallet app's own browser (where window.ethereum / tronLink are). */
function openIn(href: string) {
  const url = encodeURIComponent(href);
  const bare = href.replace(/^https?:\/\//, '');
  return [
    { name: 'MetaMask', href: `https://metamask.app.link/dapp/${bare}` },
    { name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=60&url=${url}` },
    { name: 'OKX', href: `okx://wallet/dapp/url?dappUrl=${url}` },
    { name: 'TronLink', href: `tronlinkoutside://pull.activity?param=${encodeURIComponent(JSON.stringify({ url: href, action: 'open', protocol: 'tronlink', version: '1.0' }))}` },
  ];
}

function toHex(text: string) {
  return '0x' + Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function WalletPage() {
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState<Signed | null>(null);
  const [needsAccount, setNeedsAccount] = useState(false);
  const [name, setName] = useState('');
  const [character, setCharacter] = useState<'Diana' | 'Arellah' | 'Arash'>('Diana');
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [here, setHere] = useState('');

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('code') ?? '';
    setCode(c);
    setHere(window.location.href);
    if (!c) {
      setError('Open this page from the game (Connect wallet).');
      return;
    }
    fetch(`/api/wallet/challenge?code=${encodeURIComponent(c)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) {
          throw new Error(body.error ?? 'This link isn\'t valid');
        }
        setChallenge(body);
        if (body.status !== 'pending') {
          setError(body.status === 'expired' ? 'This link ran out: start again from the game.' : 'This link was already used.');
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const send = useCallback(
    async (s: Signed, extra?: { name: string; character: string }) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch('/api/wallet/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, ...s, ...extra }) });
        const body = await r.json();
        if (!r.ok) {
          throw new Error(body.error ?? 'That didn\'t work');
        }
        if (body.needsAccount) {
          setSigned(s);
          setNeedsAccount(true);
          return;
        }
        setDone(body.linked ? `Linked ${body.linked}.` : `Signed in as ${body.username}.`);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [code],
  );

  async function evm() {
    if (!window.ethereum || !challenge) {
      setError('No EVM wallet here: open this page in MetaMask, Trust Wallet or OKX (their browser), or use a desktop browser with the wallet extension.');
      return;
    }
    try {
      setBusy(true);
      const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
      const address = accounts[0];
      const signature = (await window.ethereum.request({ method: 'personal_sign', params: [toHex(challenge.message), address] })) as string;
      await send({ chain: 'evm', address, signature });
    } catch (e) {
      setBusy(false);
      setError((e as { message?: string }).message ?? 'The wallet said no');
    }
  }

  async function tron() {
    if (!window.tronLink || !challenge) {
      setError('No TronLink here: open this page in the TronLink app (its browser), or a desktop browser with the TronLink extension.');
      return;
    }
    try {
      setBusy(true);
      await window.tronLink.request({ method: 'tron_requestAccounts' });
      const address = window.tronWeb?.defaultAddress?.base58;
      if (!address || !window.tronWeb) {
        throw new Error('Unlock TronLink and try again');
      }
      const signature = await window.tronWeb.trx.signMessageV2(challenge.message);
      await send({ chain: 'tron', address, signature });
    } catch (e) {
      setBusy(false);
      setError((e as { message?: string }).message ?? 'TronLink said no');
    }
  }

  function copyLink() {
    navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true));
  }

  return (
    <section className="card wallet">
      <p className="kicker">Battle Bloom</p>
      <h1>{challenge?.mode === 'link' ? 'Connect your wallet' : 'Sign in with your wallet'}</h1>
      {challenge && (
        <p className="muted">
          {challenge.mode === 'link' ? (
            <>
              To <b>{challenge.username}</b>&apos;s farm. Payments you send from it to the shop&apos;s wallet are credited to this farm by themselves.
            </>
          ) : (
            <>Sign in to your farm with a wallet you linked before, or start a new farm with it.</>
          )}
        </p>
      )}
      {challenge && (
        <div className="code-check">
          The game shows <b>{challenge.short}</b> — make sure it&apos;s the same.
        </div>
      )}

      {done ? (
        <div className="done">
          <h2>Done ✓</h2>
          <p>{done} Go back to the game: it carries on by itself.</p>
        </div>
      ) : needsAccount && signed ? (
        <div>
          <h2>A new farm for this wallet</h2>
          <label htmlFor="name">Farmer name</label>
          <input id="name" value={name} maxLength={20} placeholder="3-20 letters, digits or _" onChange={(e) => setName(e.target.value)} />
          <label>You play as</label>
          <div className="tabs">
            <button aria-selected={character === 'Diana'} onClick={() => setCharacter('Diana')}>
              Diana · woman
            </button>
            <button aria-selected={character === 'Arellah'} onClick={() => setCharacter('Arellah')}>
              Arellah · woman
            </button>
            <button aria-selected={character === 'Arash'} onClick={() => setCharacter('Arash')}>
              Arash · man
            </button>
          </div>
          <p className="muted small">Chosen once: later another character costs 600 gems, the other gender 1500.</p>
          <button className="button wide" disabled={busy || !/^[A-Za-z0-9_]{3,20}$/.test(name)} onClick={() => send(signed, { name, character })}>
            Make my farm
          </button>
        </div>
      ) : (
        challenge?.status === 'pending' && (
          <div className="wallet-buttons">
            <button className="button wide" disabled={busy} onClick={evm}>
              MetaMask · Trust · OKX (BNB Chain / EVM)
            </button>
            <button className="button wide" disabled={busy} onClick={tron}>
              TronLink (Tron: USDT-TRC20, TRX)
            </button>
            <TonButton nonce={challenge.nonce} busy={busy} onProof={(s) => send(s)} onError={setError} />
            {here && (
              <p className="open-in small">
                Open this page in:{' '}
                {openIn(here).map((app, i) => (
                  <span key={app.name}>
                    {i > 0 && ' · '}
                    <a href={app.href}>{app.name}</a>
                  </span>
                ))}
              </p>
            )}
            <p className="muted small">
              On a phone, MetaMask, Trust Wallet and TronLink sign inside their own app&apos;s browser: open this page there (links above). TON wallets open from any browser.{' '}
              <button className="linkish" onClick={copyLink}>
                {copied ? 'Link copied' : 'Copy this link'}
              </button>
            </p>
          </div>
        )
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
