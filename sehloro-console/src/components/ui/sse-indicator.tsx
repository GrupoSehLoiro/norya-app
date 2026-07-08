import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

/**
 * Pulse-ringed indicator for SSE / streaming activity.
 */
export function SseIndicator({ className, children, ...rest }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-accent-200 bg-accent-50',
        'px-3 py-1.5 text-xs font-medium text-accent-300',
        className,
      )}
      {...rest}
    >
      <span className="relative inline-block h-2 w-2 rounded-full bg-accent-400">
        <span className="absolute inset-[-4px] rounded-full border border-accent-400 animate-sse-pulse" />
      </span>
      {children}
    </span>
  );
}
