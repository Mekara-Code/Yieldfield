import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './database';

/*
 * First run on a new computer (npm run setup): writes .env from .env.example with fresh secrets,
 * then creates the database and its tables.
 */
const envPath = path.join(ROOT, '.env');
if (!existsSync(envPath)) {
  const text = readFileSync(path.join(ROOT, '.env.example'), 'utf8')
    .replace('change-me-database-password', randomBytes(18).toString('base64url'))
    .replace('change-me-jwt-secret', randomBytes(48).toString('base64url'));
  writeFileSync(envPath, text, { mode: 0o600 });
  console.log('[setup] wrote .env with new secrets');
} else {
  console.log('[setup] .env is already there');
}

const dotenv = await import('dotenv');
dotenv.config({ path: envPath });
const { migrate, startDatabase } = await import('./database');
const database = await startDatabase();
try {
  migrate();
  console.log('[setup] database ready: now run  npm run dev');
} finally {
  await database?.stop();
}
