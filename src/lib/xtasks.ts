import { createHash, randomBytes } from 'node:crypto';
import { prisma } from './db';
import { creditFarmCoins } from './referrals';
import { REQUEST_MINUTES } from './wallets';

/**
 * Tasks on X (Twitter) for coins, on the website: link the X account (OAuth 2.0 with PKCE), follow the
 * game's page, like its post, post the player's share card with their invitation link. The admins set the
 * page, the post and the coins for each (/admin/social); each is paid once per farm and once per X account.
 *
 * Follows and likes are checked with X's API (app-only, X_BEARER_TOKEN): reading who someone follows and what
 * they liked needs X's Basic API plan or above. The shared post is checked through X's public oEmbed (its
 * author must be the linked account and its text must carry the player's link), which needs no plan.
 *
 * Needs X_CLIENT_ID and X_CLIENT_SECRET (an X app with OAuth 2.0 on, type "Web App", its callback
 * <site>/api/x/callback, or X_REDIRECT_URI) and X_BEARER_TOKEN.
 */

export type XTask = 'connect' | 'follow' | 'like' | 'share';

export interface XSettings {
  enabled: boolean;
  /** The game's page, without the @. */
  handle: string;
  /** Its numeric id (found from the handle when saved). */
  pageId: string;
  /** The post to like (its address on x.com). */
  postUrl: string;
  coins: Record<XTask, number>;
}

export const DEFAULT_X: XSettings = { enabled: false, handle: '', pageId: '', postUrl: '', coins: { connect: 100, follow: 200, like: 100, share: 300 } };

export const xConfig = {
  get clientId() {
    return process.env.X_CLIENT_ID ?? '';
  },
  get clientSecret() {
    return process.env.X_CLIENT_SECRET ?? '';
  },
  get bearer() {
    return process.env.X_BEARER_TOKEN ?? '';
  },
  get api() {
    return process.env.X_API ?? 'https://api.x.com/2';
  },
  get authorize() {
    return process.env.X_AUTHORIZE ?? 'https://x.com/i/oauth2/authorize';
  },
  get configured() {
    return !!(this.clientId && this.clientSecret);
  },
  redirectUri(origin: string) {
    return process.env.X_REDIRECT_URI ?? `${origin}/api/x/callback`;
  },
};

export class XError extends Error {}

export async function xSettings(): Promise<XSettings> {
  const row = await prisma.setting.findUnique({ where: { key: 'x' } });
  const saved = (row?.value ?? {}) as Partial<XSettings>;
  return { ...DEFAULT_X, ...saved, coins: { ...DEFAULT_X.coins, ...(saved.coins ?? {}) } };
}

export function postIdOf(url: string) {
  return /\/status(?:es)?\/(\d{5,25})/.exec(url)?.[1] ?? '';
}

async function xGet<T>(path: string): Promise<{ status: number; data: T | null }> {
  if (!xConfig.bearer) {
    return { status: 0, data: null };
  }
  const response = await fetch(`${xConfig.api}${path}`, { headers: { authorization: `Bearer ${xConfig.bearer}` }, cache: 'no-store' }).catch(() => null);
  if (!response) {
    return { status: 0, data: null };
  }
  return { status: response.status, data: response.ok ? ((await response.json()) as T) : null };
}

/** Saves the admins' settings, finding the page's id from its handle (when X's API can be asked). */
export async function saveXSettings(input: XSettings) {
  const handle = input.handle.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').split(/[/?#]/)[0];
  let pageId = input.pageId.trim();
  if (handle && !/^\d+$/.test(pageId)) {
    const found = await xGet<{ data?: { id: string } }>(`/users/by/username/${encodeURIComponent(handle)}`);
    pageId = found.data?.data?.id ?? '';
  }
  const settings: XSettings = { ...input, handle, pageId };
  await prisma.setting.upsert({ where: { key: 'x' }, update: { value: { ...settings } }, create: { key: 'x', value: { ...settings } } });
  return settings;
}

// ----------------------------------------------------------------------------- linking (OAuth 2.0 + PKCE)

export async function createXRequest(userId: string) {
  return prisma.walletRequest.create({
    data: {
      code: randomBytes(18).toString('base64url'),
      short: randomBytes(3).toString('hex').toUpperCase(),
      mode: 'x',
      userId,
      // The PKCE verifier, kept with the request until X comes back.
      nonce: randomBytes(48).toString('base64url'),
      expiresAt: new Date(Date.now() + REQUEST_MINUTES * 60_000),
    },
  });
}

