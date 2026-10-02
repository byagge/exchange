'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/AdminShell';
import { adminApi, getToken } from '@/lib/api';

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [q, setQ] = useState('');

  async function load(query = q) {
    const list = await adminApi<any[]>(`/api/admin/users${query ? `?q=${encodeURIComponent(query)}` : ''}`);
    setUsers(list);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    load().catch(() => router.replace('/login'));
  }, [router]);

  async function patch(id: string, body: Record<string, unknown>) {
    await adminApi(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    await load();
  }

  return (
    <AdminShell>
      <h1 className="h1">Пользователи</h1>
      <p className="sub">Бан, лимиты, заморозка выводов</p>
      <div className="toolbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="username / telegramId / ref"
          style={{
            borderRadius: 999,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            padding: '10px 14px',
            minWidth: 260,
          }}
        />
        <button className="btn" onClick={() => load()}>
          Найти
        </button>
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Баланс</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const available = u.ledger?.find((a: any) => a.kind === 'available')?.balance || 0;
              return (
                <tr key={u.id}>
                  <td>
                    <div>@{u.username || '—'}</div>
                    <div style={{ color: 'var(--text-tertiary)' }}>TG {u.telegramId}</div>
                  </td>
                  <td>{(available / 1_000_000).toFixed(2)} USDT</td>
                  <td>
                    <span className={`badge ${u.status === 'active' ? 'ok' : 'warn'}`}>{u.status}</span>
                    {u.withdrawFrozen && <span className="badge warn"> freeze</span>}
                  </td>
                  <td>
                    {u.status !== 'banned' ? (
                      <button className="btn danger" onClick={() => patch(u.id, { status: 'banned' })}>
                        Ban
                      </button>
                    ) : (
                      <button className="btn" onClick={() => patch(u.id, { status: 'active' })}>
                        Unban
                      </button>
                    )}
                    <button
                      className="btn"
                      onClick={() => patch(u.id, { withdrawFrozen: !u.withdrawFrozen })}
                    >
                      {u.withdrawFrozen ? 'Unfreeze WD' : 'Freeze WD'}
                    </button>
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
