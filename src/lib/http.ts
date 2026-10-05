import { CHARACTER_NAMES } from './players';
import { z } from 'zod';
import type { Tokens } from './auth';
import { env } from './env';

export const REFRESH_COOKIE = 'df_refresh';

export function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers });
}

export function problem(status: number, message: string, details?: unknown) {
  return json({ error: message, details }, status);
}

/** The body as JSON checked against a schema, or the 400 to answer with. */
export async function readBody<T extends z.ZodType>(request: Request, schema: T): Promise<{ data: z.infer<T> } | { response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { response: problem(400, 'The body must be JSON') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { response: problem(400, first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid body', parsed.error.issues) };
  }
  return { data: parsed.data };
}

/**
 * The answer to a sign-in. The game reads the refresh token from the body; the site gets it as
 * an http-only cookie instead, out of reach of the page's scripts.
 */
export function tokensResponse(tokens: Tokens, client: 'game' | 'web', status = 200) {
  if (client === 'game') {
    return json(tokens, status);
  }
  const { refreshToken, ...rest } = tokens;
  return json(rest, status, { 'Set-Cookie': refreshCookie(refreshToken, env.refreshTtlDays * 86400) });
}

export function refreshCookie(value: string, maxAge: number) {
  return `${REFRESH_COOKIE}=${value}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.production ? '; Secure' : ''}`;
}

export function cookie(request: Request, name: string) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      return value.join('=');
    }
  }
  return undefined;
}

export function clientAddress(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
}

// A few sign-in attempts per address per window, against password guessing.
const attempts = new Map<string, { count: number; reset: number }>();

export function rateLimited(key: string, limit = 20, windowMs = 10 * 60_000) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) {
    attempts.set(key, { count: 1, reset: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

export const Username = z.string().trim().regex(/^[A-Za-z0-9_]{3,20}$/, '3-20 letters, digits or _');
export const Password = z.string().min(8, 'at least 8 characters').max(72, 'at most 72 characters');
export const ClientKind = z.enum(['game', 'web']).default('web');

export const RegisterBody = z.object({
  username: Username,
  email: z.email().trim().toLowerCase().max(120),
  password: Password,
  client: ClientKind,
  /** Who they'll play (the game asks at sign-up); fixed after, but for a price. */
  character: z.enum(CHARACTER_NAMES).optional(),
  /** Who invited them: a farmer's name (their link, or the game's "invited by" field). */
  ref: z.string().trim().max(40).optional(),
});

export const LoginBody = z.object({
  login: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(200),
  client: ClientKind,
});

export const RefreshBody = z.object({
  refreshToken: z.string().min(10).max(200).optional(),
});

/** The site's address as the client reached it (the Host header, not the deployment's own name). */
export function publicOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

