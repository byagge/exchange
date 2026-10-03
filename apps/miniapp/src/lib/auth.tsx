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
  /** true only while first auth attempt has no cached session */
  loading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
  login: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const USER_CACHE_KEY = 'ex_user';

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

function bootTelegram() {
  const tg = (window as any).Telegram?.WebApp;
  try {
    tg?.ready?.();
    tg?.expand?.();
    tg?.disableVerticalSwipes?.();
  } catch {
    /* noop */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const cachedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('ex_token') : null;
  const cachedUser = typeof localStorage !== 'undefined' ? readCachedUser() : null;

  const [token, setToken] = useState<string | null>(() => cachedToken);
  const [user, setUser] = useState<User | null>(() => cachedUser);
  // Don't block UI if we already have a session
  const [loading, setLoading] = useState(() => !cachedToken);
  const [error, setError] = useState<string | null>(null);

  const applySession = useCallback((nextToken: string, nextUser: User) => {
    localStorage.setItem('ex_token', nextToken);
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const login = useCallback(async () => {
    setError(null);
    bootTelegram();
    const initData = getTelegramInitData();
    const tg = (window as any).Telegram?.WebApp;
    const startParam = tg?.initDataUnsafe?.start_param as string | undefined;
    const referralCode = startParam?.startsWith('ref_') ? startParam.slice(4) : undefined;
    const res = await api<{ token: string; user: User }>('/api/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData, referralCode }),
    });
    applySession(res.token, res.user);
  }, [applySession]);

  const refreshProfile = useCallback(async () => {
    if (!token) return;
    const res = await api<{ user: User }>('/api/me', { token });
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(res.user));
    setUser(res.user);
  }, [token]);

  useEffect(() => {
    bootTelegram();
    let cancelled = false;

    (async () => {
      try {
        if (token) {
          // Background refresh — UI already visible
          await refreshProfile();
        } else {
          await login();
        }
      } catch {
        localStorage.removeItem('ex_token');
        localStorage.removeItem(USER_CACHE_KEY);
        if (!cancelled) setToken(null);
        try {
          await login();
        } catch (err: any) {
          if (!cancelled) setError(err.message || 'Не удалось войти');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
