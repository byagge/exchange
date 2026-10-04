import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useAuth } from './lib/auth';
import { SplashPage } from './pages/Splash';
import { HomePage } from './pages/Home';
import { ExchangePage } from './pages/Exchange';
import { HistoryPage } from './pages/History';
import { ProfilePage } from './pages/Profile';
import { WalletPage } from './pages/Wallet';
import { AdminShell } from './pages/admin/AdminShell';
import { AdminDashboardPage } from './pages/admin/AdminDashboard';
import { AdminOrdersPage } from './pages/admin/AdminOrders';
import { AdminUsersPage } from './pages/admin/AdminUsers';
import { AdminMorePage } from './pages/admin/AdminMore';
import { AdminSettingsPage } from './pages/admin/AdminSettings';
import { AdminDepositsPage } from './pages/admin/AdminDeposits';
import { AdminWithdrawalsPage } from './pages/admin/AdminWithdrawals';
import { AdminWalletsPage } from './pages/admin/AdminWallets';
import { AdminBroadcastPage } from './pages/admin/AdminBroadcast';

function HomeGate() {
  const seen = sessionStorage.getItem('ex_splash') === '1';
  if (!seen) return <Navigate to="/splash" replace />;
  return <HomePage />;
}

function AdminRoutes() {
  return (
    <Route path="admin">
      <Route path="login" element={<Navigate to="/admin" replace />} />
      <Route element={<AdminShell />}>
        <Route index element={<AdminDashboardPage />} />
        <Route path="orders" element={<AdminOrdersPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="more" element={<AdminMorePage />} />
        <Route path="more/settings" element={<AdminSettingsPage />} />
        <Route path="more/deposits" element={<AdminDepositsPage />} />
        <Route path="more/withdrawals" element={<AdminWithdrawalsPage />} />
        <Route path="more/wallets" element={<AdminWalletsPage />} />
        <Route path="more/broadcast" element={<AdminBroadcastPage />} />
        <Route path="settings" element={<Navigate to="/admin/more/settings" replace />} />
      </Route>
    </Route>
  );
}

export default function App() {
  const { loading, error } = useAuth();

  if (loading) {
    return (
      <Routes>
        {AdminRoutes()}
        <Route
          path="*"
          element={
            <div className="splash">
              <div className="splash-center">
                <div className="brand">
                  Ex<span>change</span>
                </div>
                <p className="muted">Загрузка…</p>
              </div>
            </div>
          }
        />
      </Routes>
    );
  }

  if (error) {
    return (
      <Routes>
        {AdminRoutes()}
        <Route
          path="*"
          element={
            <div className="splash">
              <div className="splash-center">
                <div className="brand">
                  Ex<span>change</span>
                </div>
                <p className="error-text">{error}</p>
                <p className="tiny">
                  Dev-вход: <code>?dev=1001</code> (админ по Telegram ID из .env)
                </p>
                <button className="cta" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
                  Обновить
                </button>
              </div>
            </div>
          }
        />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/splash" element={<SplashPage />} />
      {AdminRoutes()}
      <Route element={<AppShell />}>
        <Route index element={<HomeGate />} />
        <Route path="exchange" element={<ExchangePage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="wallet" element={<WalletPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
