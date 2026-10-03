import { startTransition, useCallback } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Clock3, Home, UserRound } from 'lucide-react';
import { HomePage } from '../pages/Home';
import { ExchangePage } from '../pages/Exchange';
import { HistoryPage } from '../pages/History';
import { ProfilePage } from '../pages/Profile';
import { haptic } from '../lib/api';

const tabs: { to: string; label: string; icon: typeof Home; end?: boolean }[] = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/exchange', label: 'Обмен', icon: ArrowLeftRight },
  { to: '/history', label: 'История', icon: Clock3 },
  { to: '/profile', label: 'Профиль', icon: UserRound },
];

function activeTab(pathname: string): '/' | '/exchange' | '/history' | '/profile' | null {
  if (pathname.startsWith('/wallet')) return null;
  if (pathname.startsWith('/exchange')) return '/exchange';
  if (pathname.startsWith('/history')) return '/history';
  if (pathname.startsWith('/profile')) return '/profile';
  return '/';
}

/**
 * Native-app shell: tab screens stay mounted (keep-alive).
 * No fade/remount on tab switch — that caused blank dark frames.
 * Wallet uses Outlet as a stack overlay.
 */
export function AppShell() {
  const location = useLocation();
  const nav = useNavigate();
  const tab = activeTab(location.pathname);
  const showWallet = location.pathname.startsWith('/wallet');
  const hideNav = showWallet;

  const goTab = useCallback(
    (to: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      if (location.pathname === to) return;
      haptic('light');
      startTransition(() => {
        nav(to);
      });
    },
    [location.pathname, nav],
  );

  return (
    <div className="app-shell">
      <div className="page-viewport keep-alive">
        <div className={`tab-pane${tab === '/' && !showWallet ? ' is-active' : ''}`} aria-hidden={tab !== '/' || showWallet}>
          <HomePage />
        </div>
        <div
          className={`tab-pane${tab === '/exchange' && !showWallet ? ' is-active' : ''}`}
          aria-hidden={tab !== '/exchange' || showWallet}
        >
          <ExchangePage />
        </div>
        <div
          className={`tab-pane${tab === '/history' && !showWallet ? ' is-active' : ''}`}
          aria-hidden={tab !== '/history' || showWallet}
        >
          <HistoryPage />
        </div>
        <div
          className={`tab-pane${tab === '/profile' && !showWallet ? ' is-active' : ''}`}
          aria-hidden={tab !== '/profile' || showWallet}
        >
          <ProfilePage />
        </div>

        {showWallet && (
          <div className="stack-pane is-active">
            <Outlet />
          </div>
        )}
      </div>

      {!hideNav && (
        <nav className="bottom-nav">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              onClick={goTab(t.to)}
              className={({ isActive }) => `nav-item${isActive && !showWallet ? ' active' : ''}`}
            >
              <t.icon size={20} />
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
