import { Navigate, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  ListOrdered,
  Settings,
  Users,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

const tabs = [
  { to: '/admin', label: 'Обзор', icon: LayoutDashboard, end: true },
  { to: '/admin/orders', label: 'Заявки', icon: ListOrdered },
  { to: '/admin/users', label: 'Юзеры', icon: Users },
  { to: '/admin/more', label: 'Ещё', icon: Settings },
];

export function AdminShell() {
  const { user, token, loading } = useAuth();

  if (loading) {
    return <p className="muted" style={{ padding: 20 }}>Загрузка…</p>;
  }

  // Need Telegram user session with isAdmin
  if (!token || !user?.isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="app-shell admin-shell">
      <div className="admin-body page">
        <Outlet />
      </div>
      <nav className="bottom-nav admin-nav">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <t.icon size={20} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
