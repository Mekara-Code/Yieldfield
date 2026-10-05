import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteHeader } from '../components/SiteHeader';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Battle Bloom · a cozy farm, online', template: '%s · Battle Bloom' },
  description: 'Grow crops, raise cows, sheep and hens, dress your farmer and climb the valley\'s leaderboards. Your farm lives on the server and follows you everywhere.',
  openGraph: {
    title: 'Battle Bloom · a cozy farm, online',
    description: 'Grow crops, raise cows, sheep and hens, and climb the valley\'s leaderboards.',
    images: ['/brand/shots/hero.jpg'],
  },
};

export const viewport: Viewport = { themeColor: '#0d110b' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <footer className="site-footer">
          <div className="footer-inner">
            <div className="footer-studio">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/wildcats-mark.png" alt="WILDCATS" width={64} height={46} />
              <div>
                <b>A WILDCATS game</b>
                <span>Battle Bloom © {new Date().getFullYear()} WILDCATS</span>
              </div>
            </div>
            <nav>
              <Link href="/">Home</Link>
              <Link href="/leaderboard">Leaderboards</Link>
              <Link href="/dashboard">My farm</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
