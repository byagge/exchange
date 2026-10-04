import { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  ArrowUpFromLine,
  Plus,
  RefreshCw,
  Snowflake,
  Trash2,
  Wallet,
} from 'lucide-react';
import { adminApi } from '../../lib/adminAuth';
import { haptic } from '../../lib/api';
import { DirectionFlow, MetaLine, MetaSep, pairDirection } from '../../components/DirectionFlow';
import { AdminConfirm, AdminSheet, DataRows } from './AdminUi';
import {
  fmtDate,
  fmtRub,
  fmtUsdt,
  ledgerOf,
  methodLabel,
  sourceLabel,
  statusLabel,
} from './adminFormat';
import { PageHead } from './PageHead';

type WalletRow = {
  id: string;
  network: 'TON' | 'TRC20';
  address: string;
  estimatedUsdt?: number;
  onchainUsdt?: number | null;
  onchainSource?: string;
  onchainError?: string;
  masterAddress?: string | null;
};

export function AdminUsersPage() {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [tab, setTab] = useState<'info' | 'trades' | 'ledger'>('info');
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [walletsBusy, setWalletsBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [tgId, setTgId] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newName, setNewName] = useState('');

  const [editNotes, setEditNotes] = useState('');
  const [editMin, setEditMin] = useState('');
  const [editMinWd, setEditMinWd] = useState('');
  const [editMax, setEditMax] = useState('');
  const [editFirst, setEditFirst] = useState('');
  const [editUser, setEditUser] = useState('');

  const [balOpen, setBalOpen] = useState(false);
  const [balAmount, setBalAmount] = useState('');
  const [balDir, setBalDir] = useState<'credit' | 'debit'>('credit');
  const [balReason, setBalReason] = useState('Корректировка админа');

  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    danger?: boolean;
    label: string;
    run: () => Promise<void>;
  } | null>(null);

  const [wdOpen, setWdOpen] = useState<WalletRow | null>(null);
  const [wdDest, setWdDest] = useState<'master' | 'custom'>('master');
  const [wdAddress, setWdAddress] = useState('');
  const [wdAmount, setWdAmount] = useState('');

  const load = useCallback(async (query?: string) => {
    const path =
      query && query.trim()
        ? `/api/admin/users?q=${encodeURIComponent(query.trim())}`
        : '/api/admin/users';
    setUsers(await adminApi(path));
  }, []);

  useEffect(() => {
    load()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      await load(q);
      if (selected) {
        setSelected(await adminApi(`/api/admin/users/${selected.id}`));
      }
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  }

  async function openUser(id: string) {
    haptic('light');
    const full = await adminApi(`/api/admin/users/${id}`);
    setSelected(full);
    setTab('info');
    setEditNotes(full.notes || '');
    setEditMin(full.minDepositUsdt != null ? String(full.minDepositUsdt) : '');
    setEditMinWd(full.minWithdrawUsdt != null ? String(full.minWithdrawUsdt) : '');
    setEditMax(full.maxWithdrawUsdt != null ? String(full.maxWithdrawUsdt) : '');
    setEditFirst(full.firstName || '');
    setEditUser(full.username || '');
  }

  async function refreshWallets() {
    if (!selected) return;
    setWalletsBusy(true);
    try {
      const wallets = await adminApi<WalletRow[]>(`/api/admin/users/${selected.id}/wallets`);
      setSelected({ ...selected, wallets });
      haptic('success');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setWalletsBusy(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await adminApi(`/api/admin/users/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setSelected(updated);
      haptic('success');
      await load(q);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    await patch({
      notes: editNotes,
      firstName: editFirst || undefined,
      username: editUser || undefined,
      minDepositUsdt: editMin === '' ? null : Number(editMin),
      minWithdrawUsdt: editMinWd === '' ? null : Number(editMinWd),
      maxWithdrawUsdt: editMax === '' ? null : Number(editMax),
    });
  }

  async function createUser() {
    setBusy(true);
    try {
      const u = await adminApi('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          telegramId: tgId,
          username: newUsername || undefined,
          firstName: newName || undefined,
        }),
      });
      haptic('success');
      setCreateOpen(false);
      setTgId('');
      setNewUsername('');
      setNewName('');
      await load(q);
      setSelected(u);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function adjustBalance() {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await adminApi(`/api/admin/users/${selected.id}/balance`, {
        method: 'POST',
        body: JSON.stringify({
          amountUsdt: balAmount,
          direction: balDir,
          reason: balReason || 'admin_adjust',
        }),
      });
      setSelected(updated);
      setBalOpen(false);
      setBalAmount('');
      haptic('success');
      await load(q);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser() {
    if (!selected) return;
    setBusy(true);
    try {
      await adminApi(`/api/admin/users/${selected.id}`, { method: 'DELETE' });
      haptic('success');
      setConfirmDel(false);
      setSelected(null);
      await load(q);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  function openWithdraw(w: WalletRow) {
    setWdOpen(w);
    setWdDest('master');
    setWdAddress(w.masterAddress || '');
    const sug =
      w.onchainUsdt != null && w.onchainUsdt > 0
        ? String(w.onchainUsdt)
        : w.estimatedUsdt
          ? String(w.estimatedUsdt)
          : '';
    setWdAmount(sug);
  }

  async function doWithdraw() {
    if (!wdOpen || !selected) return;
    setBusy(true);
    try {
      const toAddress =
        wdDest === 'custom'
          ? wdAddress.trim()
          : wdOpen.masterAddress || wdAddress.trim() || undefined;
      await adminApi(`/api/admin/wallets/${wdOpen.id}/withdraw`, {
        method: 'POST',
        body: JSON.stringify({
          toAddress: toAddress || undefined,
          amountUsdt: wdAmount || undefined,
        }),
      });
      haptic('success');
      setWdOpen(null);
      const updated = await adminApi(`/api/admin/users/${selected.id}`);
      setSelected(updated);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  function askConfirm(opts: {
    title: string;
    message: string;
    danger?: boolean;
    label: string;
    run: () => Promise<void>;
  }) {
    setConfirmAction(opts);
  }

  function fmtChain(n: number | null | undefined) {
    if (n == null) return 'н/д';
    return n.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  }

  return (
    <div>
      <PageHead
        title="Пользователи"
        meta={`${users.length}`}
        action={
          <div style={{ display: 'flex', gap: 2 }}>
            <button type="button" className="hist-refresh" onClick={() => setCreateOpen(true)}>
              <Plus size={18} />
            </button>
            <button
              type="button"
              className={`hist-refresh${refreshing ? ' spinning' : ''}`}
              onClick={refresh}
            >
              <RefreshCw size={18} />
            </button>
          </div>
        }
      />

      <div className="input-shell" style={{ marginTop: 10 }}>
        <input
          placeholder="Поиск: @ник / Telegram id / реф"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(q)}
        />
      </div>
      <button type="button" className="cta secondary" style={{ marginTop: 10 }} onClick={() => load(q)}>
        Найти
      </button>

      <div className="hist-list" style={{ marginTop: 14 }}>
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : (
          <>
            {users.map((u) => (
              <button
                key={u.id}
                type="button"
                className="hist-item"
                onClick={() => openUser(u.id)}
              >
                <div className="hist-main">
                  <div className="hist-title">{u.firstName || u.username || 'Пользователь'}</div>
                  <div className="hist-sub">
                    <MetaLine>
                      {u.username ? `@${u.username}` : `Telegram ${u.telegramId}`}
                      <MetaSep />
                      {statusLabel(u.status)}
                      {u.withdrawFrozen ? (
                        <>
                          <MetaSep />
                          вывод заморожен
                        </>
                      ) : null}
                    </MetaLine>
                  </div>
                </div>
                <div className="hist-right">
                  <div className="hist-amount">{fmtUsdt(ledgerOf(u))}</div>
                  <span className="tiny">
                    сделок {u._count?.orders ?? u.tradeCount ?? 0}
                  </span>
                </div>
              </button>
            ))}
            {!users.length && <p className="muted">Пользователей нет</p>}
          </>
        )}
      </div>

      <AdminSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.firstName || selected?.username || 'Пользователь'}
        subtitle={selected ? `Telegram ${selected.telegramId}` : undefined}
      >
        {selected && (
          <>
            <div className="sheet-amount">
              {fmtUsdt(ledgerOf(selected))}
              <span>USDT</span>
            </div>
            <div className="admin-status-row">
              <span
                className={`badge ${
                  selected.status === 'banned'
                    ? 'err'
                    : selected.status === 'frozen'
                      ? 'warn'
                      : 'ok'
                }`}
              >
                {statusLabel(selected.status)}
              </span>
              {selected.withdrawFrozen && (
                <span className="badge warn">Вывод заморожен</span>
              )}
            </div>
            <div className="tabs calc-tabs" style={{ marginBottom: 12 }}>
              {(
                [
                  ['info', 'Профиль'],
                  ['trades', 'Сделки'],
                  ['ledger', 'Леджер'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`tab${tab === k ? ' active' : ''}`}
                  onClick={() => setTab(k)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'info' && (
              <>
                <DataRows
                  rows={[
                    { label: 'ID', value: selected.id },
                    { label: 'Статус', value: statusLabel(selected.status) },
                    {
                      label: 'Вывод',
                      value: selected.withdrawFrozen ? 'Заморожен' : 'Разрешён',
                    },
                    {
                      label: 'Админ',
                      value: selected.isAdmin ? 'Да' : 'Нет',
                    },
                    { label: 'Последний IP', value: selected.lastIp || '—' },
                    { label: 'Устройство', value: selected.lastDevice || '—' },
                    {
                      label: 'Был в приложении',
                      value: selected.lastSeenAt ? new Date(selected.lastSeenAt).toLocaleString('ru-RU') : '—',
                    },
                    { label: 'Реф. код', value: selected.referralCode },
                    {
                      label: 'Пригласил',
                      value: selected.referredBy
                        ? `@${selected.referredBy.username || selected.referredBy.firstName}`
                        : 'нет',
                    },
                    { label: 'Сделок', value: String(selected.tradeCount ?? 0) },
                    {
                      label: 'Оборот USDT',
                      value: fmtUsdt(selected.loyaltyVolume),
                    },
                    {
                      label: 'Оборот RUB',
                      value: `${fmtRub(selected.rubTurnover)} ₽`,
                    },
                    {
                      label: 'Доступно',
                      value: `${fmtUsdt(ledgerOf(selected))} USDT`,
                    },
                    {
                      label: 'Заблокировано',
                      value: `${fmtUsdt(ledgerOf(selected, 'locked'))} USDT`,
                    },
                    {
                      label: 'Реферальный',
                      value: `${fmtUsdt(ledgerOf(selected, 'referral'))} USDT`,
                    },
                    { label: 'Создан', value: fmtDate(selected.createdAt) },
                  ]}
                />

                <div className="admin-wallet-block">
                  <div className="admin-wallet-head">
                    <p className="tiny" style={{ margin: 0 }}>
                      Депозитные кошельки
                    </p>
                    <button
                      type="button"
                      className={`hist-refresh${walletsBusy ? ' spinning' : ''}`}
                      aria-label="Обновить балансы"
                      disabled={walletsBusy}
                      onClick={() => void refreshWallets()}
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  <p className="tiny admin-wallet-hint">
                    На сети — фактический USDT на адресе. По учёту — депозиты минус уже собранное.
                  </p>
                  {(selected.wallets || []).length === 0 && (
                    <p className="muted">Кошельков пока нет</p>
                  )}
                  {(selected.wallets || []).map((w: WalletRow) => (
                    <div key={w.id} className="admin-wallet-card">
                      <div className="admin-wallet-top">
                        <strong>{w.network}</strong>
                        <button
                          type="button"
                          className="cta secondary admin-wallet-wd"
                          onClick={() => openWithdraw(w)}
                        >
                          <ArrowUpFromLine size={14} /> Вывести
                        </button>
                      </div>
                      <div className="tiny admin-wallet-addr">{w.address}</div>
                      <div className="admin-wallet-bals">
                        <div>
                          <span className="tiny">На сети</span>
                          <strong>{fmtChain(w.onchainUsdt)} USDT</strong>
                          {w.onchainSource === 'unavailable' && (
                            <span className="tiny">RPC недоступен</span>
                          )}
                        </div>
                        <div>
                          <span className="tiny">По учёту</span>
                          <strong>{fmtChain(w.estimatedUsdt ?? 0)} USDT</strong>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="admin-settings" style={{ marginTop: 16 }}>
                  <label className="admin-field">
                    <span className="tiny">Имя</span>
                    <div className="input-shell">
                      <input value={editFirst} onChange={(e) => setEditFirst(e.target.value)} />
                    </div>
                  </label>
                  <label className="admin-field">
                    <span className="tiny">Ник</span>
                    <div className="input-shell">
                      <input value={editUser} onChange={(e) => setEditUser(e.target.value)} />
                    </div>
                  </label>
                  <label className="admin-field">
                    <span className="tiny">Заметки</span>
                    <textarea
                      className="admin-textarea"
                      rows={2}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    <span className="tiny">Мин. депозит USDT</span>
                    <div className="input-shell">
                      <input
                        inputMode="decimal"
                        value={editMin}
                        onChange={(e) => setEditMin(e.target.value)}
                        placeholder="по умолчанию"
                      />
                    </div>
                  </label>
                  <label className="admin-field">
                    <span className="tiny">Мин. вывод USDT</span>
                    <div className="input-shell">
                      <input
                        inputMode="decimal"
                        value={editMinWd}
                        onChange={(e) => setEditMinWd(e.target.value)}
                        placeholder="как в настройках"
                      />
                    </div>
                  </label>
                  <label className="admin-field">
                    <span className="tiny">Макс. вывод USDT</span>
                    <div className="input-shell">
                      <input
                        inputMode="decimal"
                        value={editMax}
                        onChange={(e) => setEditMax(e.target.value)}
                        placeholder="без лимита"
                      />
                    </div>
                  </label>
                  <button type="button" className="cta" disabled={busy} onClick={saveProfile}>
                    Сохранить профиль
                  </button>
                </div>

                <p className="tiny" style={{ marginTop: 16, marginBottom: 8 }}>
                  Бан блокирует обмен, депозиты CryptoBot и вывод. Заморозка аккаунта и заморозка
                  вывода останавливают вывод и обмен.
                </p>
                <div className="admin-user-actions">
                  <button
                    type="button"
                    className="cta secondary"
                    disabled={busy}
                    onClick={() => setBalOpen(true)}
                  >
                    <Wallet size={16} /> Баланс
                  </button>
                  <button
                    type="button"
                    className={`cta${selected.isAdmin ? ' ghost' : ''}`}
                    disabled={busy}
                    onClick={() =>
                      askConfirm({
                        title: selected.isAdmin
                          ? 'Снять права админа?'
                          : 'Назначить админом?',
                        message: selected.isAdmin
                          ? 'Пользователь потеряет доступ к админ-панели в мини-аппе (если его нет в ADMIN_TELEGRAM_IDS).'
                          : 'В профиле появится пункт «Админ-панель». Вход по Telegram ID, без пароля.',
                        label: selected.isAdmin ? 'Снять' : 'Назначить',
                        run: () => patch({ isAdmin: !selected.isAdmin }),
                      })
                    }
                  >
                    {selected.isAdmin ? 'Снять админа' : 'Сделать админом'}
                  </button>
                  {selected.status !== 'banned' ? (
                    <button
                      type="button"
                      className="cta danger-cta"
                      disabled={busy}
                      onClick={() =>
                        askConfirm({
                          title: 'Забанить пользователя?',
                          message:
                            'Не сможет создавать обмены, выводить и пополнять через CryptoBot. Ончейн-депозиты на его адрес всё ещё могут зачислиться.',
                          danger: true,
                          label: 'Забанить',
                          run: () => patch({ status: 'banned' }),
                        })
                      }
                    >
                      <Ban size={16} /> Бан
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="cta"
                      disabled={busy}
                      onClick={() =>
                        askConfirm({
                          title: 'Разбанить?',
                          message:
                            'Вернём статус «Активен». Вывод останется замороженным, если флаг включён отдельно.',
                          label: 'Разбанить',
                          run: () => patch({ status: 'active' }),
                        })
                      }
                    >
                      Разбан
                    </button>
                  )}
                  <button
                    type="button"
                    className="cta ghost"
                    disabled={busy}
                    onClick={() =>
                      askConfirm({
                        title: selected.withdrawFrozen
                          ? 'Разморозить вывод?'
                          : 'Заморозить вывод?',
                        message: selected.withdrawFrozen
                          ? 'Пользователь снова сможет выводить и обменивать (если аккаунт не заморожен и не в бане).'
                          : 'Блокирует вывод и обмен. Баланс и депозиты остаются.',
                        label: selected.withdrawFrozen ? 'Разморозить' : 'Заморозить',
                        run: () => patch({ withdrawFrozen: !selected.withdrawFrozen }),
                      })
                    }
                  >
                    <Snowflake size={16} />
                    {selected.withdrawFrozen ? 'Разморозить вывод' : 'Заморозить вывод'}
                  </button>
                  {selected.status !== 'frozen' ? (
                    <button
                      type="button"
                      className="cta ghost"
                      disabled={busy || selected.status === 'banned'}
                      onClick={() =>
                        askConfirm({
                          title: 'Заморозить аккаунт?',
                          message:
                            'Как заморозка вывода: нельзя выводить и обменивать. Статус станет «Заморожен».',
                          label: 'Заморозить',
                          run: () => patch({ status: 'frozen' }),
                        })
                      }
                    >
                      Заморозить акк.
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="cta ghost"
                      disabled={busy}
                      onClick={() =>
                        askConfirm({
                          title: 'Разморозить аккаунт?',
                          message: 'Статус станет «Активен».',
                          label: 'Разморозить',
                          run: () => patch({ status: 'active' }),
                        })
                      }
                    >
                      Разморозить акк.
                    </button>
                  )}
                  <button
                    type="button"
                    className="cta danger-cta"
                    disabled={busy}
                    onClick={() => setConfirmDel(true)}
                  >
                    <Trash2 size={16} /> Удалить
                  </button>
                </div>
              </>
            )}

            {tab === 'trades' && (
              <div className="hist-list">
                <p className="tiny">Обмены</p>
                {(selected.orders || []).map((o: any) => (
                  <div key={o.id} className="admin-order">
                    <div className="admin-order-top">
                      <div>
                        <strong>
                          <DirectionFlow
                            from={pairDirection(o.pair).from}
                            to={pairDirection(o.pair).to}
                          />
                        </strong>
                        <div className="tiny">{statusLabel(o.status)}</div>
                      </div>
                      <div className="admin-order-amt">
                        {fmtUsdt(o.fromAmountMicros)}
                        <span>{fmtDate(o.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                <p className="tiny" style={{ marginTop: 12 }}>
                  Депозиты
                </p>
                {(selected.deposits || []).map((d: any) => (
                  <div key={d.id} className="admin-order">
                    <div className="admin-order-top">
                      <div>
                        <strong>{fmtUsdt(d.amountMicros)} USDT</strong>
                        <div className="tiny">
                          <MetaLine>
                            {sourceLabel(d.source)}
                            <MetaSep />
                            {statusLabel(d.status)}
                          </MetaLine>
                        </div>
                      </div>
                      <span className="tiny">{fmtDate(d.createdAt)}</span>
                    </div>
                  </div>
                ))}
                <p className="tiny" style={{ marginTop: 12 }}>
                  Выводы
                </p>
                {(selected.withdrawals || []).map((w: any) => (
                  <div key={w.id} className="admin-order">
                    <div className="admin-order-top">
                      <div>
                        <strong>{fmtUsdt(w.amountMicros)} USDT</strong>
                        <div className="tiny">
                          <MetaLine>
                            {methodLabel(w.method)}
                            <MetaSep />
                            {statusLabel(w.status)}
                          </MetaLine>
                        </div>
                      </div>
                      <span className="tiny">{fmtDate(w.createdAt)}</span>
                    </div>
                  </div>
                ))}
                {!selected.orders?.length &&
                  !selected.deposits?.length &&
                  !selected.withdrawals?.length && (
                    <p className="muted">Операций нет</p>
                  )}
              </div>
            )}

            {tab === 'ledger' && (
              <div className="hist-list">
                {(selected.ledger || []).flatMap((acc: any) =>
                  (acc.entries || []).map((e: any) => (
                    <div key={e.id} className="admin-order">
                      <div className="admin-order-top">
                        <div>
                          <strong>
                            {Number(e.amount) > 0 ? '+' : ''}
                            {fmtUsdt(Math.abs(e.amount))}{' '}
                            {acc.kind === 'available'
                              ? 'Доступно'
                              : acc.kind === 'locked'
                                ? 'Заблокировано'
                                : acc.kind === 'referral'
                                  ? 'Реферальный'
                                  : acc.kind}
                          </strong>
                          <div className="tiny">{e.reason}</div>
                        </div>
                        <span className="tiny">{fmtDate(e.createdAt)}</span>
                      </div>
                    </div>
                  )),
                )}
                {!selected.ledger?.some((a: any) => a.entries?.length) && (
                  <p className="muted">Записей нет</p>
                )}
              </div>
            )}
          </>
        )}
      </AdminSheet>

      <AdminConfirm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Добавить пользователя"
        message="Создать аккаунт по Telegram ID (без входа в бота)."
        confirmLabel="Создать"
        busy={busy}
        onConfirm={createUser}
      >
        <div className="admin-settings" style={{ marginTop: 12 }}>
          <div className="input-shell">
            <input
              placeholder="Telegram ID"
              value={tgId}
              onChange={(e) => setTgId(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div className="input-shell">
            <input
              placeholder="Ник (необязательно)"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
            />
          </div>
          <div className="input-shell">
            <input
              placeholder="Имя (необязательно)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
        </div>
      </AdminConfirm>

      <AdminConfirm
        open={balOpen}
        onClose={() => setBalOpen(false)}
        title="Изменить баланс"
        message={`Доступно сейчас: ${fmtUsdt(ledgerOf(selected))} USDT`}
        confirmLabel={balDir === 'credit' ? 'Начислить' : 'Списать'}
        busy={busy}
        onConfirm={adjustBalance}
      >
        <div className="tabs calc-tabs" style={{ marginTop: 12 }}>
          <button
            type="button"
            className={`tab${balDir === 'credit' ? ' active' : ''}`}
            onClick={() => setBalDir('credit')}
          >
            Начислить
          </button>
          <button
            type="button"
            className={`tab${balDir === 'debit' ? ' active' : ''}`}
            onClick={() => setBalDir('debit')}
          >
            Списать
          </button>
        </div>
        <div className="input-shell" style={{ marginTop: 10 }}>
          <input
            placeholder="Сумма USDT"
            inputMode="decimal"
            value={balAmount}
            onChange={(e) => setBalAmount(e.target.value)}
          />
        </div>
        <div className="input-shell" style={{ marginTop: 10 }}>
          <input
            placeholder="Причина"
            value={balReason}
            onChange={(e) => setBalReason(e.target.value)}
          />
        </div>
      </AdminConfirm>

      <AdminConfirm
        open={!!wdOpen}
        onClose={() => setWdOpen(null)}
        title={wdOpen ? `Вывести ${wdOpen.network}` : 'Вывести'}
        message={
          wdOpen
            ? `С адреса депозита на мастер или другой кошелёк. По учёту: ${fmtChain(wdOpen.estimatedUsdt)} USDT. На сети: ${fmtChain(wdOpen.onchainUsdt)} USDT.`
            : undefined
        }
        confirmLabel="Вывести"
        busy={busy}
        onConfirm={doWithdraw}
      >
        <div className="tabs calc-tabs" style={{ marginTop: 12 }}>
          <button
            type="button"
            className={`tab${wdDest === 'master' ? ' active' : ''}`}
            onClick={() => {
              setWdDest('master');
              setWdAddress(wdOpen?.masterAddress || '');
            }}
          >
            На мастер
          </button>
          <button
            type="button"
            className={`tab${wdDest === 'custom' ? ' active' : ''}`}
            onClick={() => setWdDest('custom')}
          >
            Другой адрес
          </button>
        </div>
        {(wdDest === 'custom' || !wdOpen?.masterAddress) && (
          <label className="admin-field admin-field-stack">
            <span className="tiny">Адрес назначения</span>
            <div className="input-shell">
              <input
                value={wdAddress}
                onChange={(e) => setWdAddress(e.target.value)}
                placeholder={wdOpen?.network === 'TON' ? 'EQ… / UQ…' : 'T…'}
              />
            </div>
          </label>
        )}
        {wdDest === 'master' && wdOpen?.masterAddress && (
          <p className="tiny" style={{ marginTop: 10, wordBreak: 'break-all' }}>
            Мастер: {wdOpen.masterAddress}
          </p>
        )}
        <label className="admin-field admin-field-stack">
          <span className="tiny">Сумма USDT</span>
          <div className="input-shell">
            <input
              inputMode="decimal"
              value={wdAmount}
              onChange={(e) => setWdAmount(e.target.value)}
              placeholder="Вся доступная по учёту"
            />
          </div>
        </label>
      </AdminConfirm>

      <AdminConfirm
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={confirmAction?.title || ''}
        message={confirmAction?.message}
        confirmLabel={confirmAction?.label || 'Ок'}
        danger={confirmAction?.danger}
        busy={busy}
        onConfirm={async () => {
          if (!confirmAction) return;
          await confirmAction.run();
          setConfirmAction(null);
        }}
      />

      <AdminConfirm
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title="Удалить пользователя?"
        message="Безвозвратно удалятся кошельки, сделки, депозиты и леджер. Обычно лучше бан."
        confirmLabel="Удалить навсегда"
        danger
        busy={busy}
        onConfirm={deleteUser}
      />
    </div>
  );
}
