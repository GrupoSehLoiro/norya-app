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

const TOKEN_STORAGE_KEY = 'norya:jwt';
const REFRESH_STORAGE_KEY = 'norya:refresh';

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

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_STORAGE_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

/** Persiste o par emitido pelo login/refresh (o refresh é rotacionado a cada uso). */
export function setTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
  window.localStorage.setItem(REFRESH_STORAGE_KEY, refreshToken);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(REFRESH_STORAGE_KEY);
}

// ─── Refresh: proativo (antes do exp) + reativo (401 → refresh → retry) ─────

/** exp (segundos unix) do JWT, sem depender de lib — null se ilegível. */
function tokenExp(token: string): number | null {
  try {
    const payload = token.split('.')[1]!;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

const REFRESH_SKEW_MS = 60_000; // renova quando falta <1min pro access expirar

// Single-flight: N requests simultâneas com token vencido disparam UM refresh.
// Rotação server-side exige isso — o segundo uso do mesmo refresh é rejeitado.
let refreshInFlight: Promise<boolean> | null = null;

/** Troca o refresh token por um novo par. true = tokens renovados. */
function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await fetch('/api/v2/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        // Refresh inválido/revogado — sessão realmente acabou.
        if (res.status === 401 || res.status === 403) clearToken();
        return false;
      }
      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false; // rede fora — mantém tokens; a request original reporta o erro
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Garante um access token fresco antes de usar (REST e SSE). */
export async function ensureFreshToken(): Promise<string | null> {
  const token = getToken();
  if (!token) return null;
  const exp = tokenExp(token);
  if (exp !== null && exp * 1000 - Date.now() < REFRESH_SKEW_MS && getRefreshToken()) {
    await tryRefresh();
  }
  return getToken();
}

export interface RequestOpts extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Quando true, não inclui Authorization (login etc). */
  anonymous?: boolean;
  /** Quando true, deixa o caller tratar o 401 sem auto-redirect. */
  noAuthRedirect?: boolean;
  /** Interno: já tentamos refresh+retry para esta chamada. */
  _retried?: boolean;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set('Accept', 'application/json');
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (!opts.anonymous) {
    // Proativo: se o access está a <1min do exp, rotaciona antes de usar.
    const token = await ensureFreshToken();
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

  if (res.status === 401 && !opts.anonymous && typeof window !== 'undefined') {
    // Reativo: access rejeitado no meio do caminho → rotaciona e repete UMA vez.
    if (!opts._retried && (await tryRefresh())) {
      return request<T>(path, { ...opts, _retried: true });
    }
    if (!opts.noAuthRedirect) {
      clearToken();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
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
