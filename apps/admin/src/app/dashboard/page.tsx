'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/AdminShell';
import { adminApi, getToken } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    adminApi('/api/admin/dashboard').then(setData).catch(() => router.replace('/login'));
  }, [router]);

  return (
    <AdminShell>
      <h1 className="h1">Dashboard</h1>
      <p className="sub">Операционный обзор Exchange</p>
      <div className="grid">
        <div className="stat-card">
          <div className="label">Пользователи</div>
          <div className="value">{data?.users ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Депозиты</div>
          <div className="value">{data?.deposits ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Ожидают RUB</div>
          <div className="value">{data?.ordersPending ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Оборот USDT</div>
          <div className="value">
            {data ? (data.volumeUsdtMicros / 1_000_000).toLocaleString('ru-RU') : '—'}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
