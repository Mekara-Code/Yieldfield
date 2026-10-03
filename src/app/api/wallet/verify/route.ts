import { z } from 'zod';
import { prisma } from '../../../../lib/db';
import { clientAddress, json, problem, publicOrigin, rateLimited, readBody, Username } from '../../../../lib/http';
import { CHARACTER_NAMES, isCharacter } from '../../../../lib/players';
import { messageFor, normalizeAddress, shortAddress, tonPublicKey, verifyEvm, verifyTonProof, verifyTron } from '../../../../lib/wallets';

export const runtime = 'nodejs';

const Body = z.object({
  code: z.string().max(64),
  chain: z.enum(['evm', 'tron', 'ton']),
  address: z.string().trim().max(100),
  signature: z.string().max(400).optional(),
  proof: z
    .object({
      timestamp: z.number().int(),
      domain: z.object({ lengthBytes: z.number().int(), value: z.string().max(253) }),
      payload: z.string().max(128),
      signature: z.string().max(200),
    })
    .optional(),
  /** Signing in with a wallet that has no farm yet: the new farmer's name and who they play. */
  name: Username.optional(),
  character: z.enum(CHARACTER_NAMES).optional(),
});

/** The website sends the wallet's signature: the wallet is linked, or signs the game in (or makes a farm for it). */
export async function POST(request: Request) {
  if (rateLimited(`wallet-verify:${clientAddress(request)}`, 40)) {
    return problem(429, 'Too many tries: wait a few minutes');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  const { code, chain, signature, proof, name, character } = body.data;
  const found = await prisma.walletRequest.findUnique({ where: { code } });
  if (!found || found.status !== 'pending') {
    return problem(404, 'This link was used or isn\'t valid: start again from the game');
  }
  if (found.expiresAt < new Date()) {
    return problem(410, 'This link ran out: start again from the game');
  }
  const address = normalizeAddress(chain, body.data.address);
  if (!address) {
    return problem(400, 'That isn\'t a wallet address');
  }
  let ok = false;
  if (chain === 'evm' && signature) {
    ok = await verifyEvm(address, messageFor(found), signature);
  } else if (chain === 'tron' && signature) {
    ok = await verifyTron(address, messageFor(found), signature);
  } else if (chain === 'ton' && proof) {
    const key = await tonPublicKey(address).catch(() => null);
    if (!key) {
      return problem(400, 'This TON wallet isn\'t active yet: send any small transaction from it first, then try again');
    }
    ok = verifyTonProof(address, proof, new URL(publicOrigin(request)).host, found.nonce, key);
  }
  if (!ok) {
    return problem(401, 'The signature doesn\'t match this wallet');
  }

  const owner = await prisma.wallet.findUnique({ where: { chain_address: { chain, address } } });
  if (found.mode === 'link') {
    if (owner && owner.userId !== found.userId) {
      return problem(409, 'This wallet is already linked to another farm');
    }
    if (!owner) {
      await prisma.wallet.create({ data: { userId: found.userId!, chain, address } });
    }
    await prisma.walletRequest.update({ where: { code }, data: { status: 'done', chain, address } });
    return json({ ok: true, linked: shortAddress(address) });
  }

  // Signing in: the wallet's farm, or a new one for it.
  let userId = owner?.userId;
  if (!userId) {
    if (!name || !isCharacter(character)) {
      return json({ needsAccount: true, address: shortAddress(address) });
    }
    const taken = await prisma.user.findFirst({ where: { username: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (taken) {
      return problem(409, 'That name is taken');
    }
    const user = await prisma.user.create({ data: { username: name, character, farm: { create: {} }, wallets: { create: { chain, address } } } });
    userId = user.id;
  }
  await prisma.walletRequest.update({ where: { code }, data: { status: 'done', chain, address, userId } });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  return json({ ok: true, username: user?.username });
}
