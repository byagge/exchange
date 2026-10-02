/** Telegram IDs that always have admin access (comma-separated in .env). */
export function parseAdminTelegramIds(): string[] {
  const raw = process.env.ADMIN_TELEGRAM_IDS || '';
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function userIsEnvAdmin(telegramId: string | number | bigint): boolean {
  const id = String(telegramId);
  return parseAdminTelegramIds().includes(id);
}
