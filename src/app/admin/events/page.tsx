'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiResult } from '../../../lib/client';

interface WolfSettings {
  power: number;
  health: number;
  reviveGems: number;
  rewardXp: number;
  rewardCoins: number;
}
interface WolfEvent {
  id: string;
  startsAt: string;
  endsAt: string;
  power: number;
  health: number;
  note: string | null;
  createdBy: string;
  status: 'upcoming' | 'live' | 'over' | 'cancelled';
  wolvesKilled: number;
  farmersKilled: number;
  farmersKilledPlayers: number;
}
interface EventsData {
  settings: WolfSettings;
  defaults: WolfSettings;
  events: WolfEvent[];
  now: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function hoursBetween(a: string, b: string) {
  const h = (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
  return h >= 1 ? `${Math.round(h * 10) / 10} h` : `${Math.round(h * 60)} min`;
}

async function call(path: string, method: string, body?: unknown) {
  return apiResult<EventsData>(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** /admin/events: when the wolf is let loose on the farms, how strong it is, and how each event went. */
export default function EventsPage() {
  const [data, setData] = useState<EventsData | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<WolfSettings | null>(null);
  const [day, setDay] = useState(localDate(new Date()));
  const [time, setTime] = useState('00:00');
  const [hours, setHours] = useState(24);
  const [power, setPower] = useState(500);
  const [health, setHealth] = useState(5000);
  const [note, setNote] = useState('');
  const [edits, setEdits] = useState<Record<string, { power: number; health: number }>>({});

  const take = useCallback((d: EventsData) => {
    setData(d);
    setSettings(d.settings);
    setEdits(Object.fromEntries(d.events.map((e) => [e.id, { power: e.power, health: e.health }])));
  }, []);

  useEffect(() => {
    (async () => {
      const { data: d, error } = await apiResult<EventsData>('/api/admin/events');
      if (!d) {
        setDenied(error);
        return;
      }
      take(d);
      setPower(d.settings.power);
      setHealth(d.settings.health);
    })();
  }, [take]);

  async function release(now: boolean) {
    const startsAt = now ? new Date() : new Date(`${day}T${time}`);
    if (Number.isNaN(startsAt.getTime())) {
      setMessage('Pick a day and a time');
      return;
    }
    const what = now ? `now, for ${hours} hours` : `on ${startsAt.toLocaleString()} for ${hours} hours`;
    if (!window.confirm(`Let the wolf loose on every farm ${what}? Power ${power}, health ${health}.`)) {
      return;
    }
    const { data: d, error } = await call('/api/admin/events', 'POST', { startsAt: startsAt.toISOString(), hours, power, health, note: note || undefined });
    if (d) {
      take(d);
      setNote('');
      setMessage(now ? 'The wolf is loose: it goes for each farmer as soon as they are in the game' : `The wolf comes ${what}`);
    } else {
      setMessage(error);
    }
  }

  async function saveSettings() {
    if (!settings) {
      return;
    }
    const { data: d, error } = await call('/api/admin/events', 'PUT', settings);
    if (d) {
      take(d);
      setMessage('Wolf settings saved (new events take this power and health)');
    } else {
      setMessage(error);
    }
  }

  async function change(e: WolfEvent, body: Record<string, unknown>, done: string) {
    const { data: d, error } = await call(`/api/admin/events/${e.id}`, 'PATCH', body);
    if (d) {
      take(d);
      setMessage(done);
    } else {
      setMessage(error);
    }
  }

  if (denied) {
    return (
      <section className="card" style={{ maxWidth: 520, margin: '40px auto' }}>
        <h2>Events</h2>
        <p className="muted">{denied.startsWith('Signed out') ? 'Sign in with an admin account first.' : denied}</p>
        <Link className="button" href="/">
          Sign in
        </Link>
      </section>
    );
  }
  if (!data || !settings) {
    return <p className="muted" style={{ textAlign: 'center', marginTop: 60 }}>Loading…</p>;
  }
  const live = data.events.find((e) => e.status === 'live');
  const number = (value: number, set: (n: number) => void, min = 1) => (
    <input type="number" min={min} value={value} onChange={(ev) => set(Math.max(min, Math.round(Number(ev.target.value) || 0)))} />
  );

  return (
    <div className="admin">
      <div className="row-head">
        <h1>Events</h1>
        {live ? <span className="pill live">Wolf loose until {when(live.endsAt)}</span> : <span className="pill">No wolf on the farms</span>}
        <Link className="button quiet" href="/admin">
          Shop admin
        </Link>
      </div>
      {message && (
        <p className="notice" onClick={() => setMessage(null)}>
          {message}
        </p>
      )}

      <section className="card">
        <h2>Let the wolf loose</h2>
        <p className="muted small">
          While an event is on, a black wolf comes onto every farm and goes for the farmer as soon as they are in the game. Its bites take its power off their health; their strikes take their
          combat power off its health (kept for each farm through the event). A farmer it kills is down for 24 hours, or comes back at once for {settings.reviveGems} gems. Killing it gives{' '}
          {settings.rewardXp} XP and {settings.rewardCoins} coins.
        </p>
        <div className="event-form">
          <div>
            <label htmlFor="ev-day">Day</label>
            <input id="ev-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ev-time">From (your time)</label>
            <input id="ev-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ev-hours">Hours</label>
            <input id="ev-hours" type="number" min={0.25} step={0.25} value={hours} onChange={(e) => setHours(Math.max(0.25, Number(e.target.value) || 24))} />
          </div>
          <div>
            <label>Wolf power</label>
            {number(power, setPower)}
          </div>
          <div>
            <label>Wolf health</label>
            {number(health, setHealth)}
          </div>
          <div className="wide-field">
            <label htmlFor="ev-note">Note (only admins see it)</label>
            <input id="ev-note" value={note} maxLength={120} placeholder="optional" onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
          <button className="button" onClick={() => release(false)}>
            Release the wolf that day
          </button>
          <button className="button quiet" onClick={() => release(true)}>
            Release it now
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Wolf settings</h2>
        <p className="muted small">
          A new event&apos;s wolf takes this power and health (default {data.defaults.power} and {data.defaults.health}); an event&apos;s own can be changed below, on every farm at once.
        </p>
        <div className="event-form">
          <div>
            <label>Power (health a bite takes)</label>
            {number(settings.power, (n) => setSettings({ ...settings, power: n }))}
          </div>
          <div>
            <label>Health</label>
            {number(settings.health, (n) => setSettings({ ...settings, health: n }))}
          </div>
          <div>
            <label>Gems to come back at once</label>
            {number(settings.reviveGems, (n) => setSettings({ ...settings, reviveGems: n }), 0)}
          </div>
          <div>
            <label>Reward: XP</label>
            {number(settings.rewardXp, (n) => setSettings({ ...settings, rewardXp: n }), 0)}
          </div>
          <div>
            <label>Reward: coins</label>
            {number(settings.rewardCoins, (n) => setSettings({ ...settings, rewardCoins: n }), 0)}
          </div>
        </div>
        <button className="button wide" onClick={saveSettings}>
          Save wolf settings
        </button>
      </section>

      <section className="card">
        <h2>All events</h2>
        {data.events.length === 0 ? (
          <p className="muted">No wolf yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="orders">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th>Power</th>
                  <th>Health</th>
                  <th>Farmers killed</th>
                  <th>Wolves killed</th>
                  <th>By</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => {
                  const edit = edits[e.id] ?? { power: e.power, health: e.health };
                  const open = e.status === 'live' || e.status === 'upcoming';
                  const changed = edit.power !== e.power || edit.health !== e.health;
                  return (
                    <tr key={e.id}>
                      <td>
                        {when(e.startsAt)}
                        <div className="muted small">
                          for {hoursBetween(e.startsAt, e.endsAt)}
                          {e.note ? ` · ${e.note}` : ''}
                        </div>
                      </td>
                      <td>
                        <span className={`pill ${e.status}`}>{e.status}</span>
                      </td>
                      <td>{open ? <input type="number" min={1} value={edit.power} onChange={(ev) => setEdits({ ...edits, [e.id]: { ...edit, power: Number(ev.target.value) } })} /> : e.power}</td>
                      <td>{open ? <input type="number" min={1} value={edit.health} onChange={(ev) => setEdits({ ...edits, [e.id]: { ...edit, health: Number(ev.target.value) } })} /> : e.health}</td>
                      <td>
                        {e.farmersKilled}
                        {e.farmersKilledPlayers !== e.farmersKilled && <span className="muted small"> ({e.farmersKilledPlayers} players)</span>}
                      </td>
                      <td>{e.wolvesKilled}</td>
                      <td className="muted small">{e.createdBy}</td>
                      <td className="actions">
                        {open && changed && (
                          <button className="button" onClick={() => change(e, { power: edit.power, health: edit.health }, 'The wolf changed on every farm')}>
                            Save
                          </button>
                        )}
                        {e.status === 'live' && (
                          <button className="button quiet" onClick={() => window.confirm('End this wolf event now?') && change(e, { endNow: true }, 'The wolf is gone from the farms')}>
                            End now
                          </button>
                        )}
                        {open && (
                          <button className="button quiet" onClick={() => window.confirm('Cancel this wolf event?') && change(e, { cancel: true }, 'Cancelled')}>
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
