'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  currentUser,
  login as doLogin,
  logout as doLogout,
  register as doRegister,
} from '@/lib/auth';
import type { AccountType } from '@/lib/auth';
import type { JwtUser } from '@/lib/types';

interface AuthContextValue {
  user: JwtUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<JwtUser>;
  register: (
    email: string,
    password: string,
    displayName?: string,
    accountType?: AccountType,
    document?: string,
  ) => Promise<JwtUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<JwtUser | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setUser(currentUser());
    setReady(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      async login(email, password) {
        const u = await doLogin(email, password);
        setUser(u);
        return u;
      },
      async register(email, password, displayName, accountType, document) {
        const u = await doRegister(email, password, displayName, accountType, document);
        setUser(u);
        return u;
      },
      logout() {
        doLogout();
        setUser(null);
        router.push('/login');
      },
    }),
    [user, ready, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
