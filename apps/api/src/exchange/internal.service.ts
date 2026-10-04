import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService, escHtml } from '../telegram/telegram.service';
import { OrderTopicsService, kop } from '../telegram/order-topics.service';
import { ExchangeService } from './exchange.service';
import { PaymentsService, type ActionResult } from './payments.service';
import { userIsEnvAdmin } from '../common/admin-ids';

export type ClientMessageInput = {
  telegramId: string;
  chatId: string;
  messageId: number;
  text?: string;
  /** Тип вложения Telegram: video | video_note | photo | document | voice | animation | audio | sticker */
  mediaType?: string;
  fileId?: string;
};

const ACTIVE = ['awaiting_payout', 'processing', 'locked'] as const;

/** Логика для бот-процесса (grammY): он только принимает клики и сообщения, всё решает API. */
@Injectable()
export class InternalService {
  constructor(
    private prisma: PrismaService,
    private tg: TelegramService,
    private topics: OrderTopicsService,
    private exchange: ExchangeService,
    private payments: PaymentsService,
  ) {}

  async assertAdmin(tgId: string) {
    if (userIsEnvAdmin(tgId)) return;
    const u = await this.prisma.user.findUnique({ where: { telegramId: BigInt(tgId) } });
    if (!u?.isAdmin) throw new ForbiddenException('Недостаточно прав');
  }

  private actor(tgId: string) {
    return `tg:${tgId}`;
  }

