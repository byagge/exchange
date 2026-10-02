import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { adminApi, setAdminToken } from '../../lib/adminAuth';

export function AdminLoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('admin@exchange.local');
  const [password, setPassword] = useState('ChangeMe123!');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi<{ token: string }>('/api/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setAdminToken(res.token);
      nav('/admin', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Ошибка входа');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page-atm admin-login">
      <div className="brand" style={{ fontSize: 32 }}>
        Ex<span>change</span>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Вход в админку
      </p>
      <form className="admin-login-form" onSubmit={onSubmit}>
        <div className="input-shell">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Почта"
            autoComplete="username"
          />
        </div>
        <div className="input-shell">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            autoComplete="current-password"
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="cta" type="submit" disabled={busy}>
          {busy ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Loader2 size={18} className="spin" /> Входим…
            </span>
          ) : (
            'Войти'
          )}
        </button>
      </form>
    </div>
  );
}
