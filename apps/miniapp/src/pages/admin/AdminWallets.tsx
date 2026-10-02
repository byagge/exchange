import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpFromLine,
  Copy,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Zap,
} from 'lucide-react';
import { adminApi } from '../../lib/adminAuth';
import { haptic } from '../../lib/api';
import { AdminConfirm, AdminSheet } from './AdminUi';
import { fmtDate, fmtUsdt, statusClass, statusLabel } from './adminFormat';
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
  lastScannedAt?: string | null;
  isValid?: boolean;
  derivationIdx?: number;
  user?: { id: string; username?: string; firstName?: string; telegramId?: string } | null;
};

type Secrets = {
  privateKey: string;
  derivationPath: string;
  masterMnemonic: string | null;
  masterMnemonicPreview: string | null;
  masterMnemonicEnv: string;
  masterMnemonicConfigured?: boolean;
  note: string;
  isValid: boolean;
};

export function AdminWalletsPage() {
  const nav = useNavigate();
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [sweeps, setSweeps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmSweep, setConfirmSweep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'TON' | 'TRC20'>('all');
  const [selected, setSelected] = useState<WalletRow | null>(null);
  const [wdOpen, setWdOpen] = useState(false);
  const [wdDest, setWdDest] = useState<'master' | 'custom'>('master');
  const [wdAddress, setWdAddress] = useState('');
  const [wdAmount, setWdAmount] = useState('');
  const [secrets, setSecrets] = useState<Secrets | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  async function load() {
    const [w, s] = await Promise.all([
      adminApi<WalletRow[]>('/api/admin/wallets'),
      adminApi('/api/admin/sweeps'),
    ]);
    setWallets(w);
    setSweeps(s);
    setSelected((prev) => {
      if (!prev) return prev;
      return w.find((x) => x.id === prev.id) || prev;
    });
  }

  useEffect(() => {
    load()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function triggerAll() {
    setBusy(true);
    try {
      const res = await adminApi('/api/admin/sweeps/trigger', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      haptic('success');
      setConfirmSweep(false);
      alert(`Обработано кошельков: ${res.enqueued ?? 0}, сборов: ${res.completed ?? 0}`);
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  function openWallet(w: WalletRow) {
    haptic('light');
    setSelected(w);
    setSecrets(null);
    setShowSecrets(false);
  }

  async function loadSecrets() {
    if (!selected) return;
    setBusy(true);
    try {
      const s = await adminApi<Secrets>(`/api/admin/wallets/${selected.id}/secrets`);
      setSecrets(s);
      setShowSecrets(true);
      haptic('success');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (!selected) return;
    setBusy(true);
    try {
      await adminApi(`/api/admin/wallets/${selected.id}/regenerate`, { method: 'POST' });
      haptic('success');
      setConfirmRegen(false);
      setSecrets(null);
      setShowSecrets(false);
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  function openWithdraw(w: WalletRow) {
    setWdDest('master');
    setWdAddress(w.masterAddress || '');
    setWdAmount(
      w.onchainUsdt != null && w.onchainUsdt > 0
        ? String(w.onchainUsdt)
        : w.estimatedUsdt
          ? String(w.estimatedUsdt)
          : '',
    );
    setWdOpen(true);
  }

  async function doWithdraw() {
    if (!selected) return;
    setBusy(true);
    try {
      const toAddress =
        wdDest === 'custom'
          ? wdAddress.trim()
          : selected.masterAddress || wdAddress.trim() || undefined;
      await adminApi(`/api/admin/wallets/${selected.id}/withdraw`, {
        method: 'POST',
        body: JSON.stringify({
          toAddress: toAddress || undefined,
          amountUsdt: wdAmount || undefined,
        }),
      });
      haptic('success');
      setWdOpen(false);
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function collectOne(w: WalletRow) {
    setBusy(true);
    try {
      await adminApi('/api/admin/sweeps/trigger', {
        method: 'POST',
        body: JSON.stringify({ walletAddressId: w.id }),
      });
      haptic('success');
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  function fmtChain(n: number | null | undefined, source?: string) {
    if (n == null) {
      if (source === 'invalid_address') return 'невалидный';
      return 'н/д';
    }
    return n.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  }

  function copyText(text: string) {
    void navigator.clipboard.writeText(text);
    haptic('success');
  }

  const visible = wallets.filter((w) => filter === 'all' || w.network === filter);
  const sumOnchain = wallets.reduce(
    (a, w) => a + (w.onchainUsdt != null ? Number(w.onchainUsdt) : 0),
    0,
  );
  const sumEst = wallets.reduce((a, w) => a + (Number(w.estimatedUsdt) || 0), 0);

  return (
    <div>
      <PageHead
        title="Кошельки"
        meta={`${visible.length}`}
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
        На сети — факт с блокчейна. По учёту — депозиты минус сборы. Старые placeholder-адреса
        пересоздайте.
      </p>

      <div className="admin-wallet-summary">
        <div>
          <span className="tiny">На сети всего</span>
          <strong>{fmtChain(sumOnchain)} USDT</strong>
        </div>
        <div>
          <span className="tiny">По учёту</span>
          <strong>{fmtChain(sumEst)} USDT</strong>
        </div>
      </div>

      <div className="tabs calc-tabs" style={{ marginTop: 12 }}>
        {(
          [
            ['all', 'Все'],
            ['TRC20', 'TRC20'],
            ['TON', 'TON'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`tab${filter === k ? ' active' : ''}`}
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <button type="button" className="cta" style={{ marginTop: 12 }} onClick={() => setConfirmSweep(true)}>
        <Zap size={16} style={{ marginRight: 6 }} />
        Собрать все на мастер
      </button>

      <p className="tiny" style={{ marginTop: 12 }}>
        Адреса
      </p>
      <div className="hist-list">
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : (
          <>
            {visible.map((w) => (
              <button
                key={w.id}
                type="button"
                className="admin-wallet-list-item"
                onClick={() => openWallet(w)}
              >
                <div className="admin-wallet-list-top">
                  <strong>
                    {w.network}
                    {w.isValid === false && (
                      <span className="badge warn" style={{ marginLeft: 8 }}>
                        placeholder
                      </span>
                    )}
                  </strong>
                  <span className="tiny">@{w.user?.username || w.user?.firstName || 'нет'}</span>
                </div>
                <div className="tiny admin-wallet-addr">{w.address}</div>
                <div className="admin-wallet-bals">
                  <div>
                    <span className="tiny">На сети</span>
                    <strong>{fmtChain(w.onchainUsdt, w.onchainSource)} USDT</strong>
                  </div>
                  <div>
                    <span className="tiny">По учёту</span>
                    <strong>{fmtChain(w.estimatedUsdt ?? 0)} USDT</strong>
                  </div>
                </div>
              </button>
            ))}
            {!visible.length && <p className="muted">Кошельков нет</p>}
          </>
        )}
      </div>

      <p className="tiny" style={{ marginTop: 18 }}>
        История сборов
      </p>
      <div className="hist-list">
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : (
          <>
            {sweeps.map((s) => (
              <div key={s.id} className="admin-dep-row">
                <div className="hist-main" style={{ marginLeft: 0 }}>
                  <div className="hist-title">
                    {fmtUsdt(s.amountMicros)} USDT{' '}
                    <span className="tiny">{s.network || s.walletAddress?.network}</span>
                  </div>
                  <div className="hist-sub" style={{ wordBreak: 'break-all' }}>
                    {s.toMaster || s.walletAddress?.address || '—'}
                  </div>
                </div>
                <div className="hist-right">
                  <span className={`badge ${statusClass(s.status)}`}>{statusLabel(s.status)}</span>
                  <div className="tiny" style={{ marginTop: 4 }}>
                    {fmtDate(s.createdAt)}
                  </div>
                </div>
              </div>
            ))}
            {!sweeps.length && <p className="muted">Задач сбора нет</p>}
          </>
        )}
      </div>

      <AdminSheet
        open={!!selected}
        onClose={() => {
          setSelected(null);
          setSecrets(null);
          setShowSecrets(false);
        }}
        title={selected ? `Кошелёк ${selected.network}` : 'Кошелёк'}
        subtitle={
          selected
            ? `@${selected.user?.username || selected.user?.firstName || 'нет'}`
            : undefined
        }
      >
        {selected && (
          <>
            <div className="tiny admin-wallet-addr" style={{ marginTop: 4 }}>
              {selected.address}
            </div>
            {selected.isValid === false && (
              <p className="error-text" style={{ marginTop: 8, fontSize: 13 }}>
                Адрес невалидный (старый placeholder). Деньги туда не дойдут — пересоздайте.
              </p>
            )}
            <div className="admin-wallet-bals" style={{ marginTop: 14 }}>
              <div>
                <span className="tiny">На сети</span>
                <strong>{fmtChain(selected.onchainUsdt, selected.onchainSource)} USDT</strong>
                {selected.onchainError && (
                  <span className="tiny">{selected.onchainError}</span>
                )}
              </div>
              <div>
                <span className="tiny">По учёту</span>
                <strong>{fmtChain(selected.estimatedUsdt ?? 0)} USDT</strong>
              </div>
            </div>
            {selected.masterAddress && (
              <p className="tiny" style={{ marginTop: 12, wordBreak: 'break-all' }}>
                Мастер: {selected.masterAddress}
              </p>
            )}

            {showSecrets && secrets && (
              <div className="settings-preview" style={{ marginTop: 14 }}>
                <div className="tiny">Путь: {secrets.derivationPath}</div>
                <div className="tiny" style={{ marginTop: 8 }}>
                  Private key
                </div>
                <div className="tiny" style={{ wordBreak: 'break-all' }}>
                  {secrets.privateKey || 'нет'}
                </div>
                <button
                  type="button"
                  className="cta ghost"
                  style={{ marginTop: 8, width: 'auto', padding: '8px 12px' }}
                  onClick={() => secrets.privateKey && copyText(secrets.privateKey)}
                >
                  <Copy size={14} /> Копировать ключ
                </button>
                {secrets.masterMnemonic && (
                  <>
                    <div className="tiny" style={{ marginTop: 12 }}>
                      Seed
                    </div>
                    <div className="tiny" style={{ wordBreak: 'break-word' }}>
                      {secrets.masterMnemonic}
                    </div>
                    <button
                      type="button"
                      className="cta ghost"
                      style={{ marginTop: 8, width: 'auto', padding: '8px 12px' }}
                      onClick={() => copyText(secrets.masterMnemonic!)}
                    >
                      <Copy size={14} /> Копировать seed
                    </button>
                  </>
                )}
                <p className="tiny" style={{ marginTop: 10 }}>
                  {secrets.note}
                </p>
              </div>
            )}

            <div className="admin-user-actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="cta"
                disabled={busy || selected.isValid === false}
                onClick={() => openWithdraw(selected)}
              >
                <ArrowUpFromLine size={16} /> Вывести
              </button>
              <button
                type="button"
                className="cta secondary"
                disabled={busy}
                onClick={() => void collectOne(selected)}
              >
                <Zap size={16} /> На мастер
              </button>
              <button type="button" className="cta ghost" disabled={busy} onClick={() => void loadSecrets()}>
                <KeyRound size={16} /> Ключи
              </button>
              <button
                type="button"
                className="cta ghost"
                disabled={busy}
                onClick={() => setConfirmRegen(true)}
              >
                <RotateCcw size={16} /> Пересоздать
              </button>
              <button
                type="button"
                className="cta ghost"
                onClick={() => copyText(selected.address)}
              >
                <Copy size={16} /> Адрес
              </button>
              <button
                type="button"
                className="cta ghost"
                disabled={busy || refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    await load();
                    haptic('success');
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                <RefreshCw size={16} /> Обновить
              </button>
            </div>
          </>
        )}
      </AdminSheet>

      <AdminConfirm
        open={wdOpen}
        onClose={() => setWdOpen(false)}
        title={selected ? `Вывести ${selected.network}` : 'Вывести'}
        message={
          selected
            ? `По учёту: ${fmtChain(selected.estimatedUsdt)} USDT. На сети: ${fmtChain(selected.onchainUsdt, selected.onchainSource)} USDT.`
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
              setWdAddress(selected?.masterAddress || '');
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
        {(wdDest === 'custom' || !selected?.masterAddress) && (
          <label className="admin-field admin-field-stack">
            <span className="tiny">Адрес назначения</span>
            <div className="input-shell">
              <input
                value={wdAddress}
                onChange={(e) => setWdAddress(e.target.value)}
                placeholder={selected?.network === 'TON' ? 'EQ… / UQ…' : 'T…'}
              />
            </div>
          </label>
        )}
        {wdDest === 'master' && selected?.masterAddress && (
          <p className="tiny" style={{ marginTop: 10, wordBreak: 'break-all' }}>
            Мастер: {selected.masterAddress}
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
        open={confirmSweep}
        onClose={() => setConfirmSweep(false)}
        title="Собрать все на мастер?"
        message="Создаст задачи сбора по всем депозитным адресам с положительным учётом."
        confirmLabel="Запустить"
        busy={busy}
        onConfirm={triggerAll}
      />

      <AdminConfirm
        open={confirmRegen}
        onClose={() => setConfirmRegen(false)}
        title="Пересоздать кошелёк?"
        message="Сгенерируется новый реальный адрес. Старый больше не используйте. Средства на старом адресе останутся там."
        confirmLabel="Пересоздать"
        danger
        busy={busy}
        onConfirm={regenerate}
      />
    </div>
  );
}
