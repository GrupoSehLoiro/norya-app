/**
 * Pequeno gráfico de barras SVG (sem dep externa).
 * Boa o suficiente pra série temporal de 24-72 buckets.
 */
import { cn } from '@/lib/utils';

interface Props {
  values: number[];
  labels?: string[];
  className?: string;
  color?: string;
  yMin?: number;
  height?: number;
}

export function SparkBars({
  values, labels, className, color = '#d7fe01', height = 80,
}: Props) {
  if (values.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-xs text-ink-400', className)}
        style={{ height }}
      >
        sem dados
      </div>
    );
  }
  const max = Math.max(...values, 1);
  const w = 100;
  const barW = w / values.length;
  return (
    <svg
      viewBox={`0 0 ${w} 100`}
      preserveAspectRatio="none"
      className={cn('w-full', className)}
      style={{ height }}
      role="img"
      aria-label="série temporal"
    >
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * 96);
        const y = 100 - h;
        const x = i * barW + 0.5;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW - 1}
            height={h}
            // via style (não attr) para aceitar cores em var(--...) do tema
            style={{ fill: color }}
            opacity={0.85}
          >
            <title>{labels?.[i] ?? ''}: {v}</title>
          </rect>
        );
      })}
    </svg>
  );
}
