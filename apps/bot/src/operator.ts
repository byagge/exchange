import { Bot, Context } from 'grammy';
import { prisma } from '@exchange/db';
import { internalApi } from './api';

/** topicKey → mode */
type Draft =
  | { kind: 'pay'; orderId: string }
  | { kind: 'extra'; orderId: string }
  | { kind: 'reply'; orderId: string };

const topicDrafts = new Map<string, Draft>();
/** user telegram id → orderId awaiting video */
const videoWait = new Map<number, string>();

function topicKey(chatId: string | number, threadId: number) {
  return `${chatId}:${threadId}`;
}

function isAdmin(ctx: Context) {
  const ids = new Set(
    (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return !!ctx.from?.id && ids.has(String(ctx.from.id));
}

export function registerOperatorHandlers(bot: Bot) {
  bot.command('bindforum', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply('Только админ.');
      return;
    }
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
      await ctx.reply(
        'Открой <b>forum-группу</b> операторов (Topics включены) и напиши там /bindforum',
        { parse_mode: 'HTML' },
      );
      return;
    }
    try {
      await internalApi('/internal/forum/bind', {
        method: 'POST',
        body: { chatId: String(chat.id) },
      });
      await ctx.reply(
        `✅ Группа привязана\nID: <code>${chat.id}</code>\n\n` +
          `Новые заявки будут создавать темы здесь.`,
        { parse_mode: 'HTML' },
      );
    } catch (e: any) {
      await ctx.reply(`Ошибка: ${e.message}`);
    }
  });

  bot.command('ops', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
      const status = await internalApi<{ forumChatId?: string | null }>('/internal/forum/status').catch(
        () => ({ forumChatId: null }),
      );
      const forum = (status as any).forumChatId || 'не привязана';
      await ctx.reply(
        `🛠 <b>Операторка</b>\n\n` +
          `Forum: <code>${forum}</code>\n` +
          `API: <code>${process.env.API_URL || 'http://127.0.0.1:3010'}</code>\n\n` +
          `1) Создай супергруппу → включи Topics\n` +
          `2) Добавь @${ctx.me.username} админом (право управлять темами)\n` +
          `3) В группе: /bindforum\n` +
          `4) Создай тестовую заявку в миниаппе`,
        { parse_mode: 'HTML' },
      );
    } catch (e: any) {
      await ctx.reply(`⚠️ ${e.message}`);
    }
  });

  // Auto-bind when bot is added as admin to a forum group
  bot.on('my_chat_member', async (ctx) => {
    try {
      const upd = ctx.myChatMember;
      const chat = upd.chat;
      const status = upd.new_chat_member.status;
      if (chat.type !== 'supergroup' && chat.type !== 'group') return;
      if (status !== 'administrator' && status !== 'member') return;
      const fromId = String(upd.from.id);
      const admins = new Set(
        (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
      );
      if (!admins.has(fromId)) return;
      await internalApi('/internal/forum/bind', {
        method: 'POST',
        body: { chatId: String(chat.id) },
      });
      await ctx.api.sendMessage(
        chat.id,
        `✅ Exchange привязал эту группу как операторскую.\n` +
          `Проверка: /ops в личке с ботом.`,
      );
    } catch {
      /* ignore */
    }
  });

  bot.callbackQuery(/^op:(pay|reply|extra|done|cancel):(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
      return;
    }
    const action = ctx.match![1];
    const orderId = ctx.match![2];
    const chatId = ctx.chat?.id;
    const threadId = ctx.callbackQuery.message?.message_thread_id;

    try {
      if (action === 'pay') {
        if (chatId != null && threadId != null) {
          topicDrafts.set(topicKey(chatId, threadId), { kind: 'pay', orderId });
        }
        await ctx.answerCallbackQuery({ text: 'Введите: сумма_руб минуты' });
        await ctx.reply(
          `💸 <b>Отправить платёж</b>\n` +
            `Напишите одной строкой: <code>6159.19 30</code>\n` +
            `(сумма ₽ и таймер в минутах)`,
          { parse_mode: 'HTML' },
        );
        return;
      }

      if (action === 'extra') {
        if (chatId != null && threadId != null) {
          topicDrafts.set(topicKey(chatId, threadId), { kind: 'extra', orderId });
        }
        await ctx.answerCallbackQuery({ text: 'Введите сумму доп. платежа' });
        await ctx.reply(`Доп. платёж — сумма в ₽, например: <code>1500</code>`, {
          parse_mode: 'HTML',
        });
        return;
      }

      if (action === 'reply') {
        if (chatId != null && threadId != null) {
          topicDrafts.set(topicKey(chatId, threadId), { kind: 'reply', orderId });
        }
        await ctx.answerCallbackQuery({ text: 'Следующее сообщение уйдёт клиенту' });
        await ctx.reply('🛡 Напишите ответ клиенту следующим сообщением.');
        return;
      }

      if (action === 'done') {
        await ctx.answerCallbackQuery({ text: 'Завершаю…' });
        await internalApi(`/internal/orders/${orderId}/fulfill`, {
          method: 'POST',
          body: { note: 'Завершено из Telegram' },
        });
        await ctx.reply('✅ Заявка завершена.');
        return;
      }

      if (action === 'cancel') {
        await ctx.answerCallbackQuery({ text: 'Отменяю…' });
        await internalApi(`/internal/orders/${orderId}/reject`, {
          method: 'POST',
          body: { reason: 'Отменено оператором в Telegram' },
        });
        await ctx.reply('✖️ Заявка отменена, средства разблокированы.');
        return;
      }
    } catch (e: any) {
      await ctx.answerCallbackQuery({ text: 'Ошибка', show_alert: true });
      await ctx.reply(`⚠️ ${e.message || e}`);
    }
  });

  bot.callbackQuery(/^pay:(ok|no):(.+)$/, async (ctx) => {
    const status = ctx.match![1] === 'ok' ? 'arrived' : 'not_arrived';
    const orderId = ctx.match![2];
    try {
      await internalApi(`/internal/orders/${orderId}/payout-confirm`, {
        method: 'POST',
        body: { status },
      });
      if (status === 'arrived') {
        await ctx.answerCallbackQuery({ text: 'Спасибо!' });
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => null);
        await ctx.reply('✅ Принято. Оператор получил подтверждение.');
      } else {
        videoWait.set(ctx.from!.id, orderId);
        await ctx.answerCallbackQuery({ text: 'Пришлите видео' });
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => null);
        await ctx.reply(
          '🎥 Пожалуйста, пришлите <b>видео</b> (или файл), подтверждающее ситуацию.',
          { parse_mode: 'HTML' },
        );
      }
    } catch (e: any) {
      await ctx.answerCallbackQuery({ text: 'Ошибка', show_alert: true });
      await ctx.reply(`⚠️ ${e.message || e}`);
    }
  });

  // Topic drafts + client↔topic relay
  bot.on('message', async (ctx, next) => {
    const msg = ctx.message;
    if (!msg) return next();

    // Client video after "не пришли"
    if (ctx.chat?.type === 'private' && ctx.from && videoWait.has(ctx.from.id)) {
      const orderId = videoWait.get(ctx.from.id)!;
      if (msg.video || msg.video_note || msg.document || msg.photo) {
        try {
          const order = await internalApi<any>(`/internal/orders/${orderId}`);
          if (order?.adminForumChatId && order.adminTopicId != null) {
            await ctx.api.copyMessage(
              order.adminForumChatId,
              ctx.chat.id,
              msg.message_id,
              { message_thread_id: order.adminTopicId },
            );
            await ctx.api.sendMessage(
              order.adminForumChatId,
              `🎥 Видео/файл от клиента по заявке`,
              { message_thread_id: order.adminTopicId },
            );
          }
          videoWait.delete(ctx.from.id);
          await prisma.exchangeOrder.update({
            where: { id: orderId },
            data: { awaitingClientVideo: false, clientProofAt: new Date() },
          });
          await ctx.reply('✅ Получено, передали оператору.');
        } catch (e: any) {
          await ctx.reply(`⚠️ Не удалось отправить оператору: ${e.message}`);
        }
        return;
      }
    }

    // Forum topic admin drafts / relay
    const chat = ctx.chat;
    const threadId = msg.message_thread_id;
    if (
      chat &&
      (chat.type === 'group' || chat.type === 'supergroup') &&
      threadId != null &&
      ctx.from &&
      !ctx.from.is_bot
    ) {
      const key = topicKey(chat.id, threadId);
      const draft = topicDrafts.get(key);

      if (draft && isAdmin(ctx) && msg.text && !msg.text.startsWith('/')) {
        try {
          if (draft.kind === 'pay') {
            const parts = msg.text.trim().replace(',', '.').split(/\s+/);
            const amountRub = Number(parts[0]);
            const timerMinutes = Number(parts[1] || 30);
            if (!Number.isFinite(amountRub) || amountRub <= 0) {
              await ctx.reply('Формат: <code>6159.19 30</code>', { parse_mode: 'HTML' });
              return;
            }
            await internalApi(`/internal/orders/${draft.orderId}/dispatch`, {
              method: 'POST',
              body: { amountRub, timerMinutes },
            });
            topicDrafts.delete(key);
            await ctx.reply(
              `✅ Платёж <b>${amountRub}</b> ₽, таймер ${timerMinutes} мин — отправлено клиенту.`,
              { parse_mode: 'HTML' },
            );
            return;
          }
          if (draft.kind === 'extra') {
            const amountRub = Number(msg.text.trim().replace(',', '.'));
            if (!Number.isFinite(amountRub) || amountRub <= 0) {
              await ctx.reply('Укажите сумму числом');
              return;
            }
            await internalApi(`/internal/orders/${draft.orderId}/extra-payout`, {
              method: 'POST',
              body: { amountRub },
            });
            topicDrafts.delete(key);
            await ctx.reply(`✅ Доп. платёж ${amountRub} ₽ отправлен клиенту.`);
            return;
          }
          if (draft.kind === 'reply') {
            const order = await internalApi<any>(`/internal/orders/${draft.orderId}`);
            if (order?.user?.telegramId) {
              await ctx.api.copyMessage(order.user.telegramId.toString(), chat.id, msg.message_id);
              topicDrafts.delete(key);
              await ctx.reply('✅ Доставлено клиенту.');
            }
            return;
          }
        } catch (e: any) {
          await ctx.reply(`⚠️ ${e.message || e}`);
          return;
        }
      }

      // Client messages are only in private; here: if someone writes in topic without draft — ignore
    }

    // Private client text → relay into active order topic
    const menuHit =
      !!msg.text &&
      ['Профиль', 'Поддержка', 'Открыть приложение', 'Рассылка', 'Баланс'].some((t) =>
        msg.text!.includes(t),
      );
    if (
      ctx.chat?.type === 'private' &&
      ctx.from &&
      msg.text &&
      !msg.text.startsWith('/') &&
      !menuHit
    ) {
      const open = await prisma.exchangeOrder.findFirst({
        where: {
          user: { telegramId: BigInt(ctx.from.id) },
          status: { in: ['awaiting_payout', 'processing'] },
          adminTopicId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (open?.adminForumChatId && open.adminTopicId != null) {
        try {
          await ctx.api.sendMessage(
            open.adminForumChatId,
            `📇 Клиент:` ,
            { message_thread_id: open.adminTopicId },
          );
          await ctx.api.copyMessage(
            open.adminForumChatId,
            ctx.chat.id,
            msg.message_id,
            { message_thread_id: open.adminTopicId },
          );
        } catch {
          /* ignore relay errors */
        }
      }
    }

    return next();
  });
}

/** Restore video-wait from DB on boot */
export async function hydrateVideoWait() {
  const rows = await prisma.exchangeOrder.findMany({
    where: { awaitingClientVideo: true, status: { in: ['processing', 'awaiting_payout'] } },
    include: { user: true },
  });
  for (const o of rows) {
    videoWait.set(Number(o.user.telegramId), o.id);
  }
}
