'use client';

import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Modal flutuante padrão do console: overlay com blur mostrando a plataforma
 * atrás, card glass centralizado, fecha em Esc / clique-fora / botão ✕.
 * (Mesmo padrão do "Novo canal" em /channels.)
 */
export function Modal({
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
  ariaLabel,
}: {
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  maxWidth?: string;
  ariaLabel?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-0/55 p-4"
      style={{ backdropFilter: 'blur(10px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      onClick={onClose}
    >
      <div
        className={cn('glass-card w-full p-7 shadow-elevated', maxWidth)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight text-ink-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full p-1 text-ink-400 transition-colors hover:text-ink-800"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
