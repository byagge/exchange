import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService, escHtml } from './telegram.service';
import { parseAdminTelegramIds } from '../common/admin-ids';

export const kop = (v: number | bigint) =>
  (Number(v) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const usd = (micros: number | bigint) => {
  const n = Number(micros) / 1e6;
  // 171.4, 68.11, 90 — без хвостовых нулей, как в заголовке темы
  return String(Number(n.toFixed(6)));
};

const fmtTime = (d: Date) =>
  d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Moscow' });

type PaymentRow = {
  id: string;
  seq: number;
  amountKopecks: bigint;
  status: 'sent' | 'confirmed' | 'proof_requested' | 'disputed' | 'cancelled';
  deadline: Date;
};

type OrderWithAll = NonNullable<Awaited<ReturnType<OrderTopicsService['loadOrder']>>>;

const CLOSED = ['completed', 'cancelled', 'failed'];

/**
 * Группа операторов: на каждую заявку — своя тема (forum topic) с карточкой и кнопками.
 * Если группа не настроена — карточки уходят админам в личку (фолбэк).
 */
@Injectable()
export class OrderTopicsService {
  private readonly logger = new Logger(OrderTopicsService.name);

  constructor(
    private prisma: PrismaService,
    private tg: TelegramService,
  ) {}

  async groupId(): Promise<string | null> {
    const s = await this.prisma.settings.findUnique({ where: { id: 1 } });
    return (s?.ordersGroupId || process.env.ORDERS_GROUP_ID || '').trim() || null;
  }

  loadOrder(orderId: string) {
    return this.prisma.exchangeOrder.findUnique({
      where: { id: orderId },
      include: { user: true, payments: { orderBy: { seq: 'asc' } } },
    });
  }

  /** Сумма платежей, которые ещё в силе (не отменены) */
  sentTotal(payments: PaymentRow[]) {
    return payments
      .filter((p) => p.status !== 'cancelled')
      .reduce((a, p) => a + Number(p.amountKopecks), 0);
  }

  remainingKopecks(order: { toAmountKopecks: bigint }, payments: PaymentRow[]) {
    return Math.max(0, Number(order.toAmountKopecks) - this.sentTotal(payments));
  }

  /** Состояние для карточки и цвета темы */
  state(order: { status: string; toAmountKopecks?: bigint }, payments: PaymentRow[]) {
    if (order.status === 'completed') return { dot: '🟢', label: 'завершена' };
    if (order.status === 'cancelled') return { dot: '⚫', label: 'отменена клиентом' };
    if (order.status === 'failed') return { dot: '⚫', label: 'отклонена / отменена' };

    const live = payments.filter((p) => p.status !== 'cancelled');
    if (!live.length) return { dot: '🟠', label: 'ожидает платежа' };
    if (live.some((p) => p.status === 'proof_requested'))
      return { dot: '🔴', label: 'клиент: платёж не пришёл, ждём видео' };
    if (live.some((p) => p.status === 'disputed'))
      return { dot: '🔴', label: 'спор: видео получено' };
    if (live.some((p) => p.status === 'sent')) return { dot: '🟡', label: 'ждём подтверждения клиента' };
    const target = order.toAmountKopecks != null ? Number(order.toAmountKopecks) : 0;
    if (target && this.sentTotal(payments) < target - 100) {
      return { dot: '🟡', label: 'платёж подтверждён — нужен доп. платёж' };
    }
    return { dot: '🟢', label: 'все платежи подтверждены — можно завершать' };
  }

  topicTitle(order: OrderWithAll) {
    const st = this.state(order, order.payments);
    const who = order.user.username ? `@${order.user.username}` : order.user.firstName || order.user.telegramId.toString();
    return `${st.dot} ${usd(order.fromAmountMicros)} USDT • ${who}`;
  }

  keyboard(orderId: string) {
    return {
      inline_keyboard: [
        [{ text: 'Отправить платёж', callback_data: `o:pay:${orderId}`, style: 'primary' }],
        [{ text: 'Ответить клиенту', callback_data: `o:reply:${orderId}`, style: 'primary' }],
        [{ text: 'Доп. платёж', callback_data: `o:extra:${orderId}`, style: 'success' }],
        [{ text: 'Завершить заявку', callback_data: `o:done:${orderId}`, style: 'success' }],
        [{ text: 'Отменить', callback_data: `o:cancel:${orderId}`, style: 'danger' }],
      ],
    };
  }

  cardText(order: OrderWithAll) {
    const req = (order.requisites || {}) as Record<string, any>;
    const st = this.state(order, order.payments);
    const user = order.user;
    const nick = user.username ? `@${escHtml(user.username)}` : escHtml(user.firstName || '—');
    const head = order.number ? `№${order.number}` : `#${order.id.slice(-6).toUpperCase()}`;
    const lines: string[] = [];
    lines.push(`🆕 <b>Заявка ${head}</b>`);
    lines.push('');
    lines.push(`Статус: <b>${escHtml(st.label)}</b>`);
    lines.push(`💲 Сумма: <b>${usd(order.fromAmountMicros)} USDT</b>`);
    lines.push(`💱 Курс: ${escHtml(order.rate)} RUB/$`);
    lines.push(`💸 К выплате: <b>${kop(order.toAmountKopecks)} ₽</b>`);
    lines.push(`🧾 Метод: ${req.type === 'card' ? 'карта' : 'СБП'}`);
    lines.push('');
    if (req.type === 'card') lines.push(`💳 Карта: <code>${escHtml(req.card || '—')}</code>`);
    else lines.push(`📞 Телефон: <code>${escHtml(req.phone || '—')}</code>`);
    lines.push(`👤 Получатель: ${escHtml(req.fio || '—')}`);
    lines.push(`🏦 Банк: ${escHtml(req.bank || '—')}`);
    if (req.comment) lines.push(`💬 Комментарий: ${escHtml(req.comment)}`);
    lines.push('');
    lines.push(`🙍 Клиент: ${nick} · <code>${user.telegramId.toString()}</code>`);
    lines.push(`🌐 IP: <code>${escHtml(order.clientIp || user.lastIp || '—')}</code>`);
    lines.push(`📱 Устройство: ${escHtml(order.clientDevice || user.lastDevice || '—')}`);
    lines.push(`🕒 Создана: ${order.createdAt.toLocaleString('ru-RU', { timeZone: process.env.TZ || 'Europe/Moscow' })}`);

    const live = order.payments.filter((p) => p.status !== 'cancelled');
    if (live.length) {
      lines.push('');
      lines.push(
        `📤 <b>Платежи</b> (направлено ${kop(this.sentTotal(order.payments))} из ${kop(order.toAmountKopecks)} ₽):`,
      );
      for (const p of live) {
        const mark =
          p.status === 'confirmed'
            ? '✅ подтверждён'
            : p.status === 'sent'
              ? `⏳ ждём (таймер до ${fmtTime(p.deadline)})`
              : p.status === 'proof_requested'
                ? '❗ не пришёл — ждём видео'
                : '🎥 не пришёл — видео получено';
        lines.push(`  №${p.seq} · ${kop(p.amountKopecks)} ₽ · ${mark}`);
      }
    }
    return lines.join('\n');
  }

  private async adminDmTargets(): Promise<string[]> {
    const ids = new Set<string>(parseAdminTelegramIds());
    return [...ids];
  }

  /** Создаёт тему и карточку для новой заявки. Никогда не бросает — заявка важнее уведомления. */
  async openForOrder(orderId: string) {
    try {
      let order = await this.loadOrder(orderId);
      if (!order || order.topicMessageId) return;

      if (!order.number) {
        const max = await this.prisma.exchangeOrder.aggregate({ _max: { number: true } });
        const number = (max._max.number ?? 1000) + 1;
        try {
          await this.prisma.exchangeOrder.update({ where: { id: orderId }, data: { number } });
        } catch {
          // гонка за номер — берём следующий свободный
          await this.prisma.exchangeOrder.update({ where: { id: orderId }, data: { number: number + 1 } });
        }
        order = (await this.loadOrder(orderId))!;
      }

      const text = this.cardText(order);
      const group = await this.groupId();

      if (group) {
        const topic = await this.tg.createForumTopic(group, this.topicTitle(order));
        if (topic.ok) {
          const threadId = topic.result.message_thread_id;
          const sent = await this.tg.sendMessage(group, text, {
            message_thread_id: threadId,
            reply_markup: this.keyboard(orderId),
          });
          await this.prisma.exchangeOrder.update({
            where: { id: orderId },
            data: {
              topicId: threadId,
              topicChatId: group,
              topicMessageId: sent.ok ? sent.result.message_id : null,
            },
          });
          if (!sent.ok) this.logger.warn(`topic card send failed: ${sent.error}`);
          return;
        }
        this.logger.warn(
          `createForumTopic failed (${topic.error}) — фолбэк в личку админам. ` +
            `Проверьте: группа с включёнными темами, бот — админ с правом «Управление темами».`,
        );
      }

      // Фолбэк: карточка с теми же кнопками в личку админам
      for (const id of await this.adminDmTargets()) {
        await this.tg.sendMessage(id, text, { reply_markup: this.keyboard(orderId) });
      }
    } catch (e: any) {
      this.logger.error(`openForOrder ${orderId}: ${e?.message || e}`);
    }
  }

  /** Обновить карточку и название темы после смены состояния */
  async refresh(orderId: string) {
    try {
      const order = await this.loadOrder(orderId);
      if (!order?.topicChatId || !order.topicId) return;
      const closed = CLOSED.includes(order.status);
      if (order.topicMessageId) {
        await this.tg.editMessageText(order.topicChatId, order.topicMessageId, this.cardText(order), {
          reply_markup: closed ? { inline_keyboard: [] } : this.keyboard(orderId),
        });
      }
      await this.tg.editForumTopic(order.topicChatId, order.topicId, this.topicTitle(order));
    } catch (e: any) {
      this.logger.warn(`refresh ${orderId}: ${e?.message || e}`);
    }
  }

  /** Закрыть тему (после завершения/отмены) */
  async close(orderId: string) {
    await this.refresh(orderId);
    const order = await this.prisma.exchangeOrder.findUnique({ where: { id: orderId } });
    if (order?.topicChatId && order.topicId) {
      await this.tg.closeForumTopic(order.topicChatId, order.topicId);
    }
  }

  /** Сообщение в тему заявки (или админам в личку, если темы нет) */
  async post(
    orderId: string,
    text: string,
    opts: { withKeyboard?: boolean; replyTo?: number } = {},
  ) {
    const order = await this.prisma.exchangeOrder.findUnique({ where: { id: orderId } });
    if (!order) return null;
    const markup = opts.withKeyboard ? { reply_markup: this.keyboard(orderId) } : {};
    if (order.topicChatId && order.topicId) {
      const res = await this.tg.sendMessage(order.topicChatId, text, {
        message_thread_id: order.topicId,
        ...(opts.replyTo ? { reply_to_message_id: opts.replyTo } : {}),
        ...markup,
      });
      return res.ok ? res.result.message_id : null;
    }
    for (const id of await this.adminDmTargets()) {
      await this.tg.sendMessage(id, text, markup);
    }
    return null;
  }

  /** Переслать сообщение клиента (copyMessage) в тему заявки */
  async copyFromClient(orderId: string, fromChatId: string | number, messageId: number) {
    const order = await this.prisma.exchangeOrder.findUnique({ where: { id: orderId } });
    if (!order) return;
    const targets: Array<{ chat: string; thread?: number }> =
      order.topicChatId && order.topicId
        ? [{ chat: order.topicChatId, thread: order.topicId }]
        : (await this.adminDmTargets()).map((id) => ({ chat: id }));
    for (const t of targets) {
      await this.tg.copyMessage(t.chat, fromChatId, messageId, {
        ...(t.thread ? { message_thread_id: t.thread } : {}),
      });
    }
  }
}