  async orderSummary(orderId: string, actorTg: string) {
    await this.assertAdmin(actorTg);
    const [order, settings] = await Promise.all([
      this.topics.loadOrder(orderId),
      this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    if (!order) throw new BadRequestException('Заявка не найдена');
    const live = order.payments.filter((p) => p.status !== 'cancelled');
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      closed: ['completed', 'cancelled', 'failed'].includes(order.status),
      usdt: Number(order.fromAmountMicros) / 1e6,
      toAmountKopecks: Number(order.toAmountKopecks),
      sentKopecks: this.topics.sentTotal(order.payments as any),
      remainingKopecks: this.topics.remainingKopecks(order, order.payments as any),
      confirmedKopecks: live
        .filter((p) => p.status === 'confirmed')
        .reduce((a, p) => a + Number(p.amountKopecks), 0),
      unconfirmed: live.filter((p) => p.status !== 'confirmed').length,
      paymentsCount: live.length,
      defaultMinutes: settings.defaultPayoutMinutes,
    };
  }

  async sendPayment(orderId: string, actorTg: string, amountRub: number, minutes?: number) {
    await this.assertAdmin(actorTg);
    const settings = await this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    const p = await this.payments.sendPayment(orderId, {
      amountKopecks: Math.round(amountRub * 100),
      minutes: minutes && minutes > 0 ? minutes : settings.defaultPayoutMinutes,
      actor: this.actor(actorTg),
    });
    return { ok: true, seq: p.seq };
  }

  async complete(orderId: string, actorTg: string) {
    await this.assertAdmin(actorTg);
    await this.exchange.fulfillByAdmin(orderId, this.actor(actorTg), undefined, 'Завершено из группы операторов');
    return { ok: true };
  }

  async cancel(orderId: string, actorTg: string) {
    await this.assertAdmin(actorTg);
    await this.exchange.rejectByAdmin(orderId, this.actor(actorTg), 'Отменено оператором');
    return { ok: true };
  }

  /** Оператор → клиенту (текст или любое вложение) */
  async relayToClient(
    orderId: string,
    actorTg: string,
    msg: { chatId: string; messageId: number; text?: string },
  ) {
    await this.assertAdmin(actorTg);
    const order = await this.prisma.exchangeOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { user: true },
    });
    const label = order.number ? `№${order.number}` : `#${order.id.slice(-6).toUpperCase()}`;
    if (msg.text) {
      const r = await this.tg.sendMessage(
        order.user.telegramId,
        `💬 <b>Оператор · заявка ${label}</b>\n${escHtml(msg.text)}`,
      );
      if (!r.ok) throw new BadRequestException(`Не удалось доставить: ${r.error}`);
    } else {
      await this.tg.sendMessage(order.user.telegramId, `💬 <b>Оператор · заявка ${label}</b>`);
      const r = await this.tg.copyMessage(order.user.telegramId, msg.chatId, msg.messageId);
      if (!r.ok) throw new BadRequestException(`Не удалось доставить: ${r.error}`);
    }
    return { ok: true };
  }

  paymentConfirm(paymentId: string, telegramId: string): Promise<ActionResult> {
    return this.payments.clientConfirm(paymentId, telegramId);
  }

  paymentNotReceived(paymentId: string, telegramId: string): Promise<ActionResult> {
    return this.payments.clientNotReceived(paymentId, telegramId);
  }

  /** Сообщение клиента в личке бота → в тему заявки (или видео по спорному платежу) */
  async clientMessage(input: ClientMessageInput) {
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(input.telegramId) },
    });
    if (!user) return { handled: false };

    const order = await this.prisma.exchangeOrder.findFirst({
      where: { userId: user.id, status: { in: [...ACTIVE] } },
      orderBy: { createdAt: 'desc' },
      include: { payments: { orderBy: { seq: 'desc' } } },
    });
    if (!order) return { handled: false };

    const nick = user.username ? `@${escHtml(user.username)}` : escHtml(user.firstName || input.telegramId);
    const label = order.number ? `№${order.number}` : `#${order.id.slice(-6).toUpperCase()}`;
    const proofPayment = order.payments.find((p) => p.status === 'proof_requested');
    const isProofMedia = ['video', 'video_note', 'document', 'animation'].includes(input.mediaType || '');

    if (proofPayment && isProofMedia && input.fileId) {
      await this.payments.attachProof(
        proofPayment.id,
        { type: input.mediaType!, fileId: input.fileId },
        (orderId) => this.topics.copyFromClient(orderId, input.chatId, input.messageId),
      );
      return { handled: true, silent: true };
    }

    if (input.mediaType) {
      await this.topics.post(order.id, `📎 <b>Клиент ${nick}</b> · заявка ${label}:`, { withKeyboard: true });
      await this.topics.copyFromClient(order.id, input.chatId, input.messageId);
    } else {
      await this.topics.post(
        order.id,
        `🙍 <b>Клиент ${nick}</b> · заявка ${label}:\n${escHtml(input.text || '')}`,
        { withKeyboard: true },
      );
    }
    return {
      handled: true,
      reminder: proofPayment ? 'Для подтверждения проблемы нужно именно видео — отправьте его сюда.' : undefined,
    };
  }

  /** /setgroup в группе операторов */
  async setGroup(chatId: string, actorTg: string) {
    await this.assertAdmin(actorTg);
    const chat = await this.tg.call<any>('getChat', { chat_id: chatId });
    if (!chat.ok) throw new BadRequestException(`Бот не видит группу: ${chat.error}`);
    if (chat.result.type !== 'supergroup' || !chat.result.is_forum) {
      throw new BadRequestException(
        'Нужна супергруппа с включёнными темами (Настройки группы → Темы).',
      );
    }
    const me = await this.tg.call<any>('getMe', {});
    const member = me.ok
      ? await this.tg.call<any>('getChatMember', { chat_id: chatId, user_id: me.result.id })
      : null;
    const m = member?.ok ? member.result : null;
    if (!m || m.status !== 'administrator' || m.can_manage_topics === false) {
      throw new BadRequestException(
        'Сделайте бота администратором с правом «Управление темами» (и отправкой сообщений).',
      );
    }
    await this.prisma.settings.update({ where: { id: 1 }, data: { ordersGroupId: chatId } });
    return { ok: true, title: chat.result.title as string };
  }
}
