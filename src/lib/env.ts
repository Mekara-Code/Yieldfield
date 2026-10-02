import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set: copy .env.example to .env (npm run setup does it for you)`);
  }
  return value;
}

export const env = {
  get databaseUrl() {
    return required('DATABASE_URL');
  },
  get jwtSecret() {
    return new TextEncoder().encode(required('JWT_SECRET'));
  },
  /** An access token lasts this long; the game and the site refresh it with their refresh token. */
  accessTtlSeconds: Number(process.env.ACCESS_TTL_SECONDS ?? 15 * 60),
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  production: process.env.NODE_ENV === 'production',
  /**
   * Whether this server keeps WebSockets open. It does when it runs as its own process (npm run dev,
   * or the VPS's docker compose); on Vercel it runs as serverless functions, which can't, so there the
   * game saves over plain HTTP and the site checks back every few seconds instead.
   */
  realtime: !process.env.VERCEL && process.env.REALTIME !== 'false',
};
