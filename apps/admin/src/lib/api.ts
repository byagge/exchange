'use client';

const API = '';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('ex_admin_token');
}

export function setToken(token: string | null) {
  if (!token) localStorage.removeItem('ex_admin_token');
  else localStorage.setItem('ex_admin_token', token);
}

export async function adminApi<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers || {});
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'Ошибка');
  return data as T;
}
