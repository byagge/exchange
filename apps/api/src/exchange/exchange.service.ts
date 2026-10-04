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
import type { ProofAttachment } from '../admin/uploads';
import type { ClientMeta } from '../common/client-meta';
import { TelegramService, escHtml } from '../telegram/telegram.service';
import { OrderTopicsService, kop } from '../telegram/order-topics.service';
import { PaymentsService } from './payments.service';

@Injectable()
export class ExchangeService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private tg: TelegramService,
    private topics: OrderTopicsService,
    private payments: PaymentsService,
  ) {}

  private orderLabel(o: { number?: number | null; id: string }) {
    return o.number ? `№${o.number}` : `#${o.id.slice(-6).toUpperCase()}`;
  }

  private async dmClient(userId: string, text: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) await this.tg.sendMessage(user.telegramId, text);
  }

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

  async create(userId: string, body: unknown, meta?: ClientMeta) {
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
    return this.createSell(userId, parsed, settings, meta);
  }

  private async createSell(
    userId: string,
    parsed: ReturnType<typeof createExchangeSchema.parse>,
    settings: Awaited<ReturnType<PrismaService['settings']['findUniqueOrThrow']>>,
    meta?: ClientMeta,
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
        clientIp: meta?.ip ?? null,
        clientDevice: meta?.device ?? null,
        clientUserAgent: meta?.userAgent ?? null,
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

    // Тема в группе операторов + карточка с кнопками (не блокирует ответ клиенту)
    void this.topics.openForOrder(order.id);

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

    const cancelled = await this.prisma.exchangeOrder.update({
      where: { id: orderId },
      data: { status: 'cancelled' },
    });
    await this.topics.post(orderId, '🚫 <b>Клиент отменил заявку.</b> Средства разблокированы.');
    await this.topics.close(orderId);
    return cancelled;
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

    if (parsed.note?.trim()) {
      await this.prisma.exchangeOrder.update({
        where: { id: orderId },
        data: { adminNote: parsed.note.trim() },
      });
    }

    // Единый путь с кнопкой «Отправить платёж» в теме: платёж + сообщение клиенту в личку
    await this.payments.sendPayment(orderId, {
      amountKopecks: payoutKopecks,
      minutes,
      actor: adminId,
      allowOverpay: true,
    });
    return this.prisma.exchangeOrder.findUniqueOrThrow({ where: { id: orderId } });
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

    const done = await this.prisma.exchangeOrder.update({
      where: { id: order.id },
      data: {
        status: 'completed',
        proof: proof || null,
        adminNote: note || null,
        proofFiles: proofFiles?.length ? proofFiles : undefined,
        completedAt: new Date(),
      },
    });

    await this.dmClient(
      order.userId,
      `✅ <b>Заявка ${this.orderLabel(done)} завершена.</b>\nВыплата: <b>${kop(done.payoutAmountKopecks ?? done.toAmountKopecks)} ₽</b>. Спасибо, что пользуетесь сервисом!`,
    );
    await this.topics.post(order.id, '✅ <b>Заявка завершена.</b> Тема закрыта.');
    await this.topics.close(order.id);
    return done;
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
    const failed = await this.prisma.exchangeOrder.update({
      where: { id: orderId },
      data: { status: 'failed', failReason: reason },
    });
    // Невыплаченные платежи больше не актуальны
    await this.prisma.orderPayment.updateMany({
      where: { orderId, status: { in: ['sent', 'proof_requested', 'disputed'] } },
      data: { status: 'cancelled' },
    });
    await this.dmClient(
      order.userId,
      `❌ <b>Заявка ${this.orderLabel(failed)} отменена.</b>\n${reason ? `Причина: ${escHtml(reason)}\n` : ''}Заблокированные USDT возвращены на ваш баланс.`,
    );
    await this.topics.post(orderId, `🚫 <b>Заявка отменена.</b> ${reason ? escHtml(reason) : ''}`.trim());
    await this.topics.close(orderId);
    return failed;
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

    const base = (process.env.API_URL || process.env.WEBAPP_URL || '').replace(/\/$/, '');
    const links = files
      .map((f) => `• <a href="${escHtml(f.url.startsWith('http') ? f.url : base + f.url)}">${escHtml(f.name)}</a>`)
      .join('\n');
    await this.topics.post(
      orderId,
      `📎 <b>Клиент прикрепил файлы</b> (Mini App) — ${files.length} шт.:\n${links}`,
      { withKeyboard: true },
    );

    return updated;
  }
}
