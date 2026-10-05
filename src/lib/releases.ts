import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { del, list } from '@vercel/blob';
import { z } from 'zod';
import { prisma } from './db';

/**
 * Versions of the game the players update to from inside it (the AppRelease table, /admin/updates).
 * The newest not withdrawn is offered (GET /api/app/latest) to every copy with a smaller versionCode;
 * the game downloads its file and hands it to Android's installer.
 *
 * Where the file lives:
 * - "link": anywhere else, its address given by the admin;
 * - "blob": Vercel Blob, uploaded straight from the admin's browser (needs BLOB_READ_WRITE_TOKEN, which
 *   connecting a Blob store to the Vercel project sets);
 * - "disk": this server's releases folder (RELEASES_DIR, default ./releases), served at /downloads/<file>;
 *   only when it runs as its own server (Vercel's disk is read-only and its requests are small).
 */

export type ReleaseStorage = 'link' | 'blob' | 'disk';

/** A patch from an earlier version: the update engine builds this one from that one's APK and it. */
export interface ReleaseDelta {
  from: number;
  url: string;
  size: number;
}

export const RELEASES_DIR = process.env.RELEASES_DIR ?? path.join(process.cwd(), 'releases');

export function storageOptions() {
  return { blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN), disk: !process.env.VERCEL };
}

/** A file name that's safe on disk and in a URL: "Yieldfield-1.13.apk", "Yieldfield-12-to-13.yfd", "c14-pakchunk100-Android_ASTC.pak"
 *  (an APK, a patch or a content pack's file). */
export function safeFileName(name: string) {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return /\.(apk|yfd|pak|utoc|ucas)$/i.test(base) ? base : `${base || 'yieldfield'}.apk`;
}

/** One of a version's content packs: its pakchunk's files (.pak, .utoc, .ucas). */
export interface ContentPack {
  chunk: number;
  files: { name: string; size: number; sha1: string; url: string }[];
}

export function packsOf(value: unknown): ContentPack[] {
  return Array.isArray(value)
    ? value
        .filter((p) => p && typeof p.chunk === 'number' && Array.isArray(p.files))
        .map((p) => ({
          chunk: p.chunk,
          files: p.files
            .filter((f: { name?: unknown; url?: unknown }) => typeof f?.name === 'string' && typeof f?.url === 'string')
            .map((f: { name: string; size: unknown; sha1: unknown; url: string }) => ({ name: f.name, size: Number(f.size) || 0, sha1: String(f.sha1 ?? ''), url: f.url })),
        }))
    : [];
}

function deltasOf(value: unknown): ReleaseDelta[] {
  return Array.isArray(value)
    ? value.filter((d) => d && typeof d.from === 'number' && typeof d.url === 'string').map((d) => ({ from: d.from, url: d.url, size: Number(d.size) || 0 }))
    : [];
}

type ReleaseRow = Awaited<ReturnType<typeof prisma.appRelease.findMany>>[number];

/** What the game is told about a version. */
export function publicRelease(row: ReleaseRow) {
  return {
    versionCode: row.versionCode,
    versionName: row.versionName,
    notes: row.notes ?? '',
    url: row.url,
    size: row.size ?? 0,
    mandatory: row.mandatory,
    deltas: deltasOf(row.deltas),
    publishedAt: Math.floor(row.createdAt.getTime() / 1000),
  };
}

export async function latestRelease(platform = 'android') {
  return prisma.appRelease.findFirst({ where: { platform, withdrawnAt: null }, orderBy: [{ versionCode: 'desc' }, { createdAt: 'desc' }] });
}

/** A version's content packs (for the game of that version, so its packs match it), or null if it isn't published. */
export async function releasePacks(versionCode: number, platform = 'android') {
  const row = await prisma.appRelease.findFirst({ where: { platform, versionCode }, orderBy: { createdAt: 'desc' } });
  return row ? packsOf(row.contentPacks) : null;
}

export async function listReleases(platform = 'android') {
  const rows = await prisma.appRelease.findMany({ where: { platform }, orderBy: [{ versionCode: 'desc' }, { createdAt: 'desc' }], take: 50 });
  const live = rows.find((r) => !r.withdrawnAt);
  return rows.map((r) => ({
    id: r.id,
    ...publicRelease(r),
    storage: r.storage as ReleaseStorage,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
    status: r.withdrawnAt ? 'withdrawn' : r.id === live?.id ? 'live' : 'older',
    packs: packsOf(r.contentPacks).length,
    packBytes: packsOf(r.contentPacks).reduce((sum, p) => sum + p.files.reduce((s, f) => s + f.size, 0), 0),
  }));
}

export async function createRelease(input: {
  versionCode: number;
  versionName: string;
  notes?: string;
  url: string;
  size?: number;
  storage: ReleaseStorage;
  mandatory: boolean;
  deltas?: ReleaseDelta[];
  contentPacks?: ContentPack[];
  createdBy: string;
  platform?: string;
}) {
  return prisma.appRelease.create({
    data: { ...input, deltas: (input.deltas ?? []) as object[], contentPacks: (input.contentPacks ?? []) as object[], platform: input.platform ?? 'android', notes: input.notes || null },
  });
}

