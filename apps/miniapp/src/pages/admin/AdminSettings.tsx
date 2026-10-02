import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  Coins,
  Headphones,
  Loader2,
  Percent,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { adminApi } from '../../lib/adminAuth';
import { haptic } from '../../lib/api';
import { BANKS } from '../../lib/banks';
import { PageHead } from './PageHead';

type Tab = 'rate' | 'limits' | 'fees' | 'wallets' | 'fiat' | 'bot';

const TABS: { id: Tab; label: string; icon: typeof Coins }[] = [
  { id: 'rate', label: 'Курс', icon: Coins },
  { id: 'limits', label: 'Лимиты', icon: ShieldAlert },
  { id: 'fees', label: 'Комиссии', icon: Percent },
  { id: 'wallets', label: 'Мастер', icon: Wallet },
  { id: 'fiat', label: 'Фиат', icon: Building2 },
  { id: 'bot', label: 'Бот', icon: Headphones },
];

const RATE_PRESETS = [95, 97, 98, 98.5, 99, 100, 101, 102];
const MIN_DEPOSIT_PRESETS = [5, 10, 20, 25, 50, 100];
const MIN_WITHDRAW_PRESETS = [5, 10, 20, 25, 50];
const WITHDRAW_FEE_PRESETS = [0, 0.5, 1, 1.5, 2, 3];
const EXCHANGE_FEE_PRESETS = [0, 0.5, 1, 1.5, 2, 2.5, 3];
const REFERRAL_PRESETS = [0, 0.5, 1, 1.5, 2, 3, 5];
const SWEEP_PRESETS = [20, 50, 100, 200, 500];
const PAYOUT_TIMER_PRESETS = [10, 15, 30, 45, 60, 90, 120];

