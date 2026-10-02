import crypto from 'crypto';

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
};

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86400,
): { ok: true; user: TelegramUser; authDate: number } | { ok: false; error: string } {
  if (!initData) return { ok: false, error: 'empty initData' };
  if (!botToken) {
    // Dev fallback only when explicitly allowed
    if (process.env.ALLOW_DEV_AUTH === 'true' && initData.startsWith('dev:')) {
      const [, id, username] = initData.split(':');
      return {
        ok: true,
        user: { id: Number(id) || 1, username: username || 'devuser', first_name: 'Dev' },
        authDate: Math.floor(Date.now() / 1000),
      };
    }
    return { ok: false, error: 'BOT_TOKEN not configured' };
  }

  // Even with BOT_TOKEN, block forged `dev:` payloads
  if (initData.startsWith('dev:')) {
    if (process.env.ALLOW_DEV_AUTH === 'true') {
      const [, id, username] = initData.split(':');
      return {
        ok: true,
        user: { id: Number(id) || 1, username: username || 'devuser', first_name: 'Dev' },
        authDate: Math.floor(Date.now() / 1000),
      };
    }
    return { ok: false, error: 'dev auth disabled' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, error: 'missing hash' };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calculated !== hash) return { ok: false, error: 'invalid hash' };

  const authDate = Number(params.get('auth_date') || 0);
  if (maxAgeSec > 0 && Date.now() / 1000 - authDate > maxAgeSec) {
    return { ok: false, error: 'initData expired' };
  }

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, error: 'missing user' };
  try {
    const user = JSON.parse(userRaw) as TelegramUser;
    return { ok: true, user, authDate };
  } catch {
    return { ok: false, error: 'invalid user json' };
  }
}
