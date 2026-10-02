import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronRight,
  Clock3,
  Film,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { DirectionFlow, pairDirection } from '../components/DirectionFlow';
import { ProofAttachments } from './admin/AdminUi';
import { useAuth } from '../lib/auth';
import { api, formatMicros, haptic } from '../lib/api';
import { appleEase } from '../lib/motion';

type Item = {
  id: string;
  type: 'deposit' | 'exchange' | 'withdrawal';
  status: string;
  amountMicros: number;
  meta: Record<string, any>;
  createdAt: string;
};

const API_BASE = import.meta.env.VITE_API_URL || '';

const typeLabels: Record<Item['type'], string> = {
  deposit: 'Пополнение',
  exchange: 'Обмен',
  withdrawal: 'Вывод',
};

const statusRu: Record<string, string> = {
  pending: 'В обработке',
  confirming: 'Подтверждение',
  credited: 'Зачислено',
  failed: 'Ошибка',
  expired: 'Истекло',
  draft: 'Черновик',
  awaiting_funds: 'Ожидает оплаты',
  locked: 'Заблокировано',
  processing: 'Выплата',
  awaiting_payout: 'Ожидает выплаты',
  completed: 'Выполнено',
  cancelled: 'Отменено',
};

function statusLabel(s: string) {
  return statusRu[s] || s;
}

function statusClass(s: string) {
  if (['credited', 'completed'].includes(s)) return 'ok';
  if (['failed', 'cancelled', 'expired'].includes(s)) return 'err';
  return 'warn';
}

function TypeIcon({ type }: { type: Item['type'] }) {
  if (type === 'deposit') return <ArrowDownToLine size={18} />;
  if (type === 'exchange') return <ArrowLeftRight size={18} />;
  return <ArrowUpRight size={18} />;
}

