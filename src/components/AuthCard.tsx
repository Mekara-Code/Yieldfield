'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { setAccessToken } from '../lib/client';

type Mode = 'login' | 'register';

const REF_KEY = 'bb_ref';

/**
 * Sign in or make an account (the home page, an invitation's page). className styles the card ("card glass"
 * over the dark pages). invitedBy: the farmer whose link this is: the form opens on a new account, and the
 * invitation is kept (for a sign-up later on this browser too) and sent with the new account.
 */
export function AuthCard({ className = 'card', invitedBy }: { className?: string; invitedBy?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(invitedBy ? 'register' : 'login');
  const [ref, setRef] = useState(invitedBy ?? '');

  useEffect(() => {
    try {
      if (invitedBy) {
        localStorage.setItem(REF_KEY, invitedBy);
      } else {
        setRef(localStorage.getItem(REF_KEY) ?? '');
      }
    } catch {
      // storage blocked: the invitation still goes with a sign-up from this page
    }
  }, [invitedBy]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (mode === 'register' && form.get('password') !== form.get('confirm')) {
      setError('The passwords are not the same');
      return;
    }
    setBusy(true);
    setError('');
    const body =
      mode === 'login'
        ? { login: form.get('login'), password: form.get('password'), client: 'web' }
        : { username: form.get('username'), email: form.get('email'), password: form.get('password'), client: 'web', ...(ref ? { ref } : {}) };
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'Something went wrong');
        return;
      }
      setAccessToken(data.accessToken);
      router.push('/dashboard');
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => setMode('register')}>
          Create account
        </button>
      </div>
      {mode === 'register' && ref && (
        <p className="invited">
          Invited by <b>{ref}</b>
        </p>
      )}
      <form method="post" onSubmit={submit}>
        {mode === 'login' ? (
          <>
            <label htmlFor="login">Name or email</label>
            <input id="login" name="login" autoComplete="username" required />
          </>
        ) : (
          <>
            <label htmlFor="username">Farmer name</label>
            <input id="username" name="username" autoComplete="username" pattern="[A-Za-z0-9_]{3,20}" title="3-20 letters, digits or _" required />
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </>
        )}
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={mode === 'register' ? 8 : 1}
          required
        />
        {mode === 'register' && (
          <>
            <label htmlFor="confirm">Password again</label>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
          </>
        )}
        <button className="button wide" disabled={busy}>
          {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create my farm'}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
