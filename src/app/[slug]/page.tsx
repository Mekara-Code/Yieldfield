import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AuthCard } from '../../components/AuthCard';
import { prisma } from '../../lib/db';
import { levelForXp } from '../../lib/game/defs';
import { latestRelease } from '../../lib/releases';
import '../landing.css';

export const dynamic = 'force-dynamic';

/**
 * A player's invitation: <site>/ref=<their name>. The newcomer signs up here with them as the inviter (or
 * later on this browser: the invitation is kept), then downloads the game. Its preview on X is the inviter's
 * share card (/api/card/<name>).
 */

function inviterName(slug: string) {
  const text = decodeURIComponent(slug);
  return /^ref=([A-Za-z0-9_]{1,40})$/i.exec(text)?.[1] ?? null;
}

async function inviter(slug: string) {
  const name = inviterName(slug);
  if (!name) {
    return null;
  }
  return prisma.user.findFirst({
    where: { username: { equals: name, mode: 'insensitive' } },
    select: { username: true, character: true, createdAt: true, farm: { select: { state: true } } },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const who = await inviter((await params).slug);
  if (!who) {
    return {};
  }
  const title = `${who.username} invites you to Battle Bloom`;
  const description = 'Grow crops, raise cows, sheep and hens, and climb the leaderboards. Make your farm and join them.';
  const image = `/api/card/${encodeURIComponent(who.username)}`;
  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function Invitation({ params }: { params: Promise<{ slug: string }> }) {
  const who = await inviter((await params).slug);
  if (!who) {
    notFound();
  }
  const release = await latestRelease('android');
  const download = release && !release.withdrawnAt ? release : null;
  const level = levelForXp(Number((who.farm?.state as { xp?: number } | null)?.xp ?? 0));
  return (
    <div className="landing">
      <section className="l-hero invite-hero">
        <div className="l-hero-art" aria-hidden="true" />
        <div className="l-hero-inner invite-inner">
          <div className="l-hero-copy">
            <div className="l-kicker">You're invited</div>
            <h1 className="invite-title">
              <span>{who.username}</span> invites you to <em>Battle Bloom</em>
            </h1>
            <p className="l-lead">
              {who.username} farms in the valley (level {level}). Make your account here, then sign in to the game with it: your farm grows on the server,
              even while you&apos;re away, and you can climb the leaderboards together.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="invite-card" src={`/api/card/${encodeURIComponent(who.username)}`} alt={`${who.username}'s farm card`} width={1200} height={630} />
            {download && (
              <div className="l-ctas">
                <a className="l-btn primary" href={download.url}>
                  <span>
                    Download for Android
                    <small>Version {download.versionName}</small>
                  </span>
                </a>
              </div>
            )}
          </div>
          <div className="invite-join">
            <AuthCard className="card glass" invitedBy={who.username} />
          </div>
        </div>
      </section>
    </div>
  );
}