function fmtRub(kopecks?: number | null) {
  if (kopecks == null) return 'нет';
  return (kopecks / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function useCountdown(deadline?: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  return useMemo(() => {
    if (!deadline) return null;
    const left = new Date(deadline).getTime() - now;
    if (left <= 0) return { expired: true as const, label: '00:00' };
    const m = Math.floor(left / 60_000);
    const s = Math.floor((left % 60_000) / 1000);
    return {
      expired: false as const,
      label: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
    };
  }, [deadline, now]);
}

function DetailRows({
  item,
  countdown,
}: {
  item: Item;
  countdown: ReturnType<typeof useCountdown>;
}) {
  const m = item.meta || {};
  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Тип', value: typeLabels[item.type] },
    { label: 'Статус', value: statusLabel(item.status) },
    {
      label: 'Дата',
      value: new Date(item.createdAt).toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    },
    { label: 'ID', value: item.id },
  ];

  if (item.type === 'deposit') {
    if (m.source) {
      rows.push({
        label: 'Источник',
        value: m.source === 'cryptobot' ? 'CryptoBot' : 'Ончейн',
      });
    }
    if (m.network) rows.push({ label: 'Сеть', value: String(m.network) });
    if (m.txHash) rows.push({ label: 'Tx', value: String(m.txHash) });
    rows.push({ label: 'Сумма', value: `${formatMicros(item.amountMicros)} USDT` });
  }

  if (item.type === 'exchange') {
    const dir = pairDirection(m.pair);
    rows.push({
      label: 'Направление',
      value: <DirectionFlow from={dir.from} to={dir.to} />,
    });
    if (m.rate) rows.push({ label: 'Курс', value: `1 USDT = ${m.rate} ₽` });
    rows.push({
      label: 'Списание',
      value: `${formatMicros(item.amountMicros)} USDT`,
    });
    const payout =
      m.payoutAmountKopecks != null ? m.payoutAmountKopecks : m.toAmountKopecks;
    rows.push({ label: 'К выплате', value: `${fmtRub(payout)} ₽` });
    if (m.feeMicros > 0) {
      rows.push({ label: 'Комиссия', value: `${formatMicros(m.feeMicros)} USDT` });
    }
    const req = m.requisites;
    if (req?.fio) rows.push({ label: 'ФИО', value: String(req.fio) });
    if (req?.bank) rows.push({ label: 'Банк', value: String(req.bank) });
    if (req?.phone) rows.push({ label: 'СБП', value: String(req.phone) });
    if (req?.card) rows.push({ label: 'Карта', value: String(req.card) });
    if (m.payoutDeadline) {
      rows.push({
        label: 'Таймер',
        value: countdown?.expired
          ? 'Истёк — можно прикрепить видео'
          : countdown
            ? `Осталось ${countdown.label}`
            : new Date(m.payoutDeadline).toLocaleString('ru-RU'),
      });
    }
    if (m.failReason) rows.push({ label: 'Причина', value: String(m.failReason) });
    if (m.proof) rows.push({ label: 'Комментарий', value: String(m.proof) });
  }

  if (item.type === 'withdrawal') {
    rows.push({
      label: 'Способ',
      value:
        m.method === 'cryptobot'
          ? 'Чек КБ'
          : m.method === 'onchain'
            ? 'Ончейн'
            : String(m.method || 'нет'),
    });
    if (m.network) rows.push({ label: 'Сеть', value: String(m.network) });
    if (m.destination) rows.push({ label: 'Куда', value: String(m.destination) });
    rows.push({ label: 'Сумма', value: `${formatMicros(item.amountMicros)} USDT` });
    if (m.feeMicros > 0) {
      rows.push({ label: 'Комиссия', value: `${formatMicros(m.feeMicros)} USDT` });
    }
    if (m.failReason) rows.push({ label: 'Причина', value: String(m.failReason) });
  }

  const proofFiles = item.type === 'exchange' ? m.proofFiles : null;
  const clientProof = item.type === 'exchange' ? m.clientProofFiles : null;

  return (
    <>
      <div className="sheet-rows">
        {rows.map((r) => (
          <div key={r.label} className="sheet-row">
            <span>{r.label}</span>
            <strong title={typeof r.value === 'string' ? r.value : undefined}>{r.value}</strong>
          </div>
        ))}
      </div>
      {!!proofFiles?.length && (
        <div className="proof-block">
          <div className="tiny proof-block-title">Вложения от поддержки</div>
          <ProofAttachments files={proofFiles} />
        </div>
      )}
      {!!clientProof?.length && (
        <div className="proof-block">
          <div className="tiny proof-block-title">Ваше видео</div>
          <ProofAttachments files={clientProof} />
        </div>
      )}
    </>
  );
}

export function HistoryPage() {
  const { token } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<'all' | Item['type']>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  const countdown = useCountdown(
    selected?.type === 'exchange' ? selected.meta?.payoutDeadline : null,
  );

  async function load() {
    if (!token) return;
    const res = await api<{ items: Item[] }>('/api/history', { token });
    setItems(res.items);
  }

  async function refresh() {
    if (refreshing) return;
    haptic('light');
    setRefreshing(true);
    try {
      await load();
    } finally {
      setTimeout(() => setRefreshing(false), 450);
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, [token]);

  useEffect(() => {
    if (!selected) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const fresh = items.find((i) => i.id === selected.id && i.type === selected.type);
    if (fresh) setSelected(fresh);
  }, [items]);

  const visible = items.filter((i) => filter === 'all' || i.type === filter);

  function openItem(item: Item) {
    haptic('light');
    setUploadErr(null);
    setSelected(item);
  }

  function closeSheet() {
    setSelected(null);
    setUploadErr(null);
  }

  const canAttachVideo =
    selected?.type === 'exchange' &&
    !!selected.meta?.payoutDeadline &&
    countdown?.expired &&
    ['processing', 'awaiting_payout'].includes(selected.status);

  async function uploadVideo(list: FileList | null) {
    if (!token || !selected || !list?.length) return;
    setUploading(true);
    setUploadErr(null);
    try {
      const fd = new FormData();
      Array.from(list)
        .slice(0, 3)
        .forEach((f) => fd.append('files', f));
      const res = await fetch(`${API_BASE}/api/exchange/orders/${selected.id}/client-proof`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Ошибка загрузки');
      haptic('success');
      await load();
    } catch (e: any) {
      setUploadErr(e.message || 'Ошибка');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="page hist-page">
      <div className="page-head">
        <div className="page-head-main">
          <h1 className="page-head-title">История</h1>
        </div>
        <div className="page-head-action">
          <button
            type="button"
            className={`hist-refresh${refreshing ? ' spinning' : ''}`}
            onClick={refresh}
            aria-label="Обновить"
          >
            <RefreshCw size={18} strokeWidth={2.25} />
          </button>
        </div>
      </div>

      <div className="tabs hist-tabs">
        {(['all', 'deposit', 'exchange', 'withdrawal'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`tab${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'Все' : typeLabels[f]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Clock3 size={24} />
          </div>
          <div style={{ fontWeight: 600, color: 'var(--text)' }}>Заявок пока нет</div>
          <p className="tiny">Обмены и операции с балансом появятся здесь.</p>
          <button
            className="cta secondary"
            style={{ marginTop: 16 }}
            type="button"
            onClick={() => nav('/exchange')}
          >
            Создать обмен
          </button>
        </div>
      ) : (
        <div className="hist-list">
          {visible.map((item) => (
            <button
              key={`${item.type}-${item.id}`}
              type="button"
              className="hist-item"
              onClick={() => openItem(item)}
            >
              <div className={`hist-icon ${item.type}`}>
                <TypeIcon type={item.type} />
              </div>
              <div className="hist-main">
                <div className="hist-title">{typeLabels[item.type]}</div>
                <div className="hist-sub">
                  {new Date(item.createdAt).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
              <div className="hist-right">
                <div className="hist-amount">{formatMicros(item.amountMicros)}</div>
                <span className={`badge ${statusClass(item.status)}`}>
                  {statusLabel(item.status)}
                </span>
              </div>
              <ChevronRight size={16} className="hist-chevron" />
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {selected && (
          <>
            <motion.button
              type="button"
              className="sheet-backdrop"
              aria-label="Закрыть"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              onClick={closeSheet}
            />
            <motion.div
              className="sheet"
              role="dialog"
              aria-modal="true"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.38, ease: appleEase }}
            >
              <div className="sheet-grab" />
              <div className="sheet-top">
                <div className="sheet-top-main">
                  <div className={`hist-icon ${selected.type}`}>
                    <TypeIcon type={selected.type} />
                  </div>
                  <div>
                    <div className="sheet-title">{typeLabels[selected.type]}</div>
                    <span className={`badge ${statusClass(selected.status)}`}>
                      {statusLabel(selected.status)}
                    </span>
                  </div>
                </div>
                <button type="button" className="sheet-close" onClick={closeSheet} aria-label="Закрыть">
                  <X size={18} />
                </button>
              </div>

              <div className="sheet-amount">
                {formatMicros(selected.amountMicros)}
                <span>USDT</span>
              </div>

              <DetailRows item={selected} countdown={countdown} />

              {canAttachVideo && (
                <div className="proof-block" style={{ marginTop: 12 }}>
                  <input
                    ref={videoRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm,video/*,image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      uploadVideo(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="cta"
                    disabled={uploading}
                    onClick={() => videoRef.current?.click()}
                  >
                    {uploading ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <Loader2 size={16} className="spin" /> Загрузка…
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <Film size={16} /> Прикрепить видео
                      </span>
                    )}
                  </button>
                  <p className="tiny" style={{ marginTop: 8 }}>
                    Таймер истёк — оператор получит ваше видео.
                  </p>
                  {uploadErr && <p className="error-text">{uploadErr}</p>}
                </div>
              )}

              <button type="button" className="cta secondary sheet-done" onClick={closeSheet}>
                Готово
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
