'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Ícone "i" com popover explicando o que a página/seção faz. Conteúdo
 * provisório até o time enviar os textos finais — trocar só o `text`.
 */
export function InfoTip({ text, className }: { text: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        aria-label="Sobre esta página"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold',
          'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60',
          open
            ? 'border-accent-400/40 bg-accent-400/15 text-accent-300'
            : 'border-white/[0.10] bg-white/[0.04] text-ink-400 hover:text-ink-700 hover:border-white/[0.18]',
        )}
      >
        i
      </button>
      {open && (
        <div
          role="tooltip"
          className={
            'absolute left-0 top-[calc(100%+8px)] z-50 w-72 rounded-xl border border-white/[0.08] ' +
            'bg-bg-1/95 p-3 text-left text-xs leading-relaxed text-ink-700 shadow-elevated'
          }
          style={{ backdropFilter: 'blur(20px)' }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
