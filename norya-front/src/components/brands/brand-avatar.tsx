'use client';

import { useState } from 'react';
import { brandLogoUrl, brandAccent, brandInitials } from '@/lib/brand-visuals';

/**
 * Avatar da marca: mostra o logo (favicon por domínio) quando existe e
 * carrega; senão, um quadrado colorido determinístico com as iniciais.
 * O logo ganha um fundo claro porque muitos favicons são transparentes
 * ou brancos e sumiriam no tema escuro.
 */
export function BrandAvatar({
  name,
  size = 40,
  className = '',
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const url = brandLogoUrl(name);
  const [failed, setFailed] = useState(false);
  const accent = brandAccent(name);
  const radius = Math.round(size * 0.28);

  if (url && !failed) {
    return (
      <span
        className={'inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-white/10 ' + className}
        style={{ width: size, height: size, borderRadius: radius }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
          style={{ padding: Math.round(size * 0.16) }}
        />
      </span>
    );
  }

  return (
    <span
      className={'inline-flex shrink-0 items-center justify-center font-bold ' + className}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: accent.solid,
        color: accent.solidInk,
        fontSize: Math.round(size * 0.4),
        letterSpacing: '-0.03em',
      }}
      aria-hidden
    >
      {brandInitials(name)}
    </span>
  );
}
