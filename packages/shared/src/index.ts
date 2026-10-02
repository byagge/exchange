export const USDT_MICROS = 1_000_000n;
export const RUB_KOPECKS = 100n;

export type Network = 'TON' | 'TRC20';
export type UserStatus = 'active' | 'banned' | 'frozen';
export type DepositSource = 'onchain' | 'cryptobot';
export type DepositStatus = 'pending' | 'confirming' | 'credited' | 'failed' | 'expired';
export type OrderStatus =
  | 'draft'
  | 'awaiting_funds'
  | 'locked'
  | 'processing'
  | 'awaiting_payout'
  | 'completed'
  | 'cancelled'
  | 'failed';
export type WithdrawalMethod = 'cryptobot' | 'onchain' | 'fiat';
export type WithdrawalStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type LedgerKind = 'available' | 'locked' | 'referral';
export type Pair = 'USDT_RUB';

/** Convert USDT decimal string/number to micros bigint-safe number (integer). */
export function usdtToMicros(amount: string | number): number {
  const n = typeof amount === 'number' ? amount : Number(amount.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid USDT amount');
  return Math.round(n * 1_000_000);
}

export function microsToUsdt(micros: number | bigint): string {
  const v = Number(micros) / 1_000_000;
  return v.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function formatUsdt(micros: number, opts?: { compact?: boolean }): string {
  const v = micros / 1_000_000;
  if (opts?.compact && Math.abs(v) >= 1000) {
    return `${v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} USDT`;
  }
  return `${v.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })} USDT`;
}

export function formatRub(kopecks: number): string {
  const v = kopecks / 100;
  return `${v.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

/** Rate is rubles per 1 USDT, stored as string decimal e.g. "98.01" */
export function calcRubFromUsdt(usdtMicros: number, rate: string): number {
  const rateNum = Number(rate);
  const usdt = usdtMicros / 1_000_000;
  return Math.round(usdt * rateNum * 100);
}

export function calcUsdtFromRub(rubKopecks: number, rate: string): number {
  const rateNum = Number(rate);
  if (rateNum <= 0) throw new Error('Invalid rate');
  const rub = rubKopecks / 100;
  return Math.round((rub / rateNum) * 1_000_000);
}

export function generateReferralCode(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export const LOYALTY_TIERS = [
  { id: 'standard', name: 'Стандарт', minVolumeMicros: 0, label: 'Базовый курс' },
  { id: 'silver', name: 'Серебро', minVolumeMicros: 1_000 * 1_000_000, label: 'Лучший курс' },
  { id: 'gold', name: 'Золото', minVolumeMicros: 5_000 * 1_000_000, label: 'Премиум курс' },
  { id: 'platinum', name: 'Платина', minVolumeMicros: 20_000 * 1_000_000, label: 'VIP курс' },
] as const;

export function resolveLoyaltyTier(volumeMicros: number) {
  let current: (typeof LOYALTY_TIERS)[number] = LOYALTY_TIERS[0];
  for (const tier of LOYALTY_TIERS) {
    if (volumeMicros >= tier.minVolumeMicros) current = tier;
  }
  const idx = LOYALTY_TIERS.findIndex((t) => t.id === current.id);
  const next = LOYALTY_TIERS[idx + 1] ?? null;
  return {
    current,
    next,
    remainingToNext: next ? next.minVolumeMicros - volumeMicros : 0,
  };
}

export * from './schemas';
