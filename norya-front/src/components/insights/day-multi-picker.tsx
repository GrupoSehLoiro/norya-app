'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseYmd, shiftYmd, todayYmd, ymdFromDate } from '@/lib/day-range';

interface Props {
  /** Dias selecionados (YYYY-MM-DD) — sempre pelo menos um. */
  value: string[];
  onChange: (dates: string[]) => void;
}

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTH_LABEL = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const DAY_LABEL = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

function labelFor(dates: string[]): string {
  if (dates.length === 1) {
    const only = dates[0]!;
    if (only === todayYmd()) return 'Hoje';
    const [y, m, d] = parseYmd(only);
    return DAY_LABEL.format(new Date(y, m - 1, d));
  }
  return `${dates.length} dias selecionados`;
}

/**
 * Seletor de período por DIAS (multi-seleção): clique inclui/exclui dias
 * individuais — dá pra analisar dias não contíguos (ex.: só os dias de um
 * tipo de conteúdo no mês) ou tirar um dia atípico da conta. Atalhos para
 * hoje / últimos 7 / últimos 30. Nunca deixa a seleção vazia.
 */
export function DayMultiPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  // Mês exibido no calendário (YYYY-MM-01 do mês do último dia selecionado).
  const [viewMonth, setViewMonth] = useState(() => {
    const last = [...value].sort().pop() ?? todayYmd();
    return last.slice(0, 8) + '01';
  });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = useMemo(() => new Set(value), [value]);
  const today = todayYmd();

  function toggle(ymd: string) {
    if (selected.has(ymd)) {
      if (value.length === 1) return; // nunca vazio
      onChange(value.filter((d) => d !== ymd));
    } else {
      onChange([...value, ymd].sort());
    }
  }

  function preset(days: number) {
    const list: string[] = [];
    for (let i = days - 1; i >= 0; i--) list.push(shiftYmd(today, -i));
    onChange(list);
  }

  // Grade do mês em exibição: células vazias até o weekday do dia 1.
  const cells = useMemo(() => {
    const [y, m] = parseYmd(viewMonth);
    const first = new Date(y, m - 1, 1);
    const out: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
    const cursor = new Date(first);
    while (cursor.getMonth() === m - 1) {
      out.push(ymdFromDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }, [viewMonth]);

  const [vy, vm] = parseYmd(viewMonth);
  const monthLabel = MONTH_LABEL.format(new Date(vy, vm - 1, 1));
  const nextMonthStart = ymdFromDate(new Date(vy, vm, 1));
  const canGoNext = nextMonthStart <= today;

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
        Período
      </label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-10 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm font-medium text-ink-800 transition-colors hover:border-white/[0.16] focus:border-accent-400/60 focus:outline-none focus:ring-2 focus:ring-accent-400/20"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-400" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        {labelFor(value)}
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-ink-400" aria-hidden>
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Selecionar dias do período"
          className="absolute left-0 top-[70px] z-30 w-72 rounded-xl border border-white/[0.10] bg-bg-1 p-3 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth(ymdFromDate(new Date(vy, vm - 2, 1)))}
              aria-label="Mês anterior"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-500 hover:bg-white/[0.06] hover:text-ink-800"
            >
              ‹
            </button>
            <p className="text-sm font-semibold capitalize text-ink-800">{monthLabel}</p>
            <button
              type="button"
              onClick={() => canGoNext && setViewMonth(nextMonthStart)}
              disabled={!canGoNext}
              aria-label="Próximo mês"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-500 enabled:hover:bg-white/[0.06] enabled:hover:text-ink-800 disabled:opacity-30"
            >
              ›
            </button>
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w, i) => (
              <span key={`${w}-${i}`} className="text-[10px] font-medium text-ink-400">{w}</span>
            ))}
            {cells.map((ymd, i) =>
              ymd === null ? (
                <span key={`empty-${i}`} />
              ) : (
                <button
                  key={ymd}
                  type="button"
                  disabled={ymd > today}
                  onClick={() => toggle(ymd)}
                  aria-pressed={selected.has(ymd)}
                  className={
                    'flex h-8 w-8 items-center justify-center rounded-lg text-xs transition-colors ' +
                    (selected.has(ymd)
                      ? 'bg-accent-400/20 font-semibold text-accent-300 ring-1 ring-accent-400/50'
                      : ymd > today
                        ? 'text-ink-300 opacity-30'
                        : 'text-ink-700 hover:bg-white/[0.07]') +
                    (ymd === today ? ' underline underline-offset-4' : '')
                  }
                >
                  {Number(ymd.slice(8))}
                </button>
              ),
            )}
          </div>

          <div className="mt-3 flex items-center gap-2 border-t border-white/[0.06] pt-3">
            {[
              { label: 'Hoje', days: 1 },
              { label: '7 dias', days: 7 },
              { label: '30 dias', days: 30 },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => preset(p.days)}
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-ink-600 hover:border-white/[0.16] hover:text-ink-800"
              >
                {p.label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-ink-400">{value.length} dia(s)</span>
          </div>
        </div>
      )}
    </div>
  );
}
