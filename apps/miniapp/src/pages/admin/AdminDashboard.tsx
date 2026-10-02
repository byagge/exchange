import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DirectionFlow, MetaLine, MetaSep, pairDirection } from '../../components/DirectionFlow';
import { adminApi } from '../../lib/adminAuth';
import { haptic } from '../../lib/api';
import { fmtDate, fmtRub, fmtUsdt, sourceLabel, statusLabel } from './adminFormat';
import { PageHead } from './PageHead';

export function AdminDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setData(await adminApi('/api/admin/dashboard'));
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    haptic('light');
    try {
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  }

  if (error && !data) {
    return (
      <div>
        <p className="error-text">{error}</p>
        <button className="cta secondary" type="button" onClick={refresh}>
          Повторить
        </button>
      </div>
    );
  }

  if (!data) return <p className="muted">Загрузка статистики…</p>;

  const u = data.users || {};
  const d = data.deposits || {};
  const o = data.orders || {};
  const w = data.withdrawals || {};
  const l = data.ledger || {};

  return (
    <div className="admin-dash">
      <PageHead
        title="Обзор"
        meta={
          <MetaLine>
            {data.rate} ₽
            {data.maintenanceMode ? (
              <>
                <MetaSep />
                обслуживание
              </>
            ) : null}
          </MetaLine>
        }
        action={
          <button
            type="button"
            className={`hist-refresh${refreshing ? ' spinning' : ''}`}
            onClick={refresh}
            aria-label="Обновить"
          >
            <RefreshCw size={18} />
          </button>
        }
      />

      <section className="admin-section">
        <h3>Пользователи</h3>
        <div className="admin-stats">
          <Stat label="Всего" value={u.total} />
          <Stat label="Активные" value={u.active} />
          <Stat label="Бан" value={u.banned} />
          <Stat label="Заморозка" value={u.frozen} />
        </div>
      </section>

      <section className="admin-section">
        <h3>Балансы в системе</h3>
        <div className="admin-stats">
          <Stat label="Доступно" value={`${fmtUsdt(l.availableMicros)}`} />
          <Stat label="Заблокировано" value={`${fmtUsdt(l.lockedMicros)}`} />
          <Stat label="Реферальный" value={`${fmtUsdt(l.referralMicros)}`} />
          <Stat
            label="Всего на счетах"
            value={`${fmtUsdt(
              Number(l.availableMicros || 0) +
                Number(l.lockedMicros || 0) +
                Number(l.referralMicros || 0),
            )}`}
          />
        </div>
      </section>

      <section className="admin-section">
        <h3>Депозиты</h3>
        <div className="admin-stats">
          <Stat label="Зачислено" value={d.credited} />
          <Stat label="В ожидании" value={d.pending} />
          <Stat label="Сегодня" value={d.today} />
          <Stat label="Объём" value={fmtUsdt(d.volumeMicros)} />
          <Stat label="Объём сегодня" value={fmtUsdt(d.volumeTodayMicros)} />
        </div>
      </section>

      <section className="admin-section">
        <h3>Обмены</h3>
        <div className="admin-stats">
          <Stat label="Всего" value={o.total} />
          <Stat label="Выполнено" value={o.completed} />
          <Stat label="Ждут выплату" value={o.awaitingPayout} />
          <Stat label="Ждут оплату" value={o.awaitingFunds} />
          <Stat label="Ошибки/отмена" value={o.failed} />
          <Stat label="Сегодня" value={o.today} />
          <Stat label="Оборот USDT" value={fmtUsdt(o.volumeUsdtMicros)} />
          <Stat label="Оборот RUB" value={`${fmtRub(o.volumeRubKopecks)} ₽`} />
          <Stat label="Комиссии" value={fmtUsdt(o.feesMicros)} />
          <Stat label="Неделя USDT" value={fmtUsdt(o.weekUsdtMicros)} />
          <Stat label="Неделя RUB" value={`${fmtRub(o.weekRubKopecks)} ₽`} />
        </div>
      </section>

      <section className="admin-section">
        <h3>Выводы и сбор</h3>
        <div className="admin-stats">
          <Stat label="Выводы в очереди" value={w.pending} />
          <Stat label="Выводы готовы" value={w.completed} />
          <Stat label="Выводы с ошибкой" value={w.failed} />
          <Stat label="Сбор средств в очереди" value={data.sweepsPending} />
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <h3>Последние заявки</h3>
          <Link to="/admin/orders" className="tiny admin-link-more">
            Все <ChevronRight size={14} />
          </Link>
        </div>
        <div className="hist-list">
          {(data.recentOrders || []).map((ord: any) => {
            const dir = pairDirection(ord.pair);
            return (
            <div key={ord.id} className="admin-order">
              <div className="admin-order-top">
                <div>
                  <strong>
                    <DirectionFlow from={dir.from} to={dir.to} />
                  </strong>
                  <div className="tiny">
                    <MetaLine>
                      @{ord.user?.username || 'нет'}
                      <MetaSep />
                      {statusLabel(ord.status)}
                    </MetaLine>
                  </div>
                </div>
                <div className="admin-order-amt">
                  {fmtUsdt(ord.fromAmountMicros)}
                  <span>{fmtDate(ord.createdAt)}</span>
                </div>
              </div>
            </div>
          );
          })}
          {!data.recentOrders?.length && <p className="muted">Пока пусто</p>}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <h3>Последние депозиты</h3>
          <Link to="/admin/more/deposits" className="tiny admin-link-more">
            Все <ChevronRight size={14} />
          </Link>
        </div>
        <div className="hist-list">
          {(data.recentDeposits || []).map((dep: any) => (
            <div key={dep.id} className="admin-order">
              <div className="admin-order-top">
                <div>
                  <strong>{fmtUsdt(dep.amountMicros)} USDT</strong>
                  <div className="tiny">
                    <MetaLine>
                      @{dep.user?.username || 'нет'}
                      <MetaSep />
                      {sourceLabel(dep.source)}
                      {dep.network ? (
                        <>
                          <MetaSep />
                          {dep.network}
                        </>
                      ) : null}
                    </MetaLine>
                  </div>
                </div>
                <div className="admin-order-amt">
                  <span>{fmtDate(dep.createdAt)}</span>
                </div>
              </div>
            </div>
          ))}
          {!data.recentDeposits?.length && <p className="muted">Пока пусто</p>}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="admin-stat">
      <div className="tiny">{label}</div>
      <strong>{value ?? 'нет'}</strong>
    </div>
  );
}
