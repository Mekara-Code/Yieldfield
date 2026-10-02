'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getAccessToken, itemName, refreshAccess, setAccessToken } from '../../lib/client';
import { BloomIcon, MONEY } from '../../components/Bloom';

interface Plot {
  index: number;
  state: number;
  crop: string;
  days: number;
  bWatered: boolean;
}
interface Animal {
  id: string;
  kind: 'Chicken' | 'Sheep' | 'Cow';
  name: string;
  boughtDay: number;
  lastMilkedDay: number;
  lastShornDay: number;
}
interface FarmState {
  day: number;
  hour: number;
  coins: number;
  energy: number;
  seeds: Record<string, number>;
  produce: Record<string, number>;
  plots: Plot[];
  animals: Animal[];
  eggsInCoop: number;
}
interface FarmEvent {
  id: string;
  kind: string;
  day: number;
  data: Record<string, string | number | boolean>;
  at: string;
}
interface Me {
  username: string;
  playing: boolean;
}

// How many days of watering each crop needs (as in the game's AFarmWorld).
const DAYS_TO_GROW: Record<string, number> = { Carrot: 3, Wheat: 3, Sunflower: 4, Tomato: 5, Corn: 6, Pumpkin: 8 };
const ICONS = { Chicken: '🐔', Sheep: '🐑', Cow: '🐄' };
const WOOL_DAYS = 3;

function clock(hour: number) {
  const h = Math.floor(hour % 24);
  const m = Math.floor(((hour % 24) - h) * 6) * 10;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function describe(e: FarmEvent) {
  const d = e.data;
  switch (e.kind) {
    case 'sell':
      return `Sold ${d.pieces} pieces for ${d.coins} ${MONEY}`;
    case 'buy_seeds':
      return `Bought ${d.count} ${d.crop} seeds (${d.cost} ${MONEY})`;
    case 'buy_animal':
      return `Bought ${d.name} the ${String(d.kind).toLowerCase()} (${d.cost} ${MONEY})`;
    case 'harvest':
      return `Harvested ${d.count} ${d.crop}`;
    case 'collect':
      return `Collected ${d.count} ${itemName(String(d.item))}${d.from ? ` from ${d.from}` : ''}`;
    case 'leather':
      return `${d.name} went to the tannery: ${d.count} leather`;
    case 'eat':
      return `Ate a ${itemName(String(d.item))} meal (+${d.energy} energy)`;
    case 'sleep':
      return d.passedOut ? `Passed out; woke on day ${e.day}` : `Slept; a new day (${e.day})`;
    case 'plant':
      return `Planted ${d.crop}`;
    default:
      return e.kind.replace(/_/g, ' ');
  }
}

export default function Dashboard() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<FarmState | null>(null);
  const [revision, setRevision] = useState(0);
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
      const farm = await api<{ revision: number; state: FarmState | null }>('/api/farm');
      if (farm) {
        setState(farm.state);
        setRevision(farm.revision);
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
            api<{ revision: number; state: FarmState | null }>('/api/farm'),
            api<{ events: FarmEvent[] }>('/api/farm/events'),
            api<Me>('/api/me'),
            fetch('/api/health').then((r) => r.json()).catch(() => null),
          ]);
          if (farmNow) {
            setState(farmNow.state);
            setRevision(farmNow.revision);
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
  }, [connect, router]);

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
  const plots = [...(state?.plots ?? [])].sort((a, b) => a.index - b.index);

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
        <div className="card">
          <h2>No farm yet</h2>
          <p className="muted">Sign into the game with this account: your farm appears here as soon as it is first saved.</p>
        </div>
      ) : (
        <div className="grid">
          <div className="card">
            <h2>Day {state.day}</h2>
            <div className="stat">{clock(state.hour)}</div>
            <div className="muted small">saved {revision} times</div>
          </div>
          <div className="card">
            <h2>{MONEY}</h2>
            <div className="stat">
              <BloomIcon size={30} /> {state.coins.toLocaleString()}
            </div>
          </div>
          <div className="card">
            <h2>Energy</h2>
            <div className="stat">{Math.round(state.energy)}</div>
            <div className="bar">
              <div style={{ width: `${Math.min(100, state.energy)}%` }} />
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
            {state.eggsInCoop > 0 && <p className="muted small">{state.eggsInCoop} eggs waiting in the coop</p>}
          </div>
          <div className="card">
            <h2>Seeds</h2>
            {seeds.length ? (
              <div className="items">
                {seeds.map(([id, n]) => (
                  <span className="item" key={id}>
                    {id}
                    <b>{n}</b>
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted small">None: buy some at the seed shop</p>
            )}
          </div>

          <div className="card">
            <h2>Animals ({state.animals.length})</h2>
            {state.animals.length ? (
              <div className="animals">
                {state.animals.map((a) => {
                  const notes: string[] = [];
                  if (a.kind !== 'Chicken') {
                    notes.push(a.lastMilkedDay >= state.day ? 'milked today' : 'ready to milk');
                  }
                  if (a.kind === 'Sheep') {
                    const grown = state.day - a.lastShornDay >= WOOL_DAYS || a.lastShornDay === 0;
                    notes.push(grown ? 'wool ready' : 'wool growing');
                  }
                  if (a.kind === 'Chicken') {
                    notes.push('lays an egg a day');
                  }
                  return (
                    <div className="animal" key={a.id}>
                      <span className="icon">{ICONS[a.kind]}</span>
                      <div>
                        <b>{a.name}</b>
                        <div className="muted small">
                          {a.kind} since day {a.boughtDay} · {notes.join(' · ')}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="muted small">None yet: the animal market by the paddock sells chickens, sheep and cows.</p>
            )}
          </div>

          <div className="card" style={{ gridColumn: 'span 2' }}>
            <h2>Field</h2>
            <div className="plots">
              {plots.map((p) => {
                const need = DAYS_TO_GROW[p.crop] ?? 3;
                const ripe = p.state === 2 && p.days >= need;
                const cls = p.state === 2 ? `planted${ripe ? ' ripe' : ''}` : p.state === 1 ? 'tilled' : '';
                return (
                  <div className={`plot ${cls}`} key={p.index}>
                    {p.state === 2 ? (
                      <>
                        <b>{p.crop}</b>
                        <span>{ripe ? 'ripe!' : `${p.days}/${need} days`}</span>
                        {p.bWatered && <span>💧</span>}
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

          <div className="card">
            <h2>What happened</h2>
            {events.length ? (
              <ul className="feed">
                {events.map((e) => (
                  <li key={e.id} className={e.id === freshId ? 'fresh' : ''}>
                    <time>day {e.day}</time>
                    <span>{describe(e)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing yet</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
