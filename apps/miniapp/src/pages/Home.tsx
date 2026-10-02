import { useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Plus, ArrowLeftRight } from 'lucide-react';
import { MetaLine, MetaSep } from '../components/DirectionFlow';
import { useAuth } from '../lib/auth';
import { api, haptic } from '../lib/api';
import { UsdtLogo } from '../components/AssetLogos';
import { RateCalculator } from '../components/RateCalculator';

export function HomePage() {
  const { token } = useAuth();
  const nav = useNavigate();
  const [balance, setBalance] = useState(0);
  const [rate, setRate] = useState('98.01');

  const spring = useSpring(0, { stiffness: 80, damping: 20 });
  const display = useTransform(spring, (v) =>
    (v / 1_000_000).toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  );

  useEffect(() => {
    if (!token) return;
    (async () => {
      const b = await api<{ available: number; rate: string }>('/api/balance', { token });
      setBalance(b.available);
      setRate(b.rate);
      spring.set(b.available);
    })().catch(console.error);
  }, [token, spring]);

  return (
    <div className="page page-atm">
      <div className="row">
        <div className="brand">
          Ex<span>change</span>
        </div>
        <div className="asset-chip" style={{ padding: '4px 10px 4px 4px' }}>
          <UsdtLogo size={22} />
          <span style={{ fontSize: 12 }}>USDT</span>
        </div>
      </div>

      <div className="balance-hero">
        <div className="balance-label">Общий баланс</div>
        <div className="balance-value">
          <motion.span>{display}</motion.span>{' '}
          <span style={{ fontSize: 22, color: 'var(--text-secondary)' }}>USDT</span>
        </div>
        <div className="rate-pill">
          <MetaLine>
            Курс 1 USDT
            <MetaSep />
            <strong>{Number(rate).toLocaleString('ru-RU')} ₽</strong>
          </MetaLine>
        </div>
      </div>

      <div className="actions-row">
        <button
          className="action-btn primary"
          type="button"
          onClick={() => {
            haptic('medium');
            nav('/wallet?tab=deposit');
          }}
        >
          <div className="action-icon">
            <Plus size={22} strokeWidth={2.25} />
          </div>
          <span>Пополнить</span>
        </button>
        <button
          className="action-btn"
          type="button"
          onClick={() => {
            haptic();
            nav('/exchange');
          }}
        >
          <div className="action-icon">
            <ArrowLeftRight size={20} />
          </div>
          <span>Обмен</span>
        </button>
        <button
          className="action-btn"
          type="button"
          onClick={() => {
            haptic();
            nav('/wallet?tab=withdraw');
          }}
        >
          <div className="action-icon">
            <ArrowUpRight size={20} />
          </div>
          <span>Вывести</span>
        </button>
      </div>

      <RateCalculator rate={rate} balance={balance} />
    </div>
  );
}
