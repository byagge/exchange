import { createHash } from 'crypto';

const apiBase = () => (process.env.API_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');

/** Same derivation as API InternalGuard — no manual INTERNAL_API_KEY needed. */
function resolveInternalKey(): string {
  const explicit = (process.env.INTERNAL_API_KEY || '').trim();
  if (explicit) return explicit;
  const seed = process.env.BOT_TOKEN || process.env.JWT_SECRET || 'exchange-internal';
  return createHash('sha256').update(`ex-internal:${seed}`).digest('hex').slice(0, 48);
}

export async function internalApi<T = any>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${apiBase()}/api${path}`, {
    method: opts.method || 'GET',
    headers: {
      'content-type': 'application/json',
      'x-internal-key': resolveInternalKey(),
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as any)?.message || `API ${res.status}`;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : String(msg));
  }
  return data as T;
}
