'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The site's bar: over the home page's picture it's see-through, elsewhere as before. */
export function SiteHeader() {
  const path = usePathname();
  const home = path === '/';
  const invitation = /^\/ref(=|%3D)/i.test(path);
  // The dark pages (the leaderboards) get a dark bar; the home page's and an invitation's float over their picture.
  const look = home || invitation ? ' over' : path.startsWith('/leaderboard') ? ' dark' : '';
  const link = (href: string, label: string) => (
    <Link href={href} className={path === href ? 'active' : undefined}>
      {label}
    </Link>
  );
  return (
    <header className={`top${look}`}>
      <Link href="/" className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/icon-192.png" alt="" width={34} height={34} />
        Battle <span>Bloom</span>
      </Link>
      <nav>
        {home && (
          <a href="#features" className="wide-only">
            The game
          </a>
        )}
        {link('/leaderboard', 'Leaderboards')}
        {link('/dashboard', 'My farm')}
      </nav>
    </header>
  );
}
