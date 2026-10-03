/**
 * The coins a BLOOM pack can be paid with, and how to read each chain for payments to the admin's
 * wallet. Every order gets an amount no other open order has (a few hundredths of a cent apart), so
 * a transfer of that amount to the wallet, sent while the order was open, is that order's payment.
 */

export type NetworkId = 'USDT_TRC20' | 'TRX' | 'TON' | 'USDT_BEP20' | 'BTC' | 'LTC';

export interface Network {
  id: NetworkId;
  label: string;
  asset: string;
  decimals: number;
  /** The amounts differ in steps of this many of the coin's smallest units... */
  step: bigint;
  /** ...up to this many steps above the price. */
  spread: number;
  /** CoinGecko's id and Kraken's pair for the USD price (stablecoins are 1). */
  coingecko?: string;
  kraken?: string;
  /** Wait for a block before crediting (a transfer seen in the mempool could still be replaced). */
  needsBlock?: boolean;
  /** How long after the order closes a payment sent in time may still turn up. */
  lateMinutes: number;
  address: RegExp;
  explorer: string;
}

export const NETWORKS: Record<NetworkId, Network> = {
  USDT_TRC20: {
    id: 'USDT_TRC20', label: 'USDT · TRC20 (Tron)', asset: 'USDT', decimals: 6, step: 100n, spread: 900, lateMinutes: 60,
    address: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, explorer: 'https://tronscan.org/#/transaction/',
  },
  TRX: {
    id: 'TRX', label: 'TRX (Tron)', asset: 'TRX', decimals: 6, step: 1000n, spread: 900, coingecko: 'tron', kraken: 'TRXUSD', lateMinutes: 60,
    address: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, explorer: 'https://tronscan.org/#/transaction/',
  },
  TON: {
    id: 'TON', label: 'TON', asset: 'TON', decimals: 9, step: 100000n, spread: 900, coingecko: 'the-open-network', kraken: 'TONUSD', lateMinutes: 60,
    address: /^((EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}|-?[0-9]:[0-9a-fA-F]{64})$/, explorer: 'https://tonviewer.com/transaction/',
  },
  USDT_BEP20: {
    id: 'USDT_BEP20', label: 'USDT · BEP20 (BNB Chain)', asset: 'USDT', decimals: 18, step: 10n ** 14n, spread: 900, lateMinutes: 60,
    address: /^0x[0-9a-fA-F]{40}$/, explorer: 'https://bscscan.com/tx/',
  },
  BTC: {
    id: 'BTC', label: 'Bitcoin', asset: 'BTC', decimals: 8, step: 1n, spread: 300, coingecko: 'bitcoin', kraken: 'XBTUSD', needsBlock: true, lateMinutes: 240,
    address: /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/, explorer: 'https://mempool.space/tx/',
  },
  LTC: {
    id: 'LTC', label: 'Litecoin', asset: 'LTC', decimals: 8, step: 100n, spread: 900, coingecko: 'litecoin', kraken: 'LTCUSD', needsBlock: true, lateMinutes: 120,
    address: /^(ltc1[a-z0-9]{25,62}|[LM3][a-km-zA-HJ-NP-Z1-9]{25,34})$/, explorer: 'https://litecoinspace.org/tx/',
  },
};

export function isNetwork(id: string): id is NetworkId {
  return Object.prototype.hasOwnProperty.call(NETWORKS, id);
}

/** units (smallest units) as a decimal string, without trailing zeros. */
export function formatUnits(units: bigint, decimals: number) {
  const s = units.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const fraction = s.slice(s.length - decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** A transfer to the wallet as a chain reports it. time: when it was sent (ms; unknown while unconfirmed on UTXO chains). */
export interface Incoming {
  hash: string;
  units: bigint;
  time?: number;
  confirmed: boolean;
}

const USDT_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_BSC = '0x55d398326f99059ff775485246999027b3197955';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const BSC_RPC = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'];

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(9000), headers: { accept: 'application/json', ...init?.headers } });
  if (!response.ok) {
    throw new Error(`${new URL(url).host} answered ${response.status}`);
  }
  return response.json();
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** A Tron base58 address as the hex the chain's raw transactions use (41...). */
export function tronHex(address: string) {
  let n = 0n;
  for (const c of address) {
    const i = B58.indexOf(c);
    if (i < 0) {
      throw new Error('not base58');
    }
    n = n * 58n + BigInt(i);
  }
  const hex = n.toString(16).padStart(50, '0'); // 21 bytes + 4 checksum
  return hex.slice(0, 42).toLowerCase();
}

async function tronTrc20(address: string, since: number): Promise<Incoming[]> {
  const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?only_to=true&only_confirmed=true&limit=100&min_timestamp=${since}&contract_address=${USDT_TRON}`;
  const body = (await getJson(url)) as { data?: { transaction_id: string; value: string; block_timestamp: number; to: string; token_info?: { address?: string } }[] };
  return (body.data ?? [])
    .filter((t) => t.to === address && (!t.token_info?.address || t.token_info.address === USDT_TRON))
    .map((t) => ({ hash: t.transaction_id, units: BigInt(t.value), time: t.block_timestamp, confirmed: true }));
}

async function tronNative(address: string, since: number): Promise<Incoming[]> {
  const url = `https://api.trongrid.io/v1/accounts/${address}/transactions?only_to=true&only_confirmed=true&limit=100&min_timestamp=${since}`;
  const body = (await getJson(url)) as {
    data?: { txID: string; block_timestamp: number; ret?: { contractRet?: string }[]; raw_data?: { contract?: { type: string; parameter?: { value?: { amount?: number; to_address?: string } } }[] } }[];
  };
  const mine = tronHex(address);
  const out: Incoming[] = [];
  for (const t of body.data ?? []) {
    const c = t.raw_data?.contract?.[0];
    if (c?.type !== 'TransferContract' || t.ret?.[0]?.contractRet !== 'SUCCESS' || c.parameter?.value?.to_address?.toLowerCase() !== mine) {
      continue;
    }
    out.push({ hash: t.txID, units: BigInt(c.parameter.value.amount ?? 0), time: t.block_timestamp, confirmed: true });
  }
  return out;
}

