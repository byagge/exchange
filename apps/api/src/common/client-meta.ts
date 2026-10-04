import type { Request } from 'express';

export type ClientMeta = {
  ip: string | null;
  userAgent: string | null;
  device: string | null;
};

export function extractClientMeta(req?: Request | null): ClientMeta {
  if (!req) return { ip: null, userAgent: null, device: null };

  const xf = (req.headers['x-forwarded-for'] as string | undefined) || '';
  const ip =
    xf.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string | undefined) ||
    req.ip ||
    req.socket?.remoteAddress ||
    null;

  const userAgent = (req.headers['user-agent'] as string | undefined) || null;
  const deviceHeader = (req.headers['x-device'] as string | undefined) || null;
  const platform = (req.headers['x-tg-platform'] as string | undefined) || null;

  const device =
    deviceHeader ||
    platform ||
    (userAgent ? summarizeUa(userAgent) : null);

  return { ip: ip || null, userAgent, device };
}

function summarizeUa(ua: string): string {
  const s = ua.slice(0, 180);
  if (/iPhone|iPad/i.test(s)) return 'iOS';
  if (/Android/i.test(s)) return 'Android';
  if (/Windows/i.test(s)) return 'Windows';
  if (/Mac OS/i.test(s)) return 'macOS';
  if (/Linux/i.test(s)) return 'Linux';
  return s.slice(0, 64);
}
