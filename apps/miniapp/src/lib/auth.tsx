import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getTelegramInitData } from './api';

type User = {
  id: string;
  telegramId: string;
  username?: string;
  firstName?: string;
  referralCode: string;
  loyaltyVolume: number;
  tradeCount: number;
  rubTurnover: number;
  isAdmin?: boolean;
  loyalty: any;
};

type AuthState = {
  token: string | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
  login: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('ex_token'));
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async () => {
    setError(null);
    const tg = (window as any).Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
    const initData = getTelegramInitData();
    const startParam = tg?.initDataUnsafe?.start_param as string | undefined;
    const referralCode = startParam?.startsWith('ref_') ? startParam.slice(4) : undefined;
    const res = await api<{ token: string; user: User }>('/api/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData, referralCode }),
    });
    localStorage.setItem('ex_token', res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!token) return;
    const res = await api<{ user: User }>('/api/me', { token });
    setUser(res.user);
  }, [token]);

  useEffect(() => {
    (async () => {
      try {
        if (token) {
          await refreshProfile();
        } else {
          await login();
        }
      } catch (e: any) {
        localStorage.removeItem('ex_token');
        setToken(null);
        try {
          await login();
        } catch (err: any) {
          setError(err.message || 'Не удалось войти');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const value = useMemo(
    () => ({ token, user, loading, error, refreshProfile, login }),
    [token, user, loading, error, refreshProfile, login],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider missing');
  return ctx;
}
