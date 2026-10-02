import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, ArrowLeft, Link2, RefreshCw } from 'lucide-react';
import { adminApi } from '../../lib/adminAuth';
import { MetaLine, MetaSep } from '../../components/DirectionFlow';
import { fmtDate, fmtUsdt, sourceLabel, statusClass, statusLabel } from './adminFormat';
import { PageHead } from './PageHead';

export function AdminDepositsPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRows(await adminApi('/api/admin/deposits'));
  }

  useEffect(() => {
    load()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHead
        title="Депозиты"
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
      <div className="hist-list" style={{ marginTop: 10 }}>
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : (
          <>
            {rows.map((d) => (
          <div key={d.id} className="admin-dep-row">
            <div className={`hist-icon ${d.source === 'cryptobot' ? 'exchange' : 'deposit'}`}>
              {d.source === 'cryptobot' ? <Link2 size={18} /> : <ArrowDownToLine size={18} />}
            </div>
            <div className="hist-main">
              <div className="hist-title">{fmtUsdt(d.amountMicros)} USDT</div>
              <div className="hist-sub">
                <MetaLine>
                  @{d.user?.username || d.user?.firstName || 'нет'}
                  <MetaSep />
                  {sourceLabel(d.source)}
                  {d.network ? (
                    <>
                      <MetaSep />
                      {d.network}
                    </>
                  ) : null}
                </MetaLine>
              </div>
              {(d.txHash || d.checkId) && (
                <div className="tiny admin-dep-hash">{d.txHash || d.checkId}</div>
              )}
            </div>
            <div className="hist-right">
              <span className={`badge ${statusClass(d.status)}`}>{statusLabel(d.status)}</span>
              <div className="tiny" style={{ marginTop: 4 }}>
                {fmtDate(d.createdAt)}
              </div>
            </div>
          </div>
        ))}
            {!rows.length && <p className="muted">Депозитов нет</p>}
          </>
        )}
      </div>
    </div>
  );
}
