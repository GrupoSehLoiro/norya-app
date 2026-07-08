import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'positive' | 'negative' | 'accent' | 'warn' | 'twitch' | 'kick';

const tones: Record<Tone, string> = {
  neutral:  'bg-white/[0.05] text-ink-600 border border-white/[0.10]',
  positive: 'bg-ok/10 text-ok border border-ok/30',
  negative: 'bg-err/10 text-err border border-err/30',
  accent:   'bg-accent-100 text-accent-300 border border-accent-200',
  warn:     'bg-warn/10 text-warn border border-warn/30',
  twitch:   'bg-platform-twitch/15 text-platform-twitch border border-platform-twitch/30',
  kick:     'bg-platform-kick/15 text-platform-kick border border-platform-kick/30',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Renders the eyebrow-style pill: uppercase, tighter letter-spacing. */
  eyebrow?: boolean;
}

export function Badge({ className, tone = 'neutral', eyebrow, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        eyebrow && 'uppercase tracking-[0.14em] text-[10px]',
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
