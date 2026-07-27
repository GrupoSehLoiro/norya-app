import { jwtDecode } from 'jwt-decode';
import { api, clearToken, getRefreshToken, getToken, setTokens } from './api-client';
import type {
  JwtUser,
  LoginResponse,
  MeResponse,
} from './types';

export type AccountType = 'streamer' | 'agency' | 'brand';

/** Sign-up: cria a conta (já ativa, sem código por email) e loga direto. */
export async function register(
  email: string,
  password: string,
  displayName?: string,
  accountType?: AccountType,
  document?: string,
): Promise<JwtUser> {
  const res = await api.post<LoginResponse>(
    '/api/v2/auth/register',
    { email, password, displayName, accountType, document },
    { anonymous: true, noAuthRedirect: true },
  );
  setTokens(res.accessToken, res.refreshToken);
  return decodeUser(res.accessToken);
}

/** Login por email (identificador canônico no fluxo novo). */
export async function login(email: string, password: string): Promise<JwtUser> {
  const res = await api.post<LoginResponse>(
    '/api/v2/auth/login',
    { email, password },
    { anonymous: true, noAuthRedirect: true },
  );
  setTokens(res.accessToken, res.refreshToken);
  return decodeUser(res.accessToken);
}

export function logout(): void {
  // Revoga a cadeia de refresh no servidor — fire-and-forget: o logout local
  // não pode depender da rede.
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    void api
      .post('/api/v2/auth/logout', { refreshToken }, { noAuthRedirect: true })
      .catch(() => undefined);
  }
  clearToken();
}

/** Contexto de tenancy/onboarding do usuário logado. */
export async function fetchMe(): Promise<MeResponse> {
  return api.get<MeResponse>('/api/v2/auth/me');
}

/** Campos que o próprio usuário pode editar sobre a conta. */
export interface UpdateMePayload {
  displayName?: string;
  locale?: string;
}

/** Auto-edição da conta — devolve o `/me` já atualizado. */
export async function updateMe(payload: UpdateMePayload): Promise<MeResponse> {
  return api.patch<MeResponse>('/api/v2/auth/me', payload);
}

export function currentUser(): JwtUser | null {
  const token = getToken();
  if (!token) return null;
  try {
    const decoded = decodeUser(token);
    if (decoded.exp * 1000 < Date.now()) {
      // Access vencido mas com refresh guardado: a sessão é renovável — o
      // api-client rotaciona o par na primeira chamada autenticada. Derrubar
      // aqui deslogaria o usuário a cada 15min (TTL do access).
      if (getRefreshToken()) return decoded;
      clearToken();
      return null;
    }
    return decoded;
  } catch {
    clearToken();
    return null;
  }
}

function decodeUser(token: string): JwtUser {
  return jwtDecode<JwtUser>(token);
}
