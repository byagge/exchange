import { useEffect, useMemo, useState } from 'react';
import { LayoutGroup, motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  CreditCard,
  Loader2,
  Phone,
  UserRound,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, formatMicros, haptic } from '../lib/api';
import { BANKS } from '../lib/banks';
import { RubLogo, UsdtLogo } from '../components/AssetLogos';
import { appleEase } from '../lib/motion';

type Quote = {
  direction: 'sell';
  rate: string;
  fromAmountMicros: number;
  feeMicros: number;
  netMicros: number;
  toAmountKopecks: number;
  feePercent: number;
};

type PayoutWay = 'sbp' | 'card';

const USDT_QUICK = [10, 50, 100];

export function ExchangePage() {
  const { token, refreshProfile } = useAuth();
  const nav = useNavigate();
  const location = useLocation() as { state?: { usdt?: string } };

  const [payoutWay, setPayoutWay] = useState<PayoutWay>('sbp');
  const [usdtAmount, setUsdtAmount] = useState(location.state?.usdt || '');
  const [rubAmount, setRubAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [card, setCard] = useState('');
  const [bank, setBank] = useState<string>(BANKS[0]);
  const [bankCustom, setBankCustom] = useState(false);
  const [fio, setFio] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [rate, setRate] = useState('98.01');
  const [balance, setBalance] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const rateNum = Number(rate) || 0;

  useEffect(() => {
    if (!token) return;
    api<{ available: number; rate: string }>('/api/balance', { token }).then((b) => {
      setBalance(b.available);
      if (b.rate) setRate(b.rate);
    });
  }, [token]);

  function setFromUsdt(v: string) {
    setUsdtAmount(v);
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n) || !rateNum) {
      setRubAmount('');
      return;
    }
    setRubAmount((n * rateNum).toFixed(2));
  }

  function setFromRub(v: string) {
    setRubAmount(v);
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n) || !rateNum) {
      setUsdtAmount('');
      return;
    }
    setUsdtAmount((n / rateNum).toFixed(6));
  }

  useEffect(() => {
    if (!token) {
      setQuote(null);
      return;
    }
    const amount = Number(usdtAmount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      setQuote(null);
      return;
    }
    const t = setTimeout(() => {
      api<Quote>(`/api/exchange/quote?amount=${amount}`, { token })
        .then((res) => {
          setQuote(res);
          setRate(res.rate);
        })
        .catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(t);
  }, [usdtAmount, token]);

  const canSubmit = useMemo(() => {
    if (!quote) return false;
    const n = Number(usdtAmount.replace(',', '.'));
    if (!(n > 0)) return false;
    if (!bank.trim() || fio.trim().length < 3) return false;
    if (payoutWay === 'sbp') return phone.replace(/\D/g, '').length >= 10;
    return card.replace(/\D/g, '').length >= 13;
  }, [quote, usdtAmount, payoutWay, phone, card, bank, fio]);

  const receiveRubLabel = useMemo(() => {
    if (!quote) return '0.00';
    return (quote.toAmountKopecks / 100).toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, [quote]);

  async function submit() {
    if (!token || !canSubmit) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api('/api/exchange/orders', {
        method: 'POST',
        token,
        body: JSON.stringify({
          direction: 'sell',
          amountUsdt: Number(usdtAmount.replace(',', '.')),
          method: 'fiat',
          requisites: {
            type: payoutWay,
            phone: payoutWay === 'sbp' ? phone : undefined,
            card: payoutWay === 'card' ? card : undefined,
            bank: bank.trim(),
            fio: fio.trim(),
          },
        }),
      });
      haptic('success');
      setOk('Заявка создана');
      await refreshProfile();
      setTimeout(() => nav('/history'), 900);
    } catch (e: any) {
      setError(e.message || 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  const layoutSpring = { type: 'spring' as const, stiffness: 380, damping: 36, mass: 0.85 };

  return (
    <div className="page page-atm calc-page">
      <div className="page-head">
        <div className="page-head-main">
          <h1 className="page-head-title">Обмен</h1>
          {rateNum > 0 && <span className="page-head-meta">USDT → RUB · 1 USDT {rate} ₽</span>}
        </div>
      </div>

      <LayoutGroup>
        <div className="calc-stack">
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
                value={usdtAmount}
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
                value={rubAmount}
                onChange={(e) => setFromRub(e.target.value)}
              />
              {quote && (
                <p className="tiny" style={{ marginTop: 6 }}>
                  К выплате по курсу: {receiveRubLabel} ₽
                </p>
              )}
            </div>
          </motion.div>
        </div>
      </LayoutGroup>

      <div className="calc-payout">
        <p className="calc-section-label">Реквизиты для выплаты</p>
        <div className="tabs calc-tabs">
          <button
            type="button"
            className={`tab${payoutWay === 'sbp' ? ' active' : ''}`}
            onClick={() => {
              haptic('light');
              setPayoutWay('sbp');
            }}
          >
            <span className="tab-with-icon">
              <Phone size={15} /> СБП
            </span>
          </button>
          <button
            type="button"
            className={`tab${payoutWay === 'card' ? ' active' : ''}`}
            onClick={() => {
              haptic('light');
              setPayoutWay('card');
            }}
          >
            <span className="tab-with-icon">
              <CreditCard size={15} /> Карта
            </span>
          </button>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {payoutWay === 'sbp' ? (
            <motion.div
              key="sbp"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: appleEase }}
            >
              <div className="input-shell">
                <Phone size={18} />
                <input
                  placeholder="+7 900 000-00-00"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="card"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: appleEase }}
            >
              <div className="input-shell">
                <CreditCard size={18} />
                <input
                  placeholder="Номер карты"
                  value={card}
                  onChange={(e) => setCard(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="input-shell" style={{ marginTop: 10 }}>
          <Building2 size={18} />
          <select
            value={bankCustom ? 'Другой' : bank}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'Другой') {
                setBankCustom(true);
                setBank('');
              } else {
                setBankCustom(false);
                setBank(v);
              }
            }}
            style={{
              flex: 1,
              border: 0,
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              outline: 'none',
            }}
          >
            {BANKS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        {bankCustom && (
          <div className="input-shell" style={{ marginTop: 10 }}>
            <Building2 size={18} />
            <input
              placeholder="Название банка"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
            />
          </div>
        )}

        <div className="input-shell" style={{ marginTop: 10 }}>
          <UserRound size={18} />
          <input
            placeholder="ФИО получателя"
            value={fio}
            onChange={(e) => setFio(e.target.value)}
            autoComplete="name"
          />
        </div>
      </div>

      {quote && quote.feePercent > 0 && (
        <p className="calc-fee">
          Комиссия {formatMicros(quote.feeMicros)} USDT ({quote.feePercent}%)
        </p>
      )}

      {error && <p className="error-text">{error}</p>}
      {ok && <p className="calc-ok">{ok}</p>}

      <button className="cta calc-cta" disabled={!canSubmit || busy} onClick={submit}>
        {busy ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={18} className="spin" /> Создаём…
          </span>
        ) : (
          'Создать обмен USDT → RUB'
        )}
      </button>

      <p className="calc-available">Доступно: {formatMicros(balance)} USDT</p>
    </div>
  );
}
