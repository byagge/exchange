import { ReactNode, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FileText, X } from 'lucide-react';
import { appleEase } from '../../lib/motion';

export function AdminSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            className="sheet-backdrop"
            aria-label="Закрыть"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="sheet admin-sheet"
            role="dialog"
            aria-modal="true"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.36, ease: appleEase }}
          >
            <div className="sheet-grab" />
            <div className="sheet-top">
              <div>
                <div className="sheet-title">{title}</div>
                {subtitle && (
                  <p className="tiny" style={{ margin: 0 }}>
                    {subtitle}
                  </p>
                )}
              </div>
              <button type="button" className="sheet-close" onClick={onClose} aria-label="Закрыть">
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Mobile-first bottom sheet confirm (not a floating card) */
export function AdminConfirm({
  open,
  onClose,
  title,
  message,
  confirmLabel,
  danger,
  busy,
  children,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  children?: ReactNode;
  onConfirm: () => void | Promise<void>;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            className="sheet-backdrop"
            aria-label="Закрыть"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="admin-confirm-sheet"
            role="dialog"
            aria-modal="true"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.34, ease: appleEase }}
          >
            <div className="sheet-grab" />
            <h3>{title}</h3>
            {message && <p className="admin-confirm-msg">{message}</p>}
            {children}
            <div className="admin-confirm-actions">
              <button type="button" className="cta ghost" disabled={busy} onClick={onClose}>
                Отмена
              </button>
              <button
                type="button"
                className={`cta${danger ? ' danger-cta' : ''}`}
                disabled={busy}
                onClick={() => void onConfirm()}
              >
                {busy ? 'Подождите' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function DataRows({
  rows,
}: {
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <div className="sheet-rows">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="sheet-row">
          <span>{r.label}</span>
          <strong title={typeof r.value === 'string' ? r.value : undefined}>{r.value}</strong>
        </div>
      ))}
    </div>
  );
}

const API_BASE = import.meta.env.VITE_API_URL || '';

function resolveUploadUrl(url: string) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url.startsWith('/') ? url : `/${url}`}`;
}

export function ProofAttachments({
  files,
}: {
  files?: { url: string; name: string; mime: string; size?: number }[] | null;
}) {
  if (!files?.length) return null;
  return (
    <div className="proof-files">
      {files.map((f) => {
        const href = resolveUploadUrl(f.url);
        if (f.mime?.startsWith('image/')) {
          return (
            <a key={f.url} href={href} target="_blank" rel="noreferrer" className="proof-thumb">
              <img src={href} alt={f.name} />
              <span>{f.name}</span>
            </a>
          );
        }
        if (f.mime?.startsWith('video/')) {
          return (
            <div key={f.url} className="proof-thumb proof-video">
              <video src={href} controls playsInline preload="metadata" />
              <a href={href} target="_blank" rel="noreferrer">
                {f.name}
              </a>
            </div>
          );
        }
        return (
          <a key={f.url} href={href} target="_blank" rel="noreferrer" className="proof-doc">
            <FileText size={18} />
            <span>{f.name}</span>
          </a>
        );
      })}
    </div>
  );
}
