'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'sehloro.selectedChannelId';

interface Ctx {
  channelId: string | null;
  setChannelId: (id: string | null) => void;
}

const SelectedChannelContext = createContext<Ctx | undefined>(undefined);

/**
 * Provider que mantém o canal escolhido em localStorage. Resolve o
 * pain-point de cada página IA Core ter o próprio `useState` e perder a
 * seleção quando o usuário navega.
 */
export function SelectedChannelProvider({ children }: { children: ReactNode }) {
  const [channelId, setChannelIdState] = useState<string | null>(null);

  // Hidrata do storage no primeiro render do client. Não toca em SSR.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setChannelIdState(stored);
  }, []);

  const setChannelId = useCallback((id: string | null) => {
    setChannelIdState(id);
    if (typeof window === 'undefined') return;
    if (id) {
      window.localStorage.setItem(STORAGE_KEY, id);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const value = useMemo<Ctx>(() => ({ channelId, setChannelId }), [channelId, setChannelId]);

  return (
    <SelectedChannelContext.Provider value={value}>
      {children}
    </SelectedChannelContext.Provider>
  );
}

export function useSelectedChannel(): Ctx {
  const ctx = useContext(SelectedChannelContext);
  if (!ctx) {
    throw new Error('useSelectedChannel precisa estar dentro de <SelectedChannelProvider>');
  }
  return ctx;
}
