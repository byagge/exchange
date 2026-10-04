import { Bot, Context, InlineKeyboard } from 'grammy';
import { internal } from './internal-api';

/**
 * Заявки: кнопки операторов в теме группы + переписка/платежи клиента в личке.
 * Вся бизнес-логика — в API (/api/internal), здесь только Telegram-интерфейс.
 */

type Pending = { kind: 'pay' | 'reply'; orderId: string; promptMessageId?: number; expires: number };
const pending = new Map<string, Pending>();
const TTL = 10 * 60_000;

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const kop = (v: number) =>
  (v / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function threadOf(ctx: Context): number | undefined {
  const m: any = ctx.callbackQuery?.message ?? ctx.message;
  return m?.is_topic_message || m?.message_thread_id ? m.message_thread_id : undefined;
}

function pendingKey(ctx: Context) {
  return `${ctx.chat?.id}:${threadOf(ctx) ?? 0}:${ctx.from?.id}`;
}

function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
}

async function say(ctx: Context, text: string, extra: Record<string, unknown> = {}) {
  const thread = threadOf(ctx);
  try {
    return await ctx.api.sendMessage(ctx.chat!.id, text, {
      parse_mode: 'HTML',
      ...(thread ? { message_thread_id: thread } : {}),
      link_preview_options: { is_disabled: true },
      ...extra,
    } as any);
  } catch (e) {
    console.error('say failed', e);
    return null;
  }
}

async function safeDelete(ctx: Context, messageId?: number) {
  if (!messageId || !ctx.chat) return;
  try {
    await ctx.api.deleteMessage(ctx.chat.id, messageId);
  } catch {
    /* нет прав / уже удалено */
  }
}

const cancelRow = (orderId: string) =>
  new InlineKeyboard().text('Отмена', `o:x:${orderId}`);

/** Текст оператора в теме (сумма/таймер) или ответ клиенту. true — сообщение обработано. */
export async function tryPending(ctx: Context): Promise<boolean> {
  sweep();
  if (!ctx.from || !ctx.chat || !ctx.message) return false;
  const key = pendingKey(ctx);
  const p = pending.get(key);
  if (!p) return false;
  const msg = ctx.message;

  if (p.kind === 'pay') {
    const text = msg.text?.trim();
    if (!text) return false;
    const tokens = text.split(/\s+/);
    const amount = Number(tokens[0].replace(',', '.'));
    const minutes = tokens[1] ? Number(tokens[1]) : undefined;
    if (tokens.length > 2 || !Number.isFinite(amount) || amount <= 0 || (minutes !== undefined && !(minutes > 0))) {
      await say(ctx, 'Не понял. Формат: <code>сумма</code> или <code>сумма минуты</code>, например <code>3000 20</code>.', {
        reply_parameters: { message_id: msg.message_id },
      });
      return true;
    }
    const r = await internal('POST', `/orders/${p.orderId}/payments`, {
      actor: ctx.from.id,
      amountRub: amount,
      minutes,
    });
    if (!r.ok) {
      await say(ctx, `⚠️ ${esc(r.message)}`, { reply_parameters: { message_id: msg.message_id } });
      return true;
    }
    pending.delete(key);
    await safeDelete(ctx, p.promptMessageId);
    return true;
  }

  // reply → клиенту
  const mediaLike = !msg.text;
  const r = await internal('POST', `/orders/${p.orderId}/relay`, {
    actor: ctx.from.id,
    chatId: ctx.chat.id,
    messageId: msg.message_id,
    text: mediaLike ? undefined : msg.text,
  });
  if (!r.ok) {
    await say(ctx, `⚠️ ${esc(r.message)}`, { reply_parameters: { message_id: msg.message_id } });
    return true;
  }
  pending.delete(key);
  await safeDelete(ctx, p.promptMessageId);
  await say(ctx, '✅ Отправлено клиенту.', { reply_parameters: { message_id: msg.message_id } });
  return true;
}

async function react(ctx: Context) {
  try {
    await ctx.react('👌');
  } catch {
    /* реакции могут быть отключены */
  }
}

