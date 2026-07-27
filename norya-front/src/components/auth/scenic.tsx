import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Kit visual das telas de auth/onboarding: fundo em degradê grafite → verde
 * com brilhos lime, painel escuro arredondado flutuando, rows com ícone +
 * label e pill escuro no item ativo.
 *
 * Cores hardcoded de propósito (não usam os tokens ink/accent): essas telas
 * são escuras-sobre-paisagem independente do tema claro/escuro do app, e os
 * valores arbitrários não são remapeados pelos overrides `html.light`.
 */

// ── Fundo: degradê grafite → verde com brilhos lime (paleta Norya) ───────────
export function Scenic() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#0a0d0b]">
      {/* Base: degradê diagonal grafite → verde profundo */}
      <div className="absolute inset-0 bg-[linear-gradient(155deg,#0a0d0b_0%,#0c130b_42%,#0a1207_78%,#0b1405_100%)]" />
      {/* Brilho lime principal (topo) */}
      <div className="absolute -top-[22%] left-1/2 h-[85vh] w-[85vh] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(215,254,1,0.20)_0%,rgba(168,200,0,0.07)_45%,transparent_70%)] blur-[60px]" />
      {/* Brilho verde secundário (rodapé) dá profundidade ao degradê */}
      <div className="absolute -bottom-[25%] left-[6%] h-[65vh] w-[65vh] rounded-full bg-[radial-gradient(circle,rgba(126,163,0,0.16)_0%,transparent_65%)] blur-[70px]" />
      <div className="absolute -bottom-[18%] right-[4%] h-[55vh] w-[55vh] rounded-full bg-[radial-gradient(circle,rgba(215,254,1,0.10)_0%,transparent_68%)] blur-[70px]" />
      {/* Vinheta suave nas bordas para o painel destacar */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_28%,transparent_52%,rgba(3,6,3,0.62)_100%)]" />
    </div>
  );
}

// ── Painel escuro arredondado ────────────────────────────────────────────────
export function ScenicPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative rounded-[28px] p-4',
        'bg-[rgba(12,16,20,0.78)] backdrop-blur-2xl',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_30px_80px_rgba(0,0,0,0.55)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Row de menu: ícone + label (+ sub) + trailing; ativo = pill escuro ───────
export function MenuRow({
  icon,
  label,
  sub,
  trailing,
  active,
  onClick,
  className,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  sub?: React.ReactNode;
  trailing?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left transition-colors',
        active
          ? 'bg-gradient-to-br from-[#e8ff7a] to-[#d7fe01] shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_20px_rgba(215,254,1,0.25)]'
          : onClick && 'hover:bg-[rgba(255,255,255,0.05)]',
        onClick &&
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(215,254,1,0.6)]',
        className,
      )}
    >
      {icon && (
        <span className={cn('shrink-0', active ? 'text-[#0b0e05]' : 'text-[rgba(255,255,255,0.85)]')}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-[15px] font-medium',
            active ? 'text-[#0b0e05]' : 'text-[#eef1f5]',
          )}
        >
          {label}
        </span>
        {sub && (
          <span
            className={cn(
              'block text-xs',
              active ? 'text-[rgba(11,14,5,0.65)]' : 'text-[rgba(255,255,255,0.45)]',
            )}
          >
            {sub}
          </span>
        )}
      </span>
      {trailing && (
        <span className={cn('shrink-0', active ? 'text-[#0b0e05]' : 'text-[rgba(255,255,255,0.55)]')}>
          {trailing}
        </span>
      )}
    </Tag>
  );
}

// ── Sub-item com bullet (como Display/Appearance/Preferences da referência) ──
export function SubRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3.5 px-4 py-2 pl-[26px]', className)}>
      <span className="size-[5px] shrink-0 rounded-full bg-[rgba(255,255,255,0.35)]" />
      <span className="text-[15px] text-[#eef1f5]">{children}</span>
    </div>
  );
}

// ── Controles de formulário no mesmo idioma visual ───────────────────────────
export function SLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.45)]">
      {children}
    </label>
  );
}

type SInputProps = InputHTMLAttributes<HTMLInputElement>;
export const SInput = forwardRef<HTMLInputElement, SInputProps>(function SInput(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-xl border border-[rgba(255,255,255,0.09)] bg-[rgba(255,255,255,0.04)]',
        'px-3.5 text-sm text-[#eef1f5] placeholder:text-[rgba(255,255,255,0.32)]',
        'transition-colors focus:border-[rgba(215,254,1,0.55)] focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  );
});

type SButtonVariant = 'primary' | 'secondary' | 'ghost';
interface SButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: SButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
}

const sButtonVariants: Record<SButtonVariant, string> = {
  primary:
    'bg-gradient-to-br from-[#e8ff7a] via-[#d7fe01] to-[#a8c800] font-semibold text-[#07090c] ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_20px_rgba(215,254,1,0.25)] ' +
    'hover:-translate-y-px hover:to-[#d7fe01]',
  secondary:
    'border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.07)] text-[#eef1f5] hover:bg-[rgba(255,255,255,0.12)]',
  ghost: 'text-[rgba(255,255,255,0.6)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[#eef1f5]',
};

export const SButton = forwardRef<HTMLButtonElement, SButtonProps>(function SButton(
  { className, variant = 'primary', size = 'md', loading, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-tight',
        'transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,255,255,0.35)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3.5 text-xs' : 'h-10 px-5 text-sm',
        sButtonVariants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  );
});

export function SError({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.10)] px-3.5 py-2.5 text-sm text-[#fca5a5]">
      {children}
    </div>
  );
}

/** Linha divisória fininha, como entre grupos do menu. */
export function SDivider({ className }: { className?: string }) {
  return <div className={cn('mx-4 border-t border-[rgba(255,255,255,0.07)]', className)} />;
}
