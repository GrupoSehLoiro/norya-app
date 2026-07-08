import { jwtDecode } from 'jwt-decode';
import { api, clearToken, getToken, setToken } from './api-client';
import type {
  JwtUser,
  LoginResponse,
  MeResponse,
  RegisterResponse,
} from './types';

export type AccountType = 'streamer' | 'agency' | 'brand';

/** Sign-up: cria conta pendente e dispara o código por email. NÃO loga. */
export async function register(
  email: string,
  password: string,
  displayName?: string,
  accountType?: AccountType,
  document?: string,
): Promise<RegisterResponse> {
  return api.post<RegisterResponse>(
    '/api/v2/auth/register',
    { email, password, displayName, accountType, document },
    { anonymous: true, noAuthRedirect: true },
  );
}

/** Confirma o email com o código de 6 dígitos → emite JWT e loga. */
export async function verifyEmail(
  email: string,
  code: string,
): Promise<JwtUser> {
  const res = await api.post<LoginResponse>(
    '/api/v2/auth/verify-email',
    { email, code },
    { anonymous: true, noAuthRedirect: true },
  );
  setToken(res.accessToken);
  return decodeUser(res.accessToken);
}

export async function resendCode(email: string): Promise<void> {
  await api.post(
    '/api/v2/auth/resend-code',
    { email },
    { anonymous: true, noAuthRedirect: true },
  );
}

/** Login por email (identificador canônico no fluxo novo). */
export async function login(email: string, password: string): Promise<JwtUser> {
  const res = await api.post<LoginResponse>(
    '/api/v2/auth/login',
    { email, password },
    { anonymous: true, noAuthRedirect: true },
  );
  setToken(res.accessToken);
  return decodeUser(res.accessToken);
}

export function logout(): void {
  clearToken();
}

/** Contexto de tenancy/onboarding do usuário logado. */
export async function fetchMe(): Promise<MeResponse> {
  return api.get<MeResponse>('/api/v2/auth/me');
}

export function currentUser(): JwtUser | null {
  const token = getToken();
  if (!token) return null;
  try {
    const decoded = decodeUser(token);
    if (decoded.exp * 1000 < Date.now()) {
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
