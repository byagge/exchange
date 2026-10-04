import { Address } from '@ton/core';

export const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
/** Официальный Tether USDT jetton master (TON) */
export const USDT_TON_JETTON = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

export type IncomingTransfer = { txHash: string; amountMicros: number; from?: string };
export type ScanResult = { ok: true; transfers: IncomingTransfer[] } | { ok: false; error: string };

/** Меньше этого — пыль/«address poisoning», не зачисляем */
export const DUST_MICROS = 10_000; // 0.01 USDT

function rawTon(addr: string | undefined | null): string | null {
  if (!addr) return null;
  try {
    return Address.parse(addr).toRawString().toLowerCase();
  } catch {
    return null;
  }
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) return { ok: false as const, status: res.status, json: null as any };
    return { ok: true as const, status: res.status, json: (await res.json()) as any };
  } finally {
    clearTimeout(t);
  }
}

// ───────────────────────── TRC20 ─────────────────────────

export function parseTronTransfers(json: any, address: string): IncomingTransfer[] {
  const out: IncomingTransfer[] = [];
  for (const t of json?.data || []) {
    if (String(t.to) !== address) continue;
    const tokenAddr = String(t.token_info?.address || '');
    if (tokenAddr && tokenAddr !== USDT_TRC20) continue;
    if (t.type && String(t.type).toLowerCase() !== 'transfer') continue;
    const decimals = Number(t.token_info?.decimals ?? 6);
    const raw = Number(t.value);
    if (!Number.isFinite(raw) || raw <= 0 || !t.transaction_id) continue;
    const micros = Math.round((raw / 10 ** decimals) * 1e6);
    if (micros < DUST_MICROS) continue;
    out.push({ txHash: String(t.transaction_id), amountMicros: micros, from: t.from });
  }
  return out;
}

export async function scanTrc20(address: string): Promise<ScanResult> {
  const headers: Record<string, string> = {};
  if (process.env.TRONGRID_API_KEY) headers['TRON-PRO-API-KEY'] = process.env.TRONGRID_API_KEY;
  try {
    const r = await getJson(
      `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20` +
        `?only_to=true&only_confirmed=true&limit=50&contract_address=${USDT_TRC20}`,
      headers,
    );
    if (!r.ok) return { ok: false, error: `TronGrid HTTP ${r.status}` };
    return { ok: true, transfers: parseTronTransfers(r.json, address) };
  } catch (e: any) {
    return { ok: false, error: `TronGrid: ${e?.message || e}` };
  }
}

// ───────────────────────── TON ─────────────────────────

export function parseTonapiHistory(json: any, address: string): IncomingTransfer[] {
  const mine = rawTon(address);
  const out: IncomingTransfer[] = [];
  for (const op of json?.operations || []) {
    if (String(op.operation || '').toLowerCase() !== 'transfer') continue;
    if (rawTon(op.destination?.address) !== mine) continue;
    const master = rawTon(op.jetton?.address);
    if (master && master !== rawTon(USDT_TON_JETTON)) continue;
    const decimals = Number(op.jetton?.decimals ?? 6);
    const raw = Number(op.amount);
    if (!Number.isFinite(raw) || raw <= 0 || !op.transaction_hash) continue;
    const micros = Math.round((raw / 10 ** decimals) * 1e6);
    if (micros < DUST_MICROS) continue;
    out.push({ txHash: String(op.transaction_hash), amountMicros: micros, from: op.source?.address });
  }
  return out;
}

export function parseToncenterTransfers(json: any, address: string): IncomingTransfer[] {
  const mine = rawTon(address);
  const usdt = rawTon(USDT_TON_JETTON);
  const out: IncomingTransfer[] = [];
  for (const t of json?.jetton_transfers || []) {
    if (t.transaction_aborted) continue;
    if (rawTon(t.destination) !== mine) continue;
    if (rawTon(t.jetton_master) !== usdt) continue;
    const raw = Number(t.amount);
    if (!Number.isFinite(raw) || raw <= 0 || !t.transaction_hash) continue;
    const micros = Math.round(raw); // у USDT на TON 6 знаков — как и у нас
    if (micros < DUST_MICROS) continue;
    out.push({ txHash: String(t.transaction_hash), amountMicros: micros, from: t.source });
  }
  return out;
}

async function scanTonViaTonapi(address: string): Promise<ScanResult> {
  const key = process.env.TON_API_KEY;
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  try {
    const r = await getJson(
      `https://tonapi.io/v2/accounts/${encodeURIComponent(address)}/jettons/${USDT_TON_JETTON}/history?limit=50`,
      headers,
    );
    // 404 — у адреса ещё нет USDT-кошелька: пополнений нет
    if (r.status === 404) return { ok: true, transfers: [] };
    if (!r.ok) return { ok: false, error: `TonAPI HTTP ${r.status}` };
    return { ok: true, transfers: parseTonapiHistory(r.json, address) };
  } catch (e: any) {
    return { ok: false, error: `TonAPI: ${e?.message || e}` };
  }
}

async function scanTonViaToncenter(address: string): Promise<ScanResult> {
  const key = process.env.TONCENTER_API_KEY;
  const headers: Record<string, string> = key ? { 'X-API-Key': key } : {};
  try {
    const r = await getJson(
      `https://toncenter.com/api/v3/jetton/transfers?owner_address=${encodeURIComponent(address)}` +
        `&jetton_master=${encodeURIComponent(USDT_TON_JETTON)}&direction=in&limit=50&sort=desc`,
      headers,
    );
    if (!r.ok) return { ok: false, error: `Toncenter HTTP ${r.status}` };
    return { ok: true, transfers: parseToncenterTransfers(r.json, address) };
  } catch (e: any) {
    return { ok: false, error: `Toncenter: ${e?.message || e}` };
  }
}

/** TonAPI (если есть ключ) → запасной Toncenter; без ключа наоборот: Toncenter → TonAPI */
export async function scanTon(address: string): Promise<ScanResult> {
  const order = process.env.TON_API_KEY
    ? [scanTonViaTonapi, scanTonViaToncenter]
    : [scanTonViaToncenter, scanTonViaTonapi];
  let last: ScanResult = { ok: false, error: 'no provider' };
  for (const fn of order) {
    last = await fn(address);
    if (last.ok) return last;
  }
  return last;
}
