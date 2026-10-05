import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { jwtVerify, SignJWT } from 'jose';
import { prisma } from './db';
import { env } from './env';

const ISSUER = 'yieldfield';

export type Client = 'game' | 'web';

export interface PublicUser {
  id: string;
  username: string;
  /** Null for accounts made with a wallet. */
  email: string | null;
  /** "Diana" or "Arash"; null on accounts from before the choice (they choose once, free). */
  character: string | null;
}

export interface Tokens {
  accessToken: string;
  /** Keep it secret: it signs the device in again (the game keeps it in its save folder, the site in a cookie). */
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

export interface AccessClaims {
  userId: string;
  username: string;
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 11);
}

export function checkPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function signAccessToken(user: { id: string; username: string }) {
  return new SignJWT({ name: user.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${env.accessTtlSeconds}s`)
    .sign(env.jwtSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, env.jwtSecret, { issuer: ISSUER, audience: ISSUER, algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.name !== 'string') {
      return null;
    }
    return { userId: payload.sub, username: payload.name };
  } catch {
    return null;
  }
}

/** Signs a device in: a new session with its own refresh token. */
export async function issueTokens(user: PublicUser, client: Client): Promise<Tokens> {
  const refreshToken = randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      client,
      expiresAt: new Date(Date.now() + env.refreshTtlDays * 86400_000),
    },
  });
  return {
    accessToken: await signAccessToken(user),
    refreshToken,
    expiresIn: env.accessTtlSeconds,
    user: { id: user.id, username: user.username, email: user.email, character: user.character ?? null },
  };
}

/**
 * Trades a refresh token for new tokens (the old one stops working). A token used a second time means it
 * was copied, and every session of that player is signed out; but not when it comes back within
 * ROTATION_GRACE_MS of its own refresh: then the answer to that refresh never reached the device (a dropped
 * connection on a phone, the game closed meanwhile), and it gets new tokens again rather than being signed out.
 */
const ROTATION_GRACE_MS = 10 * 60_000;

export async function refreshTokens(refreshToken: string): Promise<{ tokens: Tokens; client: Client } | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(refreshToken) }, include: { user: true } });
  if (!session) {
    return null;
  }
  const client = session.client === 'game' ? 'game' : 'web';
  if (session.revokedAt) {
    const lostAnswer = session.rotatedAt && Date.now() - session.rotatedAt.getTime() < ROTATION_GRACE_MS && session.expiresAt > new Date();
    if (lostAnswer) {
      return { tokens: await issueTokens(session.user, client), client };
    }
    await prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return null;
  }
  if (session.expiresAt < new Date()) {
    return null;
  }
  const now = new Date();
  const revoked = await prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now, rotatedAt: now } });
  if (revoked.count === 0) {
    // Refreshed at the same moment by another request of the same device: that one has the new tokens.
    return null;
  }
  return { tokens: await issueTokens(session.user, client), client };
}

export async function revokeRefreshToken(refreshToken: string) {
  await prisma.session.updateMany({ where: { tokenHash: hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
}

/** The player a request's "Authorization: Bearer <access token>" belongs to. */
export async function authenticate(request: Request): Promise<AccessClaims | null> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? verifyAccessToken(match[1].trim()) : null;
}