export function registerOrderHandlers(bot: Bot) {
  // ───────────── привязка группы ─────────────
  bot.command('setgroup', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply('Команду нужно отправить в группе операторов (супергруппа с включёнными темами).');
      return;
    }
    const r = await internal('POST', '/set-group', { chatId: String(ctx.chat.id), actor: ctx.from?.id });
    if (!r.ok) {
      await say(ctx, `⚠️ ${esc(r.message)}`);
      return;
    }
    await say(
      ctx,
      `✅ Группа <b>${esc(r.data.title)}</b> привязана. Каждая новая заявка будет создавать здесь тему с кнопками.`,
    );
  });

  // ───────────── кнопки оператора ─────────────
  bot.callbackQuery(/^o:(pay|extra|reply|done|cancel|payfull|x|no):([A-Za-z0-9]+)(?::(y))?$/, async (ctx) => {
    const [, action, orderId, confirmed] = ctx.match as unknown as [string, string, string, string?];
    const actor = ctx.from.id;

    const sum = await internal<any>('GET', `/orders/${orderId}/summary`, { actor });
    if (!sum.ok) {
      await ctx.answerCallbackQuery({ text: sum.status === 403 ? 'Недостаточно прав' : sum.message, show_alert: true });
      return;
    }
    const o = sum.data;
    const label = o.number ? `№${o.number}` : `#${orderId.slice(-6).toUpperCase()}`;
    const key = pendingKey(ctx);

    if (action === 'x' || action === 'no') {
      pending.delete(key);
      await ctx.answerCallbackQuery();
      await safeDelete(ctx, ctx.callbackQuery.message?.message_id);
      return;
    }

    if (o.closed) {
      await ctx.answerCallbackQuery({ text: 'Заявка уже закрыта', show_alert: true });
      return;
    }

    if (action === 'pay' || action === 'extra') {
      await ctx.answerCallbackQuery();
      const title = action === 'extra' ? 'Доп. платёж' : 'Платёж';
      const rest = o.remainingKopecks;
      const kb = new InlineKeyboard();
      if (rest > 0) kb.text(`Полная сумма: ${kop(rest)} ₽ · ${o.defaultMinutes} мин`, `o:payfull:${orderId}`).row();
      kb.text('Отмена', `o:x:${orderId}`);
      const prompt = await say(
        ctx,
        `💸 <b>${title} · заявка ${label}</b>\n` +
          `К выплате: <b>${kop(o.toAmountKopecks)} ₽</b> · направлено: ${kop(o.sentKopecks)} ₽ · ` +
          `осталось: <b>${kop(rest)} ₽</b>\n\n` +
          `Пришлите сумму в ₽ и (по желанию) таймер в минутах:\n` +
          `<code>${rest > 0 ? Math.round(rest) / 100 : 1000}</code> или <code>3000 20</code>\n` +
          `Без таймера — ${o.defaultMinutes} мин.`,
        { reply_markup: kb },
      );
      pending.set(key, { kind: 'pay', orderId, promptMessageId: prompt?.message_id, expires: Date.now() + TTL });
      return;
    }

    if (action === 'payfull') {
      if (!(o.remainingKopecks > 0)) {
        await ctx.answerCallbackQuery({ text: 'Всё уже направлено. Укажите сумму вручную.', show_alert: true });
        return;
      }
      const r = await internal('POST', `/orders/${orderId}/payments`, {
        actor,
        amountRub: o.remainingKopecks / 100,
        minutes: o.defaultMinutes,
      });
      if (!r.ok) {
        await ctx.answerCallbackQuery({ text: r.message.slice(0, 190), show_alert: true });
        return;
      }
      pending.delete(key);
      await ctx.answerCallbackQuery({ text: `Платёж №${r.data.seq} отправлен клиенту` });
      await safeDelete(ctx, ctx.callbackQuery.message?.message_id);
      return;
    }

    if (action === 'reply') {
      await ctx.answerCallbackQuery();
      const prompt = await say(
        ctx,
        `✍️ <b>Ответ клиенту · заявка ${label}</b>\nНапишите следующим сообщением (текст, фото, видео, файл) — оно уйдёт клиенту в личку.`,
        { reply_markup: cancelRow(orderId) },
      );
      pending.set(key, { kind: 'reply', orderId, promptMessageId: prompt?.message_id, expires: Date.now() + TTL });
      return;
    }

    if (action === 'done') {
      if (!confirmed) {
        await ctx.answerCallbackQuery();
        const warn =
          o.paymentsCount === 0
            ? '\n⚠️ Платежей клиенту не направлялось.'
            : o.unconfirmed > 0
              ? `\n⚠️ Не подтверждено клиентом платежей: <b>${o.unconfirmed}</b>.`
              : o.remainingKopecks > 100
                ? `\n⚠️ Направлено меньше расчётной суммы — осталось ${kop(o.remainingKopecks)} ₽.`
                : '';
        await say(
          ctx,
          `🏁 <b>Завершить заявку ${label}?</b>\n` +
            `Будет списано <b>${o.usdt} USDT</b> с заблокированного баланса клиента.\n` +
            `Направлено: ${kop(o.sentKopecks)} ₽ из ${kop(o.toAmountKopecks)} ₽ · подтверждено: ${kop(o.confirmedKopecks)} ₽.${warn}`,
          {
            reply_markup: new InlineKeyboard()
              .text('Да, завершить', `o:done:${orderId}:y`)
              .text('Нет', `o:no:${orderId}`),
          },
        );
        return;
      }
      const r = await internal('POST', `/orders/${orderId}/complete`, { actor });
      if (!r.ok) {
        await ctx.answerCallbackQuery({ text: r.message.slice(0, 190), show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: 'Заявка завершена' });
      await safeDelete(ctx, ctx.callbackQuery.message?.message_id);
      return;
    }

    if (action === 'cancel') {
      if (!confirmed) {
        await ctx.answerCallbackQuery();
        const warn =
          o.confirmedKopecks > 0
            ? `\n⚠️ Клиент уже подтвердил получение <b>${kop(o.confirmedKopecks)} ₽</b> — отмена вернёт USDT клиенту!`
            : '';
        await say(
          ctx,
          `🚫 <b>Отменить заявку ${label}?</b>\n${o.usdt} USDT будут разблокированы на балансе клиента.${warn}`,
          {
            reply_markup: new InlineKeyboard()
              .text('Да, отменить', `o:cancel:${orderId}:y`)
              .text('Нет', `o:no:${orderId}`),
          },
        );
        return;
      }
      const r = await internal('POST', `/orders/${orderId}/cancel`, { actor });
      if (!r.ok) {
        await ctx.answerCallbackQuery({ text: r.message.slice(0, 190), show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: 'Заявка отменена' });
      await safeDelete(ctx, ctx.callbackQuery.message?.message_id);
    }
  });

  // ───────────── кнопки клиента: Пришло / Не пришло ─────────────
  bot.callbackQuery(/^p:(ok|no):([A-Za-z0-9]+)$/, async (ctx) => {
    const [, action, paymentId] = ctx.match as unknown as [string, string, string];
    const path = action === 'ok' ? 'confirm' : 'not-received';
    const r = await internal<{ ok: boolean; alert?: string }>('POST', `/payments/${paymentId}/${path}`, {
      telegramId: ctx.from.id,
    });
    if (!r.ok) {
      await ctx.answerCallbackQuery({ text: r.message.slice(0, 190), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({
      text: r.data.alert ? r.data.alert.slice(0, 190) : undefined,
      show_alert: !r.data.ok,
    });
  });

  // ───────────── сообщения ─────────────
  // Группа операторов: только ответы по ожидающим действиям, меню клиента там не показываем
  bot.on('message', async (ctx, next) => {
    if (ctx.chat.type === 'private') return next();
    if (ctx.message.text?.startsWith('/')) return next();
    await tryPending(ctx);
  });

  // Медиа в личке: видео по спорному платежу / вложения к заявке
  bot.on(
    [
      'message:photo',
      'message:video',
      'message:video_note',
      'message:document',
      'message:voice',
      'message:animation',
    ],
    async (ctx) => {
      if (ctx.chat.type !== 'private') return;
      if (await tryPending(ctx)) return;
      const m: any = ctx.message;
      const mediaType = m.video
        ? 'video'
        : m.video_note
          ? 'video_note'
          : m.animation
            ? 'animation'
            : m.document
              ? 'document'
              : m.voice
                ? 'voice'
                : 'photo';
      const fileId =
        m.video?.file_id ||
        m.video_note?.file_id ||
        m.animation?.file_id ||
        m.document?.file_id ||
        m.voice?.file_id ||
        m.photo?.[m.photo.length - 1]?.file_id;
      const r = await internal<any>('POST', '/client-message', {
        telegramId: ctx.from.id,
        chatId: ctx.chat.id,
        messageId: m.message_id,
        mediaType,
        fileId,
        text: m.caption,
      });
      if (!r.ok) {
        await ctx.reply(`⚠️ ${r.message}`);
        return;
      }
      if (!r.data.handled) {
        await ctx.reply('Сейчас нет активной заявки. Создайте заявку в приложении — оператор ответит в этом чате.');
        return;
      }
      if (!r.data.silent) await react(ctx);
      if (r.data.reminder) await ctx.reply(r.data.reminder);
    },
  );
}

/** Для обработчика текста в личке: ожидающее действие админа или сообщение клиента → оператору */
export async function handlePrivateText(ctx: Context, text: string): Promise<boolean> {
  if (await tryPending(ctx)) return true;
  if (!ctx.from || !ctx.chat) return false;
  const r = await internal<any>('POST', '/client-message', {
    telegramId: ctx.from.id,
    chatId: ctx.chat.id,
    messageId: ctx.message!.message_id,
    text,
  });
  if (!r.ok || !r.data.handled) return false;
  await react(ctx);
  if (r.data.reminder) await ctx.reply(r.data.reminder);
  return true;
}
