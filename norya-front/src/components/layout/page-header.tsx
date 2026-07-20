import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { InfoTip } from '@/components/ui/info-tip';

interface Props {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Texto do ícone "i" — explica o que a página faz. */
  info?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions, className, info }: Props) {
  return (
    <header className={cn('flex flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}>
      <div>
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="flex items-center gap-2.5 text-3xl font-bold tracking-tight text-ink-800 md:text-4xl">
          <span>{title}</span>
          {info ? <InfoTip text={info} /> : null}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-ink-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
