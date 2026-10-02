import { api } from './api';

/** Admin API uses the same Mini App user token (Telegram). */
export function getAdminToken() {
  return localStorage.getItem('ex_token') || localStorage.getItem('ex_admin_token');
}

export function setAdminToken(token: string | null) {
  if (!token) localStorage.removeItem('ex_admin_token');
  else localStorage.setItem('ex_admin_token', token);
}

export async function adminApi<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  return api<T>(path, { ...opts, token: getAdminToken() });
}
