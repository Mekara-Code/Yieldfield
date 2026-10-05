import Link from 'next/link';
import { AuthCard } from '../components/AuthCard';
import { BoardCard } from '../components/Boards';
import { allBoards, valleyStats } from '../lib/leaderboard';
import { latestRelease } from '../lib/releases';
import './landing.css';

export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    shot: 'fields',
    title: 'Fields that grow while you sleep',
    text: 'Till, plant and water wheat, corn, carrots, tomatoes, sunflowers and pumpkins. They grow in real time, even when the game is closed.',
  },
  {
    shot: 'animals',
    title: 'Cows, sheep and hens',
    text: 'Feed them, milk them, shear them and collect the eggs. Every animal levels up and gives more as it grows.',
  },
  {
    shot: 'style',
    title: 'Dress up your farmer',
    text: 'Dozens of outfits, ten hairstyles and twenty eye styles at the wardrobe and the salon. Every look is yours to keep.',
  },
  {
    shot: 'wolf',
    title: 'Wolf nights',
    text: 'When the wolf comes down from the hills, shut the barn and fight it off together. Not everyone makes it to morning.',
  },
  {
    shot: 'market',
    title: 'Traders and a living market',
    text: 'Sell to Gus, Hattie, Molly and Bruno, finish daily tasks, and trade with other players at the market stall.',
  },
  {
    shot: 'partner',
    title: 'A partner and VIP',
    text: 'Find a partner who works the farm beside you and doubles every harvest. Go VIP for a golden name and more.',
  },
];

const CHARACTERS = [
  { id: 'diana', name: 'Diana', line: 'Knows every inch of the valley.' },
  { id: 'arellah', name: 'Arellah', line: 'The best-dressed farmer in town.' },
  { id: 'arash', name: 'Arash', line: 'Up before the hens, every day.' },
];

function megabytes(bytes: number | null | undefined) {
  return bytes ? `${Math.round(bytes / 1048576)} MB` : '';
}

function AndroidMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.86 3.22a11.4 11.4 0 0 0-9.84 0L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"
      />
    </svg>
  );
}

export default async function Home() {
  const [boards, stats, release] = await Promise.all([allBoards(5), valleyStats(), latestRelease('android')]);
  const download = release && !release.withdrawnAt ? release : null;

  return (
    <div className="landing">
      <section className="l-hero">
        <div className="l-hero-art" aria-hidden="true" />
        <div className="l-hero-inner">
          <div className="l-hero-copy">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="l-app-icon" src="/brand/icon-512.png" alt="Battle Bloom" width={96} height={96} />
            <div className="l-kicker">A cozy farm · online</div>
            <h1 className="l-title">Battle Bloom</h1>
            <p className="l-lead">
              Grow crops, raise cows, sheep and hens, dress your farmer and climb the valley&apos;s leaderboards. Your farm lives on the server: it keeps
              growing while you&apos;re away, and it&apos;s there on every device you sign in on.
            </p>
            <div className="l-ctas">
              {download ? (
                <a className="l-btn primary" href={download.url}>
                  <AndroidMark />
                  <span>
                    Download for Android
                    <small>
                      Version {download.versionName}
                      {download.size ? ` · ${megabytes(download.size)}` : ''}
                    </small>
                  </span>
                </a>
              ) : (
                <span className="l-btn primary disabled">
                  <AndroidMark />
                  <span>
                    Android
                    <small>Coming very soon</small>
                  </span>
                </span>
              )}
              <a className="l-btn ghost" href="#join">
                Create your farm
              </a>
            </div>
            <ul className="l-stats">
              <li>
                <b>{stats.playing.toLocaleString('en-US')}</b>
                <span>
                  <i className="live-dot" /> farming now
                </span>
              </li>
              <li>
                <b>{stats.farmers.toLocaleString('en-US')}</b>
                <span>farms in the valley</span>
              </li>
              <li>
                <b>{stats.animals.toLocaleString('en-US')}</b>
                <span>animals raised</span>
              </li>
            </ul>
          </div>
        </div>
        <a className="l-scroll" href="#features" aria-label="See more">
          <span />
        </a>
      </section>

      <section id="features" className="l-section">
        <div className="l-head">
          <div className="l-kicker">Life in the valley</div>
          <h2>Everything a farm needs, and a few things it doesn&apos;t</h2>
          <p>Plant in the morning, sell at noon, fight the wolf at night. Every day on the farm is a little different.</p>
        </div>
        <div className="l-features">
          {FEATURES.map((f) => (
            <article key={f.shot} className="l-feature">
              <div className="l-shot" style={{ backgroundImage: `url(/brand/shots/${f.shot}.jpg)` }} />
              <div className="l-feature-body">
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="l-section l-boards">
        <div className="l-head">
          <div className="l-kicker">Hall of fame</div>
          <h2>The valley&apos;s best</h2>
          <p>Six leaderboards, updated as people play. Who keeps the biggest herd? Who has the most BLOOM? Your name could be next.</p>
        </div>
        <div className="board-grid">
          {boards.map((b) => (
            <BoardCard key={b.id} info={b} entries={b.entries} />
          ))}
        </div>
        <div className="l-center">
          <Link className="l-btn ghost" href="/leaderboard">
            All the leaderboards
          </Link>
        </div>
      </section>

      <section className="l-section l-characters">
        <div className="l-head">
          <div className="l-kicker">Who will you be?</div>
          <h2>Play as Diana, Arellah or Arash</h2>
        </div>
        <div className="l-cast">
          {CHARACTERS.map((c) => (
            <figure key={c.id} className="l-person">
              <div className="l-portrait" style={{ backgroundImage: `url(/brand/characters/${c.id}-tall.jpg)` }} />
              <figcaption>
                <b>{c.name}</b>
                <span>{c.line}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section id="join" className="l-section l-join">
        <div className="l-join-copy">
          <div className="l-kicker">Your farm is waiting</div>
          <h2>Make your account, then sign in to the game with it</h2>
          <p>One account for the game and this site: watch your farm from here as it grows, see what happened today and how you rank.</p>
          {download && (
            <a className="l-btn primary" href={download.url}>
              <AndroidMark />
              <span>
                Get the game
                <small>
                  Android · {download.versionName}
                  {download.size ? ` · ${megabytes(download.size)}` : ''}
                </small>
              </span>
            </a>
          )}
        </div>
        <div className="l-join-card">
          <AuthCard className="card glass" />
        </div>
      </section>
    </div>
  );
}
