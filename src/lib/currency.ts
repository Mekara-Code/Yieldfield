import type { Prisma } from '../generated/prisma/client';

/**
 * A player's BLOOM and gems, changed only here (inside a transaction) and written in the books
 * (CurrencyLog) with why. A spend that would go below zero changes nothing.
 */

export type Currency = 'bloom' | 'gems';

type Data = Record<string, string | number | boolean>;

export async function addCurrency(tx: Prisma.TransactionClient, userId: string, currency: Currency, amount: number, reason: string, data?: Data) {
  const user = await tx.user.update({ where: { id: userId }, data: { [currency]: { increment: amount } }, select: { bloom: true, gems: true } });
  await tx.currencyLog.create({ data: { userId, currency, change: amount, balance: user[currency], reason, data: data ?? undefined } });
  return user;
}

/** Takes amount if there's that much; null (and nothing changed) if not. */
export async function spendCurrency(tx: Prisma.TransactionClient, userId: string, currency: Currency, amount: number, reason: string, data?: Data) {
  const taken = await tx.user.updateMany({ where: { id: userId, [currency]: { gte: amount } }, data: { [currency]: { decrement: amount } } });
  if (taken.count === 0) {
    return null;
  }
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { bloom: true, gems: true } });
  await tx.currencyLog.create({ data: { userId, currency, change: -amount, balance: user[currency], reason, data: data ?? undefined } });
  return user;
}

/** Adds (positive) or takes (negative, if there's that much) in one go. */
export async function changeCurrency(tx: Prisma.TransactionClient, userId: string, currency: Currency, change: number, reason: string, data?: Data) {
  if (change >= 0) {
    return addCurrency(tx, userId, currency, change, reason, data);
  }
  return spendCurrency(tx, userId, currency, -change, reason, data);
}
