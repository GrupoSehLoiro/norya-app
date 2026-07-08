import { cn } from '@/lib/utils';

export interface StepperStep {
  key: string;
  label: string;
}

/**
 * Indicador de passos do onboarding. Bolinhas numeradas conectadas por linha;
 * o passo atual recebe o acento lime, passos concluídos ficam preenchidos.
 */
export function Stepper({
  steps,
  current,
}: {
  steps: StepperStep[];
  current: number;
}) {
  return (
    <ol className="flex items-center gap-2">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step.key} className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors',
                  active && 'bg-gradient-to-br from-accent-300 to-accent-600 text-bg-0',
                  done && 'bg-accent-400/20 text-accent-400',
                  !active && !done && 'bg-white/[0.05] text-ink-400',
                )}
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                className={cn(
                  'hidden text-xs font-medium sm:block',
                  active ? 'text-ink-800' : 'text-ink-400',
                )}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  'h-px flex-1',
                  i < current ? 'bg-accent-400/40' : 'bg-white/[0.08]',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
