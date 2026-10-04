import { createHash } from 'crypto';

function secret(): string {
  const explicit = (process.env.INTERNAL_SECRET || '').trim();
  if (explicit) return explicit;
  const base = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY || 'dev-insecure';
  return createHash('sha256').update(`bot-internal:v1:${base}`).digest('hex');
}

function baseUrl(): string {
  return (
    process.env.API_INTERNAL_URL ||
    `http://${process.env.API_HOST && process.env.API_HOST !== '0.0.0.0' ? process.env.API_HOST : '127.0.0.1'}:${process.env.API_PORT || 3010}`
  ).replace(/\/$/, '');
}

export type ApiResult<T = any> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** Вызов внутреннего API (бот → API на том же сервере) */
export async function internal<T = any>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<ApiResult<T>> {
  try {
    const url = new URL(`${baseUrl()}/api/internal${path}`);
    if (method === 'GET' && body) {
      for (const [k, v] of Object.entries(body)) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret() },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = Array.isArray(json.message) ? json.message.join(', ') : json.message;
      return { ok: false, status: res.status, message: msg || `Ошибка API (${res.status})` };
    }
    return { ok: true, data: json as T };
  } catch (e: any) {
    return { ok: false, status: 0, message: `API недоступен: ${e?.message || e}` };
  }
}
