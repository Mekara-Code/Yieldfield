'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getAccessToken, itemName, refreshAccess, setAccessToken } from '../../lib/client';
import { BloomIcon, CoinIcon, GemIcon, MONEY } from '../../components/Bloom';
import { HistoryCard, MarketCard, SkillsCard, StandingCard, type MeAccount } from './Account';

/** The farm as the server keeps it (src/lib/game/state.ts): times are Unix seconds, the server's clock. */
interface Plot {
  index: number;
  state: number;
  crop: string;
  grown: number;
  grownAt: number;
  wetUntil: number;
}
interface Animal {
  id: string;
  kind: 'Chicken' | 'Sheep' | 'Cow';
  name: string;
  xp: number;
  cycleStart: number;
  readyAt: number;
  woolStart: number;
  woolReadyAt: number;
  fedUntil: number;
}
interface FarmState {
  day: number;
  hour: number;
  coins: number;
  xp: number;
  energy: number;
  seeds: Record<string, number>;
  produce: Record<string, number>;
  plots: Plot[];
  ownedPlots: number[];
  animals: Animal[];
  buildings: string[];
  companion: string;
  construction?: Record<string, number>;
  skills?: Record<string, number>;
  skillResetAt?: number;
  skillPointsFree?: number;
  combatPower?: number;
}
interface Wallet {
  coins: number;
  bloom: number;
  gems: number;
}
interface Defs {
  crops: { id: string; name: string; grow: number; water: number }[];
  animals: { kind: Animal['kind']; name: string; product: string; feed: string; feedCount: number }[];
  buildings: { id: string; name: string }[];
  maxEnergy: number;
  skills?: { id: string; name: string; about: string }[];
  skillTracks?: { id: string; skill: string; part: 'power' | 'time' | 'yield'; max: number; step: number }[];
  skillResetSeconds?: number;
}
interface FarmEvent {
  id: string;
  kind: string;
  day: number;
  data: Record<string, string | number | boolean>;
  at: string;
}
interface Me extends MeAccount {
  username: string;
  playing: boolean;
}
interface FarmLoad {
  revision: number;
  state: FarmState | null;
  wallet: Wallet;
  now: number;
  defs?: Defs;
}

const ICONS = { Chicken: '🐔', Sheep: '🐑', Cow: '🐄' };
const PRODUCT_WORD: Record<string, string> = { Egg: 'egg', Milk: 'milk', SheepMilk: 'milk' };

// The same sums as the server's (src/lib/game/defs.ts and state.ts).
const levelOf = (xp: number, per: number, cap = 50) => {
  let level = 1;
  while (level < cap && xp >= per * level * (level + 1)) {
    level++;
  }
  return level;
};
const playerLevel = (xp: number) => levelOf(xp, 30);
const animalLevel = (xp: number) => levelOf(xp, 4);

function growth(p: Plot, grow: number, t: number) {
  return p.state === 2 ? Math.min(grow, p.grown + Math.max(0, Math.min(t, p.wetUntil) - p.grownAt)) : 0;
}

function remaining(start: number, ready: number, fedUntil: number, t: number) {
  if (ready <= t && ready <= fedUntil) {
    return 0;
  }
  if (t >= fedUntil && ready > fedUntil) {
    return ready - Math.max(fedUntil, start);
  }
  return Math.max(0, ready - t);
}

/** "5h 12m", "12m 30s", "30s" (as the game writes it). */
function duration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/** "just now", "5m ago", "3h ago", "2d ago". */
function ago(at: string) {
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
}

