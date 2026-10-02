import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Check, RefreshCw, X } from 'lucide-react';
import { adminApi } from '../../lib/adminAuth';
import { haptic } from '../../lib/api';
import { MetaLine, MetaSep } from '../../components/DirectionFlow';
import { fmtDate, fmtUsdt, methodLabel, statusClass, statusLabel } from './adminFormat';
import { PageHead } from './PageHead';

export function AdminWithdrawalsPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setRows(await adminApi('/api/admin/withdrawals'));
  }

  useEffect(() => {
    load()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function complete(w: any) {
    const proof =
      w.method === 'cryptobot'
        ? prompt('Ссылка на выданный чек КБ (https://t.me/send?start=...)')
        : prompt('txHash отправки с MASTER-кошелька');
    if (!proof?.trim()) return;
    setBusyId(w.id);
    try {
      await adminApi(`/api/admin/withdrawals/${w.id}/complete`, {
        method: 'POST',
        body: JSON.stringify(
          w.method === 'cryptobot'
            ? { checkUrl: proof.trim() }
            : { txHash: proof.trim() },
        ),
      });
      haptic('success');
      await load();
    } catch (e: any) {
      alert(e.message || 'Ошибка');
    } finally {
      setBusyId(null);
    }
  }

  async function fail(w: any) {
    const reason = prompt('Причина отказа (средства разблокируются)') || '';
    if (reason.trim().length < 2) return;
    setBusyId(w.id);
    try {
      await adminApi(`/api/admin/withdrawals/${w.id}/fail`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      haptic('success');
      await load();
    } catch (e: any) {
      alert(e.message || 'Ошибка');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHead
        title="Выводы"
        back={
          <button
            type="button"
            className="back-btn"
            onClick={() => nav('/admin/more')}
            aria-label="Назад"
          >
            <ArrowLeft size={18} />
          </button>
        }
        action={
          <button
            type="button"
            className={`hist-refresh${refreshing ? ' spinning' : ''}`}
            onClick={async () => {
              setRefreshing(true);
              try {
                await load();
              } finally {
                setTimeout(() => setRefreshing(false), 400);
              }
            }}
          >
            <RefreshCw size={18} />
          </button>
        }
      />
      <p className="tiny" style={{ margin: '0 0 10px' }}>
        Чек КБ — выдача чека на username. Ончейн — отправка с MASTER (не с депозитного адреса
        клиента).
      </p>
      <div className="hist-list" style={{ marginTop: 10 }}>
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : (
          <>
            {rows.map((w) => {
              const actionable = w.status === 'pending' || w.status === 'processing';
              return (
                <div key={w.id} className="admin-dep-row" style={{ flexWrap: 'wrap' }}>
                  <div className="hist-icon withdrawal">
                    <ArrowUpRight size={18} />
                  </div>
                  <div className="hist-main" style={{ flex: 1 }}>
                    <div className="hist-title">{fmtUsdt(w.amountMicros)} USDT</div>
                    <div className="hist-sub">
                      <MetaLine>
                        @{w.user?.username || 'нет'}
                        <MetaSep />
                        {methodLabel(w.method)}
                        {w.network ? (
                          <>
                            <MetaSep />
                            {w.network}
                          </>
                        ) : null}
                      </MetaLine>
                    </div>
                    {w.destination && (
                      <div className="tiny admin-dep-hash">{w.destination}</div>
                    )}
                    {w.checkUrl && (
                      <div className="tiny admin-dep-hash">Чек: {w.checkUrl}</div>
                    )}
                    {w.txHash && (
                      <div className="tiny admin-dep-hash">Tx: {w.txHash}</div>
                    )}
                    {w.error && (
                      <div className="error-text" style={{ fontSize: 12, marginTop: 4 }}>
                        {w.error}
                      </div>
                    )}
                    {actionable && (
                      <div className="admin-order-actions" style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          className="cta"
                          style={{ marginTop: 0, flex: 1 }}
                          disabled={busyId === w.id}
                          onClick={() => complete(w)}
                        >
                          <Check size={14} />{' '}
                          {w.method === 'cryptobot' ? 'Ввести чек' : 'Ввести tx'}
                        </button>
                        <button
                          type="button"
                          className="cta ghost"
                          style={{ marginTop: 0, flex: 1 }}
                          disabled={busyId === w.id}
                          onClick={() => fail(w)}
                        >
                          <X size={14} /> Отклонить
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="hist-right">
                    <span className={`badge ${statusClass(w.status)}`}>
                      {statusLabel(w.status)}
                    </span>
                    <div className="tiny" style={{ marginTop: 4 }}>
                      {fmtDate(w.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })}
            {!rows.length && <p className="muted">Выводов нет</p>}
          </>
        )}
      </div>
    </div>
  );
}
