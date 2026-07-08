import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'ok' | 'warn' | 'err' | 'accent';

const led: Record<Tone, string> = {
  neutral: 'bg-white/30',
  ok:      'bg-ok shadow-[0_0_0_3px_rgba(110,231,183,0.15)]',
  warn:    'bg-warn shadow-[0_0_0_3px_rgba(251,191,36,0.15)]',
  err:     'bg-err shadow-[0_0_0_3px_rgba(248,113,113,0.18)]',
  accent:  'bg-accent-400 shadow-[0_0_0_3px_rgba(215,254,1,0.18)]',
};

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  children: ReactNode;
}

export function Pill({ className, tone = 'neutral', children, ...rest }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.035]',
        'px-3 py-1.5 text-xs text-ink-600',
        className,
      )}
      {...rest}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', led[tone])} aria-hidden />
      {children}
    </span>
  );
}