function clock(hour: number) {
  const h = Math.floor(hour % 24);
  const m = Math.floor(((hour % 24) - h) * 6) * 10;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function describe(e: FarmEvent) {
  const d = e.data;
  switch (e.kind) {
    case 'start':
      return 'Started the farm';
    case 'sell':
      return `Sold ${d.pieces} pieces at the bin for ${d.coins} coins`;
    case 'trade':
      return `Sold ${d.pieces} pieces to ${d.trader} for ${d.coins} coins`;
    case 'buy_seeds':
      return `Bought ${d.count} ${d.crop} seeds (${d.cost} coins)`;
    case 'buy_animal':
      return `Bought ${d.name} the ${String(d.kind).toLowerCase()} (${d.cost} coins)`;
    case 'buy_bed':
      return `Bought bed ${d.bed} (${d.cost} coins)`;
    case 'harvest':
      return `Harvested ${d.count} ${d.crop}`;
    case 'collect':
      return `Collected ${d.count} ${itemName(String(d.item))}${d.from ? ` from ${d.from}` : ''}`;
    case 'feed':
      return `Fed ${d.name} ${d.count} ${itemName(String(d.item))}`;
    case 'leather':
      return `${d.name} went to the tannery: ${d.count} leather`;
    case 'eat':
      return `Ate a ${itemName(String(d.item))} meal (+${d.energy} energy)`;
    case 'sleep':
      return d.passedOut ? `Passed out; woke on day ${e.day}` : `Slept; a new day (${e.day})`;
    case 'plant':
      return `Planted ${d.crop}`;
    case 'level':
      return `Reached level ${d.level}!`;
    case 'task':
      return d.task === 'all' ? `All of the day's tasks done (+${d.gems} gems)` : `Task done: ${d.task} (+${d.coins} coins)`;
    case 'marry':
      return `Married ${d.name} (${d.bloom} ${MONEY})`;
    case 'vip':
      return `VIP for ${d.days} days (${d.bloom} ${MONEY})`;
    case 'gems':
      return `Bought ${d.gems} gems (${d.bloom} ${MONEY})`;
    case 'purchase':
      return `Bought ${Number(d.gems) > 0 ? `${d.gems} gems` : `${d.bloom} ${MONEY}`} ($${d.usd} in ${String(d.coin).toUpperCase()})${d.wallet ? ', from a linked wallet' : ''}`;
    case 'build':
      return `Started building the ${String(d.building) === 'Coop' ? 'hen house' : String(d.building) === 'Market' ? 'market stall' : 'barn'} (${d.cost} coins)`;
    case 'built':
      return `The ${String(d.building) === 'Coop' ? 'hen house' : String(d.building) === 'Market' ? 'market stall' : 'barn'} is built`;
    case 'skill':
      return `Skill: ${String(d.track).replace('.', ' ')} level ${d.level}`;
    case 'skill_reset':
      return `Reset the skills (${d.points} points back)`;
    case 'discord':
      return `Linked Discord: ${d.name} (+${d.reputation} reputation)`;
    case 'market_list':
      return `Put ${d.count} ${itemName(String(d.item))} on the market for ${d.price} ${MONEY}`;
    case 'market_cancel':
      return `Took ${d.count} ${itemName(String(d.item))} off the market`;
    case 'market_expired':
      return `${d.count} ${itemName(String(d.item))} came back from the market unsold`;
    case 'market_buy':
      return `Bought ${d.count} ${itemName(String(d.item))} from ${d.from} for ${d.price} ${MONEY}`;
    case 'market_sold':
      return `Sold ${d.count} ${itemName(String(d.item))} to ${d.to} for ${d.price} ${MONEY}`;
    case 'character':
      return `Changed character to ${d.to} (${d.cost} ${MONEY})`;
    case 'admin_adjust':
      return `The admins changed your standing${d.vipDays ? ` (VIP ${Number(d.vipDays) > 0 ? '+' : ''}${d.vipDays} days)` : ''}${d.reputation ? ` (reputation ${Number(d.reputation) > 0 ? '+' : ''}${d.reputation})` : ''}`;
    case 'gift':
      return `A gift from ${d.by}: ${d.gems ? `${d.gems} gems` : `${d.bloom ?? d.amount} ${MONEY}`}`;
    default:
      return e.kind.replace(/_/g, ' ');
  }
}

export default function Dashboard() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<FarmState | null>(null);
  const [revision, setRevision] = useState(0);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [defs, setDefs] = useState<Defs | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const offset = useRef(0); // the server's clock less this one's, seconds
  const [events, setEvents] = useState<FarmEvent[]>([]);
  const [online, setOnline] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [live, setLive] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopped = useRef(false);

  const connect = useCallback(async () => {
    const token = getAccessToken() ?? (await refreshAccess());
    if (!token || stopped.current) {
      return;
    }
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    socket.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token, client: 'web' }));
    ws.onmessage = (message) => {
      const m = JSON.parse(message.data);
      switch (m.type) {
        case 'auth:ok':
          setLive(true);
          setOnline(m.online);
          break;
        case 'auth:error':
          setAccessToken(null); // expired: the reconnect refreshes it
          break;
        case 'presence':
          setOnline(m.online);
          break;
        case 'status':
          setPlaying(m.playing);
          break;
        case 'farm:update':
          setState(m.state);
          setRevision(m.revision);
          if (m.wallet) {
            setWallet(m.wallet);
          }
          if (typeof m.now === 'number') {
            offset.current = m.now - Date.now() / 1000;
          }
          break;
        case 'farm:event':
          setEvents((list) => [m.event, ...list].slice(0, 60));
          setFreshId(m.event.id);
          break;
      }
    };
    ws.onclose = () => {
      setLive(false);
      if (!stopped.current) {
        setTimeout(connect, 2500);
      }
    };
  }, []);

  const take = useCallback((farm: FarmLoad) => {
    setState(farm.state);
    setRevision(farm.revision);
    setWallet(farm.wallet);
    if (farm.defs) {
      setDefs(farm.defs);
    }
    offset.current = farm.now - Date.now() / 1000;
  }, []);

  // The timers count down by the second (the server's time).
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000 + offset.current), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    stopped.current = false;
    (async () => {
      const who = await api<Me>('/api/me');
      if (!who) {
        router.replace('/');
        return;
      }
      setMe(who);
      setPlaying(who.playing);
      const farm = await api<FarmLoad>('/api/farm');
      if (farm) {
        take(farm);
      }
      const feed = await api<{ events: FarmEvent[] }>('/api/farm/events');
      setEvents(feed?.events ?? []);
      const health = await fetch('/api/health').then((r) => r.json()).catch(() => null);
      if (health?.realtime === false) {
        // No WebSocket here (Vercel): check back every few seconds instead.
        setOnline(health.online ?? 0);
        setLive(true);
        poll.current = setInterval(async () => {
          const [farmNow, feedNow, whoNow, healthNow] = await Promise.all([
            api<FarmLoad>('/api/farm'),
            api<{ events: FarmEvent[] }>('/api/farm/events'),
            api<Me>('/api/me'),
            fetch('/api/health').then((r) => r.json()).catch(() => null),
          ]);
          if (farmNow) {
            take(farmNow);
          }
          if (feedNow) {
            setEvents((list) => {
              const newest = feedNow.events[0];
              if (newest && newest.id !== list[0]?.id) {
                setFreshId(newest.id);
              }
              return feedNow.events;
            });
          }
          if (whoNow) {
            setPlaying(whoNow.playing);
          }
          setLive(!!healthNow);
          setOnline(healthNow?.online ?? 0);
        }, 6000);
        return;
      }
      connect();
    })();
    return () => {
      stopped.current = true;
      socket.current?.close();
      if (poll.current) {
        clearInterval(poll.current);
      }
    };
  }, [connect, router, take]);

  const reloadMe = useCallback(async () => {
    const who = await api<Me>('/api/me');
    if (who) {
      setMe(who);
    }
  }, []);

  async function signOut() {
    stopped.current = true;
    socket.current?.close();
    if (poll.current) {
      clearInterval(poll.current);
    }
    await fetch('/api/auth/logout', { method: 'POST' });
    setAccessToken(null);
    router.replace('/');
  }

  if (!me) {
    return <p className="muted">Loading your farm…</p>;
  }

  const produce = Object.entries(state?.produce ?? {}).filter(([, n]) => n > 0);
  const seeds = Object.entries(state?.seeds ?? {}).filter(([, n]) => n > 0);
  const owned = new Set(state?.ownedPlots ?? []);
  const plots = [...(state?.plots ?? [])].filter((p) => owned.has(p.index)).sort((a, b) => a.index - b.index);
  const t = Math.floor(now);
  const level = state ? playerLevel(state.xp) : 1;
  const levelFrom = 30 * (level - 1) * level;
  const levelTo = 30 * level * (level + 1);
  const hungry = state?.animals.filter((a) => t >= a.fedUntil).length ?? 0;

  return (
    <>
      <div className="row-head">
        <h1>{me.username}&apos;s farm</h1>
        <span className={`pill ${playing ? 'live' : ''}`}>{playing ? 'Playing now' : 'Not in the game'}</span>
        <span className="pill">{live ? `${online} farming now` : 'reconnecting…'}</span>
        <button className="button quiet" onClick={signOut}>
          Sign out
        </button>
      </div>

      {!state ? (
        <div className="grid">
          <div className="card">
            <h2>No farm yet</h2>
            <p className="muted">Sign into the game with this account: your farm appears here as soon as it starts.</p>
          </div>
          <StandingCard me={me} onChange={reloadMe} />
        </div>
      ) : (
        <div className="grid">
          <div className="card">
            <h2>Day {state.day}</h2>
            <div className="stat">{clock(state.hour)}</div>
            <div className="muted small">
              Level {level} · {state.xp - levelFrom} / {levelTo - levelFrom} XP
            </div>
            <div className="bar">
              <div style={{ width: `${Math.min(100, ((state.xp - levelFrom) / Math.max(1, levelTo - levelFrom)) * 100)}%` }} />
            </div>
          </div>
          <div className="card">
            <h2>Wallet</h2>
            <div className="stat">
              <CoinIcon size={28} /> {(wallet?.coins ?? state.coins).toLocaleString()}
            </div>
            <div className="wallet-row">
              <span title="Gems: speed timers up">
                <GemIcon size={16} /> {(wallet?.gems ?? 0).toLocaleString()} gems
              </span>
              <span title="BLOOM: trading, the spouse, VIP">
                <BloomIcon size={16} /> {(wallet?.bloom ?? 0).toLocaleString()} {MONEY}
              </span>
            </div>
          </div>
          <div className="card">
            <h2>Energy</h2>
            <div className="stat">{Math.round(state.energy)}</div>
            <div className="bar">
              <div style={{ width: `${Math.min(100, (state.energy / (defs?.maxEnergy ?? 100)) * 100)}%` }} />
            </div>
          </div>

          <div className="card">
            <h2>Basket</h2>
            {produce.length ? (
              <div className="items">
                {produce.map(([id, n]) => (
                  <span className="item" key={id}>
                    {itemName(id)}
                    <b>{n}</b>
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted small">Empty</p>
            )}
          </div>
          <div className="card">
            <h2>Seeds</h2>
            {seeds.length ? (
              <div className="items">
                {seeds.map(([id, n]) => (
                  <span className="item" key={id}>
                    {itemName(id)}
                    <b>{n}</b>
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted small">None: buy some at the seed shop</p>
            )}
            {state.buildings.length > 0 && (
              <p className="muted small">
                Built: {state.buildings.map((b) => defs?.buildings.find((d) => d.id === b)?.name ?? b).join(', ')}
              </p>
            )}
            {Object.entries(state.construction ?? {}).map(([b, readyAt]) => (
              <p className="muted small" key={b}>
                Going up: {defs?.buildings.find((d) => d.id === b)?.name ?? b} · {readyAt > t ? `done in ${duration(readyAt - t)}` : 'done'}
              </p>
            ))}
          </div>

          <div className="card">
            <h2>
              Animals ({state.animals.length}){hungry > 0 && <span className="tag hungry">{hungry} hungry</span>}
            </h2>
            {state.animals.length ? (
              <div className="animals">
                {state.animals.map((a) => {
                  const def = defs?.animals.find((d) => d.kind === a.kind);
                  const word = PRODUCT_WORD[def?.product ?? ''] ?? 'product';
                  const isHungry = t >= a.fedUntil;
                  const left = remaining(a.cycleStart, a.readyAt, a.fedUntil, t);
                  const notes = [left === 0 ? `${word} ready!` : `${word} ${isHungry ? 'paused' : 'in ' + duration(left)}`];
                  if (a.woolReadyAt > 0) {
                    const wool = remaining(a.woolStart, a.woolReadyAt, a.fedUntil, t);
                    notes.push(wool === 0 ? 'wool ready!' : `wool ${isHungry ? 'paused' : 'in ' + duration(wool)}`);
                  }
                  if (!isHungry) {
                    notes.push(`fed ${duration(a.fedUntil - t)}`);
                  }
                  return (
                    <div className={`animal ${isHungry ? 'is-hungry' : ''}`} key={a.id}>
                      <span className="icon">{ICONS[a.kind]}</span>
                      <div>
                        <b>{a.name}</b> <span className="muted small">Lv {animalLevel(a.xp)}</span>
                        {isHungry && (
                          <span className="tag hungry">
                            hungry: wants {def?.feedCount ?? 1} {itemName(def?.feed ?? '')}
                          </span>
                        )}
                        <div className="muted small">{notes.join(' · ')}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="muted small">None yet: build a hen house or a barn, then visit the animal market by the paddock.</p>
            )}
          </div>

          <div className="card" style={{ gridColumn: 'span 2' }}>
            <h2>Field ({plots.length} beds)</h2>
            <div className="plots">
              {plots.map((p) => {
                const crop = defs?.crops.find((c) => c.id === p.crop);
                const grow = crop?.grow ?? 1;
                const g = growth(p, grow, t);
                const ripe = p.state === 2 && g >= grow;
                const dry = p.state === 2 && !ripe && t >= p.wetUntil;
                const cls = p.state === 2 ? `planted${ripe ? ' ripe' : dry ? ' dry' : ''}` : p.state === 1 ? 'tilled' : '';
                return (
                  <div className={`plot ${cls}`} key={p.index}>
                    {p.state === 2 ? (
                      <>
                        <b>{crop?.name ?? p.crop}</b>
                        <span>{ripe ? 'ripe!' : dry ? '💧 needs water' : `ripe in ${duration(grow - g)}`}</span>
                        {!ripe && (
                          <span className="grow">
                            <span style={{ width: `${(g / grow) * 100}%` }} />
                          </span>
                        )}
                      </>
                    ) : p.state === 1 ? (
                      'tilled'
                    ) : (
                      'wild'
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <StandingCard me={me} onChange={reloadMe} />
          {defs?.skills && defs.skillTracks && (
            <SkillsCard
              skills={state.skills ?? {}}
              free={state.skillPointsFree ?? 0}
              power={state.combatPower ?? 0}
              resetAt={state.skillResetAt ?? 0}
              defs={{ skills: defs.skills, skillTracks: defs.skillTracks, skillResetSeconds: defs.skillResetSeconds ?? 90 * 86400 }}
              now={t}
            />
          )}
          <MarketCard />

          <div className="card">
            <h2>What happened</h2>
            {events.length ? (
              <ul className="feed">
                {events.map((e) => (
                  <li key={e.id} className={e.id === freshId ? 'fresh' : ''}>
                    <time title={new Date(e.at).toLocaleString()}>{ago(e.at)}</time>
                    <span>{describe(e)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing yet</p>
            )}
          </div>
          <HistoryCard />
        </div>
      )}
    </>
  );
}
