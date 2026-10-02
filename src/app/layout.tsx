import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Yieldfield',
  description: 'Your farm from the game: BLOOM, crops, animals and what happened today.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">
            Yield<span>field</span>
          </Link>
          <nav>
            <Link href="/dashboard">My farm</Link>
            <Link href="/leaderboard">Leaderboard</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
