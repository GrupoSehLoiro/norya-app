'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'norya:theme';

/**
 * Botão de troca de tema (claro ↔ escuro). Dark é o padrão; o estado é
 * persistido em localStorage e aplicado antes do paint pelo script no
 * <head> (layout.tsx), então aqui só espelhamos/alternamos a classe `light`
 * em <html>. Mostra lua no escuro e sol no claro.
 */
export function ThemeToggle() {
  const [light, setLight] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.classList.contains('light'));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains('light');
    document.documentElement.classList.toggle('light', next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'light' : 'dark');
    } catch {
      /* localStorage indisponível — apenas não persiste */
    }
    setLight(next);
  }

  const isLight = mounted && light;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? 'Mudar para tema escuro' : 'Mudar para tema claro'}
      title={
        isLight
          ? 'Tema claro. Clique para o padrão (escuro)'
          : 'Tema escuro (padrão). Clique para o claro'
      }
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-ink-600 transition-colors hover:bg-white/[0.08] hover:text-ink-800"
    >
      {isLight ? (
        // sol
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        // lua
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
