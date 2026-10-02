import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { createWithdrawSchema, usdtToMicros } from '@exchange/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { QueueService, QUEUES } from '../queue/queue.service';

@Injectable()
export class WithdrawalsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private queue: QueueService,
  ) {}

  async create(userId: string, body: unknown) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status === 'banned') throw new ForbiddenException('Аккаунт заблокирован');
    if (user.withdrawFrozen || user.status === 'frozen') {
      throw new ForbiddenException('Вывод временно заморожен');
    }

    const settings = await this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    const parsed = createWithdrawSchema.parse(body);
    const amount =
      typeof parsed.amountUsdt === 'number' ? parsed.amountUsdt : Number(parsed.amountUsdt);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Некорректная сумма');
    const minWd =
      user.minWithdrawUsdt != null ? user.minWithdrawUsdt : settings.minWithdrawUsdt;
    if (amount < minWd) {
      throw new BadRequestException(`Минимум ${minWd} USDT`);
    }
    if (user.maxWithdrawUsdt && amount > user.maxWithdrawUsdt) {
      throw new BadRequestException('Превышен лимит вывода');
    }

    const feeMicros = usdtToMicros(settings.withdrawFeeUsdt);
    const amountMicros = usdtToMicros(amount);
    const total = amountMicros + feeMicros;
    const balances = await this.ledger.getBalances(userId);
    if (balances.available < total) throw new BadRequestException('Недостаточно средств');

    let destination = '';
    if (parsed.method === 'cryptobot') {
      destination = parsed.username || (user.username ? `@${user.username}` : '');
      if (!destination) throw new BadRequestException('Укажите Telegram username');
      if (!destination.startsWith('@')) destination = `@${destination}`;
    } else {
      if (!parsed.address || !parsed.network) {
        throw new BadRequestException('Укажите адрес и сеть');
      }
      destination = parsed.address;
    }

    const withdrawal = await this.prisma.withdrawal.create({
      data: {
        userId,
        method: parsed.method,
        status: 'pending',
        amountMicros: BigInt(amountMicros),
        feeMicros: BigInt(feeMicros),
        destination,
        network: parsed.network,
      },
    });

    await this.ledger.lock(userId, total, 'withdraw_lock', withdrawal.id);

    await this.queue.enqueue(
      QUEUES.payouts,
      parsed.method === 'cryptobot' ? 'cryptobot_payout' : 'onchain_payout',
      { withdrawalId: withdrawal.id },
    );

    return withdrawal;
  }

  async completeCryptoBot(withdrawalId: string, checkUrl: string) {
    const w = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    if (w.status === 'completed') return w;
    const total = Number(w.amountMicros) + Number(w.feeMicros);
    await this.ledger.burnLocked(w.userId, total, 'withdraw_complete', w.id);

    if (w.orderId) {
      await this.prisma.exchangeOrder.update({
        where: { id: w.orderId },
        data: { status: 'completed', completedAt: new Date(), proof: checkUrl },
      });
      await this.prisma.user.update({
        where: { id: w.userId },
        data: {
          loyaltyVolume: { increment: w.amountMicros },
          tradeCount: { increment: 1 },
        },
      });
    }

    return this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'completed',
        checkUrl,
        completedAt: new Date(),
      },
    });
  }

  async fail(withdrawalId: string, error: string) {
    const w = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    if (w.status === 'completed' || w.status === 'failed') return w;
    const total = Number(w.amountMicros) + Number(w.feeMicros);
    await this.ledger.unlock(w.userId, total, 'withdraw_fail', w.id);
    if (w.orderId) {
      await this.prisma.exchangeOrder.update({
        where: { id: w.orderId },
        data: { status: 'failed', failReason: error },
      });
    }
    return this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'failed', error },
    });
  }

  async listMine(userId: string) {
    return this.prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
