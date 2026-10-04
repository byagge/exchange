const API_BASE = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(
  path: string,
  opts: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const headers = new Headers(opts.headers || {});
  headers.set('Content-Type', 'application/json');
  if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`);
  // Платформа Telegram — для определения устройства клиента на сервере
  const wa = (window as any).Telegram?.WebApp;
  if (wa?.platform) headers.set('X-Tg-Platform', String(wa.platform));
  if (wa?.version) headers.set('X-Tg-Version', String(wa.version));

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const msg = Array.isArray(data.message)
      ? data.message.join(', ')
      : data.message || data.error || `Ошибка запроса (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}
export function getTelegramInitData(): string {
  const params = new URLSearchParams(window.location.search);
  const devId = params.get('dev');
  if (devId) {
    return `dev:${devId}:${params.get('user') || 'demo'}`;
  }

  const tg = (window as any).Telegram?.WebApp;
  if (tg?.initData) return tg.initData as string;

  // Local fallback without query
  return 'dev:1001:demo';
}

export function haptic(type: 'light' | 'medium' | 'success' = 'light') {
  const tg = (window as any).Telegram?.WebApp;
  try {
    if (type === 'success') tg?.HapticFeedback?.notificationOccurred('success');
    else tg?.HapticFeedback?.impactOccurred(type);
  } catch {
    /* noop */
  }
}

export function formatMicros(micros: number) {
  return (micros / 1_000_000).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}