async function ton(address: string, since: number): Promise<Incoming[]> {
  const url = `https://toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(address)}&limit=50&archival=true`;
  const body = (await getJson(url)) as { result?: { utime: number; transaction_id: { hash: string }; in_msg?: { source?: string; value?: string } }[] };
  return (body.result ?? [])
    .filter((t) => t.in_msg?.source && t.in_msg.value && t.utime * 1000 >= since)
    .map((t) => ({ hash: t.transaction_id.hash, units: BigInt(t.in_msg!.value!), time: t.utime * 1000, confirmed: true }));
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  let last: unknown;
  for (const url of BSC_RPC) {
    try {
      const body = (await getJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })) as { result?: unknown; error?: { message: string } };
      if (body.error) {
        throw new Error(body.error.message);
      }
      return body.result;
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error('BNB Chain RPC failed');
}

async function bscUsdt(address: string, since: number): Promise<Incoming[]> {
  const latest = Number(BigInt((await rpc('eth_blockNumber', [])) as string));
  // Blocks since `since`, from the chain's own pace (blocks have come under a second apart lately).
  const blockTime = async (n: number) => Number(BigInt(((await rpc('eth_getBlockByNumber', ['0x' + n.toString(16), false])) as { timestamp: string }).timestamp)) * 1000;
  const [now, earlier] = [await blockTime(latest), await blockTime(latest - 1000)];
  const perBlock = Math.max((now - earlier) / 1000, 100);
  const first = Math.max(latest - Math.ceil(((now - since) / perBlock) * 1.1) - 20, latest - 20000);
  const topic = '0x' + address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const out: Incoming[] = [];
  const times = new Map<string, number>();
  for (let from = first; from <= latest; from += 800) {
    const to = Math.min(from + 799, latest);
    const logs = (await rpc('eth_getLogs', [{ fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), address: USDT_BSC, topics: [TRANSFER_TOPIC, null, topic] }])) as {
      transactionHash: string; blockNumber: string; data: string;
    }[];
    for (const log of logs) {
      if (!times.has(log.blockNumber)) {
        times.set(log.blockNumber, await blockTime(Number(BigInt(log.blockNumber))));
      }
      const time = times.get(log.blockNumber)!;
      if (time >= since) {
        out.push({ hash: log.transactionHash, units: BigInt(log.data), time, confirmed: true });
      }
    }
  }
  return out;
}

async function utxo(base: string, address: string, since: number): Promise<Incoming[]> {
  const txs = (await getJson(`${base}/address/${address}/txs`)) as { txid: string; status: { confirmed: boolean; block_time?: number }; vout: { scriptpubkey_address?: string; value: number }[] }[];
  const out: Incoming[] = [];
  for (const tx of txs) {
    const units = tx.vout.filter((v) => v.scriptpubkey_address === address).reduce((sum, v) => sum + BigInt(v.value), 0n);
    const time = tx.status.confirmed && tx.status.block_time ? tx.status.block_time * 1000 : undefined;
    if (units > 0n && (time === undefined || time >= since)) {
      out.push({ hash: tx.txid, units, time, confirmed: tx.status.confirmed });
    }
  }
  return out;
}

/** Transfers of the network's coin to address since a time (ms). */
export async function incoming(id: NetworkId, address: string, since: number): Promise<Incoming[]> {
  switch (id) {
    case 'USDT_TRC20':
      return tronTrc20(address, since);
    case 'TRX':
      return tronNative(address, since);
    case 'TON':
      return ton(address, since);
    case 'USDT_BEP20':
      return bscUsdt(address, since);
    case 'BTC':
      return utxo('https://mempool.space/api', address, since);
    case 'LTC':
      return utxo('https://litecoinspace.org/api', address, since);
  }
}

// ----------------------------------------------------------------------------- prices

let priceCache: { at: number; usd: Partial<Record<NetworkId, number>> } | null = null;

/** The coin's price in USD (cached a minute): CoinGecko, else Kraken. */
export async function usdPrice(id: NetworkId): Promise<number> {
  const network = NETWORKS[id];
  if (!network.coingecko) {
    return 1; // a stablecoin
  }
  if (priceCache && Date.now() - priceCache.at < 60_000 && priceCache.usd[id]) {
    return priceCache.usd[id]!;
  }
  const usd: Partial<Record<NetworkId, number>> = {};
  const all = Object.values(NETWORKS).filter((n) => n.coingecko);
  try {
    const ids = all.map((n) => n.coingecko).join(',');
    const body = (await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`)) as Record<string, { usd?: number }>;
    for (const n of all) {
      const price = body[n.coingecko!]?.usd;
      if (price && price > 0) {
        usd[n.id] = price;
      }
    }
  } catch {
    // CoinGecko busy: Kraken below
  }
  if (!usd[id] && network.kraken) {
    const body = (await getJson(`https://api.kraken.com/0/public/Ticker?pair=${network.kraken}`)) as { result?: Record<string, { c?: string[] }> };
    const first = body.result && Object.values(body.result)[0];
    const price = first?.c?.[0] ? Number(first.c[0]) : 0;
    if (price > 0) {
      usd[id] = price;
    }
  }
  if (!usd[id]) {
    throw new Error(`No price for ${network.asset} right now`);
  }
  priceCache = { at: Date.now(), usd: { ...priceCache?.usd, ...usd } };
  return usd[id]!;
}
