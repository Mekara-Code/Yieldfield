import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The PostgreSQL the server uses. On a VPS that is a real PostgreSQL (DATABASE_URL points at it).
 * On your own computer, with EMBEDDED_POSTGRES=true, it is PostgreSQL run from node_modules
 * (the embedded-postgres package: the real server binaries, no install or root needed), its
 * data kept in Server/.pgdata.
 */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function target() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
}

function listening(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

type Embedded = { stop(): Promise<void> } | null;

/** Starts the embedded PostgreSQL if this setup uses one and it isn't running yet; null if nothing was started. */
export async function startDatabase(): Promise<Embedded> {
  if (process.env.EMBEDDED_POSTGRES !== 'true') {
    return null;
  }
  const t = target();
  if (await listening(t.host, t.port)) {
    return null; // already up (npm run db:start in another terminal)
  }
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dataDir = path.join(ROOT, '.pgdata');
  const fresh = !existsSync(path.join(dataDir, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: t.port,
    user: t.user,
    password: t.password,
    persistent: true,
    authMethod: 'scram-sha-256',
    postgresFlags: ['-c', `listen_addresses=${t.host}`],
    onLog: () => {},
    onError: (e) => console.error('[postgres]', e),
  });
  if (fresh) {
    console.log(`[db] creating the database cluster in ${dataDir}`);
    await pg.initialise();
  }
  await pg.start();
  if (fresh) {
    await pg.createDatabase(t.database);
  }
  console.log(`[db] PostgreSQL on ${t.host}:${t.port}`);
  return pg;
}

/** Brings the tables up to date (prisma/migrations). */
export function migrate() {
  execFileSync(path.join(ROOT, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], { cwd: ROOT, stdio: 'inherit' });
}
