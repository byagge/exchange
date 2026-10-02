/** Shared admin formatting helpers */

export const statusRu: Record<string, string> = {
  pending: 'В обработке',
  confirming: 'Подтверждение',
  credited: 'Зачислено',
  failed: 'Ошибка',
  expired: 'Истекло',
  draft: 'Черновик',
  awaiting_funds: 'Ожидает оплаты',
  locked: 'Заблокировано',
  processing: 'В обработке',
  awaiting_payout: 'Ожидает выплаты',
  completed: 'Выполнено',
  cancelled: 'Отменено',
  active: 'Активен',
  banned: 'Бан',
  frozen: 'Заморожен',
};

export const sourceRu: Record<string, string> = {
  onchain: 'Ончейн',
  cryptobot: 'CryptoBot',
  fiat: 'Фиат',
};

export const methodRu: Record<string, string> = {
  onchain: 'Ончейн',
  cryptobot: 'Чек КБ',
  fiat: 'Фиат',
  sbp: 'СБП',
  card: 'Карта',
};

export function statusLabel(s: string) {
  return statusRu[s] || s;
}

export function sourceLabel(s?: string | null) {
  if (!s) return 'нет';
  return sourceRu[s] || s;
}

export function methodLabel(s?: string | null) {
  if (!s) return 'нет';
  return methodRu[s] || s;
}

export function statusClass(s: string) {
  if (['credited', 'completed', 'active', 'ok'].includes(s)) return 'ok';
  if (['failed', 'cancelled', 'expired', 'banned'].includes(s)) return 'err';
  return 'warn';
}

export function fmtUsdt(micros: number | string | undefined) {
  return (Number(micros || 0) / 1e6).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function fmtRub(kopecks: number | string | undefined) {
  return (Number(kopecks || 0) / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtDate(d: string | Date | undefined) {
  if (!d) return 'нет';
  return new Date(d).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ledgerOf(user: any, kind = 'available') {
  return Number(user?.ledger?.find((a: any) => a.kind === kind)?.balance || 0);
}