async function pendingRequest(code: string) {
  const request = await prisma.walletRequest.findUnique({ where: { code } });
  if (!request || request.mode !== 'x' || request.status !== 'pending' || request.expiresAt < new Date() || !request.userId) {
    throw new XError('This link has run out: start again from your farm page');
  }
  return request;
}

/** X's consent page, coming back with the request's code as the state. */
export async function xAuthorizeUrl(code: string, origin: string) {
  const request = await pendingRequest(code);
  const challenge = createHash('sha256').update(request.nonce).digest('base64url');
  const url = new URL(xConfig.authorize);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: xConfig.clientId,
    redirect_uri: xConfig.redirectUri(origin),
    scope: 'users.read tweet.read',
    state: code,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

/** X came back: the account is read and linked to the request's player, and the link task paid. Returns @name. */
export async function finishX(oauthCode: string, state: string, origin: string) {
  const request = await pendingRequest(state);
  const basic = Buffer.from(`${xConfig.clientId}:${xConfig.clientSecret}`).toString('base64');
  const token = await fetch(`${xConfig.api}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: oauthCode, redirect_uri: xConfig.redirectUri(origin), code_verifier: request.nonce, client_id: xConfig.clientId }),
  }).then((r) => (r.ok ? (r.json() as Promise<{ access_token?: string }>) : null)).catch(() => null);
  if (!token?.access_token) {
    throw new XError('X didn\'t confirm it: try again');
  }
  const me = await fetch(`${xConfig.api}/users/me?user.fields=profile_image_url,name,username`, { headers: { authorization: `Bearer ${token.access_token}` } })
    .then((r) => (r.ok ? (r.json() as Promise<{ data?: { id: string; username: string; name?: string; profile_image_url?: string } }>) : null))
    .catch(() => null);
  const account = me?.data;
  if (!account?.id || !/^\d{1,25}$/.test(account.id)) {
    throw new XError('Couldn\'t read the X account: try again');
  }
  const taken = await prisma.user.findUnique({ where: { xId: account.id }, select: { id: true } });
  if (taken && taken.id !== request.userId) {
    throw new XError('That X account is linked to another farm');
  }
  const done = await prisma.walletRequest.updateMany({ where: { code: state, status: 'pending' }, data: { status: 'done', address: `@${account.username}` } });
  if (done.count !== 1) {
    throw new XError('This link was used already');
  }
  // The bigger picture X keeps beside the small one.
  const avatar = account.profile_image_url?.replace('_normal.', '_400x400.') ?? null;
  await prisma.user.update({
    where: { id: request.userId! },
    data: { xId: account.id, xUsername: account.username, xName: account.name?.slice(0, 80) ?? null, xAvatar: avatar, xLinkedAt: new Date() },
  });
  const settings = await xSettings();
  await claim(request.userId!, account.id, 'connect', '', settings.coins.connect);
  return `@${account.username}`;
}

export async function unlinkX(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { xId: null, xUsername: null, xName: null, xAvatar: null, xLinkedAt: null } });
}

// ----------------------------------------------------------------------------- the tasks

/** Pays a task once (per farm, and per X account): false if it was paid already. */
async function claim(userId: string, xId: string, task: XTask, target: string, coins: number, proof?: string) {
  const elsewhere = await prisma.xTaskClaim.findFirst({ where: { xId, task, target }, select: { id: true } });
  if (elsewhere) {
    return false;
  }
  try {
    await prisma.xTaskClaim.create({ data: { userId, xId, task, target, coins, proof } });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return false;
    }
    throw error;
  }
  if (coins > 0) {
    await creditFarmCoins(userId, coins);
  }
  await prisma.farmEvent.create({ data: { userId, kind: 'x_task', day: 0, data: { task, coins } } });
  return true;
}

async function linked(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true, xId: true, xUsername: true } });
  if (!user.xId || !user.xUsername) {
    throw new XError('Link your X account first');
  }
  return user as { username: string; xId: string; xUsername: string };
}

function planProblem(status: number) {
  if (status === 0) {
    return new XError('Checking on X isn\'t set up on this server yet');
  }
  if (status === 401 || status === 403) {
    return new XError('X won\'t let the game check this right now (its API plan): try again later');
  }
  if (status === 429) {
    return new XError('X is busy: try again in a few minutes');
  }
  return new XError('Couldn\'t ask X: try again');
}

/** Follows the page? Looks through who the player follows (up to 5000). */
export async function checkFollow(userId: string) {
  const settings = await xSettings();
  if (!settings.enabled || !settings.pageId) {
    throw new XError('This task isn\'t open yet');
  }
  const user = await linked(userId);
  let token = '';
  for (let page = 0; page < 5; page++) {
    const result = await xGet<{ data?: { id: string }[]; meta?: { next_token?: string } }>(
      `/users/${user.xId}/following?max_results=1000${token ? `&pagination_token=${token}` : ''}`,
    );
    if (!result.data) {
      throw planProblem(result.status);
    }
    if (result.data.data?.some((u) => u.id === settings.pageId)) {
      const paid = await claim(userId, user.xId, 'follow', settings.pageId, settings.coins.follow);
      return { ok: true, paid, coins: paid ? settings.coins.follow : 0 };
    }
    token = result.data.meta?.next_token ?? '';
    if (!token) {
      break;
    }
  }
  throw new XError(`@${user.xUsername} doesn't follow @${settings.handle} yet`);
}

/** Liked the post? Looks through the player's latest likes (up to 300). */
export async function checkLike(userId: string) {
  const settings = await xSettings();
  const postId = postIdOf(settings.postUrl);
  if (!settings.enabled || !postId) {
    throw new XError('This task isn\'t open yet');
  }
  const user = await linked(userId);
  let token = '';
  for (let page = 0; page < 3; page++) {
    const result = await xGet<{ data?: { id: string }[]; meta?: { next_token?: string } }>(
      `/users/${user.xId}/liked_tweets?max_results=100${token ? `&pagination_token=${token}` : ''}`,
    );
    if (!result.data) {
      throw planProblem(result.status);
    }
    if (result.data.data?.some((t) => t.id === postId)) {
      const paid = await claim(userId, user.xId, 'like', postId, settings.coins.like);
      return { ok: true, paid, coins: paid ? settings.coins.like : 0 };
    }
    token = result.data.meta?.next_token ?? '';
    if (!token) {
      break;
    }
  }
  throw new XError(`That post isn't among @${user.xUsername}'s likes yet`);
}

/** Posted the share card? X's oEmbed of the post: by the linked account, with the player's link in it. */
export async function checkShare(userId: string, postUrl: string) {
  const settings = await xSettings();
  if (!settings.enabled) {
    throw new XError('This task isn\'t open yet');
  }
  const user = await linked(userId);
  if (!postIdOf(postUrl)) {
    throw new XError('Paste the address of your post on X');
  }
  const embed = await fetch(`https://publish.twitter.com/oembed?omit_script=true&url=${encodeURIComponent(postUrl.trim())}`, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<{ author_url?: string; html?: string }>) : null))
    .catch(() => null);
  if (!embed?.html) {
    throw new XError('Couldn\'t find that post: is it public?');
  }
  const author = (embed.author_url ?? '').split('/').filter(Boolean).pop()?.toLowerCase();
  if (author !== user.xUsername.toLowerCase()) {
    throw new XError(`That post isn't by @${user.xUsername}`);
  }
  const text = embed.html.replace(/&amp;/g, '&');
  const needle = `ref=${user.username}`.toLowerCase();
  if (!text.toLowerCase().includes(needle) && !text.toLowerCase().includes(`ref=${encodeURIComponent(user.username)}`.toLowerCase())) {
    throw new XError('Your invitation link isn\'t in that post');
  }
  const paid = await claim(userId, user.xId, 'share', '', settings.coins.share, postUrl.trim());
  return { ok: true, paid, coins: paid ? settings.coins.share : 0 };
}

/** The farm page's X card: the tasks, what each pays, what's done. */
export async function xTasksView(userId: string) {
  const [settings, user, claims] = await Promise.all([
    xSettings(),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { xUsername: true, xName: true, xAvatar: true } }),
    prisma.xTaskClaim.findMany({ where: { userId }, select: { task: true, target: true, coins: true, createdAt: true } }),
  ]);
  const postId = postIdOf(settings.postUrl);
  const done = (task: XTask, target: string) => claims.some((c) => c.task === task && c.target === target);
  return {
    open: settings.enabled,
    canLink: xConfig.configured,
    canCheck: !!xConfig.bearer,
    handle: settings.handle,
    postUrl: settings.postUrl,
    coins: settings.coins,
    account: user.xUsername ? { username: user.xUsername, name: user.xName, avatar: user.xAvatar } : null,
    done: {
      connect: done('connect', ''),
      follow: !!settings.pageId && done('follow', settings.pageId),
      like: !!postId && done('like', postId),
      share: done('share', ''),
    },
    earned: claims.reduce((sum, c) => sum + c.coins, 0),
  };
}
