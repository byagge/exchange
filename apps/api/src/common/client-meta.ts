import type { Request } from 'express';

export type ClientMeta = {
  ip: string | null;
  userAgent: string | null;
  device: string | null;
  platform: string | null;
};

function cleanIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let ip = raw.split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  // IPv4 with port (редко, но бывает за некоторыми прокси)
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.split(':')[0];
  return ip || null;
}

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Реальный IP клиента: nginx кладёт его в X-Real-IP / X-Forwarded-For. */
export function resolveIp(req: Request): string | null {
  return (
    cleanIp(header(req, 'cf-connecting-ip')) ||
    cleanIp(header(req, 'x-real-ip')) ||
    cleanIp(header(req, 'x-forwarded-for')) ||
    cleanIp(req.ip || req.socket?.remoteAddress)
  );
}

const TG_PLATFORMS: Record<string, string> = {
  ios: 'iOS',
  android: 'Android',
  android_x: 'Android',
  macos: 'macOS',
  tdesktop: 'Desktop',
  weba: 'Web',
  webk: 'Web',
  web: 'Web',
  unknown: '',
};

/** Человекочитаемое устройство из User-Agent (+ платформа Telegram WebApp). */
export function describeDevice(ua: string | null, tgPlatform?: string | null, tgVersion?: string | null) {
  const parts: string[] = [];
  const s = ua || '';

  let model = '';
  let os = '';

  const iphone = s.match(/\b(iPhone|iPad|iPod)\b/);
  const android = s.match(/Android\s([\d.]+)/);
  if (iphone) {
    model = iphone[1];
    const v = s.match(/OS (\d+)[_.](\d+)/);
    os = v ? `iOS ${v[1]}.${v[2]}` : 'iOS';
  } else if (android) {
    os = `Android ${android[1]}`;
    const m = s.match(/Android[\s\d.]*;\s*([^;)]+?)(?:\sBuild|\)|;)/);
    const candidate = m?.[1]?.trim();
    if (candidate && !/^(wv|U|K|Mobile)$/i.test(candidate)) model = candidate;
  } else if (/Windows NT/.test(s)) {
    const v = s.match(/Windows NT ([\d.]+)/)?.[1];
    os = v === '10.0' ? 'Windows 10/11' : `Windows ${v || ''}`.trim();
  } else if (/Mac OS X/.test(s)) {
    const v = s.match(/Mac OS X (\d+)[_.](\d+)/);
    os = v ? `macOS ${v[1]}.${v[2]}` : 'macOS';
  } else if (/Linux|X11/.test(s)) {
    os = 'Linux';
  }

  if (model) parts.push(model);
  if (os) parts.push(os);

  let browser = '';
  if (/Telegram/i.test(s)) browser = tgPlatform || tgVersion ? '' : 'Telegram';
  else if (/Edg\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/YaBrowser/.test(s)) browser = 'Яндекс Браузер';
  else if (/SamsungBrowser/.test(s)) browser = 'Samsung Browser';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';
  if (browser) parts.push(browser);

  const plat = tgPlatform ? TG_PLATFORMS[tgPlatform.toLowerCase()] ?? tgPlatform : '';
  if (plat || tgVersion) {
    parts.push(`Telegram ${[plat, tgVersion].filter(Boolean).join(' ')}`.trim());
  }

  const out = parts.join(' · ').slice(0, 200);
  return out || null;
}

export function readClientMeta(req: Request): ClientMeta {
  const ua = (header(req, 'user-agent') || '').slice(0, 400) || null;
  const platform = (header(req, 'x-tg-platform') || '').slice(0, 32) || null;
  const version = (header(req, 'x-tg-version') || '').slice(0, 16) || null;
  return {
    ip: resolveIp(req),
    userAgent: ua,
    platform,
    device: describeDevice(ua, platform, version),
  };
}
