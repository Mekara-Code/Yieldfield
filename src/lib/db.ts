import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { env } from './env';

// One client for the whole process: the custom server (WebSocket) and Next's route handlers
// are bundled apart but run in the same process, so the client lives on globalThis. As serverless
// functions (Vercel) each instance keeps only a few connections (use the database's pooled address).
const holder = globalThis as unknown as { __farmPrisma?: PrismaClient };

export const prisma: PrismaClient =
  holder.__farmPrisma ?? (holder.__farmPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl, max: env.realtime ? 10 : 3 }) }));
