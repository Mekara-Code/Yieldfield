import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';
import { concat, keccak256, recoverAddress, toBytes, verifyMessage } from 'viem';
import { addCurrency } from './currency';
import { prisma } from './db';
import { incoming, isNetwork, NETWORKS, type NetworkId, tonRaw, tronBase58, usdPrice } from './networks';
import { shopSettings, type Pack } from './shop';

/**
 * Players' own wallets: they prove one is theirs by signing a message on the website (the game opens
 * the page with a request's code and waits for it). A linked wallet then signs them in, and anything
 * it sends to the admin's wallets is theirs: credited to their farm without an order.
 */

export type Chain = 'evm' | 'tron' | 'ton';
export const CHAINS: Chain[] = ['evm', 'tron', 'ton'];

/** Which of the shop's coins a wallet on each chain can send. */
export const CHAIN_NETWORKS: Record<Chain, NetworkId[]> = {
  evm: ['USDT_BEP20'],
  tron: ['USDT_TRC20', 'TRX'],
  ton: ['TON'],
};

export const REQUEST_MINUTES = 15;

export function isChain(chain: unknown): chain is Chain {
  return typeof chain === 'string' && (CHAINS as string[]).includes(chain);
}

/** The address as it's kept: evm lower-case, tron base58, ton raw. Null if it isn't one. */
export function normalizeAddress(chain: Chain, address: string): string | null {
  const a = address.trim();
  if (chain === 'evm') {
    return /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null;
  }
  if (chain === 'tron') {
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a) ? a : null;
  }
  return tonRaw(a);
}

export function shortAddress(address: string) {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

// ----------------------------------------------------------------------------- requests

function shortCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  const s = Array.from(bytes, (b) => letters[b % letters.length]).join('');
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export async function createRequest(mode: 'link' | 'login', userId: string | null) {
  return prisma.walletRequest.create({
    data: {
      code: randomBytes(18).toString('base64url'),
      short: shortCode(),
      mode,
      userId,
      nonce: randomBytes(16).toString('hex'),
      expiresAt: new Date(Date.now() + REQUEST_MINUTES * 60_000),
    },
  });
}

/** What the wallet signs (EVM and Tron); TON wallets sign the nonce in a TON Connect proof. */
export function messageFor(request: { mode: string; short: string; nonce: string; createdAt: Date }) {
  return [
    'Yieldfield',
    request.mode === 'link' ? 'Link this wallet to my farm.' : 'Sign in to my farm with this wallet.',
    `Code: ${request.short}`,
    `Nonce: ${request.nonce}`,
    `Issued: ${request.createdAt.toISOString()}`,
  ].join('\n');
}

// ----------------------------------------------------------------------------- signatures

export async function verifyEvm(address: string, message: string, signature: string) {
  try {
    return await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` });
  } catch {
    return false;
  }
}

/** TronLink's signMessageV2: secp256k1 over keccak256("\x19TRON Signed Message:\n" + length + message). */
export async function verifyTron(address: string, message: string, signature: string) {
  try {
    const bytes = toBytes(message);
    const hash = keccak256(concat([toBytes(`\x19TRON Signed Message:\n${bytes.length}`), bytes]));
    const signer = await recoverAddress({ hash, signature: (signature.startsWith('0x') ? signature : `0x${signature}`) as `0x${string}` });
    return tronBase58(signer) === address;
  } catch {
    return false;
  }
}

export interface TonProof {
  timestamp: number;
  domain: { lengthBytes: number; value: string };
  payload: string;
  signature: string; // base64
}

/** A wallet's public key from the chain (its get_public_key method); null if it has none (never used). */
export async function tonPublicKey(rawAddress: string): Promise<Buffer | null> {
  const url = `https://toncenter.com/api/v2/runGetMethod`;
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(9000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: rawAddress, method: 'get_public_key', stack: [] }),
  });
  const body = (await response.json()) as { ok?: boolean; result?: { exit_code?: number; stack?: [string, string][] } };
  const value = body.result?.exit_code === 0 ? body.result.stack?.[0]?.[1] : undefined;
  if (!value) {
    return null;
  }
  return Buffer.from(BigInt(value).toString(16).padStart(64, '0'), 'hex');
}

/**
 * A TON Connect ton_proof (v2): the wallet's ed25519 signature over its address, our domain, the time and
 * the request's nonce. publicKey: the wallet's (from the chain, or given by a test).
 */
