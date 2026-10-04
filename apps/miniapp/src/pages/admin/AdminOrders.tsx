import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Clock3,
  FileText,
  FileUp,
  Image,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import { DirectionFlow, MetaLine, MetaSep, pairDirection } from '../../components/DirectionFlow';
import { adminApi, getAdminToken } from '../../lib/adminAuth';
import { haptic } from '../../lib/api';
import { AdminConfirm, AdminSheet, DataRows, ProofAttachments } from './AdminUi';
import { fmtDate, fmtRub, fmtUsdt, methodLabel, statusClass, statusLabel } from './adminFormat';
import { PageHead } from './PageHead';

type Order = any;
type LocalFile = { file: File; preview?: string };

const API_BASE = import.meta.env.VITE_API_URL || '';

export function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<'all' | 'awaiting_payout' | 'processing' | 'completed'>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<Order | null>(null);
  const [confirm, setConfirm] = useState<{
    type: 'fulfill' | 'reject' | 'dispatch';
    order: Order;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [proof, setProof] = useState('');
  const [dispatchRub, setDispatchRub] = useState('');
  const [dispatchMinutes, setDispatchMinutes] = useState('30');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const q = filter === 'all' ? '' : `?status=${filter}`;
    setOrders(await adminApi(`/api/admin/orders${q}`));
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    return () => {
      files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    };
  }, [files]);

  async function refresh() {
    setRefreshing(true);
    haptic('light');
    try {
      await load();
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  }

  const visible = useMemo(() => orders, [orders]);

  function openDetail(o: Order) {
    haptic('light');
    setDetail(o);
  }

  function clearFiles() {
    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    setFiles([]);
  }

  function onPickFiles(list: FileList | null) {
    if (!list?.length) return;
    const next: LocalFile[] = [...files];
    for (const file of Array.from(list).slice(0, 5 - next.length)) {
      next.push({
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      });
    }
    setFiles(next.slice(0, 5));
  }

  function payoutKopecks(o: Order) {
    return o.payoutAmountKopecks != null ? o.payoutAmountKopecks : o.toAmountKopecks;
  }

  function detailRows(o: Order) {
    const req = o.requisites || {};
    const dir = pairDirection(o.pair);
    const rows: { label: string; value: React.ReactNode }[] = [
      { label: 'ID', value: o.id },
      {
        label: 'Направление',
        value: (
          <span className="dir-flow-wrap">
            <DirectionFlow from={dir.from} to={dir.to} />
            <span className="tiny"> (выплата)</span>
          </span>
        ),
      },
      { label: 'Статус', value: statusLabel(o.status) },
      {
        label: 'Пользователь',
        value: (
          <MetaLine>
            @{o.user?.username || 'нет'}
            <MetaSep />
            Telegram {String(o.user?.telegramId || 'нет')}
          </MetaLine>
        ),
      },
      { label: 'Курс', value: `${o.rate} ₽` },
      { label: 'Списание USDT', value: `${fmtUsdt(o.fromAmountMicros)} USDT` },
      { label: 'К выплате', value: `${fmtRub(payoutKopecks(o))} ₽` },
      { label: 'Комиссия', value: `${fmtUsdt(o.feeMicros)} USDT` },
      { label: 'Метод', value: methodLabel(o.method || 'fiat') },
      { label: 'Создано', value: fmtDate(o.createdAt) },
    ];
    if (req.fio) rows.push({ label: 'ФИО', value: String(req.fio) });
    if (req.bank) rows.push({ label: 'Банк', value: String(req.bank) });
    if (req.phone) rows.push({ label: 'СБП', value: String(req.phone) });
    if (req.card) rows.push({ label: 'Карта', value: String(req.card) });
    if (o.number) rows.push({ label: 'Номер', value: `№${o.number}` });
    if (o.clientIp) rows.push({ label: 'IP клиента', value: String(o.clientIp) });
    if (o.clientDevice) rows.push({ label: 'Устройство', value: String(o.clientDevice) });
    if (o.payments?.length) {
      const st: Record<string, string> = {
        sent: 'ждём клиента',
        confirmed: 'подтверждён',
        proof_requested: 'не пришёл, ждём видео',
        disputed: 'не пришёл, видео получено',
        cancelled: 'отменён',
      };
      for (const p of o.payments) {
        rows.push({
          label: `Платёж №${p.seq}`,
          value: `${fmtRub(p.amountKopecks)} ₽ · ${st[p.status] || p.status}`,
        });
      }
    }
    if (o.payoutDeadline) rows.push({ label: 'Таймер до', value: fmtDate(o.payoutDeadline) });
    if (o.dispatchedAt) rows.push({ label: 'Направлено', value: fmtDate(o.dispatchedAt) });
    if (o.failReason) rows.push({ label: 'Причина отказа', value: String(o.failReason) });
    if (o.proof) rows.push({ label: 'Комментарий', value: String(o.proof) });
    if (o.adminNote) rows.push({ label: 'Заметка', value: String(o.adminNote) });
    if (o.completedAt) rows.push({ label: 'Завершено', value: fmtDate(o.completedAt) });
    return rows;
  }

  function openDispatch(o: Order) {
    setDispatchRub(String((payoutKopecks(o) / 100).toFixed(2)));
    setDispatchMinutes('30');
    setConfirm({ type: 'dispatch', order: o });
  }

  async function doDispatch() {
    if (!confirm || confirm.type !== 'dispatch') return;
    setBusy(true);
    try {
      await adminApi(`/api/admin/orders/${confirm.order.id}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({
          amountRub: Number(dispatchRub.replace(',', '.')),
          timerMinutes: Number(dispatchMinutes) || 30,
        }),
      });
      haptic('success');
      setConfirm(null);
      setDetail(null);
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doFulfill() {
    if (!confirm || confirm.type !== 'fulfill') return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('proof', proof || 'Выплачено');
      fd.append('note', 'Выплата RUB');
      files.forEach((f) => fd.append('files', f.file));

      const token = getAdminToken();
      const res = await fetch(`${API_BASE}/api/admin/orders/${confirm.order.id}/fulfill`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Ошибка');

      haptic('success');
      setConfirm(null);
      setDetail(null);
      setProof('');
      clearFiles();
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doReject() {
    if (!confirm || confirm.type !== 'reject') return;
    if (reason.trim().length < 2) {
      alert('Укажите причину');
      return;
    }
    setBusy(true);
    try {
      await adminApi(`/api/admin/orders/${confirm.order.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      haptic('success');
      setConfirm(null);
      setDetail(null);
      setReason('');
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  function isActionable(o: Order) {
    return o.status === 'awaiting_payout' || o.status === 'processing';
  }

  return (
    <div>
      <PageHead
        title="Заявки"
        action={
          <button
            type="button"
            className={`hist-refresh${refreshing ? ' spinning' : ''}`}
            onClick={refresh}
          >
            <RefreshCw size={18} />
          </button>
        }
      />

      <div className="tabs hist-tabs">
        {(
          [
            ['all', 'Все'],
            ['awaiting_payout', 'Очередь'],
            ['processing', 'Таймер'],
            ['completed', 'Готово'],
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

      <div className="hist-list">
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : !visible.length ? (
          <p className="muted">Заявок нет</p>
        ) : (
          visible.map((o) => {
            const dir = pairDirection(o.pair);
            const req = o.requisites || {};
            return (
              <div key={o.id} className="admin-order">
                <button type="button" className="admin-order-hit" onClick={() => openDetail(o)}>
                  <div className="admin-order-top">
                    <div>
                      <strong>
                        <DirectionFlow from={dir.from} to={dir.to} />
                      </strong>
                      <div className="tiny">
                        <MetaLine>
                          @{o.user?.username || 'нет'}
                          <MetaSep />
                          {req.fio || 'без ФИО'}
                          <MetaSep />
                          {fmtDate(o.createdAt)}
                        </MetaLine>
                      </div>
                    </div>
                    <div className="admin-order-amt">
                      {fmtUsdt(o.fromAmountMicros)} USDT
                      <span className="dir-flow-wrap tiny">
                        <DirectionFlow from="USDT" to={`${fmtRub(payoutKopecks(o))} ₽`} size={12} />
                      </span>
                    </div>
                  </div>
                  <span className={`badge ${statusClass(o.status)}`} style={{ marginTop: 8 }}>
                    {statusLabel(o.status)}
                  </span>
                </button>

                <button type="button" className="cta secondary admin-more-btn" onClick={() => openDetail(o)}>
                  Подробнее <ChevronRight size={16} />
                </button>

                {isActionable(o) && (
                  <div className="admin-order-actions" style={{ flexWrap: 'wrap' }}>
                    {!o.dispatchedAt && (
                      <button
                        type="button"
                        className="cta secondary"
                        style={{ marginTop: 0, flex: '1 1 100%' }}
                        onClick={() => openDispatch(o)}
                      >
                        <Send size={16} /> Направить сумму и таймер
                      </button>
                    )}
                    <button
                      type="button"
                      className="cta"
                      style={{ marginTop: 0, flex: 1 }}
                      onClick={() => {
                        setProof('');
                        clearFiles();
                        setConfirm({ type: 'fulfill', order: o });
                      }}
                    >
                      <Check size={16} /> Выплатить
                    </button>
                    <button
                      type="button"
                      className="cta ghost"
                      style={{ marginTop: 0, flex: 1 }}
                      onClick={() => {
                        setReason('');
                        setConfirm({ type: 'reject', order: o });
                      }}
                    >
                      <X size={16} /> Отклонить
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <AdminSheet
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Выплата RUB"
        subtitle={detail ? statusLabel(detail.status) : undefined}
      >
        {detail && (
          <>
            <div className="sheet-amount">
              {fmtUsdt(detail.fromAmountMicros)}
              <span>USDT</span>
            </div>
            <DataRows rows={detailRows(detail)} />
            <ProofAttachments files={detail.proofFiles} />
            {!!detail.clientProofFiles?.length && (
              <div className="proof-block" style={{ marginTop: 12 }}>
                <div className="tiny proof-block-title">Видео от клиента</div>
                <ProofAttachments files={detail.clientProofFiles} />
              </div>
            )}
            {isActionable(detail) && (
              <div className="admin-order-actions" style={{ marginTop: 16, flexWrap: 'wrap' }}>
                {!detail.dispatchedAt && (
                  <button
                    type="button"
                    className="cta secondary"
                    style={{ marginTop: 0, flex: '1 1 100%' }}
                    onClick={() => openDispatch(detail)}
                  >
                    <Send size={16} /> Направить сумму и таймер
                  </button>
                )}
                <button
                  type="button"
                  className="cta"
                  style={{ marginTop: 0, flex: 1 }}
                  onClick={() => {
                    setProof('');
                    clearFiles();
                    setConfirm({ type: 'fulfill', order: detail });
                  }}
                >
                  Выплатить
                </button>
                <button
                  type="button"
                  className="cta ghost"
                  style={{ marginTop: 0, flex: 1 }}
                  onClick={() => {
                    setReason('');
                    setConfirm({ type: 'reject', order: detail });
                  }}
                >
                  Отклонить
                </button>
              </div>
            )}
            <button type="button" className="cta secondary sheet-done" onClick={() => setDetail(null)}>
              Закрыть
            </button>
          </>
        )}
      </AdminSheet>

      <AdminConfirm
        open={confirm?.type === 'dispatch'}
        onClose={() => setConfirm(null)}
        title="Направить клиенту"
        message="Клиент получит сумму платежа и таймер. После истечения сможет прикрепить видео."
        confirmLabel="Направить"
        busy={busy}
        onConfirm={doDispatch}
      >
        <label className="admin-field admin-field-stack">
          <span className="tiny">Сумма платежа, ₽</span>
          <input
            className="admin-textarea admin-confirm-input"
            inputMode="decimal"
            value={dispatchRub}
            onChange={(e) => setDispatchRub(e.target.value)}
          />
        </label>
        <label className="admin-field admin-field-stack">
          <span className="tiny">Таймер, минут</span>
          <input
            className="admin-textarea admin-confirm-input"
            inputMode="numeric"
            value={dispatchMinutes}
            onChange={(e) => setDispatchMinutes(e.target.value)}
          />
        </label>
        <div className="tiny" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <Clock3 size={14} /> По умолчанию 30 минут
        </div>
      </AdminConfirm>

      <AdminConfirm
        open={confirm?.type === 'fulfill'}
        onClose={() => {
          setConfirm(null);
          clearFiles();
        }}
        title="Подтвердить выплату RUB?"
        message={
          confirm
            ? `Клиенту отмечается выплата ${fmtRub(payoutKopecks(confirm.order))} ₽. USDT спишется с заблокированных.`
            : undefined
        }
        confirmLabel="Подтвердить"
        busy={busy}
        onConfirm={doFulfill}
      >
        <label className="admin-field admin-field-stack">
          <span className="tiny">Комментарий для клиента</span>
          <textarea
            className="admin-textarea admin-confirm-input"
            rows={3}
            placeholder="Необязательно"
            value={proof}
            onChange={(e) => setProof(e.target.value)}
          />
        </label>

        <div className="proof-attach">
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              onPickFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={docRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf"
            multiple
            hidden
            onChange={(e) => {
              onPickFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <span className="tiny proof-attach-label">Вложения к пруфу</span>
          <div className="proof-attach-row">
            <button
              type="button"
              className="proof-attach-chip"
              disabled={files.length >= 5}
              onClick={() => photoRef.current?.click()}
            >
              <Image size={18} />
              <span>Фото</span>
            </button>
            <button
              type="button"
              className="proof-attach-chip"
              disabled={files.length >= 5}
              onClick={() => docRef.current?.click()}
            >
              <FileText size={18} />
              <span>Документ</span>
            </button>
          </div>
          <p className="tiny proof-attach-hint">До 5 файлов. Клиент увидит их в истории.</p>
          {!!files.length && (
            <div className="proof-local-list">
              {files.map((f, i) => (
                <div key={`${f.file.name}-${i}`} className="proof-local-item">
                  {f.preview ? (
                    <img src={f.preview} alt="" />
                  ) : (
                    <span className="proof-local-ico">
                      <FileUp size={18} />
                    </span>
                  )}
                  <span>{f.file.name}</span>
                  <button
                    type="button"
                    className="proof-local-remove"
                    aria-label="Убрать"
                    onClick={() => {
                      if (f.preview) URL.revokeObjectURL(f.preview);
                      setFiles((prev) => prev.filter((_, idx) => idx !== i));
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </AdminConfirm>

      <AdminConfirm
        open={confirm?.type === 'reject'}
        onClose={() => setConfirm(null)}
        title="Отклонить заявку?"
        message="Средства вернутся клиенту, если были заблокированы. Укажите причину."
        confirmLabel="Отклонить"
        danger
        busy={busy}
        onConfirm={doReject}
      >
        <label className="admin-field admin-field-stack">
          <span className="tiny">Причина отказа</span>
          <textarea
            className="admin-textarea admin-confirm-input"
            rows={3}
            placeholder="Укажите причину"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </AdminConfirm>
    </div>
  );
}
