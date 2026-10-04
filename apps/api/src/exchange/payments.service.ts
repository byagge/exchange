import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService, escHtml } from '../telegram/telegram.service';
import { OrderTopicsService, kop } from '../telegram/order-topics.service';

const TZ = () => process.env.TZ || 'Europe/Moscow';
const hhmm = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ() });

function leftText(deadline: Date, now = new Date()) {
  const ms = deadline.getTime() - now.getTime();
  if (ms <= 0) return null;
  const min = Math.ceil(ms / 60_000);
  if (min >= 60) return `${Math.floor(min / 60)} ч ${String(min % 60).padStart(2, '0')} мин`;
  return `${min} мин`;
}

export type ActionResult = { ok: boolean; alert?: string };

/**
 * Платежи оператора клиенту. По заявке их может быть несколько (основной + «Доп. платёж»).
 * Клиент видит платёж в личке бота (сумма + таймер) и жмёт «Пришло / Не пришло».
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  private ticking = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private prisma: PrismaService,
    private tg: TelegramService,
    private topics: OrderTopicsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_PAYMENT_TICKER === 'true') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
  }

  // ───────────────────────── отправка платежа ─────────────────────────

  async sendPayment(
    orderId: string,
    params: { amountKopecks: number; minutes: number; actor: string; allowOverpay?: boolean },
  ) {
    const order = await this.prisma.exchangeOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { user: true, payments: true },
    });
    if (order.pair === 'RUB_USDT') throw new BadRequestException('Обмен RUB → USDT отключён');
    if (!['awaiting_payout', 'processing'].includes(order.status)) {
      throw new BadRequestException('Неверный статус заявки');
    }
    if (!Number.isFinite(params.amountKopecks) || params.amountKopecks <= 0) {
      throw new BadRequestException('Некорректная сумма платежа');
    }
    const minutes = Math.min(Math.max(Math.round(params.minutes), 1), 24 * 60);

    const sentBefore = this.topics.sentTotal(order.payments as any);
    const target = Number(order.toAmountKopecks);
    if (!params.allowOverpay && sentBefore + params.amountKopecks > target + 100) {
      throw new BadRequestException(
        `Сумма платежей превысит выплату по заявке: осталось ${kop(Math.max(0, target - sentBefore))} ₽`,
      );
    }

    const seq = (order.payments.reduce((m, p) => Math.max(m, p.seq), 0) || 0) + 1;
    const deadline = new Date(Date.now() + minutes * 60_000);

    const payment = await this.prisma.orderPayment.create({
      data: {
        orderId,
        seq,
        amountKopecks: BigInt(params.amountKopecks),
        timerMinutes: minutes,
        deadline,
        sentBy: params.actor,
      },
    });

    await this.prisma.exchangeOrder.update({
      where: { id: orderId },
      data: {
        status: 'processing',
        payoutAmountKopecks: BigInt(sentBefore + params.amountKopecks),
        payoutDeadline: deadline,
        dispatchedAt: order.dispatchedAt ?? new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        adminId: params.actor,
        action: 'send_payment',
        entityType: 'ExchangeOrder',
        entityId: orderId,
        meta: { paymentId: payment.id, seq, amountKopecks: params.amountKopecks, minutes },
      },
    });

    // Клиенту в личку: сумма + таймер + кнопки
    const text = this.clientText(order, payment, new Date());
    const sent = await this.tg.sendMessage(order.user.telegramId, text, {
      reply_markup: this.clientKeyboard(payment.id, true),
    });
    if (sent.ok) {
      await this.prisma.orderPayment.update({
        where: { id: payment.id },
        data: { clientChatId: order.user.telegramId.toString(), clientMessageId: sent.result.message_id },
      });
    } else {
      this.logger.warn(`client DM failed (${sent.error}) for payment ${payment.id}`);
    }

    await this.topics.post(
      orderId,
      `💸 <b>Платёж №${seq}</b> направлен клиенту: <b>${kop(params.amountKopecks)} ₽</b>, таймер ${minutes} мин (до ${hhmm(deadline)}).` +
        (sent.ok ? '' : `\n⚠️ Клиенту не удалось доставить сообщение в личку: ${escHtml(sent.error)}`),
    );
    await this.topics.refresh(orderId);
    return payment;
  }

  // ───────────────────────── тексты клиента ─────────────────────────

  private clientText(
    order: { number: number | null; id: string; requisites: any },
    p: { seq: number; amountKopecks: bigint; deadline: Date; status: string },
    now: Date,
  ) {
    const req = (order.requisites || {}) as Record<string, any>;
    const head = order.number ? `№${order.number}` : `#${order.id.slice(-6).toUpperCase()}`;
    const where =
      req.type === 'card'
        ? `Карта: <code>${escHtml(req.card || '—')}</code>`
        : `Телефон: <code>${escHtml(req.phone || '—')}</code>`;
    const lines = [
      `💸 <b>Платёж №${p.seq}</b> · заявка ${head}`,
      '',
      `Сумма: <b>${kop(p.amountKopecks)} ₽</b>`,
      where,
      `Получатель: ${escHtml(req.fio || '—')}`,
      `Банк: ${escHtml(req.bank || '—')}`,
      '',
    ];
    if (p.status === 'confirmed') {
      lines.push('✅ <b>Вы подтвердили получение.</b> Спасибо!');
      return lines.join('\n');
    }
    const left = leftText(p.deadline, now);
    if (left) {
      lines.push(`⏱ Осталось: <b>${left}</b> (до ${hhmm(p.deadline)})`);
      lines.push('Проверьте поступление в банковском приложении и нажмите кнопку ниже.');
    } else {
      lines.push('⏱ <b>Таймер истёк.</b>');
      lines.push('Деньги пришли — нажмите «Пришло». Не пришли — нажмите «Не пришло» и отправьте видео.');
    }
    if (p.status === 'proof_requested') lines.push('\n🎥 Ждём ваше видео — отправьте его сюда в чат.');
    if (p.status === 'disputed') lines.push('\n🎥 Видео получено, оператор проверяет платёж.');
    return lines.join('\n');
  }

  private clientKeyboard(paymentId: string, withNo: boolean) {
    const row: any[] = [{ text: '✅ Пришло', callback_data: `p:ok:${paymentId}`, style: 'success' }];
    if (withNo) row.push({ text: '❌ Не пришло', callback_data: `p:no:${paymentId}`, style: 'danger' });
    return { inline_keyboard: [row] };
  }

  // ───────────────────────── действия клиента ─────────────────────────

  private async loadOwned(paymentId: string, telegramId: string) {
    const payment = await this.prisma.orderPayment.findUnique({
      where: { id: paymentId },
      include: { order: { include: { user: true } } },
    });
    if (!payment) throw new BadRequestException('Платёж не найден');
    if (payment.order.user.telegramId.toString() !== telegramId) throw new ForbiddenException();
    return payment;
  }

  async clientConfirm(paymentId: string, telegramId: string): Promise<ActionResult> {
    const p = await this.loadOwned(paymentId, telegramId);
    if (p.status === 'confirmed') return { ok: true, alert: 'Уже подтверждено' };
    if (p.status === 'cancelled') return { ok: false, alert: 'Платёж отменён' };
    if (['completed', 'cancelled', 'failed'].includes(p.order.status)) {
      return { ok: false, alert: 'Заявка уже закрыта' };
    }

    const updated = await this.prisma.orderPayment.update({
      where: { id: p.id },
      data: { status: 'confirmed', confirmedAt: new Date() },
    });
    await this.editClientMessage(p.order, updated);

    const all = await this.prisma.orderPayment.findMany({ where: { orderId: p.orderId } });
    const live = all.filter((x) => x.status !== 'cancelled');
    const allConfirmed = live.length > 0 && live.every((x) => x.status === 'confirmed');
    const covered = this.topics.sentTotal(all as any) >= Number(p.order.toAmountKopecks) - 100;

    let text = `✅ <b>Клиент подтвердил платёж №${p.seq}</b> на ${kop(p.amountKopecks)} ₽.`;
    if (allConfirmed && covered) {
      text += `\n\n🏁 Все платежи (${kop(this.topics.sentTotal(all as any))} ₽) подтверждены — можно завершать заявку.`;
    } else if (allConfirmed) {
      text += `\n\nОсталось направить: <b>${kop(this.topics.remainingKopecks(p.order, all as any))} ₽</b> («Доп. платёж»).`;
    }
    await this.topics.post(p.orderId, text, { withKeyboard: true });
    await this.topics.refresh(p.orderId);
    return { ok: true, alert: 'Спасибо, платёж подтверждён' };
  }

  async clientNotReceived(paymentId: string, telegramId: string): Promise<ActionResult> {
    const p = await this.loadOwned(paymentId, telegramId);
    if (p.status === 'confirmed') return { ok: false, alert: 'Вы уже подтвердили этот платёж' };
    if (p.status === 'cancelled') return { ok: false, alert: 'Платёж отменён' };
    if (['completed', 'cancelled', 'failed'].includes(p.order.status)) {
      return { ok: false, alert: 'Заявка уже закрыта' };
    }
    const left = leftText(p.deadline);
    if (left) {
      return {
        ok: false,
        alert: `Платёж ещё в пути — подождите до ${hhmm(p.deadline)} (осталось ${left}). Если деньги не придут, нажмите «Не пришло» после таймера.`,
      };
    }
    if (p.status === 'proof_requested' || p.status === 'disputed') {
      return { ok: true, alert: 'Отправьте видео в этот чат' };
    }

    const updated = await this.prisma.orderPayment.update({
      where: { id: p.id },
      data: { status: 'proof_requested' },
    });
    await this.editClientMessage(p.order, updated);

    await this.tg.sendMessage(
      p.order.user.telegramId,
      `🎥 <b>Пришлите видео</b>\n\n` +
        `Запишите видео экрана: откройте банковское приложение, покажите историю операций (платежа нет) ` +
        `и ваши реквизиты. Отправьте видео сюда одним сообщением — оно сразу попадёт оператору.`,
    );

    await this.topics.post(
      p.orderId,
      `❗ <b>Клиент сообщает: платёж №${p.seq} (${kop(p.amountKopecks)} ₽) не пришёл.</b>\nЖдём видео от клиента.`,
      { withKeyboard: true },
    );
    await this.topics.refresh(p.orderId);
    return { ok: true, alert: 'Пришлите видео в чат' };
  }

  private async editClientMessage(
    order: { number: number | null; id: string; requisites: any },
    p: { id: string; seq: number; amountKopecks: bigint; deadline: Date; status: string; clientChatId: string | null; clientMessageId: number | null },
  ) {
    if (!p.clientChatId || !p.clientMessageId) return;
    const done = p.status === 'confirmed';
    await this.tg.editMessageText(p.clientChatId, p.clientMessageId, this.clientText(order, p, new Date()), {
      reply_markup: done
        ? { inline_keyboard: [] }
        : this.clientKeyboard(p.id, p.status === 'sent' || p.status === 'proof_requested' || p.status === 'disputed'),
    });
  }

  /** Видео/файл от клиента по спорному платежу */
  async attachProof(
    paymentId: string,
    file: { type: string; fileId: string },
    relay: (orderId: string) => Promise<void>,
  ) {
    const p = await this.prisma.orderPayment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { order: { include: { user: true } } },
    });
    const prev = Array.isArray(p.proofFiles) ? (p.proofFiles as any[]) : [];
    const updated = await this.prisma.orderPayment.update({
      where: { id: paymentId },
      data: {
        status: 'disputed',
        disputedAt: p.disputedAt ?? new Date(),
        proofFiles: [...prev, { ...file, at: new Date().toISOString() }].slice(-10) as any,
      },
    });
    await this.prisma.exchangeOrder.update({
      where: { id: p.orderId },
      data: { clientProofAt: new Date() },
    });
    await this.editClientMessage(p.order, updated);
    await this.topics.post(
      p.orderId,
      `🎥 <b>Видео от клиента</b> по платежу №${p.seq} (${kop(p.amountKopecks)} ₽):`,
    );
    await relay(p.orderId);
    await this.topics.post(p.orderId, `Проверьте платёж и решите: «Доп. платёж» / «Ответить клиенту» / «Завершить».`, {
      withKeyboard: true,
    });
    await this.topics.refresh(p.orderId);
    await this.tg.sendMessage(
      p.order.user.telegramId,
      '✅ Видео получено и передано оператору. Ожидайте ответа в этом чате.',
    );
  }

  // ───────────────────────── живой таймер ─────────────────────────

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const rows = await this.prisma.orderPayment.findMany({
        where: {
          status: { in: ['sent', 'proof_requested'] },
          clientMessageId: { not: null },
          order: { status: { in: ['awaiting_payout', 'processing'] } },
        },
        include: { order: true },
        take: 200,
      });
      const now = new Date();
      for (const p of rows) {
        // после истечения таймера обновляем один раз
        const expired = p.deadline <= now;
        if (p.clientChatId && p.clientMessageId && (!expired || !p.expiredNotified)) {
          await this.tg.editMessageText(
            p.clientChatId,
            p.clientMessageId,
            this.clientText(p.order, p, now),
            { reply_markup: this.clientKeyboard(p.id, true) },
          );
        }
        if (expired && !p.expiredNotified) {
          await this.prisma.orderPayment.update({ where: { id: p.id }, data: { expiredNotified: true } });
          if (p.status === 'sent') {
            await this.topics.post(
              p.orderId,
              `⏱ Таймер платежа №${p.seq} (${kop(p.amountKopecks)} ₽) истёк — клиент ещё не подтвердил получение.`,
              { withKeyboard: true },
            );
          }
        }
        await new Promise((r) => setTimeout(r, 60));
      }
    } catch (e: any) {
      this.logger.warn(`tick: ${e?.message || e}`);
    } finally {
      this.ticking = false;
    }
  }
}
