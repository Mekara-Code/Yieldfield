import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { prisma } from '../../../../lib/db';
import { levelForXp } from '../../../../lib/game/defs';
import { publicOrigin } from '../../../../lib/http';
import { isVip } from '../../../../lib/reputation';

export const runtime = 'nodejs';

/**
 * A player's share card (1200 x 630 PNG): their X picture (or their character), their name in the game,
 * since when they farm, their level, the game's name and a picture of it, and their invitation link. It is
 * what X shows for their link (the /ref= page's preview) and what they download to post themselves.
 */

const FONTS = path.join(process.cwd(), 'assets', 'fonts');
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 700 | 900; style: 'normal' }[]> | undefined;

function loadFonts() {
  fonts ??= Promise.all([
    readFile(path.join(FONTS, 'Roboto-Regular.ttf')).then((data) => ({ name: 'Roboto', data, weight: 400 as const, style: 'normal' as const })),
    readFile(path.join(FONTS, 'Roboto-Bold.ttf')).then((data) => ({ name: 'Roboto', data, weight: 700 as const, style: 'normal' as const })),
    readFile(path.join(FONTS, 'Roboto-Black.ttf')).then((data) => ({ name: 'Roboto', data, weight: 900 as const, style: 'normal' as const })),
  ]);
  return fonts;
}

const PORTRAITS = new Set(['diana', 'arellah', 'arash']);

export async function GET(request: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const name = decodeURIComponent(username).replace(/\.png$/i, '');
  const user = await prisma.user.findFirst({
    where: { username: { equals: name, mode: 'insensitive' } },
    select: { username: true, createdAt: true, character: true, xAvatar: true, xUsername: true, vipUntil: true, farm: { select: { state: true } } },
  });
  if (!user) {
    return new Response('No such farmer', { status: 404 });
  }
  const origin = publicOrigin(request);
  const host = new URL(origin).host;
  const xp = Number((user.farm?.state as { xp?: number } | null)?.xp ?? 0);
  const level = levelForXp(Number.isFinite(xp) ? xp : 0);
  const character = user.character?.toLowerCase() ?? 'diana';
  const picture = user.xAvatar ?? `${origin}/brand/characters/${PORTRAITS.has(character) ? character : 'diana'}.jpg`;
  const since = user.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const vip = isVip(user.vipUntil);
  const gold = '#ffd36b';

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: 'flex', position: 'relative', background: '#0d110b', fontFamily: 'Roboto', color: '#fff' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${origin}/brand/shots/hero.jpg`} width={1200} height={630} style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, objectFit: 'cover' }} alt="" />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 1200,
            height: 630,
            display: 'flex',
            backgroundImage: 'linear-gradient(90deg, rgba(9,12,7,0.97) 0%, rgba(9,12,7,0.9) 42%, rgba(9,12,7,0.35) 75%, rgba(9,12,7,0.2) 100%)',
          }}
        />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', padding: '54px 64px', width: 760, height: 630 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${origin}/brand/icon-192.png`} width={58} height={58} style={{ borderRadius: 14 }} alt="" />
            <div style={{ display: 'flex', marginLeft: 16, fontSize: 34, fontWeight: 900, color: gold, letterSpacing: -0.5 }}>Battle Bloom</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 46 }}>
            <div style={{ display: 'flex', width: 188, height: 188, borderRadius: 94, padding: 6, background: 'linear-gradient(135deg, #fff1b0, #f0a72a)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={picture} width={176} height={176} style={{ borderRadius: 88, objectFit: 'cover' }} alt="" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 34 }}>
              <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, letterSpacing: 4, color: gold }}>FARMER</div>
              <div style={{ display: 'flex', fontSize: 64, fontWeight: 900, lineHeight: 1.05, maxWidth: 480 }}>{user.username}</div>
              {user.xUsername && <div style={{ display: 'flex', fontSize: 24, color: '#b9c0ae', marginTop: 4 }}>@{user.xUsername}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', marginTop: 34, fontSize: 26, color: '#e7e2d6' }}>Farming in Battle Bloom since {since}</div>
          <div style={{ display: 'flex', marginTop: 18 }}>
            <div style={{ display: 'flex', padding: '8px 18px', borderRadius: 999, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', fontSize: 22, fontWeight: 700 }}>
              Level {level}
            </div>
            {vip && (
              <div style={{ display: 'flex', marginLeft: 12, padding: '8px 18px', borderRadius: 999, background: 'linear-gradient(135deg, #ffe08a, #ee8a2a)', color: '#3a2400', fontSize: 22, fontWeight: 900 }}>
                VIP
              </div>
            )}
          </div>
          <div style={{ display: 'flex', marginTop: 'auto', alignItems: 'center' }}>
            <div style={{ display: 'flex', fontSize: 22, color: '#b9c0ae', marginRight: 14 }}>Join my farm</div>
            <div style={{ display: 'flex', padding: '10px 20px', borderRadius: 14, background: 'linear-gradient(135deg, #ffe08a, #f6b73c 50%, #ee8a2a)', color: '#2a1904', fontSize: 24, fontWeight: 900 }}>
              {host}/ref={user.username}
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts: await loadFonts(), headers: { 'cache-control': 'public, max-age=600, s-maxage=600' } },
  );
}
