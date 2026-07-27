import { cn } from '@/lib/utils';

/**
 * Ícones de linha (stroke) no mesmo padrão visual do menu lateral —
 * substituem emojis/setas de texto nas telas de auth e onboarding.
 */
function LineIcon({
  d,
  size = 16,
  className,
}: {
  d: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('flex-shrink-0', className)}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export function IconUser({ size, className }: { size?: number; className?: string }) {
  return (
    <LineIcon
      d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1"
      size={size}
      className={className}
    />
  );
}

export function IconBuilding({ size, className }: { size?: number; className?: string }) {
  return (
    <LineIcon
      d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h3a1 1 0 0 1 1 1v11M2 21h20M8 7h2M8 11h2M8 15h2M12 7h1M12 11h1M12 15h1"
      size={size}
      className={className}
    />
  );
}

export function IconChevronRight({ size = 14, className }: { size?: number; className?: string }) {
  return <LineIcon d="m9 6 6 6-6 6" size={size} className={className} />;
}

export function IconChevronLeft({ size = 14, className }: { size?: number; className?: string }) {
  return <LineIcon d="m15 6-6 6 6 6" size={size} className={className} />;
}

export function IconChevronDown({ size = 14, className }: { size?: number; className?: string }) {
  return <LineIcon d="m6 9 6 6 6-6" size={size} className={className} />;
}

export function IconChevronUp({ size = 14, className }: { size?: number; className?: string }) {
  return <LineIcon d="m6 15 6-6 6 6" size={size} className={className} />;
}

export function IconCheck({ size = 14, className }: { size?: number; className?: string }) {
  return <LineIcon d="m4 12.5 5 5L20 6.5" size={size} className={className} />;
}

export function IconX({ size = 12, className }: { size?: number; className?: string }) {
  return <LineIcon d="M6 6l12 12M18 6 6 18" size={size} className={className} />;
}

export function IconPlus({ size = 14, className }: { size?: number; className?: string }) {
  return <LineIcon d="M12 5v14M5 12h14" size={size} className={className} />;
}

export function IconSettings({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('flex-shrink-0', className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function IconLayers({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('flex-shrink-0', className)}
      aria-hidden
    >
      <path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}
