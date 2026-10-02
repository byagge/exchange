import { BadRequestException, Injectable } from '@nestjs/common';
import { LedgerKind, Prisma } from '@exchange/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  async ensureAccounts(userId: string) {
    const kinds: LedgerKind[] = ['available', 'locked', 'referral'];
    await this.prisma.$transaction(
      kinds.map((kind) =>
        this.prisma.ledgerAccount.upsert({
          where: { userId_kind: { userId, kind } },
          create: { userId, kind, balance: 0n },
          update: {},
        }),
      ),
    );
  }

  async getBalances(userId: string) {
    await this.ensureAccounts(userId);
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { userId } });
    const map = Object.fromEntries(accounts.map((a) => [a.kind, Number(a.balance)]));
    return {
      available: map.available || 0,
      locked: map.locked || 0,
      referral: map.referral || 0,
      total: (map.available || 0) + (map.locked || 0),
    };
  }

  private async mutate(
    tx: Prisma.TransactionClient,
    userId: string,
    kind: LedgerKind,
    signedAmount: bigint,
    reason: string,
    reference?: { type: string; id: string; meta?: Prisma.InputJsonValue },
  ) {
    if (signedAmount === 0n) throw new BadRequestException('Amount must be non-zero');

    // Re-read inside transaction to reduce race window (SQLite serializes writers)
    const account = await tx.ledgerAccount.findUnique({
      where: { userId_kind: { userId, kind } },
    });
    if (!account) throw new BadRequestException(`Ledger ${kind} missing`);

    const balanceAfter = account.balance + signedAmount;
    if (balanceAfter < 0n) throw new BadRequestException('Недостаточно средств');

    // Optimistic guard: update only if balance unchanged
    const updated = await tx.ledgerAccount.updateMany({
      where: { id: account.id, balance: account.balance },
      data: { balance: balanceAfter },
    });
    if (updated.count !== 1) {
      throw new BadRequestException('Конфликт баланса, повторите операцию');
    }

    await tx.ledgerEntry.create({
      data: {
        accountId: account.id,
        amount: signedAmount,
        balanceAfter,
        reason,
        referenceType: reference?.type,
        referenceId: reference?.id,
        meta: reference?.meta,
      },
    });
    return balanceAfter;
  }

  async credit(
    userId: string,
    kind: LedgerKind,
    amountMicros: number | bigint,
    reason: string,
    reference?: { type: string; id: string; meta?: Prisma.InputJsonValue },
    tx?: Prisma.TransactionClient,
  ) {
    const amount = BigInt(amountMicros);
    if (amount <= 0n) throw new BadRequestException('Amount must be positive');
    if (tx) return this.mutate(tx, userId, kind, amount, reason, reference);
    await this.ensureAccounts(userId);
    return this.prisma.$transaction(
      (inner) => this.mutate(inner, userId, kind, amount, reason, reference),
      { timeout: 15000 },
    );
  }

  async debit(
    userId: string,
    kind: LedgerKind,
    amountMicros: number | bigint,
    reason: string,
    reference?: { type: string; id: string; meta?: Prisma.InputJsonValue },
    tx?: Prisma.TransactionClient,
  ) {
    const amount = BigInt(amountMicros);
    if (amount <= 0n) throw new BadRequestException('Amount must be positive');
    if (tx) return this.mutate(tx, userId, kind, -amount, reason, reference);
    await this.ensureAccounts(userId);
    return this.prisma.$transaction(
      (inner) => this.mutate(inner, userId, kind, -amount, reason, reference),
      { timeout: 15000 },
    );
  }

  async lock(userId: string, amountMicros: number | bigint, reason: string, refId: string) {
    const amount = BigInt(amountMicros);
    await this.ensureAccounts(userId);
    return this.prisma.$transaction(
      async (tx) => {
        await this.mutate(tx, userId, 'available', -amount, reason, { type: 'lock', id: refId });
        await this.mutate(tx, userId, 'locked', amount, reason, { type: 'lock', id: refId });
      },
      { timeout: 15000 },
    );
  }

  async unlock(userId: string, amountMicros: number | bigint, reason: string, refId: string) {
    const amount = BigInt(amountMicros);
    await this.ensureAccounts(userId);
    return this.prisma.$transaction(
      async (tx) => {
        await this.mutate(tx, userId, 'locked', -amount, reason, { type: 'unlock', id: refId });
        await this.mutate(tx, userId, 'available', amount, reason, { type: 'unlock', id: refId });
      },
      { timeout: 15000 },
    );
  }

  async burnLocked(userId: string, amountMicros: number | bigint, reason: string, refId: string) {
    return this.debit(userId, 'locked', amountMicros, reason, { type: 'burn', id: refId });
  }

  async transferReferralToAvailable(userId: string, amountMicros: number) {
    await this.ensureAccounts(userId);
    return this.prisma.$transaction(
      async (tx) => {
        await this.mutate(tx, userId, 'referral', -BigInt(amountMicros), 'referral_withdraw', {
          type: 'referral',
          id: userId,
        });
        await this.mutate(tx, userId, 'available', BigInt(amountMicros), 'referral_withdraw', {
          type: 'referral',
          id: userId,
        });
      },
      { timeout: 15000 },
    );
  }
}
