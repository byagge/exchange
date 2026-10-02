'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/AdminShell';
import { adminApi, getToken } from '@/lib/api';

export default function WithdrawalsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    adminApi('/api/admin/withdrawals').then(setRows).catch(() => router.replace('/login'));
  }, [router]);

  return (
    <AdminShell>
      <h1 className="h1">Выводы</h1>
      <p className="sub">CryptoBot / on-chain</p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Method</th>
              <th>Amount</th>
              <th>Destination</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id}>
                <td>@{w.user?.username || '—'}</td>
                <td>{w.method}</td>
                <td>{(Number(w.amountMicros) / 1e6).toFixed(4)} USDT</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{w.destination}</td>
                <td>
                  <span className={`badge ${w.status === 'completed' ? 'ok' : 'warn'}`}>{w.status}</span>
                </td>
                <td>{new Date(w.createdAt).toLocaleString('ru-RU')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
