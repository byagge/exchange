'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/AdminShell';
import { adminApi, getToken } from '@/lib/api';

export default function SettingsPage() {
  const router = useRouter();
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    adminApi('/api/admin/settings').then(setS).catch(() => router.replace('/login'));
  }, [router]);

  async function save() {
    await adminApi('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        usdtRubRate: String(s.usdtRubRate),
        minDepositUsdt: Number(s.minDepositUsdt),
        minWithdrawUsdt: Number(s.minWithdrawUsdt),
        withdrawFeeUsdt: Number(s.withdrawFeeUsdt),
        exchangeFeePercent: Number(s.exchangeFeePercent),
        supportUrl: s.supportUrl,
        welcomeText: s.welcomeText,
        maintenanceMode: !!s.maintenanceMode,
        referralPercent: Number(s.referralPercent),
      }),
    });
    setMsg('Настройки сохранены');
  }

  if (!s) {
    return (
      <AdminShell>
        <p className="sub">Загрузка…</p>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <h1 className="h1">Настройки</h1>
      <p className="sub">Курс, комиссии, бот, режим обслуживания</p>
      <div className="panel" style={{ padding: 16 }}>
        {(
          [
            ['usdtRubRate', 'Курс USDT/RUB'],
            ['minDepositUsdt', 'Мин. депозит USDT'],
            ['minWithdrawUsdt', 'Мин. вывод USDT'],
            ['withdrawFeeUsdt', 'Комиссия вывода USDT'],
            ['exchangeFeePercent', 'Комиссия обмена %'],
            ['referralPercent', 'Реферал %'],
            ['supportUrl', 'URL поддержки'],
          ] as const
        ).map(([key, label]) => (
          <div className="field" key={key}>
            <label>{label}</label>
            <input value={s[key] ?? ''} onChange={(e) => setS({ ...s, [key]: e.target.value })} />
          </div>
        ))}
        <div className="field">
          <label>Welcome text бота</label>
          <textarea
            rows={4}
            value={s.welcomeText || ''}
            onChange={(e) => setS({ ...s, welcomeText: e.target.value })}
          />
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={!!s.maintenanceMode}
              onChange={(e) => setS({ ...s, maintenanceMode: e.target.checked })}
            />{' '}
            Maintenance mode
          </label>
        </div>
        <button className="btn primary" style={{ marginTop: 16 }} onClick={save}>
          Сохранить
        </button>
        {msg && <p className="sub">{msg}</p>}
      </div>
    </AdminShell>
  );
}
