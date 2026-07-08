import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatPct(n: number, digits = 1): string {
  return (n * 100).toFixed(digits) + '%';
}

export function formatRelative(iso: string | Date | undefined | null): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'agora';
  if (s < 60) return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const day = Math.floor(h / 24);
  return `${day}d atrás`;
}

export function formatDate(iso: string | Date | undefined | null): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function classifySentiment(s: { pos: number; neg: number; neu: number }): {
  label: 'positivo' | 'negativo' | 'neutro' | 'misto';
  color: string;
} {
  if (s.pos === 0 && s.neg === 0 && s.neu === 0) {
    return { label: 'neutro', color: 'text-ink-400' };
  }
  if (s.pos > s.neg && s.pos > s.neu) {
    return { label: 'positivo', color: 'text-ok' };
  }
  if (s.neg > s.pos && s.neg > s.neu) {
    return { label: 'negativo', color: 'text-err' };
  }
  if (Math.abs(s.pos - s.neg) < 0.05) {
    return { label: 'misto', color: 'text-warn' };
  }
  return { label: 'neutro', color: 'text-ink-400' };
}
