import { randomBytes } from 'node:crypto';
import { prisma } from './db';
import { REPUTATION_SOURCES } from './reputation';
import { REQUEST_MINUTES } from './wallets';

/**
 * Linking a Discord account to a farm (it gives REPUTATION_SOURCES.discord reputation while linked), by
 * Discord's OAuth2 with the identify scope: the game (or the site) makes a request (a WalletRequest with
 * mode "discord"), opens /api/discord/start?code=..., Discord asks the player, and comes back to
 * /api/discord/callback, which links the account (one farm each) and marks the request done for the game.
 *
 * Needs DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET (a Discord application, its OAuth2 redirect set to
 * <site>/api/discord/callback, or DISCORD_REDIRECT_URI). DISCORD_API and DISCORD_AUTHORIZE move it
 * elsewhere (tests).
 */

export const discordConfig = {
  get clientId() {
    return process.env.DISCORD_CLIENT_ID ?? '';
  },
  get clientSecret() {
    return process.env.DISCORD_CLIENT_SECRET ?? '';
  },
  get api() {
    return process.env.DISCORD_API ?? 'https://discord.com/api/v10';
  },
  get authorize() {
    return process.env.DISCORD_AUTHORIZE ?? 'https://discord.com/oauth2/authorize';
  },
  get configured() {
    return !!(this.clientId && this.clientSecret);
  },
  redirectUri(origin: string) {
    return process.env.DISCORD_REDIRECT_URI ?? `${origin}/api/discord/callback`;
  },
};

export class DiscordError extends Error {}

export async function createDiscordRequest(userId: string) {
  return prisma.walletRequest.create({
    data: {
      code: randomBytes(18).toString('base64url'),
      short: randomBytes(3).toString('hex').toUpperCase(),
      mode: 'discord',
      userId,
      nonce: randomBytes(16).toString('hex'),
      expiresAt: new Date(Date.now() + REQUEST_MINUTES * 60_000),
    },
  });
}

/** Where /api/discord/start sends the player: Discord's consent page, coming back with the request's code as the state. */
export async function authorizeUrl(code: string, origin: string) {
  const request = await prisma.walletRequest.findUnique({ where: { code } });
  if (!request || request.mode !== 'discord' || request.status !== 'pending' || request.expiresAt < new Date()) {
    throw new DiscordError('This link has run out: start again from the game or the site');
  }
  const url = new URL(discordConfig.authorize);
  url.search = new URLSearchParams({
    client_id: discordConfig.clientId,
    response_type: 'code',
    redirect_uri: discordConfig.redirectUri(origin),
    scope: 'identify',
    state: code,
    prompt: 'consent',
  }).toString();
  return url.toString();
}

/** Discord came back: the account is fetched and linked to the request's player. Returns the name shown. */
export async function finishDiscord(oauthCode: string, state: string, origin: string) {
  const request = await prisma.walletRequest.findUnique({ where: { code: state } });
  if (!request || request.mode !== 'discord' || request.status !== 'pending' || request.expiresAt < new Date() || !request.userId) {
    throw new DiscordError('This link has run out: start again from the game or the site');
  }
  const token = await fetch(`${discordConfig.api}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: discordConfig.clientId,
      client_secret: discordConfig.clientSecret,
      grant_type: 'authorization_code',
      code: oauthCode,
      redirect_uri: discordConfig.redirectUri(origin),
    }),
  }).then((r) => (r.ok ? (r.json() as Promise<{ access_token?: string }>) : null)).catch(() => null);
  if (!token?.access_token) {
    throw new DiscordError('Discord didn\'t confirm it: try again');
  }
  const me = await fetch(`${discordConfig.api}/users/@me`, { headers: { authorization: `Bearer ${token.access_token}` } })
    .then((r) => (r.ok ? (r.json() as Promise<{ id?: string; username?: string; global_name?: string | null; avatar?: string | null }>) : null))
    .catch(() => null);
  if (!me?.id || !/^\d{5,25}$/.test(me.id)) {
    throw new DiscordError('Couldn\'t read the Discord account: try again');
  }
  const taken = await prisma.user.findUnique({ where: { discordId: me.id }, select: { id: true } });
  if (taken && taken.id !== request.userId) {
    throw new DiscordError('That Discord account is linked to another farm');
  }
  const name = (me.global_name ? `${me.global_name} (@${me.username})` : me.username ?? 'Discord').slice(0, 80);
  await prisma.$transaction(async (tx) => {
    const done = await tx.walletRequest.updateMany({ where: { code: state, status: 'pending' }, data: { status: 'done', address: name } });
    if (done.count !== 1) {
      throw new DiscordError('This link was used already');
    }
    const had = await tx.user.findUniqueOrThrow({ where: { id: request.userId! }, select: { discordId: true } });
    await tx.user.update({ where: { id: request.userId! }, data: { discordId: me.id, discordName: name, discordAvatar: me.avatar ?? null, discordLinkedAt: new Date() } });
    if (!had.discordId) {
      await tx.farmEvent.create({ data: { userId: request.userId!, kind: 'discord', day: 0, data: { name, reputation: REPUTATION_SOURCES.discord } } });
    }
  });
  return name;
}

export async function unlinkDiscord(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { discordId: null, discordName: null, discordAvatar: null, discordLinkedAt: null } });
}
