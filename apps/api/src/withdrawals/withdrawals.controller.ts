import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WithdrawalsService } from './withdrawals.service';
import { CurrentUser, JwtAuthGuard, type JwtPayload } from '../auth/guards';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class WithdrawalsController {
  constructor(
    private withdrawals: WithdrawalsService,
    private ledger: LedgerService,
    private prisma: PrismaService,
  ) {}

  @Get('balance')
  @UseGuards(JwtAuthGuard)
  async balance(@CurrentUser() user: JwtPayload) {
    const balances = await this.ledger.getBalances(user.sub);
    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    return {
      ...balances,
      rate: settings?.usdtRubRate ?? '98.01',
      currency: 'USDT',
    };
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  async history(@CurrentUser() user: JwtPayload) {
    const [deposits, orders, withdrawals] = await Promise.all([
      this.prisma.deposit.findMany({
        where: { userId: user.sub },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.exchangeOrder.findMany({
        where: { userId: user.sub },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.withdrawal.findMany({
        where: { userId: user.sub },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    const items = [
      ...deposits.map((d) => ({
        id: d.id,
        type: 'deposit' as const,
        status: d.status,
        amountMicros: Number(d.amountMicros),
        meta: {
          source: d.source,
          network: d.network,
          txHash: d.txHash,
          checkUrl: d.checkUrl,
          error: d.error,
          creditedAt: d.creditedAt,
        },
        createdAt: d.createdAt,
      })),
      ...orders.map((o) => ({
        id: o.id,
        type: 'exchange' as const,
        status: o.status,
        amountMicros: Number(o.fromAmountMicros),
        meta: {
          pair: o.pair,
          toAmountKopecks: Number(o.toAmountKopecks),
          payoutAmountKopecks:
            o.payoutAmountKopecks != null ? Number(o.payoutAmountKopecks) : null,
          rate: o.rate,
          method: o.method,
          feeMicros: Number(o.feeMicros),
          requisites: o.requisites,
          failReason: o.failReason,
          completedAt: o.completedAt,
          proof: o.proof,
          adminNote: o.adminNote,
          proofFiles: o.proofFiles,
          clientProofFiles: o.clientProofFiles,
          clientProofAt: o.clientProofAt,
          payoutDeadline: o.payoutDeadline,
          dispatchedAt: o.dispatchedAt,
        },
        createdAt: o.createdAt,
      })),
      ...withdrawals.map((w) => ({
        id: w.id,
        type: 'withdrawal' as const,
        status: w.status,
        amountMicros: Number(w.amountMicros),
        meta: {
          method: w.method,
          destination: w.destination,
          network: w.network,
          feeMicros: Number(w.feeMicros),
          failReason: w.error,
          completedAt: w.completedAt,
        },
        createdAt: w.createdAt,
      })),
    ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

    return { items };
  }

  @Get('withdrawals')
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: JwtPayload) {
    return this.withdrawals.listMine(user.sub);
  }

  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('withdrawals')
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.withdrawals.create(user.sub, body);
  }

  @Post('referral/withdraw')
  @UseGuards(JwtAuthGuard)
  async referralWithdraw(@CurrentUser() user: JwtPayload) {
    const bal = await this.ledger.getBalances(user.sub);
    if (bal.referral <= 0) {
      return { ok: false, message: 'Нет реферального баланса' };
    }
    await this.ledger.transferReferralToAvailable(user.sub, bal.referral);
    return { ok: true, amountMicros: bal.referral };
  }
}
