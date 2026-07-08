'use client';

import { Button } from './button';

export interface DateRangeValue {
  from: string; // ISO date (yyyy-mm-dd) ou ''
  to: string;
}

/**
 * Kit de filtro de período reutilizável (de→até). Usado em mensagens, marcas,
 * anúncios, emojis, moderação. `onApply` dispara a busca; campos vazios = sem
 * limite.
 */
export function DateRangeFilter({
  value,
  onChange,
  onApply,
  children,
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  onApply?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="De">
        <input
          type="date"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className="h-9 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 text-sm text-ink-800 focus:border-accent-400/60 focus:outline-none"
        />
      </Field>
      <Field label="Até">
        <input
          type="date"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className="h-9 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 text-sm text-ink-800 focus:border-accent-400/60 focus:outline-none"
        />
      </Field>
      {children}
      {onApply && (
        <Button size="sm" variant="secondary" onClick={onApply}>
          Aplicar
        </Button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">{label}</label>
      {children}
    </div>
  );
}
