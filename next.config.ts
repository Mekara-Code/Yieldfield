import type { NextConfig } from 'next';

const config: NextConfig = {
  // The database drivers stay plain Node modules rather than bundled.
  serverExternalPackages: ['pg', '@prisma/adapter-pg', 'bcryptjs', 'ws', 'embedded-postgres'],
  poweredByHeader: false,
  // The share card (src/app/api/card) draws with these fonts, read from disk.
  outputFileTracingIncludes: { '/api/card/[username]': ['./assets/fonts/*.ttf'] },
};

export default config;
