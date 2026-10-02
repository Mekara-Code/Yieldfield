import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, startDatabase } from './database';

/*
 *   npm run db:start     just the database (Ctrl+C stops it)
 *   npm run db:migrate   after changing prisma/schema.prisma: writes a migration and applies it
 *   npm run db:studio    Prisma Studio, to look through the tables in the browser
 */
const command = process.argv[2];
const prisma = path.join(ROOT, 'node_modules', '.bin', 'prisma');
const database = await startDatabase();

async function stop() {
  await database?.stop();
  process.exit(0);
}

if (command === 'start') {
  console.log('[db] running; Ctrl+C to stop');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30);
} else {
  try {
    if (command === 'migrate') {
      execFileSync(prisma, ['migrate', 'dev', ...process.argv.slice(3)], { cwd: ROOT, stdio: 'inherit' });
    } else if (command === 'studio') {
      process.on('SIGINT', stop);
      execFileSync(prisma, ['studio'], { cwd: ROOT, stdio: 'inherit' });
    } else {
      console.error('usage: tsx scripts/db.ts start | migrate [--name <name>] | studio');
    }
  } finally {
    await stop();
  }
}
