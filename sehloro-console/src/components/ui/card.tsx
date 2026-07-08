import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  accent?: boolean;
  padding?: 'sm' | 'md' | 'lg' | 'none';
}

const padMap = {
  none: 'p-0',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-7',
};

export function Card({ className, accent, padding = 'md', ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'glass-card',
        accent && 'glass-card--accent',
        padMap[padding],
        className,
      )}
      {...rest}
    />
  );
}

interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}

export function CardHeader({ title, description, actions, eyebrow, className }: CardHeaderProps) {
  return (
    <div className={cn('mb-5 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h2 className="text-base font-semibold tracking-tight text-ink-800">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-ink-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