export function AdminSettingsPage() {
  const nav = useNavigate();
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('rate');
  const [bankCustom, setBankCustom] = useState(false);

  useEffect(() => {
    adminApi('/api/admin/settings')
      .then((data) => {
        setS(data);
        if (data.fiatReceiveBank && !(BANKS as readonly string[]).slice(0, -1).includes(data.fiatReceiveBank)) {
          setBankCustom(true);
        }
      })
      .catch(console.error);
  }, []);

  function setField(key: string, value: unknown) {
    setS((prev: any) => ({ ...prev, [key]: value }));
  }

  const rateNum = useMemo(() => Number(s?.usdtRubRate || 0), [s?.usdtRubRate]);

  async function save() {
    if (!s) return;
    setBusy(true);
    setMsg(null);
    try {
      const updated = await adminApi('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          usdtRubRate: String(s.usdtRubRate),
          sweepThresholdUsdt: Number(s.sweepThresholdUsdt),
          masterTonAddress: s.masterTonAddress || null,
          masterTrc20Address: s.masterTrc20Address || null,
          minDepositUsdt: Number(s.minDepositUsdt),
          minWithdrawUsdt: Number(s.minWithdrawUsdt),
          withdrawFeeUsdt: Number(s.withdrawFeeUsdt),
          exchangeFeePercent: Number(s.exchangeFeePercent),
          supportUrl: s.supportUrl,
          welcomeText: s.welcomeText,
          rulesText: s.rulesText,
          maintenanceMode: !!s.maintenanceMode,
          referralPercent: Number(s.referralPercent),
          fiatReceivePhone: s.fiatReceivePhone,
          fiatReceiveCard: s.fiatReceiveCard || null,
          fiatReceiveBank: s.fiatReceiveBank,
          fiatReceiveName: s.fiatReceiveName,
          defaultPayoutMinutes: Number(s.defaultPayoutMinutes || 30),
        }),
      });
      setS(updated);
      haptic('success');
      setMsg('Настройки сохранены');
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!s) {
    return (
      <div>
        <PageHead
          title="Настройки"
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
        />
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="admin-settings-page">
      <PageHead
        title="Настройки"
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
      />

      <button
        type="button"
        className={`settings-maint-toggle${s.maintenanceMode ? ' on' : ''}`}
        onClick={() => {
          haptic('medium');
          setField('maintenanceMode', !s.maintenanceMode);
        }}
      >
        <div>
          <strong>Режим обслуживания</strong>
          <span className="tiny">
            {s.maintenanceMode
              ? 'Клиенты видят, что сервис временно недоступен'
              : 'Сервис работает в штатном режиме'}
          </span>
        </div>
        <span className="settings-switch" aria-hidden>
          <span className="settings-switch-knob" />
        </span>
      </button>

      <div className="settings-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`settings-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => {
              haptic('light');
              setTab(t.id);
            }}
          >
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="settings-panel">
        {tab === 'rate' && (
          <>
            <SectionTitle
              title="Курс USDT"
              hint="Сколько рублей за 1 USDT при обмене"
            />
            <div className="settings-hero-value">
              <strong>{Number.isFinite(rateNum) ? rateNum.toLocaleString('ru-RU') : '—'}</strong>
              <span>₽</span>
            </div>
            <ChipRow
              values={RATE_PRESETS}
              current={rateNum}
              suffix="₽"
              onPick={(v) => setField('usdtRubRate', String(v))}
            />
            <label className="admin-field">
              <span className="tiny">Точное значение</span>
              <div className="input-shell">
                <input
                  inputMode="decimal"
                  value={s.usdtRubRate ?? ''}
                  onChange={(e) => setField('usdtRubRate', e.target.value)}
                />
              </div>
            </label>
            <PreviewCard
              lines={[
                `100 USDT ≈ ${(100 * rateNum).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`,
                `10 000 ₽ ≈ ${(10000 / (rateNum || 1)).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} USDT`,
              ]}
            />
          </>
        )}

        {tab === 'limits' && (
          <>
            <SectionTitle title="Мин. депозит" hint="Ниже этой суммы депозит не принимаем" />
            <ChipRow
              values={MIN_DEPOSIT_PRESETS}
              current={Number(s.minDepositUsdt)}
              suffix="USDT"
              onPick={(v) => setField('minDepositUsdt', v)}
            />
            <NumField
              label="Своё значение"
              value={s.minDepositUsdt}
              onChange={(v) => setField('minDepositUsdt', v)}
            />

            <SectionTitle title="Мин. вывод" hint="Минимальная заявка на вывод с баланса" />
            <ChipRow
              values={MIN_WITHDRAW_PRESETS}
              current={Number(s.minWithdrawUsdt)}
              suffix="USDT"
              onPick={(v) => setField('minWithdrawUsdt', v)}
            />
            <NumField
              label="Своё значение"
              value={s.minWithdrawUsdt}
              onChange={(v) => setField('minWithdrawUsdt', v)}
            />

            <SectionTitle
              title="Таймер выплаты"
              hint="По умолчанию, когда оператор направляет сумму клиенту"
            />
            <ChipRow
              values={PAYOUT_TIMER_PRESETS}
              current={Number(s.defaultPayoutMinutes || 30)}
              suffix="мин"
              onPick={(v) => setField('defaultPayoutMinutes', v)}
            />
            <NumField
              label="Минут"
              value={s.defaultPayoutMinutes ?? 30}
              onChange={(v) => setField('defaultPayoutMinutes', v)}
            />

            <SectionTitle
              title="Порог сбора"
              hint="Когда на депозитном адресе достаточно USDT — собираем на мастер"
            />
            <ChipRow
              values={SWEEP_PRESETS}
              current={Number(s.sweepThresholdUsdt)}
              suffix="USDT"
              onPick={(v) => setField('sweepThresholdUsdt', v)}
            />
            <NumField
              label="Своё значение"
              value={s.sweepThresholdUsdt}
              onChange={(v) => setField('sweepThresholdUsdt', v)}
            />
          </>
        )}

        {tab === 'fees' && (
          <>
            <SectionTitle title="Комиссия вывода" hint="Списывается сверху при выводе USDT" />
            <ChipRow
              values={WITHDRAW_FEE_PRESETS}
              current={Number(s.withdrawFeeUsdt)}
              suffix="USDT"
              onPick={(v) => setField('withdrawFeeUsdt', v)}
            />
            <NumField
              label="Своё значение"
              value={s.withdrawFeeUsdt}
              onChange={(v) => setField('withdrawFeeUsdt', v)}
            />

            <SectionTitle title="Комиссия обмена" hint="Процент от суммы обмена USDT" />
            <ChipRow
              values={EXCHANGE_FEE_PRESETS}
              current={Number(s.exchangeFeePercent)}
              suffix="%"
              onPick={(v) => setField('exchangeFeePercent', v)}
            />
            <NumField
              label="Своё значение"
              value={s.exchangeFeePercent}
              onChange={(v) => setField('exchangeFeePercent', v)}
            />

            <SectionTitle title="Реферальный процент" hint="Доля от оборота приглашённого" />
            <ChipRow
              values={REFERRAL_PRESETS}
              current={Number(s.referralPercent)}
              suffix="%"
              onPick={(v) => setField('referralPercent', v)}
            />
            <NumField
              label="Своё значение"
              value={s.referralPercent}
              onChange={(v) => setField('referralPercent', v)}
            />

            <PreviewCard
              lines={[
                `Вывод 100 USDT: комиссия ${Number(s.withdrawFeeUsdt || 0)} USDT`,
                `Обмен 100 USDT: комиссия ${(100 * Number(s.exchangeFeePercent || 0)) / 100} USDT`,
              ]}
            />
          </>
        )}

        {tab === 'wallets' && (
          <>
            <SectionTitle
              title="Мастер-кошельки"
              hint="Сюда собираем USDT с депозитных адресов пользователей"
            />
            <label className="admin-field">
              <span className="tiny">Адрес TON (USDT jetton)</span>
              <div className="input-shell">
                <input
                  value={s.masterTonAddress ?? ''}
                  onChange={(e) => setField('masterTonAddress', e.target.value)}
                  placeholder="EQ… или UQ…"
                  spellCheck={false}
                />
              </div>
            </label>
            <StatusPill ok={!!s.masterTonAddress} okText="TON задан" badText="TON не задан" />

            <label className="admin-field">
              <span className="tiny">Адрес TRC20 (USDT)</span>
              <div className="input-shell">
                <input
                  value={s.masterTrc20Address ?? ''}
                  onChange={(e) => setField('masterTrc20Address', e.target.value)}
                  placeholder="T…"
                  spellCheck={false}
                />
              </div>
            </label>
            <StatusPill ok={!!s.masterTrc20Address} okText="TRC20 задан" badText="TRC20 не задан" />
          </>
        )}

        {tab === 'fiat' && (
          <>
            <SectionTitle
              title="Реквизиты приёма RUB"
              hint="Показываем клиенту при покупке USDT за рубли"
            />
            <label className="admin-field">
              <span className="tiny">Банк</span>
              <div className="settings-select-wrap">
                <select
                  className="settings-select"
                  value={
                    bankCustom
                      ? 'Другой'
                      : (BANKS as readonly string[]).includes(s.fiatReceiveBank)
                        ? s.fiatReceiveBank
                        : 'Другой'
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'Другой') {
                      setBankCustom(true);
                      if ((BANKS as readonly string[]).slice(0, -1).includes(s.fiatReceiveBank)) {
                        setField('fiatReceiveBank', '');
                      }
                    } else {
                      setBankCustom(false);
                      setField('fiatReceiveBank', v);
                    }
                  }}
                >
                  {BANKS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} className="settings-select-ico" aria-hidden />
              </div>
            </label>
            {bankCustom && (
              <label className="admin-field">
                <span className="tiny">Название банка</span>
                <div className="input-shell">
                  <input
                    value={s.fiatReceiveBank ?? ''}
                    onChange={(e) => setField('fiatReceiveBank', e.target.value)}
                    placeholder="Название банка"
                  />
                </div>
              </label>
            )}

            <label className="admin-field">
              <span className="tiny">Получатель</span>
              <div className="input-shell">
                <input
                  value={s.fiatReceiveName ?? ''}
                  onChange={(e) => setField('fiatReceiveName', e.target.value)}
                  placeholder="Иван И."
                />
              </div>
            </label>

            <label className="admin-field">
              <span className="tiny">СБП телефон</span>
              <div className="input-shell">
                <input
                  inputMode="tel"
                  value={s.fiatReceivePhone ?? ''}
                  onChange={(e) => setField('fiatReceivePhone', e.target.value)}
                  placeholder="+7…"
                />
              </div>
            </label>

            <label className="admin-field">
              <span className="tiny">Карта (необязательно)</span>
              <div className="input-shell">
                <input
                  inputMode="numeric"
                  value={s.fiatReceiveCard ?? ''}
                  onChange={(e) => setField('fiatReceiveCard', e.target.value)}
                  placeholder="2200…"
                />
              </div>
            </label>

            <PreviewCard
              lines={[
                s.fiatReceiveBank || 'Банк не выбран',
                s.fiatReceiveName || 'Получатель не указан',
                s.fiatReceivePhone || 'СБП не указан',
              ]}
            />
          </>
        )}

        {tab === 'bot' && (
          <>
            <SectionTitle title="Поддержка" hint="Куда вести пользователя из профиля" />
            <label className="admin-field">
              <span className="tiny">Ссылка</span>
              <div className="input-shell">
                <input
                  value={s.supportUrl ?? ''}
                  onChange={(e) => setField('supportUrl', e.target.value)}
                  placeholder="https://t.me/…"
                />
              </div>
            </label>
            <div className="settings-chips">
              {['https://t.me/', 'https://t.me/support'].map((p) => (
                <button
                  key={p}
                  type="button"
                  className="settings-chip"
                  onClick={() => setField('supportUrl', p)}
                >
                  {p.replace('https://', '')}
                </button>
              ))}
            </div>

            <SectionTitle title="Приветствие бота" hint="Текст в главном меню после /start" />
            <textarea
              className="admin-textarea"
              rows={4}
              value={s.welcomeText || ''}
              onChange={(e) => setField('welcomeText', e.target.value)}
              placeholder="Добро пожаловать…"
            />

            <SectionTitle title="Правила" hint="Показываются до принятия, до главного меню" />
            <textarea
              className="admin-textarea"
              rows={6}
              value={s.rulesText || ''}
              onChange={(e) => setField('rulesText', e.target.value)}
              placeholder="Правила сервиса…"
            />
          </>
        )}
      </div>

      {msg && (
        <p className={msg.includes('сохран') ? 'calc-ok' : 'error-text'} style={{ marginTop: 12 }}>
          {msg}
        </p>
      )}
      <button className="cta" type="button" disabled={busy} onClick={save} style={{ marginTop: 12 }}>
        {busy ? (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <Loader2 size={18} className="spin" /> Сохраняем…
          </span>
        ) : (
          'Сохранить'
        )}
      </button>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="settings-section-title">
      <strong>{title}</strong>
      <span className="tiny">{hint}</span>
    </div>
  );
}

function ChipRow({
  values,
  current,
  suffix,
  onPick,
}: {
  values: number[];
  current: number;
  suffix: string;
  onPick: (v: number) => void;
}) {
  return (
    <div className="settings-chips">
      {values.map((v) => {
        const active = Number(current) === v;
        return (
          <button
            key={v}
            type="button"
            className={`settings-chip${active ? ' active' : ''}`}
            onClick={() => {
              haptic('light');
              onPick(v);
            }}
          >
            {v}
            <span className="settings-chip-suf">{suffix}</span>
          </button>
        );
      })}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="admin-field">
      <span className="tiny">{label}</span>
      <div className="input-shell">
        <input
          inputMode="decimal"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </label>
  );
}

function PreviewCard({ lines }: { lines: string[] }) {
  return (
    <div className="settings-preview">
      {lines.map((l) => (
        <div key={l} className="tiny">
          {l}
        </div>
      ))}
    </div>
  );
}

function StatusPill({
  ok,
  okText,
  badText,
}: {
  ok: boolean;
  okText: string;
  badText: string;
}) {
  return <span className={`settings-pill${ok ? ' ok' : ' bad'}`}>{ok ? okText : badText}</span>;
}
