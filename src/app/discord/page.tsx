'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/** Where linking Discord ends: done (go back to the game) or why not. */
export default function DiscordDone() {
  const [result, setResult] = useState<{ linked?: string; error?: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setResult({ linked: params.get('linked') ?? undefined, error: params.get('error') ?? undefined });
  }, []);

  if (!result) {
    return <p className="muted">One moment…</p>;
  }
  return (
    <div className="card" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
      <h2>Discord</h2>
      {result.linked ? (
        <>
          <div className="stat" style={{ fontSize: 24 }}>Linked: {result.linked}</div>
          <p className="muted">+50 reputation while it stays linked. You can go back to the game now: it sees it in a moment.</p>
        </>
      ) : (
        <>
          <div className="stat" style={{ fontSize: 22, color: 'var(--red)' }}>Not linked</div>
          <p className="muted">{result.error ?? 'Something went wrong'}</p>
        </>
      )}
      <p>
        <Link className="button quiet" href="/dashboard">
          Your farm
        </Link>
      </p>
    </div>
  );
}
