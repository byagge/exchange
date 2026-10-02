'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/AdminShell';
import { adminApi, getToken } from '@/lib/api';

function fmtUsdt(micros: number | string) {
  return (Number(micros) / 1e6).toFixed(2);
}

function fmtRub(kopecks: number | string) {
  return (Number(kopecks) / 100).toFixed(2);
}

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);

  async function load() {
    setOrders(await adminApi('/api/admin/orders'));
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    load().catch(() => router.replace('/login'));
  }, [router]);

  async function dispatch(id: string, defaultRub: number) {
    const amountRub = prompt('Сумма платежа, ₽', String(defaultRub)) || '';
    const timerMinutes = prompt('Таймер, минут', '30') || '30';
    if (!amountRub) return;
    await adminApi(`/api/admin/orders/${id}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({
        amountRub: Number(amountRub.replace(',', '.')),
        timerMinutes: Number(timerMinutes) || 30,
      }),
    });
    await load();
  }

  async function fulfill(id: string) {
    const proof = prompt('Proof / комментарий выплаты') || '';
    await adminApi(`/api/admin/orders/${id}/fulfill`, {
      method: 'POST',
      body: JSON.stringify({ proof, note: 'paid' }),
    });
    await load();
  }

  async function reject(id: string) {
    const reason = prompt('Причина отказа') || 'rejected';
    await adminApi(`/api/admin/orders/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    await load();
  }

  return (
    <AdminShell>
      <h1 className="h1">Заявки на обмен</h1>
      <p className="sub">Только USDT → RUB. Направьте сумму и таймер, затем подтвердите выплату.</p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Сумма</th>
              <th>Реквизиты</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const req = o.requisites || {};
              const payout =
                o.payoutAmountKopecks != null ? o.payoutAmountKopecks : o.toAmountKopecks;
              const actionable = o.status === 'awaiting_payout' || o.status === 'processing';
              return (
                <tr key={o.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {o.id.slice(0, 8)}
                  </td>
                  <td>@{o.user?.username || o.userId.slice(0, 6)}</td>
                  <td>
                    {fmtUsdt(o.fromAmountMicros)} → {fmtRub(payout)} ₽
                    <div style={{ color: 'var(--text-tertiary)' }}>rate {o.rate}</div>
                  </td>
                  <td>
                    <div style={{ fontSize: 12 }}>
                      {req.fio && <div>{req.fio}</div>}
                      {req.bank && <div>{req.bank}</div>}
                      {req.phone || req.card || '—'}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        o.status === 'completed'
                          ? 'ok'
                          : actionable
                            ? 'warn'
                            : ''
                      }`}
                    >
                      {o.status}
                    </span>
                    {o.payoutDeadline && (
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        до {new Date(o.payoutDeadline).toLocaleString('ru-RU')}
                      </div>
                    )}
                    {!!o.clientProofFiles?.length && (
                      <div style={{ fontSize: 11 }}>📎 видео клиента</div>
                    )}
                  </td>
                  <td>
                    {actionable && (
                      <>
                        {!o.dispatchedAt && (
                          <button
                            className="btn"
                            onClick={() => dispatch(o.id, Number(payout) / 100)}
                          >
                            Направить
                          </button>
                        )}
                        <button className="btn primary" onClick={() => fulfill(o.id)}>
                          Выплатить RUB
                        </button>
                        <button className="btn danger" onClick={() => reject(o.id)}>
                          Отклонить
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
