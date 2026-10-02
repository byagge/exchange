'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/AdminShell';
import { adminApi, getToken } from '@/lib/api';

export default function WalletsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<any>(null);
  const [sweeps, setSweeps] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const [s, sw] = await Promise.all([
      adminApi('/api/admin/settings'),
      adminApi('/api/admin/sweeps'),
    ]);
    setSettings(s);
    setSweeps(sw);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    load().catch(() => router.replace('/login'));
  }, [router]);

  async function save() {
    await adminApi('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        masterTonAddress: settings.masterTonAddress,
        masterTrc20Address: settings.masterTrc20Address,
        sweepThresholdUsdt: Number(settings.sweepThresholdUsdt),
      }),
    });
    setMsg('Сохранено');
    await load();
  }

  async function trigger() {
    const res = await adminApi<{ enqueued?: number }>('/api/admin/sweeps/trigger', {
      method: 'POST',
      body: '{}',
    });
    setMsg(`Sweep enqueued: ${res.enqueued ?? 1}`);
    await load();
  }

  if (!settings) {
    return (
      <AdminShell>
        <p className="sub">Загрузка…</p>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <h1 className="h1">Кошельки / Sweep</h1>
      <p className="sub">Master-адреса и порог автоперевода</p>

      <div className="panel" style={{ padding: 16 }}>
        <div className="field">
          <label>Master TON</label>
          <input
            value={settings.masterTonAddress || ''}
            onChange={(e) => setSettings({ ...settings, masterTonAddress: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Master TRC20</label>
          <input
            value={settings.masterTrc20Address || ''}
            onChange={(e) => setSettings({ ...settings, masterTrc20Address: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Sweep threshold (USDT)</label>
          <input
            type="number"
            value={settings.sweepThresholdUsdt}
            onChange={(e) => setSettings({ ...settings, sweepThresholdUsdt: e.target.value })}
          />
        </div>
        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={save}>
            Сохранить
          </button>
          <button className="btn" onClick={trigger}>
            Запустить sweep сейчас
          </button>
        </div>
        {msg && <p className="sub">{msg}</p>}
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-h">История sweep</div>
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {sweeps.map((s) => (
              <tr key={s.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.fromAddress}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.toMaster}</td>
                <td>{(Number(s.amountMicros) / 1e6).toFixed(4)}</td>
                <td>
                  <span className={`badge ${s.status === 'completed' ? 'ok' : 'warn'}`}>{s.status}</span>
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.txHash || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
