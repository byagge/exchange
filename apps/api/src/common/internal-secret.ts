import { createHash } from 'crypto';

/**
 * Секрет между API и ботом (оба читают один .env).
 * По умолчанию выводится из JWT_SECRET — отдельной настройки не требуется.
 */
export function internalSecret(): string {
  const explicit = (process.env.INTERNAL_SECRET || '').trim();
  if (explicit) return explicit;
  const base = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY || 'dev-insecure';
  return createHash('sha256').update(`bot-internal:v1:${base}`).digest('hex');
}