export async function updateRelease(id: string, change: { withdraw?: boolean; restore?: boolean; mandatory?: boolean; notes?: string; contentPacks?: ContentPack[] }) {
  const row = await prisma.appRelease.findUnique({ where: { id } });
  if (!row) {
    return null;
  }
  const data: Record<string, unknown> = {};
  if (change.withdraw) data.withdrawnAt = new Date();
  if (change.restore) data.withdrawnAt = null;
  if (change.mandatory !== undefined) data.mandatory = change.mandatory;
  if (change.notes !== undefined) data.notes = change.notes || null;
  if (change.contentPacks !== undefined) data.contentPacks = change.contentPacks as object[];
  return prisma.appRelease.update({ where: { id }, data });
}

// ----------------------------------------------------------------------------- publishing, and the files on Blob

/** A new version, as /admin/updates and scripts/publish-release.mts send it. */
export const NewReleaseSchema = z.object({
  versionCode: z.number().int().min(1).max(2_100_000_000),
  versionName: z.string().trim().min(1).max(40),
  notes: z.string().trim().max(2000).optional(),
  url: z.string().trim().min(1).max(2000),
  size: z.number().int().min(0).max(2_147_000_000).optional(),
  storage: z.enum(['link', 'blob', 'disk']),
  mandatory: z.boolean().default(false),
  /** Patches to it from earlier versions (their files put here or on Blob first). */
  deltas: z
    .array(z.object({ from: z.number().int().min(1), url: z.string().trim().min(1).max(2000), size: z.number().int().min(1).max(2_147_000_000) }))
    .max(10)
    .default([]),
  /** Its content packs (each pakchunk's files, put here or on Blob first). */
  contentPacks: z
    .array(
      z.object({
        chunk: z.number().int().min(1),
        files: z.array(z.object({ name: z.string().trim().min(1).max(200), size: z.number().int().min(0), sha1: z.string().regex(/^[0-9a-f]{40}$/), url: z.string().trim().min(1).max(2000) })).min(1).max(8),
      }),
    )
    .max(2000)
    .default([]),
});

/** Publishes a version after the checks (a reason it can't be, else null). */
export async function publishRelease(data: z.infer<typeof NewReleaseSchema>, createdBy: string): Promise<string | null> {
  const { url, storage, versionCode } = data;
  if (storage === 'link' && !/^https?:\/\//i.test(url)) {
    return 'The link must start with http:// or https://';
  }
  if (storage === 'disk' && !url.startsWith('/downloads/')) {
    return 'A file on this server is at /downloads/<name>';
  }
  if (data.deltas.some((d) => d.from >= versionCode)) {
    return 'A patch must be from an earlier version';
  }
  const live = await latestRelease();
  if (live && versionCode <= live.versionCode) {
    return `The version code must be bigger than the one players are offered now (${live.versionName}, code ${live.versionCode})`;
  }
  await createRelease({ ...data, createdBy });
  return null;
}

/**
 * Publishing from the command line (scripts/publish-release.mts) is allowed with the release files' own
 * store key (the Blob store's read-write token: whoever has it can already replace every release file).
 */
export function releaseKeyOk(request: Request) {
  const want = process.env.BLOB_READ_WRITE_TOKEN;
  const got = request.headers.get('x-release-key');
  if (!want || !got) {
    return false;
  }
  return timingSafeEqual(createHash('sha256').update(want).digest(), createHash('sha256').update(got).digest());
}

/** Every file some version uses (its APK, patches, content packs): those are never removed. */
export async function filesInUse() {
  const rows = await prisma.appRelease.findMany();
  const urls = new Set<string>();
  /** A content pack file's address by its SHA-1: a new version with the same file uses it again (no second copy). */
  const bySha1: Record<string, string> = {};
  for (const r of rows) {
    urls.add(r.url);
    for (const d of deltasOf(r.deltas)) {
      urls.add(d.url);
    }
    for (const p of packsOf(r.contentPacks)) {
      for (const f of p.files) {
        urls.add(f.url);
        if (f.sha1 && !r.withdrawnAt) {
          bySha1[f.sha1] = f.url;
        }
      }
    }
  }
  return { urls, bySha1 };
}

/** The Blob store's files (a prefix's), with whether some version uses each, and how full it is. */
export async function blobFiles(prefix?: string) {
  const files: { pathname: string; url: string; size: number; uploadedAt: string; used: boolean }[] = [];
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { files, total: 0 };
  }
  const { urls } = await filesInUse();
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const b of page.blobs) {
      files.push({ pathname: b.pathname, url: b.url, size: b.size, uploadedAt: b.uploadedAt.toISOString(), used: urls.has(b.url) });
    }
    cursor = page.cursor;
  } while (cursor);
  return { files, total: files.reduce((sum, f) => sum + f.size, 0) };
}

/** Removes files no version uses (a failed upload's, a second copy): the addresses removed. Files in use are never touched. */
export async function removeUnusedBlobs(only?: string[]) {
  const { files } = await blobFiles();
  const doomed = files.filter((f) => !f.used && (!only || only.includes(f.url))).map((f) => f.url);
  for (let i = 0; i < doomed.length; i += 100) {
    await del(doomed.slice(i, i + 100));
  }
  return doomed;
}
