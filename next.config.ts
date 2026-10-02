import type { NextConfig } from 'next';

const config: NextConfig = {
  // The database drivers stay plain Node modules rather than bundled.
  serverExternalPackages: ['pg', '@prisma/adapter-pg', 'bcryptjs', 'ws', 'embedded-postgres'],
  poweredByHeader: false,
};

export default config;
