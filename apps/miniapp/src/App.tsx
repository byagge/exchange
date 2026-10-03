import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useAuth } from './lib/auth';
import { WalletPage } from './pages/Wallet';

const AdminShell = lazy(() =>
  import('./pages/admin/AdminShell').then((m) => ({ default: m.AdminShell })),
);
const AdminDashboardPage = lazy(() =>
  import('./pages/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboardPage })),
);
const AdminOrdersPage = lazy(() =>
  import('./pages/admin/AdminOrders').then((m) => ({ default: m.AdminOrdersPage })),
);
const AdminUsersPage = lazy(() =>
  import('./pages/admin/AdminUsers').then((m) => ({ default: m.AdminUsersPage })),
);
const AdminMorePage = lazy(() =>
  import('./pages/admin/AdminMore').then((m) => ({ default: m.AdminMorePage })),
);
const AdminSettingsPage = lazy(() =>
  import('./pages/admin/AdminSettings').then((m) => ({ default: m.AdminSettingsPage })),
);
const AdminDepositsPage = lazy(() =>
  import('./pages/admin/AdminDeposits').then((m) => ({ default: m.AdminDepositsPage })),
);
const AdminWithdrawalsPage = lazy(() =>
  import('./pages/admin/AdminWithdrawals').then((m) => ({ default: m.AdminWithdrawalsPage })),
);
const AdminWalletsPage = lazy(() =>
  import('./pages/admin/AdminWallets').then((m) => ({ default: m.AdminWalletsPage })),
);
const AdminBroadcastPage = lazy(() =>
  import('./pages/admin/AdminBroadcast').then((m) => ({ default: m.AdminBroadcastPage })),
);

function Empty() {
  return null;
}

function AdminRoutes() {
  return (
    <Route path="admin">
      <Route path="login" element={<Navigate to="/admin" replace />} />
      <Route
        element={
          <Suspense fallback={<div className="boot-screen"><p className="muted">Загрузка…</p></div>}>
            <AdminShell />
          </Suspense>
        }
      >
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
  const { loading, error, token } = useAuth();

  if (loading && !token) {
    return (
      <div className="boot-screen">
        <div className="brand">
          Ex<span>change</span>
        </div>
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  if (error && !token) {
    return (
      <div className="boot-screen">
        <div className="brand">
          Ex<span>change</span>
        </div>
        <p className="error-text">{error}</p>
        <button className="cta" style={{ marginTop: 16 }} type="button" onClick={() => window.location.reload()}>
          Обновить
        </button>
      </div>
    );
  }

  return (
    <Routes>
      {AdminRoutes()}
      <Route element={<AppShell />}>
        <Route index element={<Empty />} />
        <Route path="exchange" element={<Empty />} />
        <Route path="history" element={<Empty />} />
        <Route path="profile" element={<Empty />} />
        <Route path="wallet" element={<WalletPage />} />
      </Route>
      <Route path="splash" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
