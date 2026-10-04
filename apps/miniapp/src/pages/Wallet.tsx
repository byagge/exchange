import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Copy,
  FlaskConical,
  RefreshCw,
  Link2,
  Send,
  Wallet as WalletIcon,
} from 'lucide-react';
import { MetaLine, MetaSep } from '../components/DirectionFlow';
import { useAuth } from '../lib/auth';
import { api, formatMicros, haptic } from '../lib/api';
import { CryptoBotLogo, TonLogo, TronLogo, UsdtLogo } from '../components/AssetLogos';

type Wallet = { id: string; network: 'TON' | 'TRC20'; address: string; asset: string };

export function WalletPage() {
  const nav = useNavigate();
  const { token, user, refreshProfile } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'deposit' | 'withdraw') || 'deposit';
  const [mode, setMode] = useState<'address' | 'cryptobot'>('cryptobot');
  const [network, setNetwork] = useState<'TON' | 'TRC20'>('TRC20');
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [checkUrl, setCheckUrl] = useState('');
  const [amount, setAmount] = useState('');
  const [username, setUsername] = useState(user?.username ? `@${user.username}` : '');
  const [wdMethod, setWdMethod] = useState<'cryptobot' | 'onchain'>('cryptobot');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);
  const [allowSimulate, setAllowSimulate] = useState(false);
  const [cryptoBotOk, setCryptoBotOk] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<{ wallets: Wallet[] }>('/api/wallets/me', { token }).then((r) => setWallets(r.wallets));
    api<{ available: number }>('/api/balance', { token }).then((b) => setBalance(b.available));
    api<{
      allowDepositSimulate?: boolean;
      cryptoBotConfigured?: boolean;
    }>('/api/settings/public')
      .then((s) => {
        setAllowSimulate(!!s.allowDepositSimulate);
        setCryptoBotOk(!!s.cryptoBotConfigured);
      })
      .catch(() => {
        setAllowSimulate(false);
        setCryptoBotOk(false);
      });
  }, [token]);

  async function checkDeposits(silent = false) {
    if (!token) return;
    if (!silent) {
      setChecking(true);
      setErr(null);
    }
    try {
      const r = await api<{
        credited: Array<{ network: string; amountUsdt: number }>;
        errors: string[];
      }>('/api/deposits/check', { method: 'POST', token });
      if (r.credited.length) {
        const sum = r.credited.reduce((a, c) => a + c.amountUsdt, 0);
        haptic('success');
        setMsg(`Зачислено ${sum.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} USDT`);
        await refreshProfile();
        const b = await api<{ available: number }>('/api/balance', { token });
        setBalance(b.available);
      } else if (!silent) {
        setMsg(
          r.errors.length
            ? 'Сеть временно не отвечает — повторите через минуту'
            : 'Новых поступлений пока нет. Транзакции видны после подтверждения сети (1–3 мин).',
        );
        setTimeout(() => setMsg(null), 4000);
      }
    } catch (e: any) {
      if (!silent) setErr(e.message);
    } finally {
      if (!silent) setChecking(false);
    }
  }

  // Пока открыта вкладка пополнения по адресу — сами проверяем зачисления
  useEffect(() => {
    if (!token || tab !== 'deposit' || mode !== 'address') return;
    void checkDeposits(true);
    const id = setInterval(() => void checkDeposits(true), 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab, mode]);

  const current = useMemo(
    () => wallets.find((w) => w.network === network),
    [wallets, network],
  );

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    haptic('success');
    setMsg('Адрес скопирован');
    setTimeout(() => setMsg(null), 1500);
  }

  async function submitCheck() {
    if (!token || !checkUrl) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/api/deposits/cryptobot', {
        method: 'POST',
        token,
        body: JSON.stringify({ checkUrl }),
      });
      haptic('success');
      setMsg('Чек КБ принят — активируем и зачислим на баланс');
      setCheckUrl('');
      await refreshProfile();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    if (!token) return;
    setBusy(true);
    try {
      await api('/api/deposits/simulate', {
        method: 'POST',
        token,
        body: JSON.stringify({ amountUsdt: 25, network }),
      });
      haptic('success');
      setMsg('Тестовое пополнение +25 USDT');
      await refreshProfile();
      const b = await api<{ available: number }>('/api/balance', { token });
      setBalance(b.available);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/api/withdrawals', {
        method: 'POST',
        token,
        body: JSON.stringify({
          amountUsdt: Number(amount.replace(',', '.')),
          method: wdMethod,
          username: wdMethod === 'cryptobot' ? username : undefined,
          address: wdMethod === 'onchain' ? address : undefined,
          network: wdMethod === 'onchain' ? network : undefined,
        }),
      });
      haptic('success');
      setMsg(
        wdMethod === 'cryptobot'
          ? 'Заявка на вывод чеком КБ создана'
          : 'Заявка на ончейн-вывод создана (с MASTER-кошелька)',
      );
      setAmount('');
      await refreshProfile();
      const b = await api<{ available: number }>('/api/balance', { token });
      setBalance(b.available);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    haptic('light');
    nav('/', { replace: true });
  }

  return (
    <div className="page page-atm page-stack">
      <div className="page-head wallet-head">
        <button type="button" className="back-btn" aria-label="Назад" onClick={goBack}>
          <ArrowLeft size={20} strokeWidth={2.25} />
        </button>
        <div className="wallet-head-main">
          <div className="tiny" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <WalletIcon size={14} /> Кошелёк
          </div>
          <div className="balance-value" style={{ fontSize: 32, marginTop: 4 }}>
            {formatMicros(balance)}{' '}
            <span style={{ fontSize: 16, color: 'var(--text-secondary)' }}>USDT</span>
          </div>
        </div>
        <UsdtLogo size={40} />
      </div>

      <div className="tabs">
        <button
          type="button"
          className={`tab${tab === 'deposit' ? ' active' : ''}`}
          onClick={() => setParams({ tab: 'deposit' })}
        >
          Пополнение
        </button>
        <button
          type="button"
          className={`tab${tab === 'withdraw' ? ' active' : ''}`}
          onClick={() => setParams({ tab: 'withdraw' })}
        >
          Вывод
        </button>
      </div>

      {tab === 'deposit' ? (
        <>
          <div className="method-grid" style={{ marginTop: 4 }}>
            <button
              type="button"
              className={`method-card${mode === 'cryptobot' ? ' active' : ''}`}
              onClick={() => setMode('cryptobot')}
            >
              <CryptoBotLogo size={32} />
              <span>Чек КБ</span>
              <small>Активация чека @send</small>
            </button>
            <button
              type="button"
              className={`method-card${mode === 'address' ? ' active' : ''}`}
              onClick={() => setMode('address')}
            >
              <UsdtLogo size={32} />
              <span>Ончейн</span>
              <small>TON / TRC20 на ваш адрес</small>
            </button>
          </div>

          {mode === 'cryptobot' ? (
            <div className="card">
              <p className="muted">
                Вставьте ссылку на чек CryptoBot / @send. Чек активируется на наш аккаунт и сумма
                зачислится на ваш внутренний баланс.
              </p>
              {!cryptoBotOk && (
                <p className="tiny" style={{ marginTop: 8, color: 'var(--warn, #c9a227)' }}>
                  Сессия CryptoBot не настроена — пополнение чеком заработает после TELEGRAM_API_* +
                  CRYPTOBOT_SESSION (или ALLOW_MOCK_PAYOUTS для демо).
                </p>
              )}
              <div className="input-shell" style={{ marginTop: 12 }}>
                <Link2 size={18} />
                <input
                  placeholder="https://t.me/send?start=CQ..."
                  value={checkUrl}
                  onChange={(e) => setCheckUrl(e.target.value)}
                />
              </div>
              <p className="tiny" style={{ marginTop: 8 }}>
                Один чек нельзя использовать повторно.
              </p>
              <button
                type="button"
                className="cta"
                disabled={!checkUrl || busy}
                onClick={submitCheck}
              >
                Активировать чек КБ
              </button>
            </div>
          ) : (
            <div className="card">
              <div className="tabs">
                <button
                  type="button"
                  className={`tab${network === 'TRC20' ? ' active' : ''}`}
                  onClick={() => setNetwork('TRC20')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <TronLogo size={16} /> TRC20
                  </span>
                </button>
                <button
                  type="button"
                  className={`tab${network === 'TON' ? ' active' : ''}`}
                  onClick={() => setNetwork('TON')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <TonLogo size={16} /> TON
                  </span>
                </button>
              </div>
              <p className="tiny">
                Уникальный адрес. После зачисления USDT попадёт на баланс; избыток с депозитных
                адресов свипится на MASTER.
              </p>
              {current && (
                <>
                  <div className="qr-frame">
                    <div className="qr-glow" aria-hidden />
                    <div className="qr-inner">
                      <QRCodeSVG
                        value={current.address}
                        size={168}
                        level="H"
                        bgColor="#FFFFFF"
                        fgColor="#0B0B0F"
                        includeMargin={false}
                        imageSettings={{
                          src: '/assets/tether.svg',
                          height: 34,
                          width: 34,
                          excavate: true,
                        }}
                      />
                    </div>
                    <div className="qr-caption">
                      {network === 'TRC20' ? <TronLogo size={18} /> : <TonLogo size={18} />}
                      <span>
                        <MetaLine>
                          USDT
                          <MetaSep />
                          {network === 'TRC20' ? 'TRC20' : 'TON'}
                        </MetaLine>
                      </span>
                    </div>
                  </div>
                  <div className="address-box">{current.address}</div>
                  <button type="button" className="cta" onClick={() => copy(current.address)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Copy size={16} /> Копировать адрес
                    </span>
                  </button>
                  <button
                    type="button"
                    className="cta secondary"
                    disabled={checking}
                    onClick={() => void checkDeposits(false)}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <RefreshCw size={16} className={checking ? 'spin' : undefined} />
                      {checking ? 'Проверяем сеть…' : 'Проверить пополнение'}
                    </span>
                  </button>
                  {allowSimulate && (
                    <button
                      type="button"
                      className="cta secondary"
                      disabled={busy}
                      onClick={simulate}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <FlaskConical size={16} /> Симулировать +25 USDT
                      </span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <div className="method-grid" style={{ marginTop: 0 }}>
            <button
              type="button"
              className={`method-card${wdMethod === 'cryptobot' ? ' active' : ''}`}
              onClick={() => setWdMethod('cryptobot')}
            >
              <CryptoBotLogo size={28} />
              <span>Чек КБ</span>
              <small>Выдадим чек на @username</small>
            </button>
            <button
              type="button"
              className={`method-card${wdMethod === 'onchain' ? ' active' : ''}`}
              onClick={() => setWdMethod('onchain')}
            >
              <UsdtLogo size={28} />
              <span>Ончейн</span>
              <small>С MASTER → ваш адрес</small>
            </button>
          </div>

          <p className="tiny" style={{ marginTop: 10 }}>
            {wdMethod === 'cryptobot'
              ? ''
              : ''}
          </p>

          <div className="input-shell" style={{ marginTop: 8 }}>
            <UsdtLogo size={20} />
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Сумма USDT"
            />
          </div>
          {wdMethod === 'cryptobot' ? (
            <div className="input-shell" style={{ marginTop: 10 }}>
              <Send size={18} />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@username для чека КБ"
              />
            </div>
          ) : (
            <>
              <div className="tabs" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className={`tab${network === 'TRC20' ? ' active' : ''}`}
                  onClick={() => setNetwork('TRC20')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <TronLogo size={16} /> TRC20
                  </span>
                </button>
                <button
                  type="button"
                  className={`tab${network === 'TON' ? ' active' : ''}`}
                  onClick={() => setNetwork('TON')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <TonLogo size={16} /> TON
                  </span>
                </button>
              </div>
              <div className="input-shell">
                <WalletIcon size={18} />
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={network === 'TRC20' ? 'T...' : 'UQ... / EQ...'}
                />
              </div>
            </>
          )}
          <button
            type="button"
            className="cta"
            disabled={
              busy ||
              !amount ||
              (wdMethod === 'cryptobot' ? username.trim().length < 3 : address.trim().length < 8)
            }
            onClick={withdraw}
          >
            {wdMethod === 'cryptobot' ? 'Вывести чеком КБ' : 'Вывести ончейн'}
          </button>
        </div>
      )}

      {msg && <div className="toast">{msg}</div>}
      {err && <p className="error-text">{err}</p>}
    </div>
  );
}
