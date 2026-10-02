import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronRight,
  LogOut,
  Megaphone,
  Settings2,
  Wallet,
} from 'lucide-react';
import { setAdminToken } from '../../lib/adminAuth';
import { PageHead } from './PageHead';

const items = [
  {
    to: '/admin/more/broadcast',
    title: 'Рассылка',
    sub: 'Сообщение всем в Telegram',
    icon: Megaphone,
  },
  {
    to: '/admin/more/settings',
    title: 'Настройки',
    sub: 'Курс, комиссии, реквизиты',
    icon: Settings2,
  },
  {
    to: '/admin/more/deposits',
    title: 'Депозиты',
    sub: 'Ончейн и CryptoBot',
    icon: ArrowDownToLine,
  },
  {
    to: '/admin/more/withdrawals',
    title: 'Выводы',
    sub: 'Чек КБ и ончейн',
    icon: ArrowUpRight,
  },
  {
    to: '/admin/more/wallets',
    title: 'Кошельки',
    sub: 'Балансы и сбор',
    icon: Wallet,
  },
];

export function AdminMorePage() {
  const nav = useNavigate();

  return (
    <div>
      <PageHead title="Ещё" />
      <div className="admin-more-list" style={{ marginTop: 10 }}>
        {items.map((it) => (
          <Link key={it.to} to={it.to} className="admin-more-item">
            <div className="hist-icon exchange">
              <it.icon size={18} />
            </div>
            <div className="hist-main">
              <div className="hist-title">{it.title}</div>
              <div className="hist-sub">{it.sub}</div>
            </div>
            <ChevronRight size={16} className="hist-chevron" />
          </Link>
        ))}
        <button
          type="button"
          className="admin-more-item admin-more-logout"
          onClick={() => {
            setAdminToken(null);
            nav('/', { replace: true });
          }}
        >
          <div className="hist-icon withdrawal">
            <LogOut size={18} />
          </div>
          <div className="hist-main">
            <div className="hist-title">В мини-апп</div>
            <div className="hist-sub">Вернуться к профилю пользователя</div>
          </div>
          <ChevronRight size={16} className="hist-chevron" />
        </button>
      </div>
    </div>
  );
}
