#!/usr/bin/env node
/**
 * Smoke test against running API (dev auth).
 * Usage: node scripts/smoke.mjs
 */
const API = process.env.API_URL || 'http://localhost:3001';

async function req(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log('health', await req('/api/health'));

  const auth = await req('/api/auth/telegram', {
    method: 'POST',
    body: JSON.stringify({ initData: 'dev:9001:smoke' }),
  });
  console.log('auth ok', auth.user.telegramId);
  const token = auth.token;

  const wallets = await req('/api/wallets/me', { token });
  console.log(
    'wallets',
    wallets.wallets.map((w) => `${w.network}:${w.address.slice(0, 12)}…`),
  );

  await req('/api/deposits/simulate', {
    method: 'POST',
    token,
    body: JSON.stringify({ amountUsdt: 50, network: 'TRC20' }),
  });
  const bal = await req('/api/balance', { token });
  console.log('balance', bal.available / 1e6, 'USDT');

  const quote = await req('/api/exchange/quote?amount=10', { token });
  console.log('quote', quote.rate, '→', quote.toAmountKopecks / 100, 'RUB');

  const order = await req('/api/exchange/orders', {
    method: 'POST',
    token,
    body: JSON.stringify({
      amountUsdt: 10,
      method: 'fiat',
      requisites: { type: 'sbp', phone: '+79990001122', bank: 'T-Bank' },
    }),
  });
  console.log('order', order.id, order.status);

  const admin = await req('/api/auth/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@exchange.local',
      password: 'ChangeMe123!',
    }),
  });
  console.log('admin ok', admin.admin.email);

  await req(`/api/admin/orders/${order.id}/fulfill`, {
    method: 'POST',
    token: admin.token,
    body: JSON.stringify({ proof: 'smoke-paid', note: 'ok' }),
  });
  console.log('order fulfilled');

  const bal2 = await req('/api/balance', { token });
  console.log('balance after', bal2.available / 1e6, 'USDT');

  const dash = await req('/api/admin/dashboard', { token: admin.token });
  console.log('dashboard', dash);

  console.log('SMOKE OK');
}

main().catch((e) => {
  console.error('SMOKE FAIL', e.message);
  process.exit(1);
});