export function verifyTonProof(rawAddress: string, proof: TonProof, domain: string, nonce: string, publicKey: Buffer, now = Date.now()) {
  const [wcText, hashHex] = rawAddress.split(':');
  if (!hashHex || proof.payload !== nonce || proof.domain.value !== domain || Math.abs(now / 1000 - proof.timestamp) > REQUEST_MINUTES * 60) {
    return false;
  }
  const wc = Buffer.alloc(4);
  wc.writeInt32BE(Number(wcText));
  const domainLength = Buffer.alloc(4);
  domainLength.writeUInt32LE(Buffer.byteLength(proof.domain.value));
  const time = Buffer.alloc(8);
  time.writeBigUInt64LE(BigInt(proof.timestamp));
  const message = Buffer.concat([Buffer.from('ton-proof-item-v2/'), wc, Buffer.from(hashHex, 'hex'), domainLength, Buffer.from(proof.domain.value), time, Buffer.from(proof.payload)]);
  const full = Buffer.concat([Buffer.from([0xff, 0xff]), Buffer.from('ton-connect'), createHash('sha256').update(message).digest()]);
  const digest = createHash('sha256').update(full).digest();
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKey]), format: 'der', type: 'spki' });
  try {
    return verifySignature(null, digest, key, Buffer.from(proof.signature, 'base64'));
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------- deposits

/** BLOOM for a dollar amount: at the rate of the biggest pack it pays for (the smallest pack's rate below that). */
export function bloomForUsd(usd: number, packs: Pack[]) {
  const sorted = [...packs].sort((a, b) => a.usdCents - b.usdCents);
  const cents = Math.round(usd * 100);
  const pack = [...sorted].reverse().find((p) => p.usdCents <= cents) ?? sorted[0];
  return Math.floor((cents * pack.bloom) / pack.usdCents);
}

/**
 * Looks for transfers from the player's linked wallets to the admin's wallets (since each was linked)
 * and credits each once, at bloomForUsd. Returns what was credited.
 */
export async function scanDeposits(userId: string) {
  const wallets = await prisma.wallet.findMany({ where: { userId } });
  if (!wallets.length) {
    return [];
  }
  const settings = await shopSettings();
  const credited: { network: NetworkId; amount: string; bloom: number; txHash: string }[] = [];
  // One look per coin at what reached the shop's wallet, matched against every wallet of the player's on that chain.
  for (const chain of CHAINS) {
    const mine = wallets.filter((w) => w.chain === chain);
    if (!mine.length) {
      continue;
    }
    const since = Math.min(...mine.map((w) => w.createdAt.getTime())) - 60_000;
    for (const id of CHAIN_NETWORKS[chain]) {
      const to = settings.wallets[id];
      if (!to) {
        continue;
      }
      const network = NETWORKS[id];
      let transfers;
      try {
        transfers = await incoming(id, to, since);
      } catch {
        continue; // that chain's API is busy: next time
      }
      for (const t of transfers) {
        const from = t.from ? normalizeAddress(chain, t.from) : null;
        const wallet = from ? mine.find((w) => w.address === from) : undefined;
        if (!wallet || !t.confirmed || (t.time !== undefined && t.time < wallet.createdAt.getTime() - 60_000)) {
          continue;
        }
        if (await prisma.payment.findUnique({ where: { txHash: t.hash }, select: { id: true } })) {
          continue; // already credited (to an order, or as a deposit)
        }
        const price = await usdPrice(id);
        const coins = Number(t.units) / 10 ** network.decimals;
        const usd = coins * price;
        const bloom = bloomForUsd(usd, settings.packs);
        if (bloom <= 0) {
          continue;
        }
        try {
          await prisma.$transaction(async (tx) => {
            await tx.payment.create({
              data: {
                userId, pack: 'deposit', bloom, usdCents: Math.round(usd * 100), network: id, amount: coins.toString(), units: t.units.toString(),
                address: to, usdPrice: price, status: 'paid', txHash: t.hash, paidAt: new Date(t.time ?? Date.now()), expiresAt: new Date(),
                note: `from linked wallet ${shortAddress(wallet.address)}`,
              },
            });
            await addCurrency(tx, userId, 'bloom', bloom, 'deposit', { coin: id, tx: t.hash });
            await tx.farmEvent.create({ data: { userId, kind: 'purchase', day: 0, data: { bloom, usd: usd.toFixed(2), coin: id, wallet: true } } });
          });
          credited.push({ network: id, amount: coins.toString(), bloom, txHash: t.hash });
        } catch (error) {
          if ((error as { code?: string }).code !== 'P2002') {
            throw error; // P2002: credited at the same moment by another request
          }
        }
      }
    }
  }
  return credited;
}

export function isNetworkId(id: string): id is NetworkId {
  return isNetwork(id);
}
