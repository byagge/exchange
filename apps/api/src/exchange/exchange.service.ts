import {
  BadRequestException,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import {
  calcRubFromUsdt,
  createExchangeSchema,
  dispatchOrderSchema,
  usdtToMicros,
} from '@exchange/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { QueueService, QUEUES } from '../queue/queue.service';
import type { ProofAttachment } from '../admin/uploads';

@Injectable()
export class ExchangeService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private queue: QueueService,
  ) {}

  /** Только USDT → RUB */
  async quote(amountUsdt: number) {
    const settings = await this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
      throw new BadRequestException('Некорректная сумма');
    }

    const micros = usdtToMicros(amountUsdt);
    const feeMicros = Math.round(micros * (settings.exchangeFeePercent / 100));
    const net = micros - feeMicros;
    const rub = calcRubFromUsdt(net, settings.usdtRubRate);
    return {
      direction: 'sell' as const,
      pair: 'USDT_RUB',
      rate: settings.usdtRubRate,
      fromAmountMicros: micros,
      feeMicros,
      netMicros: net,
      toAmountKopecks: rub,
      feePercent: settings.exchangeFeePercent,
      defaultPayoutMinutes: settings.defaultPayoutMinutes,
    };
  }

  async create(userId: string, body: unknown) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status === 'banned') throw new ForbiddenException('Аккаунт заблокирован');
    if (user.status === 'frozen' || user.withdrawFrozen) {
      throw new ForbiddenException('Операции временно ограничены');
    }

    const settings = await this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    if (settings.maintenanceMode) {
      throw new BadRequestException('Сервис на обслуживании');
    }

    // Явно блокируем устаревший RUB→USDT
    if (
      body &&
      typeof body === 'object' &&
      (('direction' in body && (body as any).direction === 'buy') ||
        ('pair' in body && (body as any).pair === 'RUB_USDT') ||
        ('amountRub' in body && (body as any).amountRub != null))
    ) {
      throw new BadRequestException('Обмен RUB → USDT отключён. Доступен только USDT → RUB');
    }

    const parsed = createExchangeSchema.parse(body);
    return this.createSell(userId, parsed, settings);
  }

  private async createSell(
    userId: string,
    parsed: ReturnType<typeof createExchangeSchema.parse>,
    settings: Awaited<ReturnType<PrismaService['settings']['findUniqueOrThrow']>>,
  ) {
    const amount =
      typeof parsed.amountUsdt === 'number'
        ? parsed.amountUsdt
        : Number(parsed.amountUsdt);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Некорректная сумма');
    }
    if (amount < settings.minWithdrawUsdt) {
      throw new BadRequestException(`Минимум ${settings.minWithdrawUsdt} USDT`);
    }

    const req = parsed.requisites;
    if (!req.bank?.trim() || !req.fio?.trim()) {
      throw new BadRequestException('Укажите банк и ФИО получателя');
    }

    const quote = await this.quote(amount);
    const balances = await this.ledger.getBalances(userId);
    if (balances.available < quote.fromAmountMicros) {
      throw new BadRequestException('Недостаточно средств на балансе');
    }

    const order = await this.prisma.exchangeOrder.create({
      data: {
        userId,
        pair: 'USDT_RUB',
        status: 'locked',
        fromAmountMicros: BigInt(quote.fromAmountMicros),
        toAmountKopecks: BigInt(quote.toAmountKopecks),
        rate: quote.rate,
        feeMicros: BigInt(quote.feeMicros),
        method: 'fiat',
        requisites: {
          type: req.type,
          phone: req.type === 'sbp' ? req.phone : undefined,
          card: req.type === 'card' ? req.card : undefined,
          bank: req.bank.trim(),
          fio: req.fio.trim(),
          comment: req.comment?.trim() || undefined,
        } as any,
      },
    });

    await this.ledger.lock(
      userId,
      quote.fromAmountMicros,
      'exchange_lock',
      order.id,
    );

    await this.prisma.exchangeOrder.update({
      where: { id: order.id },
      data: { status: 'awaiting_payout' },
    });

    await this.queue.enqueue(QUEUES.notify, 'admin_payout_needed', {
      orderId: order.id,
      userId,
      amountKopecks: quote.toAmountKopecks,
      direction: 'sell',
    });

    return this.prisma.exchangeOrder.findUniqueOrThrow({ where: { id: order.id } });
  }

  async listMine(userId: string) {
    return this.prisma.exchangeOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { withdrawal: true },
    });
  }

  async cancel(userId: string, orderId: string) {
    const order = await this.prisma.exchangeOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (order.userId !== userId) throw new ForbiddenException();
    if (!['locked', 'awaiting_payout'].includes(order.status)) {
      throw new BadRequestException('Заявку нельзя отменить');
    }
    if (order.dispatchedAt) {
      throw new BadRequestException('Заявка уже направлена оператором');
    }

    await this.ledger.unlock(
      userId,
      Number(order.fromAmountMicros),
      'exchange_cancel',
      order.id,
    );

    return this.prisma.exchangeOrder.update({
      where: { id: orderId },
      data: { status: 'cancelled' },
    });
  }

  /**
   * Оператор направляет клиенту сумму платежа и таймер.
   * После истечения таймера клиент может прикрепить видео.
   */
  async dispatchByAdmin(orderId: string, adminId: string, body: unknown) {
    const parsed = dispatchOrderSchema.parse(body);
    const order = await this.prisma.exchangeOrder.findUniqueOrThrow({ where: { id: orderId } });

    if (order.pair === 'RUB_USDT') {
      throw new BadRequestException('Обмен RUB → USDT отключён');
    }
    if (!['awaiting_payout', 'processing'].includes(order.status)) {
      throw new BadRequestException('Неверный статус заявки');
    }

    const settings = await this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    const minutesRaw =
      typeof parsed.timerMinutes === 'number'
        ? parsed.timerMinutes
        : Number(parsed.timerMinutes);
    const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0
      ? Math.min(Math.round(minutesRaw), 24 * 60)
      : settings.defaultPayoutMinutes;

    let payoutKopecks = Number(order.toAmountKopecks);
    if (parsed.amountRub != null && parsed.amountRub !== '') {
      const rub =
        typeof parsed.amountRub === 'number'
          ? parsed.amountRub
          : Number(String(parsed.amountRub).replace(',', '.'));
      if (!Number.isFinite(rub) || rub <= 0) {
        throw new BadRequestException('Некорректная сумма платежа');
      }
      payoutKopecks = Math.round(rub * 100);
    }

    const deadline = new Date(Date.now() + minutes * 60_000);

    const updated = await this.prisma.exchangeOrder.update({
      where: { id: orderId },
      data: {
        status: 'processing',
        payoutAmountKopecks: BigInt(payoutKopecks),
        payoutDeadline: deadline,
        dispatchedAt: new Date(),
        adminNote: parsed.note?.trim() || order.adminNote,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'dispatch_order',
        entityType: 'ExchangeOrder',
        entityId: orderId,
        meta: { payoutKopecks, minutes, deadline: deadline.toISOString() },
      },
    });

    await this.queue.enqueue(QUEUES.notify, 'payout_dispatched', {
      orderId,
      userId: order.userId,
      amountKopecks: payoutKopecks,
      deadline: deadline.toISOString(),
      minutes,
    });

    return updated;
  }

  async fulfillByAdmin(
    orderId: string,
    adminId: string,
    proof?: string,
    note?: string,
    proofFiles?: ProofAttachment[],
  ) {
    const order = await this.prisma.exchangeOrder.findUniqueOrThrow({ where: { id: orderId } });

    if (order.pair === 'RUB_USDT') {
      throw new BadRequestException('Обмен RUB → USDT отключён. Закройте заявку отклонением.');
    }
    return this.fulfillSell(order, adminId, proof, note, proofFiles);
  }

  private async fulfillSell(
    order: {
      id: string;
      userId: string;
      status: string;
      fromAmountMicros: bigint;
      toAmountKopecks: bigint;
    },
    adminId: string,
    proof?: string,
    note?: string,
    proofFiles?: ProofAttachment[],
  ) {
    if (!['awaiting_payout', 'locked', 'processing'].includes(order.status)) {
      throw new BadRequestException('Неверный статус заявки');
    }

    await this.ledger.burnLocked(
      order.userId,
      Number(order.fromAmountMicros),
      'exchange_complete',
      order.id,
    );

    await this.applyLoyaltyAndReferral(order);

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'fulfill_order',
        entityType: 'ExchangeOrder',
        entityId: order.id,
        meta: { proof, note, proofFiles, direction: 'sell' },
      },
    });

    return this.prisma.exchangeOrder.update({
      where: { id: order.id },
      data: {
        status: 'completed',
        proof: proof || null,
        adminNote: note || null,
        proofFiles: proofFiles?.length ? proofFiles : undefined,
        completedAt: new Date(),
      },
    });
  }

  private async applyLoyaltyAndReferral(order: {
    id: string;
    userId: string;
    fromAmountMicros: bigint;
    toAmountKopecks: bigint;
  }) {
    await this.prisma.user.update({
      where: { id: order.userId },
      data: {
        loyaltyVolume: { increment: order.fromAmountMicros },
        tradeCount: { increment: 1 },
        rubTurnover: { increment: order.toAmountKopecks },
      },
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: order.userId } });
    const settings = await this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    if (user.referredById && settings.referralPercent > 0) {
      const bonus = Math.round(
        Number(order.fromAmountMicros) * (settings.referralPercent / 100),
      );
      if (bonus > 0) {
        await this.ledger.credit(user.referredById, 'referral', bonus, 'referral_bonus', {
          type: 'order',
          id: order.id,
        });
        await this.prisma.referralEarning.create({
          data: {
            earnerId: user.referredById,
            sourceUserId: user.id,
            amountMicros: BigInt(bonus),
            orderId: order.id,
          },
        });
      }
    }
  }

  async rejectByAdmin(orderId: string, adminId: string, reason: string) {
    const order = await this.prisma.exchangeOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (['completed', 'cancelled', 'failed'].includes(order.status)) {
      throw new BadRequestException('Неверный статус');
    }

    if (order.pair !== 'RUB_USDT' && ['locked', 'awaiting_payout', 'processing'].includes(order.status)) {
      await this.ledger.unlock(
        order.userId,
        Number(order.fromAmountMicros),
        'exchange_reject',
        order.id,
      );
    }

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'reject_order',
        entityType: 'ExchangeOrder',
        entityId: orderId,
        meta: { reason },
      },
    });
    return this.prisma.exchangeOrder.update({
      where: { id: orderId },
      data: { status: 'failed', failReason: reason },
    });
  }

  /** Клиент прикрепляет видео после истечения таймера */
  async attachClientProof(
    userId: string,
    orderId: string,
    files: ProofAttachment[],
  ) {
    if (!files.length) throw new BadRequestException('Прикрепите видео или файл');

    const order = await this.prisma.exchangeOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (order.userId !== userId) throw new ForbiddenException();
    if (!['processing', 'awaiting_payout'].includes(order.status)) {
      throw new BadRequestException('Заявка уже закрыта');
    }
    if (!order.payoutDeadline) {
      throw new BadRequestException('Оператор ещё не направил таймер выплаты');
    }
    if (new Date() < order.payoutDeadline) {
      throw new BadRequestException('Видео можно прикрепить только после истечения таймера');
    }

    const prev = Array.isArray(order.clientProofFiles)
      ? (order.clientProofFiles as ProofAttachment[])
      : [];
    const merged = [...prev, ...files].slice(0, 5);

    const updated = await this.prisma.exchangeOrder.update({
      where: { id: orderId },
      data: {
        clientProofFiles: merged as any,
        clientProofAt: new Date(),
      },
    });

    await this.queue.enqueue(QUEUES.notify, 'client_proof_uploaded', {
      orderId,
      userId,
      filesCount: files.length,
    });

    return updated;
  }
}
