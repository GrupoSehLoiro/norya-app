'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-sm',
} as const;

/**
 * Foto de perfil do canal com fallback em monograma (inicial) quando a
 * plataforma ainda não forneceu imagem ou ela falhou ao carregar.
 */
export function ChannelAvatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const initial = (name || '?').charAt(0).toUpperCase();

  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL externa da plataforma (Twitch/Kick CDN)
      <img
        src={src}
        alt={`Foto de ${name}`}
        onError={() => setBroken(true)}
        className={cn(
          'rounded-full border border-white/[0.10] object-cover',
          SIZES[size],
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex items-center justify-center rounded-full border border-white/[0.10]',
        'bg-gradient-to-br from-white/[0.10] to-white/[0.03] font-bold text-ink-700',
        SIZES[size],
        className,
      )}
    >
      {initial}
    </span>
  );
}
