import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'light';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    'text-bg-0 font-semibold bg-gradient-to-br from-accent-300 via-accent-400 to-accent-600 ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_20px_rgba(215,254,1,0.25)] ' +
    'hover:from-accent-300 hover:to-accent-500 hover:-translate-y-px ' +
    'disabled:opacity-50 disabled:cursor-not-allowed',
  secondary:
    'bg-white/[0.04] text-ink-800 border border-white/[0.08] ' +
    'hover:bg-white/[0.07] hover:border-white/[0.14]',
  ghost:
    'bg-white/[0.04] text-ink-600 border border-white/[0.08] ' +
    'hover:bg-white/[0.07] hover:text-ink-800 hover:border-white/[0.14]',
  destructive:
    'bg-err/15 text-err border border-err/30 hover:bg-err/25',
  light:
    'bg-white text-bg-0 font-semibold shadow-elevated ' +
    'hover:-translate-y-px',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-6 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-tight',
        'transition-all duration-200 ease-glass',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60',
        variants[variant],
        sizes[size],
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
