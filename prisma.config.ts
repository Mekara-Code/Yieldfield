import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generating the client needs no database, so a fresh checkout (no .env yet) or a Docker build works too.
  // Migrations need a direct connection: on Vercel with Neon that's DATABASE_URL_UNPOOLED (DATABASE_URL is the pooled one).
  datasource: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://unset@localhost:5432/unset',
  },
});
