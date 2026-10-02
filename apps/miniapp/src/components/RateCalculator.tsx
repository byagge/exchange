import { useMemo, useState } from 'react';
import { LayoutGroup, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { formatMicros, haptic } from '../lib/api';
import { RubLogo, UsdtLogo } from './AssetLogos';

const USDT_QUICK = [10, 50, 100];

type Props = {
  rate: string;
  balance: number;
  initialUsdt?: string;
};

/** Калькулятор только USDT → RUB (оба поля связаны курсом). */
export function RateCalculator({ rate, balance, initialUsdt = '' }: Props) {
  const nav = useNavigate();
  const [usdt, setUsdt] = useState(initialUsdt);
  const [rub, setRub] = useState('');

  const rateNum = useMemo(() => Number(rate) || 0, [rate]);

  function setFromUsdt(v: string) {
    setUsdt(v);
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n) || !rateNum) {
      setRub('');
      return;
    }
    setRub((n * rateNum).toFixed(2));
  }

  function setFromRub(v: string) {
    setRub(v);
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n) || !rateNum) {
      setUsdt('');
      return;
    }
    setUsdt((n / rateNum).toFixed(6));
  }

  const canGo = Number(usdt.replace(',', '.')) > 0;
  const layoutSpring = { type: 'spring' as const, stiffness: 380, damping: 36, mass: 0.85 };

  return (
    <div className="home-calc">
      <div className="home-calc-head">
        <h2>Калькулятор</h2>
        {rateNum > 0 && <span>USDT → RUB · 1 USDT = {rate} ₽</span>}
      </div>

      <LayoutGroup>
        <div className="calc-stack" style={{ marginTop: 12 }}>
          <motion.div layout className="calc-slot" style={{ order: 1 }} transition={layoutSpring}>
            <div className="calc-card">
              <div className="calc-card-top">
                <div className="calc-asset">
                  <UsdtLogo size={26} />
                  <span>USDT</span>
                </div>
                <span className="calc-hint">Отдаёте</span>
              </div>
              <input
                className="calc-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={usdt}
                onChange={(e) => setFromUsdt(e.target.value)}
              />
              <div className="calc-quicks">
                {USDT_QUICK.map((n) => (
                  <button key={n} type="button" onClick={() => setFromUsdt(String(n))}>
                    {n}
                  </button>
                ))}
                <button type="button" onClick={() => setFromUsdt((balance / 1e6).toFixed(2))}>
                  MAX
                </button>
              </div>
            </div>
          </motion.div>
          <motion.div layout className="calc-slot" style={{ order: 2 }} transition={layoutSpring}>
            <div className="calc-card receive">
              <div className="calc-card-top">
                <div className="calc-asset">
                  <RubLogo size={26} />
                  <span>RUB</span>
                </div>
                <span className="calc-hint">Получите</span>
              </div>
              <input
                className="calc-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={rub}
                onChange={(e) => setFromRub(e.target.value)}
              />
            </div>
          </motion.div>
        </div>
      </LayoutGroup>

      <button
        className="cta calc-cta"
        type="button"
        disabled={!canGo}
        onClick={() => {
          haptic('medium');
          nav('/exchange', { state: { usdt } });
        }}
      >
        Обменять USDT → RUB
      </button>
      <p className="calc-available">Доступно: {formatMicros(balance)} USDT</p>
    </div>
  );
}
