'use client';

import Link from 'next/link';
import { upload } from '@vercel/blob/client';
import { useCallback, useEffect, useState } from 'react';
import { readApkVersion } from '../../../lib/apk';
import { apiResult, getAccessToken, refreshAccess } from '../../../lib/client';

type Storage = 'link' | 'blob' | 'disk';

interface Release {
  id: string;
  versionCode: number;
  versionName: string;
  notes: string;
  url: string;
  size: number;
  mandatory: boolean;
  storage: Storage;
  createdBy: string;
  createdAt: string;
  withdrawnAt: string | null;
  status: 'live' | 'older' | 'withdrawn';
  deltas: { from: number; url: string; size: number }[];
  packs: number;
  packBytes: number;
}
interface Patch {
  file: File;
  from: number;
  to: number;
}

/** The SHA-1 of a file, as hex (the game checks each pack file against it). */
async function sha1Of(file: File) {
  const digest = await crypto.subtle.digest('SHA-1', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A content pack's file: pakchunk<N>-<platform>.(pak|utoc|ucas). */
const chunkOf = (name: string) => Number(/pakchunk(\d+)/i.exec(name)?.[1] ?? 0);

/** A patch file's versions, from its header ("YFDELTA1", u32 from, u32 to): null if it isn't one. */
async function readPatch(file: File): Promise<Patch | null> {
  const head = new DataView(await file.slice(0, 80).arrayBuffer());
  if (head.byteLength < 80 || new TextDecoder().decode(new Uint8Array(head.buffer, 0, 8)) !== 'YFDELTA1') {
    return null;
  }
  return { file, from: head.getUint32(8, true), to: head.getUint32(12, true) };
}
interface UpdatesData {
  releases: Release[];
  storage: { blob: boolean; disk: boolean };
}

const megabytes = (bytes: number) => (bytes > 0 ? `${(bytes / 1_048_576).toFixed(bytes > 100 * 1_048_576 ? 0 : 1)} MB` : '—');
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function token() {
  return getAccessToken() ?? (await refreshAccess());
}

/** Sends the file to this server (RELEASES_DIR), with its progress; its address and size. */
function putOnServer(file: File, name: string, bearer: string, progress: (fraction: number) => void) {
  return new Promise<{ url: string; size: number }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', `/api/admin/releases/file?name=${encodeURIComponent(name)}`);
    request.setRequestHeader('Authorization', `Bearer ${bearer}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.upload.onprogress = (e) => e.lengthComputable && progress(e.loaded / e.total);
    request.onload = () => {
      const body = (() => {
        try {
          return JSON.parse(request.responseText);
        } catch {
          return null;
        }
      })();
      if (request.status === 200 && body?.url) {
        resolve(body);
      } else {
        reject(new Error(body?.error ?? `Upload failed (${request.status})`));
      }
    };
    request.onerror = () => reject(new Error('The upload was cut off'));
    request.send(file);
  });
}

/** /admin/updates: publishing a new version of the game, which the game then offers players to update to from inside it. */
export default function UpdatesPage() {
  const [data, setData] = useState<UpdatesData | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [readFrom, setReadFrom] = useState<string | null>(null);
  const [versionCode, setVersionCode] = useState(0);
  const [versionName, setVersionName] = useState('');
  const [notes, setNotes] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const [where, setWhere] = useState<Storage>('link');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [patches, setPatches] = useState<Patch[]>([]);
  const [patchNote, setPatchNote] = useState<string | null>(null);
  const [packFiles, setPackFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);

  const take = useCallback((d: UpdatesData) => {
    setData(d);
    setWhere((w) => (w === 'link' ? (d.storage.disk ? 'disk' : d.storage.blob ? 'blob' : 'link') : w));
  }, []);

  useEffect(() => {
    (async () => {
      const { data: d, error } = await apiResult<UpdatesData>('/api/admin/releases');
      if (!d) {
        setDenied(error);
        return;
      }
      take(d);
    })();
  }, [take]);

  async function pick(chosen: File | null) {
    setFile(chosen);
    setReadFrom(null);
    if (!chosen) {
      return;
    }
    const version = await readApkVersion(chosen);
    if (version && version.versionCode > 0) {
      setVersionCode(version.versionCode);
      setVersionName(version.versionName);
      setReadFrom(`${version.packageName || 'APK'} · version ${version.versionName} (code ${version.versionCode}) · ${megabytes(chosen.size)}`);
    } else {
      setReadFrom(`Couldn't read the version from this file (${megabytes(chosen.size)}): type it below`);
    }
  }

  async function pickPatches(files: FileList | null) {
    const read = await Promise.all(Array.from(files ?? []).map(readPatch));
    const good = read.filter((p): p is Patch => p !== null);
    setPatches(good);
    const bad = read.length - good.length;
    setPatchNote(good.length || bad ? `${good.map((p) => `from code ${p.from} to ${p.to} (${megabytes(p.file.size)})`).join(', ')}${bad ? ` · ${bad} file(s) aren't patches` : ''}` : null);
  }

  async function publish() {
    if (!data) {
      return;
    }
    if (!versionName.trim() || versionCode < 1) {
      setMessage('Give the version name and code (they are read from the APK when you choose it)');
      return;
    }
    if (where !== 'link' && !file) {
      setMessage('Choose the APK file first');
      return;
    }
    const wrong = patches.find((p) => p.to !== versionCode || p.from >= versionCode);
    if (wrong) {
      setMessage(`The patch from code ${wrong.from} is to code ${wrong.to}, not to this version (code ${versionCode})`);
      return;
    }
    if (packFiles.some((f) => !chunkOf(f.name))) {
      setMessage('Content packs are the pakchunk<N>-… files (.pak, .utoc, .ucas) the build makes');
      return;
    }
    if ((patches.length || packFiles.length) && where === 'link') {
      setMessage('Patches are kept on this server or Vercel Blob: choose one of those, or publish without patches');
      return;
    }
    if (where === 'link' && !/^https?:\/\//i.test(link.trim())) {
      setMessage('Paste the address the file can be downloaded from (http:// or https://)');
      return;
    }
    const mustText = mandatory ? ' Players will have to update before they can play.' : '';
    if (!window.confirm(`Publish version ${versionName} (code ${versionCode})? Every copy of the game older than it will offer the update.${mustText}`)) {
      return;
    }
    const bearer = await token();
    if (!bearer) {
      setMessage('Signed out: sign in again');
      return;
    }
    try {
      let url = link.trim();
      let size = file?.size ?? 0;
      const name = `Yieldfield-${versionName.trim()}.apk`;
      setProgress(0);
      if (where === 'disk' && file) {
        setBusy(`Uploading ${name} to this server…`);
        const put = await putOnServer(file, name, bearer, setProgress);
        url = put.url;
        size = put.size;
      } else if (where === 'blob' && file) {
        setBusy(`Uploading ${name} to Vercel Blob…`);
        const blob = await upload(`releases/${name}`, file, {
          access: 'public',
          handleUploadUrl: '/api/admin/releases/upload',
          headers: { Authorization: `Bearer ${bearer}` },
          contentType: 'application/vnd.android.package-archive',
          multipart: true,
          onUploadProgress: (e) => setProgress(e.percentage / 100),
        });
        url = blob.url;
      }
      // The content packs: each file checked (SHA-1) and put beside the version's (their names kept for the game).
      const packs = new Map<number, { chunk: number; files: { name: string; size: number; sha1: string; url: string }[] }>();
      for (let i = 0; i < packFiles.length; i++) {
        const file = packFiles[i];
        const chunk = chunkOf(file.name);
        setBusy(`Content packs: ${i + 1} of ${packFiles.length} (${file.name})…`);
        setProgress(i / packFiles.length);
        const sha1 = await sha1Of(file);
        let fileUrl: string;
        if (where === 'disk') {
          fileUrl = (await putOnServer(file, `c${versionCode}-${file.name}`, bearer, () => {})).url;
        } else {
          const blob = await upload(`content/${versionCode}/${file.name}`, file, {
            access: 'public',
            handleUploadUrl: '/api/admin/releases/upload',
            headers: { Authorization: `Bearer ${bearer}` },
            contentType: 'application/octet-stream',
            multipart: file.size > 8 * 1048576,
          });
          fileUrl = blob.url;
        }
        const pack = packs.get(chunk) ?? { chunk, files: [] };
        pack.files.push({ name: file.name, size: file.size, sha1, url: fileUrl });
        packs.set(chunk, pack);
      }
      // The patches from earlier versions, beside it.
      const deltas: { from: number; url: string; size: number }[] = [];
      for (const patch of patches) {
        const patchName = `Yieldfield-${patch.from}-to-${patch.to}.yfd`;
        setProgress(0);
        if (where === 'disk') {
          setBusy(`Uploading the patch from code ${patch.from}…`);
          const put = await putOnServer(patch.file, patchName, bearer, setProgress);
          deltas.push({ from: patch.from, url: put.url, size: put.size });
        } else if (where === 'blob') {
          setBusy(`Uploading the patch from code ${patch.from} to Vercel Blob…`);
          const blob = await upload(`releases/${patchName}`, patch.file, {
            access: 'public',
            handleUploadUrl: '/api/admin/releases/upload',
            headers: { Authorization: `Bearer ${bearer}` },
            contentType: 'application/octet-stream',
            multipart: true,
            onUploadProgress: (e) => setProgress(e.percentage / 100),
          });
          deltas.push({ from: patch.from, url: blob.url, size: patch.file.size });
        }
      }
      setBusy('Publishing…');
      const { data: d, error } = await apiResult<UpdatesData>('/api/admin/releases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ versionCode, versionName: versionName.trim(), notes: notes.trim() || undefined, url, size: size || undefined, storage: where, mandatory, deltas, contentPacks: [...packs.values()] }),
      });
      if (!d) {
        throw new Error(error ?? 'Publishing failed');
      }
      take(d);
      setFile(null);
      setReadFrom(null);
      setNotes('');
      setMandatory(false);
      setLink('');
      setPatches([]);
      setPatchNote(null);
      setPackFiles([]);
      setMessage(`Version ${versionName} is out: the game offers it to players from now on${deltas.length ? ` (copies of code ${deltas.map((d) => d.from).join(', ')} download only what changed)` : ''}`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function change(release: Release, body: Record<string, unknown>, done: string) {
    const { data: d, error } = await apiResult<UpdatesData>(`/api/admin/releases/${release.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
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
        <h2>App updates</h2>
        <p className="muted">{denied.startsWith('Signed out') ? 'Sign in with an admin account first.' : denied}</p>
        <Link className="button" href="/">
          Sign in
        </Link>
      </section>
    );
  }
  if (!data) {
    return <p className="muted" style={{ textAlign: 'center', marginTop: 60 }}>Loading…</p>;
  }
  const live = data.releases.find((r) => r.status === 'live');
  const places: { id: Storage; label: string; note: string; on: boolean }[] = [
    { id: 'disk', label: 'Upload to this server', note: 'kept in its releases folder, downloaded from /downloads', on: data.storage.disk },
    { id: 'blob', label: 'Upload to Vercel Blob', note: data.storage.blob ? 'Blob storage connected to this project' : 'connect a Blob store to the Vercel project first', on: data.storage.blob },
    { id: 'link', label: 'A link to the file', note: 'it is kept somewhere else (your own host, a CDN…)', on: true },
  ];

  return (
    <div className="admin">
      <div className="row-head">
        <h1>App updates</h1>
        {live ? (
          <span className="pill live">
            Players are offered {live.versionName} · {megabytes(live.size)}
          </span>
        ) : (
          <span className="pill">No version published: the game doesn&apos;t ask to update</span>
        )}
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
        <h2>Publish a new version</h2>
        <p className="muted small">
          Build the APK with a bigger Store Version (Project Settings › Android) and the same signing key as before, then publish it here. Every copy of the game with a smaller
          version code shows the update when it starts (and every few minutes while it&apos;s played): one tap downloads it inside the game and opens Android&apos;s installer.
        </p>
        <div className="event-form">
          <div className="wide-field">
            <label htmlFor="up-file">The APK</label>
            <input id="up-file" type="file" accept=".apk,application/vnd.android.package-archive" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            {readFrom && <p className="muted small">{readFrom}</p>}
          </div>
          <div className="wide-field">
            <label htmlFor="up-patches">Patches from earlier versions (optional: the .yfd files Scripts/make_update_delta.py makes)</label>
            <input id="up-patches" type="file" multiple accept=".yfd" onChange={(e) => pickPatches(e.target.files)} />
            <p className="muted small">
              {patchNote ??
                'With a patch from the version a player has, the game downloads only what changed and builds the new version from the installed one; without one it downloads the whole APK.'}
            </p>
          </div>
          <div className="wide-field">
            <label htmlFor="up-packs">Content packs (all the pakchunk files of this build: Build/Releases/&lt;version&gt;/packs)</label>
            <input id="up-packs" type="file" multiple accept=".pak,.utoc,.ucas" onChange={(e) => setPackFiles(Array.from(e.target.files ?? []))} />
            <p className="muted small">
              {packFiles.length
                ? `${new Set(packFiles.map((f) => chunkOf(f.name))).size} packs in ${packFiles.length} files, ${megabytes(packFiles.reduce((s, f) => s + f.size, 0))}`
                : 'The looks and characters the game downloads when a player first needs them (the APK is lighter without them).'}
            </p>
          </div>
          <div>
            <label htmlFor="up-name">Version name (players see it)</label>
            <input id="up-name" value={versionName} maxLength={40} placeholder="1.13" onChange={(e) => setVersionName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="up-code">Version code</label>
            <input id="up-code" type="number" min={1} value={versionCode || ''} placeholder={String((live?.versionCode ?? 0) + 1)} onChange={(e) => setVersionCode(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
          </div>
          <div className="wide-field">
            <label htmlFor="up-notes">What&apos;s new (shown in the game&apos;s update window)</label>
            <textarea
              id="up-notes"
              rows={4}
              maxLength={2000}
              value={notes}
              placeholder="New: seeds and basket wheels, music…"
              onChange={(e) => setNotes(e.target.value)}
              style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--ground)', color: 'var(--ink)', font: 'inherit' }}
            />
          </div>
          <div className="wide-field">
            <label>Where the file goes</label>
            <div style={{ display: 'grid', gap: 8 }}>
              {places.map((p) => (
                <label key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', margin: 0, fontWeight: 500, color: p.on ? 'var(--ink)' : 'var(--muted)' }}>
                  <input type="radio" name="up-where" style={{ width: 'auto' }} disabled={!p.on} checked={where === p.id} onChange={() => setWhere(p.id)} />
                  <span>
                    <b>{p.label}</b> <span className="muted small">· {p.note}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          {where === 'link' && (
            <div className="wide-field">
              <label htmlFor="up-link">Download address</label>
              <input id="up-link" value={link} placeholder="https://…/Yieldfield-1.13.apk" onChange={(e) => setLink(e.target.value)} />
            </div>
          )}
          <div className="wide-field">
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 500 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
              Players must update before they can play on
            </label>
          </div>
        </div>
        {busy && (
          <div style={{ marginTop: 14 }}>
            <p className="muted small">
              {busy} {progress > 0 && progress < 1 ? `${Math.round(progress * 100)}%` : ''}
            </p>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--line)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: 'var(--gold)', transition: 'width .2s' }} />
            </div>
          </div>
        )}
        <button className="button wide" disabled={Boolean(busy)} onClick={publish}>
          {busy ? 'Working…' : 'Publish this version'}
        </button>
      </section>

      <section className="card">
        <h2>Versions</h2>
        {data.releases.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="orders">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Size</th>
                  <th>File</th>
                  <th>By</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.releases.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.versionName}</b> <span className="muted small">code {r.versionCode}</span>
                      <div className="muted small">{when(r.createdAt)}</div>
                      {r.notes && <div className="small" style={{ whiteSpace: 'pre-wrap', maxWidth: 360 }}>{r.notes}</div>}
                      {r.packs > 0 && (
                        <div className="muted small">
                          content packs: {r.packs} ({megabytes(r.packBytes)})
                        </div>
                      )}
                      {r.deltas.length > 0 && (
                        <div className="muted small">
                          patches: {r.deltas.map((d) => `from ${d.from} (${megabytes(d.size)})`).join(', ')}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${r.status === 'live' ? 'live' : r.status === 'withdrawn' ? 'cancelled' : ''}`}>{r.status}</span>
                      {r.mandatory && <div className="small" style={{ color: 'var(--red)', marginTop: 4 }}>must update</div>}
                    </td>
                    <td>{megabytes(r.size)}</td>
                    <td className="small">
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {r.storage === 'disk' ? 'this server' : r.storage === 'blob' ? 'Vercel Blob' : 'link'}
                      </a>
                    </td>
                    <td className="muted small">{r.createdBy}</td>
                    <td className="actions">
                      {r.status === 'live' && (
                        <button className="button quiet" onClick={() => change(r, { mandatory: !r.mandatory }, r.mandatory ? 'Players may update later again' : 'Players must update now')}>
                          {r.mandatory ? 'Make optional' : 'Make a must'}
                        </button>
                      )}
                      {r.withdrawnAt ? (
                        <button className="button quiet" onClick={() => change(r, { restore: true }, 'Offered again')}>
                          Bring back
                        </button>
                      ) : (
                        <button className="button quiet" onClick={() => window.confirm(`Withdraw ${r.versionName}? Players are no longer offered it.`) && change(r, { withdraw: true }, 'Withdrawn')}>
                          Withdraw
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
