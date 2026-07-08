/**
 * Cliente HTTP único do console.
 *
 * Decisões de design (Senior FAANG):
 *  - URLs relativas (`/api/...`). O `next.config.js` reescreve para o
 *    backend. Cliente nunca conhece o host real → trocável em runtime
 *    via env do servidor sem rebuild.
 *  - Auth header sempre que houver token (localStorage). 401 ⇒ logout
 *    automático + redirect para /login.
 *  - Erros tipados: `ApiError` carrega `status` + `payload` para o caller
 *    decidir o que mostrar.
 *  - SSR-safe: checks `typeof window` antes de tocar `localStorage`.
 */

const TOKEN_STORAGE_KEY = 'sehloro:jwt';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export interface RequestOpts extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Quando true, não inclui Authorization (login etc). */
  anonymous?: boolean;
  /** Quando true, deixa o caller tratar o 401 sem auto-redirect. */
  noAuthRedirect?: boolean;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set('Accept', 'application/json');
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (!opts.anonymous) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const url = path.startsWith('http') ? path : path;
  const body = opts.body === undefined
    ? undefined
    : opts.body instanceof FormData
      ? opts.body
      : JSON.stringify(opts.body);

  const res = await fetch(url, {
    ...opts,
    headers,
    body,
    credentials: 'same-origin',
  });

  if (res.status === 401 && !opts.noAuthRedirect && typeof window !== 'undefined') {
    clearToken();
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  let payload: unknown = null;
  const txt = await res.text();
  if (txt) {
    try {
      payload = JSON.parse(txt);
    } catch {
      payload = txt;
    }
  }

  if (!res.ok) {
    const msg = (payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message: unknown }).message)
      : `HTTP ${res.status}`);
    throw new ApiError(res.status, msg, payload);
  }
  return payload as T;
}

export const api = {
  get:    <T>(path: string, opts?: RequestOpts) => request<T>(path, { ...opts, method: 'GET' }),
  post:   <T>(path: string, body?: unknown, opts?: RequestOpts) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch:  <T>(path: string, body?: unknown, opts?: RequestOpts) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  put:    <T>(path: string, body?: unknown, opts?: RequestOpts) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  delete: <T>(path: string, opts?: RequestOpts) => request<T>(path, { ...opts, method: 'DELETE' }),
};
