import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  Check,
  Copy,
  Gift,
  Headset,
  IdCard,
  Percent,
  Shield,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, formatMicros, haptic } from '../lib/api';

export function ProfilePage() {
  const { token, user, refreshProfile } = useAuth();
  const [referral, setReferral] = useState<{
    count: number;
    balanceMicros: number;
    link: string;
    percent: number;
  } | null>(null);
  const [supportUrl, setSupportUrl] = useState('https://t.me/');
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<{
      user: any;
      referral: any;
      supportUrl: string;
    }>('/api/me', { token }).then((r) => {
      setReferral(r.referral);
      setSupportUrl(r.supportUrl);
    });
  }, [token]);

  const loyalty = user?.loyalty;
  const progress =
    loyalty?.next && loyalty.next.minVolumeMicros > 0
      ? Math.min(100, (user!.loyaltyVolume / loyalty.next.minVolumeMicros) * 100)
      : 100;

  const initials = (
    user?.firstName?.[0] ||
    user?.username?.[0] ||
    'E'
  ).toUpperCase();

  async function copyLink() {
    if (!referral?.link || copied) return;
    await navigator.clipboard.writeText(referral.link);
    haptic('success');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function withdrawReferral() {
    if (!token) return;
    await api('/api/referral/withdraw', { method: 'POST', token });
    haptic('success');
    setMsg('Реферальный баланс переведён');
    await refreshProfile();
    const r = await api<{ referral: any }>('/api/me', { token });
    setReferral(r.referral);
  }

  return (
    <div className="page page-atm">
      <div className="page-head">
        <div className="page-head-main">
          <h1 className="page-head-title">Профиль</h1>
        </div>
      </div>

      <div className="profile-hero" style={{ marginTop: 4 }}>
        <div className="profile-hero-row">
          <div className="avatar-ring">
            <div>{initials}</div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="profile-name">
              {user?.firstName || user?.username || 'User'}
            </div>
            <div className="profile-handle">
              {user?.username ? `@${user.username}` : 'без username'}
            </div>
            <div
              className="tiny"
              style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <IdCard size={13} /> ID {user?.telegramId}
            </div>
          </div>
        </div>
      </div>

      <div className="stat-rich">
        <div className="stat">
          <div className="icon-wrap">
            <Sparkles size={14} />
          </div>
          <div className="tiny">Сделок</div>
          <strong>{user?.tradeCount ?? 0}</strong>
        </div>
        <div className="stat">
          <div className="icon-wrap">
            <ArrowDownToLine size={14} />
          </div>
          <div className="tiny">Оборот</div>
          <strong style={{ fontSize: 13 }}>{formatMicros(user?.loyaltyVolume || 0)}</strong>
        </div>
        <div className="stat">
          <div className="icon-wrap">
            <Percent size={14} />
          </div>
          <div className="tiny">RUB</div>
          <strong>
            {((user?.rubTurnover || 0) / 100).toLocaleString('ru-RU', {
              maximumFractionDigits: 0,
            })}
          </strong>
        </div>
      </div>

      <div className="loyalty-card">
        <div className="loyalty-top">
          <div className="loyalty-badge">
            <Trophy size={20} />
          </div>
          <div>
            <strong>{loyalty?.current?.name || 'Стандарт'}</strong>
            <div className="tiny">{loyalty?.current?.label}</div>
          </div>
        </div>
        <div className="progress">
          <i style={{ width: `${progress}%` }} />
        </div>
        {loyalty?.next && (
          <p className="tiny" style={{ marginTop: 10 }}>
            До уровня {loyalty.next.name}: {formatMicros(loyalty.remainingToNext)} USDT
          </p>
        )}
      </div>

      <div className="referral-banner">
        <div className="row" style={{ marginBottom: 12 }}>
          <div>
            <h3>Реферальная программа</h3>
            <p className="tiny" style={{ margin: 0 }}>
              Приглашайте друзей и получайте {referral?.percent ?? 0}% с оборота
            </p>
          </div>
          <Gift size={28} color="var(--success)" />
        </div>

        <div className="stats" style={{ marginTop: 0 }}>
          <div className="stat">
            <div className="tiny">Баланс</div>
            <strong style={{ fontSize: 13 }}>
              {formatMicros(referral?.balanceMicros || 0)}
            </strong>
          </div>
          <div className="stat">
            <div
              className="tiny"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Users size={12} /> Приглашено
            </div>
            <strong>{referral?.count ?? 0}</strong>
          </div>
          <div className="stat">
            <div className="tiny">%</div>
            <strong>{referral?.percent ?? 0}</strong>
          </div>
        </div>

        <div className="address-box" style={{ marginTop: 12 }}>
          {referral?.link || 'нет'}
        </div>
        <button
          className={`cta secondary copy-cta${copied ? ' copied' : ''}`}
          onClick={copyLink}
          type="button"
          aria-label={copied ? 'Скопировано' : 'Копировать ссылку'}
          disabled={copied}
        >
          {copied ? (
            <Check size={22} strokeWidth={2.75} />
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Copy size={16} /> Копировать ссылку
            </span>
          )}
        </button>
        <button
          className="cta"
          disabled={!referral?.balanceMicros}
          onClick={withdrawReferral}
          type="button"
        >
          Вывести на баланс
        </button>
      </div>

      <a
        className="cta ghost"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          marginTop: 16,
        }}
        href={supportUrl}
        target="_blank"
        rel="noreferrer"
      >
        <Headset size={16} /> Поддержка
      </a>

      {user?.isAdmin && (
        <Link
          to="/admin"
          className="cta secondary"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 10,
            textDecoration: 'none',
          }}
        >
          <Shield size={16} /> Админ-панель
        </Link>
      )}

      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
