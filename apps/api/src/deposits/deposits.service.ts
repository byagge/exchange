import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { depositCryptoBotSchema, usdtToMicros } from '@exchange/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { QueueService, QUEUES } from '../queue/queue.service';
import { sha256 } from '../common/crypto.util';
import { Network } from '@exchange/db';

@Injectable()
export class DepositsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private queue: QueueService,
  ) {}

  extractCheckId(url: string): string {
    const m =
      url.match(/start=([A-Za-z0-9_\-]+)/i) ||
      url.match(/startapp=([A-Za-z0-9_\-]+)/i) ||
      url.match(/CQ[A-Za-z0-9]+/);
    if (!m) return sha256(url).slice(0, 24);
    return m[1] || m[0];
  }

  async submitCryptoBot(userId: string, body: unknown) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status === 'banned') throw new ForbiddenException('Аккаунт заблокирован');
    if (user.status === 'frozen') throw new ForbiddenException('Аккаунт заморожен');

    const parsed = depositCryptoBotSchema.parse(body);
    const checkUrl = parsed.checkUrl.trim();
    const checkId = this.extractCheckId(checkUrl);

    const existing = await this.prisma.deposit.findUnique({ where: { checkId } });
    if (existing) {
      if (existing.status === 'credited') {
        throw new BadRequestException('Этот чек уже был использован');
      }
      if (existing.status === 'pending' || existing.status === 'confirming') {
        // Re-queue activation if stuck
        await this.queue.enqueue(QUEUES.cryptobot, 'activate_check', {
          depositId: existing.id,
          checkUrl: existing.checkUrl || checkUrl,
          checkId,
          userId,
        });
        return existing;
      }
      if (existing.status === 'failed') {
        // Allow retry once: reset to pending
        const restarted = await this.prisma.deposit.update({
          where: { id: existing.id },
          data: { status: 'pending', error: null, checkUrl },
        });
        await this.queue.enqueue(QUEUES.cryptobot, 'activate_check', {
          depositId: restarted.id,
          checkUrl,
          checkId,
          userId,
        });
        return restarted;
      }
      return existing;
    }

    const deposit = await this.prisma.deposit.create({
      data: {
        userId,
        source: 'cryptobot',
        status: 'pending',
        checkUrl,
        checkId,
      },
    });

    await this.queue.enqueue(QUEUES.cryptobot, 'activate_check', {
      depositId: deposit.id,
      checkUrl,
      checkId,
      userId,
    });

    return deposit;
  }

  async creditOnchain(params: {
    address: string;
    network: Network;
    txHash: string;
    amountMicros: number;
    /** On-chain деньги уже пришли — зачисляем 1:1 даже ниже минимума */
    ignoreMin?: boolean;
  }) {
    if (!(params.amountMicros > 0)) {
      throw new BadRequestException('Сумма должна быть больше 0');
    }
    const wallet = await this.prisma.walletAddress.findUnique({
      where: { network_address: { network: params.network, address: params.address } },
    });
    if (!wallet) throw new NotFoundException('Unknown deposit address');

    const existing = await this.prisma.deposit.findUnique({ where: { txHash: params.txHash } });
    if (existing) return existing;

    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    if (!params.ignoreMin && settings && params.amountMicros < usdtToMicros(settings.minDepositUsdt)) {
      throw new BadRequestException(`Минимум депозита ${settings.minDepositUsdt} USDT`);
    }

    try {
      const deposit = await this.prisma.$transaction(async (tx) => {
        const d = await tx.deposit.create({
          data: {
            userId: wallet.userId,
            source: 'onchain',
            status: 'credited',
            network: params.network,
            walletAddressId: wallet.id,
            amountMicros: BigInt(params.amountMicros),
            txHash: params.txHash,
            creditedAt: new Date(),
          },
        });

        const account = await tx.ledgerAccount.upsert({
          where: { userId_kind: { userId: wallet.userId, kind: 'available' } },
          create: { userId: wallet.userId, kind: 'available', balance: 0n },
          update: {},
        });
        const balanceAfter = account.balance + BigInt(params.amountMicros);
        await tx.ledgerAccount.update({
          where: { id: account.id },
          data: { balance: balanceAfter },
        });
        await tx.ledgerEntry.create({
          data: {
            accountId: account.id,
            amount: BigInt(params.amountMicros),
            balanceAfter,
            reason: 'deposit_onchain',
            referenceType: 'deposit',
            referenceId: d.id,
          },
        });
        return d;
      });

      await this.queue.enqueue(QUEUES.notify, 'deposit_credited', {
        userId: wallet.userId,
        amountMicros: params.amountMicros,
        depositId: deposit.id,
      });

      await this.queue.enqueue(QUEUES.sweeps, 'maybe_sweep', {
        walletAddressId: wallet.id,
      });

      return deposit;
    } catch (e: any) {
      // Unique txHash race → return existing
      const again = await this.prisma.deposit.findUnique({ where: { txHash: params.txHash } });
      if (again) return again;
      throw e;
    }
  }

  /** Симуляция только при явном ALLOW_DEPOSIT_SIMULATE=true */
  async simulate(userId: string, amountUsdt: number, network: Network = 'TRC20') {
    if (process.env.ALLOW_DEPOSIT_SIMULATE !== 'true') {
      throw new ForbiddenException('Симуляция депозита отключена');
    }
    if (amountUsdt > 100 || amountUsdt <= 0) {
      throw new BadRequestException('Симуляция: 0–100 USDT');
    }
    const wallets = await this.prisma.walletAddress.findMany({ where: { userId } });
    const wallet = wallets.find((w) => w.network === network) || wallets[0];
    if (!wallet) throw new BadRequestException('Сначала получите адрес кошелька');
    const txHash = `sim_${Date.now()}_${sha256(userId).slice(0, 8)}`;
    return this.creditOnchain({
      address: wallet.address,
      network: wallet.network,
      txHash,
      amountMicros: usdtToMicros(amountUsdt),
    });
  }

  async listMine(userId: string) {
    return this.prisma.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
