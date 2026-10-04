import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { tgCall, tgCreateForumTopic, tgEditForumTopic, tgSendMessage } from './tg-api';

function fmtUsdt(micros: number | bigint) {
  return (Number(micros) / 1e6).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtRub(kopecks: number | bigint) {
  return (Number(kopecks) / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

@Injectable()
export class OperatorService {
  private readonly logger = new Logger(OperatorService.name);

  constructor(private prisma: PrismaService) {}

  async resolveForumChatId(): Promise<string | null> {
    const fromEnv = (process.env.ADMIN_FORUM_CHAT_ID || '').trim();
    if (fromEnv) return fromEnv;
    const s = await this.prisma.settings.findUnique({ where: { id: 1 } });
    return s?.adminForumChatId || null;
  }

  adminKeyboard(orderId: string) {
    return {
      inline_keyboard: [
        [
          {
            text: '💬 Отправить платёж',
            callback_data: `op:pay:${orderId}`,
            style: 'primary',
          },
        ],
        [
          {
            text: '🛡 Ответить клиенту',
            callback_data: `op:reply:${orderId}`,
            style: 'primary',
          },
        ],
        [
          {
            text: '💬 Доп. платёж',
            callback_data: `op:extra:${orderId}`,
            style: 'success',
          },
        ],
        [
          {
            text: '✅ Завершить заявку',
            callback_data: `op:done:${orderId}`,
            style: 'success',
          },
        ],
        [
          {
            text: '✖️ Отменить',
            callback_data: `op:cancel:${orderId}`,
            style: 'danger',
          },
        ],
      ],
    };
  }

  clientPayoutKeyboard(orderId: string) {
    return {
      inline_keyboard: [
        [
          {
            text: '✅ Пришли',
            callback_data: `pay:ok:${orderId}`,
            style: 'success',
          },
          {
            text: '❌ Не пришли',
            callback_data: `pay:no:${orderId}`,
            style: 'danger',
          },
        ],
      ],
    };
  }

  async formatOrderCard(orderId: string): Promise<string | null> {
    const order = await this.prisma.exchangeOrder.findUnique({
      where: { id: orderId },
      include: {
        user: { include: { referredBy: true } },
      },
    });
    if (!order) return null;

    const u = order.user;
    const nick = u.username ? `@${u.username}` : u.firstName || '—';
    const req = (order.requisites || {}) as Record<string, any>;
    const usdt = fmtUsdt(order.fromAmountMicros);
    const rub = fmtRub(order.toAmountKopecks);
    const payout =
      order.payoutAmountKopecks != null
        ? fmtRub(order.payoutAmountKopecks)
        : rub;

    const ref = u.referredBy;
    const refNick = ref?.username ? `@${ref.username}` : ref ? String(ref.telegramId) : '—';

    const phone = req.phone || '—';
    const card = req.card || '—';
    const dest = req.type === 'card' ? `Карта: <code>${card}</code>` : `Телефон: <code>${phone}</code>`;

    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    const refPct = settings?.referralPercent ?? 0;
    const saleLine = `${usdt.replace(/\s/g, '')} × ${order.rate}`;

    return (
      `💬 <b>Новая заявка №-${shortId(order.id)}</b>\n\n` +
      `✅ Сумма к обработке (баланс клиента).\n` +
      `Статус: <b>${order.status}</b>\n\n` +
      `🪙 Сумма: <b>${usdt} USDT</b>\n` +
      `💰 Курс: <b>${order.rate} RUB/$</b>\n` +
      `🔄 К выплате: <b>${rub} RUB</b>\n` +
      `💳 Метод: ${req.type || order.method}\n\n` +
      `🪪 ${dest}\n` +
      `🪪 Получатель: <b>${req.fio || '—'}</b>\n` +
      `📌 Банк: <b>${req.bank || '—'}</b>\n\n` +
      `🔄 Выплата клиенту: <b>${payout} ₽</b>\n` +
      `📌 Продажа USDT: ${saleLine}\n\n` +
      `👤 Клиент: ${nick}\n` +
      `🆔 TG ID: <code>${u.telegramId}</code>\n` +
      (order.clientIp ? `🌐 IP: <code>${order.clientIp}</code>\n` : '') +
      (order.clientDevice ? `📱 Устройство: <code>${order.clientDevice}</code>\n` : '') +
      (u.lastIp && u.lastIp !== order.clientIp ? `🌐 Last IP: <code>${u.lastIp}</code>\n` : '') +
      `\n📊 Реферал: ${refNick}` +
      (ref ? `\n📌 ID реферера: <code>${ref.telegramId}</code>` : '') +
      `\n🔗 Реферальное вознаграждение (${refPct}%): считается при завершении`
    );
  }

  /** Create forum topic + post order card with admin buttons */
  async openOrderTopic(orderId: string) {
    const forumId = await this.resolveForumChatId();
    if (!forumId) {
      this.logger.warn('ADMIN_FORUM_CHAT_ID not set — skip topic');
      return null;
    }

    const order = await this.prisma.exchangeOrder.findUnique({
      where: { id: orderId },
      include: { user: true },
    });
    if (!order) return null;

    if (order.adminTopicId && order.adminForumChatId) {
      const text = await this.formatOrderCard(orderId);
      if (text) {
        await tgSendMessage(order.adminForumChatId, text, {
          message_thread_id: order.adminTopicId,
          reply_markup: this.adminKeyboard(orderId),
        });
      }
      return order;
    }

    const usdt = fmtUsdt(order.fromAmountMicros);
    const nick = order.user.username
      ? `@${order.user.username}`
      : order.user.firstName || String(order.user.telegramId);
    const topicName = `🔴 ${usdt} USDT • ${nick}`;

    const topic = await tgCreateForumTopic(forumId, topicName);
    if (!topic?.message_thread_id) {
      this.logger.warn('createForumTopic failed');
      return null;
    }

    const text = await this.formatOrderCard(orderId);
    const kb = this.adminKeyboard(orderId);

    // Control panel (top) + card with same buttons (as on screenshots)
    await tgSendMessage(forumId, '🎛 <b>Панель оператора</b>', {
      message_thread_id: topic.message_thread_id,
      reply_markup: kb,
    });

    const msg = text
      ? await tgSendMessage(forumId, text, {
          message_thread_id: topic.message_thread_id,
          reply_markup: kb,
        })
      : null;

    return this.prisma.exchangeOrder.update({
      where: { id: orderId },
      data: {
        adminForumChatId: String(forumId),
        adminTopicId: topic.message_thread_id,
        adminPanelMsgId: (msg as any)?.message_id ?? null,
      },
    });
  }

  async postToOrderTopic(orderId: string, text: string, extra: Record<string, unknown> = {}) {
    const order = await this.prisma.exchangeOrder.findUnique({ where: { id: orderId } });
    if (!order?.adminForumChatId || order.adminTopicId == null) return null;
    return tgSendMessage(order.adminForumChatId, text, {
      message_thread_id: order.adminTopicId,
      ...extra,
    });
  }

  async notifyClientPayout(orderId: string) {
    const order = await this.prisma.exchangeOrder.findUnique({
      where: { id: orderId },
      include: { user: true },
    });
    if (!order?.payoutAmountKopecks || !order.payoutDeadline) return;

    const rub = fmtRub(order.payoutAmountKopecks);
    const mins = Math.max(
      1,
      Math.round((order.payoutDeadline.getTime() - Date.now()) / 60_000),
    );
    const deadline = order.payoutDeadline.toLocaleString('ru-RU');

    await tgSendMessage(
      order.user.telegramId,
      `💸 <b>Платёж по заявке №${shortId(order.id)}</b>\n\n` +
        `Сумма: <b>${rub} ₽</b>\n` +
        `⏳ Таймер: <b>${mins} мин</b>\n` +
        `До: <code>${deadline}</code>\n\n` +
        `Подтвердите получение:`,
      { reply_markup: this.clientPayoutKeyboard(orderId) },
    );
  }

  async notifyClientExtraPayout(orderId: string, amountRub: number, note?: string) {
    const order = await this.prisma.exchangeOrder.findUnique({
      where: { id: orderId },
      include: { user: true },
    });
    if (!order) return;
    const rub = amountRub.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    await tgSendMessage(
      order.user.telegramId,
      `💸 <b>Дополнительный платёж</b>\n\n` +
        `Заявка №${shortId(order.id)}\n` +
        `Сумма: <b>${rub} ₽</b>` +
        (note ? `\n${note}` : '') +
        `\n\nПодтвердите получение:`,
      { reply_markup: this.clientPayoutKeyboard(orderId) },
    );
    await this.postToOrderTopic(
      orderId,
      `📤 Клиенту отправлен доп. платёж: <b>${rub} ₽</b>`,
    );
  }

  async updateTopicTitle(orderId: string, prefix: string) {
    const order = await this.prisma.exchangeOrder.findUnique({
      where: { id: orderId },
      include: { user: true },
    });
    if (!order?.adminForumChatId || order.adminTopicId == null) return;
    const usdt = fmtUsdt(order.fromAmountMicros);
    const nick = order.user.username
      ? `@${order.user.username}`
      : order.user.firstName || String(order.user.telegramId);
    await tgEditForumTopic(
      order.adminForumChatId,
      order.adminTopicId,
      `${prefix} ${usdt} USDT • ${nick}`,
    );
  }

  async bindForumChat(chatId: string) {
    await this.prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, adminForumChatId: chatId },
      update: { adminForumChatId: chatId },
    });
    return chatId;
  }

  /** Fallback DM to admins if no forum */
  async pingAdmins(text: string) {
    const admins = (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const id of admins) await tgSendMessage(id, text);
  }

  async answerCallback(id: string, text?: string, alert = false) {
    return tgCall('answerCallbackQuery', {
      callback_query_id: id,
      text,
      show_alert: alert,
    });
  }
}
