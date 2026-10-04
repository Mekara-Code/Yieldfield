import path from 'node:path';
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
