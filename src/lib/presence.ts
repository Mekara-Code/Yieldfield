import { prisma } from './db';
import { env } from './env';
import { hub } from './hub';

/** See env.realtime: WebSockets when the server is its own process, plain HTTP on Vercel. */
export const realtime = env.realtime;

/** Without sockets, a farm saved this recently is taken as being played (the game saves every 45 s). */
const RECENT_MS = 2 * 60 * 1000;

export async function playersOnline(): Promise<number> {
  if (realtime) {
    return hub.playersOnline();
  }
  return prisma.farm.count({ where: { updatedAt: { gt: new Date(Date.now() - RECENT_MS) } } });
}

export function isPlaying(userId: string, farmUpdatedAt?: Date | null): boolean {
  if (realtime) {
    return hub.isPlaying(userId);
  }
  return !!farmUpdatedAt && Date.now() - farmUpdatedAt.getTime() < RECENT_MS;
}
