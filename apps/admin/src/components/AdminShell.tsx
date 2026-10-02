'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { setToken } from '@/lib/api';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/users', label: 'Пользователи' },
  { href: '/orders', label: 'Заявки' },
  { href: '/deposits', label: 'Депозиты' },
  { href: '/withdrawals', label: 'Выводы' },
  { href: '/wallets', label: 'Кошельки / Sweep' },
  { href: '/settings', label: 'Настройки' },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="brand">
          Ex<span>change</span>
        </div>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`nav-link${pathname.startsWith(l.href) ? ' active' : ''}`}
          >
            {l.label}
          </Link>
        ))}
        <button
          className="btn"
          style={{ marginTop: 'auto' }}
          onClick={() => {
            setToken(null);
            router.push('/login');
          }}
        >
          Выйти
        </button>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
