/** Minimal Telegram Bot API helpers (server-side). */

const API = () => `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

export async function tgCall<T = any>(
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  const token = process.env.BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${API()}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      console.warn(`[tg:${method}]`, json.description || json);
      return null;
    }
    return json.result ?? null;
  } catch (e) {
    console.warn(`[tg:${method}]`, e);
    return null;
  }
}

export async function tgSendMessage(
  chatId: string | number | bigint,
  text: string,
  extra: Record<string, unknown> = {},
) {
  return tgCall('sendMessage', {
    chat_id: chatId.toString(),
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

export async function tgCreateForumTopic(chatId: string | number, name: string) {
  return tgCall<{ message_thread_id: number; name: string }>('createForumTopic', {
    chat_id: chatId.toString(),
    name: name.slice(0, 128),
  });
}

export async function tgEditForumTopic(
  chatId: string | number,
  threadId: number,
  name: string,
) {
  return tgCall('editForumTopic', {
    chat_id: chatId.toString(),
    message_thread_id: threadId,
    name: name.slice(0, 128),
  });
}

export async function tgCopyMessage(
  toChatId: string | number | bigint,
  fromChatId: string | number | bigint,
  messageId: number,
  threadId?: number,
) {
  return tgCall('copyMessage', {
    chat_id: toChatId.toString(),
    from_chat_id: fromChatId.toString(),
    message_id: messageId,
    ...(threadId != null ? { message_thread_id: threadId } : {}),
  });
}

export async function tgForwardMessage(
  toChatId: string | number | bigint,
  fromChatId: string | number | bigint,
  messageId: number,
  threadId?: number,
) {
  return tgCall('forwardMessage', {
    chat_id: toChatId.toString(),
    from_chat_id: fromChatId.toString(),
    message_id: messageId,
    ...(threadId != null ? { message_thread_id: threadId } : {}),
  });
}
