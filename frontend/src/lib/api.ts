export const API = '';
let token = sessionStorage.getItem('monal_token') || '';
export const setToken = (t: string) => { token = t; sessionStorage.setItem('monal_token', t); };
export const getToken = () => token;
export const logout = () => { token = ''; sessionStorage.removeItem('monal_token'); location.href = '/'; };

export async function api(path: string, opts: RequestInit = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && token) logout();
  return { ok: r.ok, status: r.status, data };
}
