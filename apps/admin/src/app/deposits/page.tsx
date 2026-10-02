'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/AdminShell';
import { adminApi, getToken } from '@/lib/api';

export default function DepositsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    adminApi('/api/admin/deposits').then(setRows).catch(() => router.replace('/login'));
  }, [router]);

  return (
    <AdminShell>
      <h1 className="h1">Депозиты</h1>
      <p className="sub">On-chain и CryptoBot</p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Source</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Ref</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>@{d.user?.username || '—'}</td>
                <td>
                  {d.source} {d.network || ''}
                </td>
                <td>{(Number(d.amountMicros) / 1e6).toFixed(4)} USDT</td>
                <td>
                  <span className={`badge ${d.status === 'credited' ? 'ok' : 'warn'}`}>{d.status}</span>
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {d.txHash || d.checkId || '—'}
                </td>
                <td>{new Date(d.createdAt).toLocaleString('ru-RU')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
