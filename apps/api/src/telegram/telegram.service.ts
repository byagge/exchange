import { Injectable, Logger } from '@nestjs/common';

export type TgResult<T = any> = { ok: true; result: T } | { ok: false; error: string; code?: number };

/** Тонкая обёртка над Bot API (HTTP). Бот-процесс и API используют один и тот же токен. */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  get enabled() {
    return !!process.env.BOT_TOKEN;
  }

  async call<T = any>(method: string, payload: Record<string, unknown>): Promise<TgResult<T>> {
    const token = process.env.BOT_TOKEN;
    if (!token) return { ok: false, error: 'BOT_TOKEN not configured' };
    try {
      const res = await fetch(`${process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as any;
      if (json?.ok) return { ok: true, result: json.result as T };
      return {
        ok: false,
        error: String(json?.description || `HTTP ${res.status}`),
        code: json?.error_code ?? res.status,
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network error' };
    }
  }

  /**
   * Вызов с мягким фолбэком: если Telegram не принял цветные кнопки (`style`),
   * повторяем без них — карточка всё равно должна дойти.
   */
  async callSafe<T = any>(method: string, payload: Record<string, unknown>): Promise<TgResult<T>> {
    const first = await this.call<T>(method, payload);
    if (first.ok) return first;
    const markup = payload.reply_markup as { inline_keyboard?: any[][] } | undefined;
    if (markup?.inline_keyboard && /style|BUTTON|button/i.test(first.error)) {
      const plain = {
        ...payload,
        reply_markup: {
          inline_keyboard: markup.inline_keyboard.map((row) =>
            row.map((b) => {
              const { style: _s, icon_custom_emoji_id: _i, ...rest } = b;
              return rest;
            }),
          ),
        },
      };
      return this.call<T>(method, plain);
    }
    return first;
  }

  sendMessage(
    chatId: string | number | bigint,
    text: string,
    extra: Record<string, unknown> = {},
  ) {
    return this.callSafe<{ message_id: number }>('sendMessage', {
      chat_id: chatId.toString(),
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  }

  editMessageText(
    chatId: string | number | bigint,
    messageId: number,
    text: string,
    extra: Record<string, unknown> = {},
  ) {
    return this.callSafe('editMessageText', {
      chat_id: chatId.toString(),
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  }

  copyMessage(
    chatId: string | number | bigint,
    fromChatId: string | number | bigint,
    messageId: number,
    extra: Record<string, unknown> = {},
  ) {
    return this.callSafe<{ message_id: number }>('copyMessage', {
      chat_id: chatId.toString(),
      from_chat_id: fromChatId.toString(),
      message_id: messageId,
      parse_mode: 'HTML',
      ...extra,
    });
  }

  createForumTopic(chatId: string, name: string) {
    return this.call<{ message_thread_id: number }>('createForumTopic', {
      chat_id: chatId,
      name: name.slice(0, 128),
    });
  }

  editForumTopic(chatId: string, threadId: number, name: string) {
    return this.call('editForumTopic', {
      chat_id: chatId,
      message_thread_id: threadId,
      name: name.slice(0, 128),
    });
  }

  closeForumTopic(chatId: string, threadId: number) {
    return this.call('closeForumTopic', { chat_id: chatId, message_thread_id: threadId });
  }

  reopenForumTopic(chatId: string, threadId: number) {
    return this.call('reopenForumTopic', { chat_id: chatId, message_thread_id: threadId });
  }

  warn(msg: string) {
    this.logger.warn(msg);
  }
}

export function escHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
