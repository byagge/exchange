import type { Network } from '@exchange/db';
import { isValidOnchainAddress } from './hd';

const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
/** Official Tether USDT jetton master on TON */
const USDT_TON_JETTON = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

export type OnchainBalanceResult = {
  usdt: number | null;
  source: 'rpc' | 'unavailable' | 'invalid_address';
  error?: string;
};

export async function fetchOnchainUsdt(
  network: Network,
  address: string,
): Promise<OnchainBalanceResult> {
  if (!isValidOnchainAddress(network, address)) {
    return {
      usdt: null,
      source: 'invalid_address',
      error: 'Адрес невалидный (старый placeholder). Пересоздайте кошелёк.',
    };
  }
  if (network === 'TRC20') return fetchTrc20Usdt(address);
  return fetchTonUsdt(address);
}

async function fetchTrc20Usdt(address: string): Promise<OnchainBalanceResult> {
  const key = process.env.TRONGRID_API_KEY;
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (key) headers['TRON-PRO-API-KEY'] = key;
    const res = await fetch(`https://api.trongrid.io/v1/accounts/${address}`, {
      headers,
    });
    if (res.status === 404) return { usdt: 0, source: 'rpc' };
    if (!res.ok) {
      return { usdt: null, source: 'unavailable', error: `TronGrid ${res.status}` };
    }
    const json = (await res.json()) as { data?: any[]; success?: boolean };
    const acc = json.data?.[0];
    if (!acc) return { usdt: 0, source: 'rpc' };

    const trc20: Record<string, string>[] = Array.isArray(acc.trc20) ? acc.trc20 : [];
    let raw = '0';
    for (const row of trc20) {
      const val = row[USDT_TRC20] ?? row[USDT_TRC20.toLowerCase()];
      if (val != null) {
        raw = String(val);
        break;
      }
    }
    return { usdt: Number(raw) / 1e6, source: 'rpc' };
  } catch (e: any) {
    return { usdt: null, source: 'unavailable', error: e?.message || 'tron error' };
  }
}

async function fetchTonUsdt(address: string): Promise<OnchainBalanceResult> {
  const key = process.env.TON_API_KEY;
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(
      `https://tonapi.io/v2/accounts/${encodeURIComponent(address)}/jettons?currencies=usd`,
      { headers },
    );
    if (res.status === 404) return { usdt: 0, source: 'rpc' };
    if (!res.ok) {
      // Without API key TonAPI may rate-limit; still try account endpoint
      if (res.status === 401 || res.status === 429) {
        return {
          usdt: null,
          source: 'unavailable',
          error: 'Нужен TON_API_KEY в .env (tonapi.io)',
        };
      }
      return { usdt: null, source: 'unavailable', error: `TonAPI ${res.status}` };
    }
    const json = (await res.json()) as { balances?: any[] };
    const list = json.balances || [];
    const hit = list.find((b) => {
      const master = String(b.jetton?.address || b.jetton?.master || '');
      return (
        master === USDT_TON_JETTON ||
        String(b.jetton?.symbol || '').toUpperCase() === 'USDT'
      );
    });
    if (!hit) return { usdt: 0, source: 'rpc' };
    const decimals = Number(hit.jetton?.decimals ?? 6);
    const raw = Number(hit.balance || 0);
    return { usdt: raw / 10 ** decimals, source: 'rpc' };
  } catch (e: any) {
    return { usdt: null, source: 'unavailable', error: e?.message || 'ton error' };
  }
}
